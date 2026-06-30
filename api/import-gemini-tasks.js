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

  // Prepare database rows
  const rows = tasks.map(task => ({
    account_id: task.account_id || '00_UNMAPPED',
    action: task.action || '',
    owner: task.owner || null,
    analysis_date: analysis_date,
    raw_action: {
      source: 'gemini_meet_notes',
      created_at: now
    },
    created_at: now,
    updated_at: now
  }));

  try {
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
