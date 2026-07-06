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

  const payload = req.body || {};
  const subject = payload.subject || '';
  const body = payload.body || payload.plainBody || '';
  const htmlBody = payload.htmlBody || '';
  if (!body && !htmlBody) {
    return res.status(400).json({ error: 'Email body is required.' });
  }

  console.log(`[import-gemini-email] Received email import request. Subject: "${subject || ''}"`);

  // 1. Extract meeting title from subject
  let meetingTitle = subject || 'Reunión sin título';
  const subjectMatch = meetingTitle.match(/Notas:\s*"([^"]+)"/i);
  if (subjectMatch) {
    meetingTitle = subjectMatch[1];
  }

  // 2. Fetch accounts list from Supabase to match the correct account
  let accountId = '00_INTERNAL'; // Default to '00_INTERNAL' (Interno Blackwell) for internal/unmatched meetings
  let matchedAccountName = 'Interno Blackwell';
  try {
    const accResponse = await fetch(`${SB_URL}/rest/v1/wa_account_scores?select=account_id,account_name`, {
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`
      }
    });

    if (accResponse.ok) {
      const accounts = await accResponse.json();

      // Normalize: lowercase, remove accents, collapse spaces and special chars
      const normalize = (str) =>
        (str || '')
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
          .replace(/[^a-z0-9\s]/g, ' ')                    // keep only alphanumeric + space
          .replace(/\s+/g, ' ')                            // collapse multiple spaces
          .trim();

      const titleNorm = normalize(meetingTitle);

      let bestMatch = null;
      let bestScore = 0;

      for (const acc of accounts) {
        const nameNorm = normalize(acc.account_name);
        if (!nameNorm || nameNorm.length < 2) continue;

        // Skip purely numeric or internal-sounding names
        if (/^\d+$/.test(nameNorm)) continue;

        let score = 0;

        // 1. Exact full-name substring match (highest confidence)
        if (titleNorm.includes(nameNorm)) {
          score = 100;
        } else {
          // 2. Word-level match: score based on how many significant words from the
          //    account name appear individually in the title (handles "Ma Ja" → "maja", etc.)
          const nameWords = nameNorm.split(' ').filter(w => w.length >= 3 && !['blackwell', 'bws', 'the', 'and', 'los', 'las', 'del', 'con'].includes(w));
          const titleWords = new Set(titleNorm.split(' '));

          // Also try collapsing consecutive title words (handles spaced-out names like "ma ja" → "maja")
          const titleCollapsed = titleNorm.replace(/\s/g, '');

          let matched = 0;
          for (const w of nameWords) {
            if (titleWords.has(w) || titleCollapsed.includes(w)) matched++;
          }

          if (nameWords.length > 0) {
            const ratio = matched / nameWords.length;
            if (ratio >= 0.5) score = Math.round(ratio * 80); // max 80 for word match
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = acc;
        }
      }

      // Accept match only if confidence is meaningful (at least 1 word matched)
      if (bestMatch && bestScore >= 40) {
        accountId = bestMatch.account_id;
        matchedAccountName = bestMatch.account_name;
      }
    }
  } catch (err) {
    console.error('[import-gemini-email] Error fetching accounts for matching:', err);
  }

  console.log(`[import-gemini-email] Matched meeting title "${meetingTitle}" to account_id: "${accountId}" (${matchedAccountName})`);

  // 3. Parse tasks from the email body
  const bodyForParsing = body || htmlBody.replace(/<[^>]+>/g, '\n');
  const lines = bodyForParsing.split('\n');
  const parsedTasks = [];
  let currentTask = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const cleanLine = line.replace(/^[-*•\s+>]+\s*/, '');
    // Match: [Brandon Pérez, Daniel Padilla] Proyectar Costos: Elaborar la proyeccion...
    const match = cleanLine.match(/^\[([^\]]+)\]\s*([^:]+)\s*:\s*(.+)$/);

    if (match) {
      if (currentTask) {
        parsedTasks.push(currentTask);
      }
      currentTask = {
        owner: match[1].trim(),
        title: match[2].trim(),
        detail: match[3].trim()
      };
    } else {
      if (currentTask) {
        currentTask.detail = `${currentTask.detail} ${cleanLine}`;
      }
    }
  }

  if (currentTask) {
    parsedTasks.push(currentTask);
  }

  const now = new Date().toISOString();
  const analysis_date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

  const tasks = parsedTasks.map(task => ({
    account_id: accountId,
    action: `${task.title}: ${task.detail}`,
    owner: task.owner,
    analysis_date: analysis_date,
    raw_action: {
      source: 'gemini_meet_email_sync',
      email_subject: subject || '',
      email_from: payload.from || '',
      email_to: payload.to || '',
      email_cc: payload.cc || '',
      email_reply_to: payload.replyTo || '',
      email_date: payload.date || null,
      email_message_id: payload.messageId || '',
      email_thread_id: payload.threadId || '',
      email_attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      created_at: now
    },
    created_at: now,
    updated_at: now
  }));

  if (tasks.length === 0) {
    console.log('[import-gemini-email] No tasks found matching the format [Name] Action: Detail');
    return res.status(200).json({ success: true, count: 0, message: 'No tasks extracted from body.' });
  }

  // 3.5 Check for duplicate tasks already imported on this date
  let tasksToInsert = [...tasks];
  try {
    const checkResponse = await fetch(
      `${SB_URL}/rest/v1/wa_tasks?select=action,owner&analysis_date=eq.${encodeURIComponent(analysis_date)}`,
      {
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`
        }
      }
    );
    if (checkResponse.ok) {
      const existingTasks = await checkResponse.json();
      const existingKeys = new Set(existingTasks.map(t => `${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
      tasksToInsert = tasks.filter(t => {
        const key = `${t.owner || ''}::${t.action || ''}`.toLowerCase().trim();
        return !existingKeys.has(key);
      });
    }
  } catch (err) {
    console.error('[import-gemini-email] Error checking for existing tasks:', err);
  }

  if (tasksToInsert.length === 0) {
    console.log('[import-gemini-email] All tasks have already been imported (skipping duplicate email import)');
    return res.status(200).json({
      success: true,
      count: 0,
      message: 'All tasks from this meeting were already imported from another participant.'
    });
  }

  // 4. Save to Supabase
  try {
    const response = await fetch(`${SB_URL}/rest/v1/wa_tasks`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(tasksToInsert)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase insert failed (${response.status}): ${errText}`);
    }

    console.log(`[import-gemini-email] Successfully imported ${tasks.length} tasks into Supabase wa_tasks for account_id "${accountId}"`);
    return res.status(200).json({ 
      success: true, 
      count: tasks.length, 
      matched_account: { id: accountId, name: matchedAccountName },
      tasks_imported: tasks.map(t => ({ owner: t.owner, action: t.action }))
    });
  } catch (err) {
    console.error('[import-gemini-email] Error inserting tasks:', err);
    return res.status(500).json({ error: String(err) });
  }
}
