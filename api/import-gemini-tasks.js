const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (!SB_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY is not configured on the server.' });
  }

  const { tasks } = req.body || {};
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'No tasks provided or invalid format.' });
  }

  // Get current date in Mexico City timezone (format: YYYY-MM-DD)
  const analysis_date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
  const now = new Date().toISOString();

  // Prepare database rows. email_subject viaja en raw_action porque la vista
  // Reuniones del dashboard agrupa por él (sin el campo, TODAS las tareas de todas
  // las juntas colapsaban en una sola "Reunión sin título").
  let rows = tasks.map(task => ({
    account_id: task.account_id || '00_UNMAPPED',
    action: task.action || '',
    owner: task.owner || null,
    analysis_date: analysis_date,
    raw_action: {
      source: 'gemini_meet_notes',
      email_subject: task.email_subject || task.meeting_title || req.body?.subject || '',
      created_at: now
    },
    created_at: now,
    updated_at: now
  }));

  try {
    // Dedup: este endpoint insertaba SIN llave, así que cada re-POST (retry del Apps
    // Script, doble clic) duplicaba las tareas — y cada duplicado creaba su propio
    // item en Monday. Se filtra contra las tareas de la misma cuenta en 7 días.
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const accountIds = [...new Set(rows.map(r => r.account_id))];
    const checkResp = await fetch(
      `${SB_URL}/rest/v1/wa_tasks?select=account_id,action,owner&account_id=in.(${accountIds.map(encodeURIComponent).join(',')})&analysis_date=gte.${since}&limit=2000`,
      { headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` } }
    );
    if (checkResp.ok) {
      const existing = await checkResp.json();
      const seen = new Set(existing.map(t => `${t.account_id}::${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
      rows = rows.filter(r => !seen.has(`${r.account_id}::${r.owner || ''}::${r.action || ''}`.toLowerCase().trim()));
    }
    if (rows.length === 0) {
      console.log('[import-gemini-tasks] Todas las tareas ya existían (dedup): nada que insertar.');
      return res.status(200).json({ success: true, count: 0, deduped: tasks.length });
    }

    // Insert tasks into wa_tasks table in Supabase
    const response = await fetch(`${SB_URL}/rest/v1/wa_tasks`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(rows)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase insert failed (${response.status}): ${errText}`);
    }

    console.log(`[import-gemini-tasks] Successfully imported ${rows.length} tasks into Supabase wa_tasks`);
    return res.status(200).json({ success: true, count: rows.length });
  } catch (err) {
    console.error('[import-gemini-tasks] Error inserting tasks:', err);
    return res.status(500).json({ error: String(err) });
  }
}
