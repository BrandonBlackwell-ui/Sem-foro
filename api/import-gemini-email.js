import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ---------------------------------------------------------------------------
// String similarity utilities
// ---------------------------------------------------------------------------

/** Normalize: lowercase, strip accents, collapse non-alphanumeric to single space */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Remove ALL whitespace — "ma ja" → "maja" */
function collapse(str) {
  return str.replace(/\s/g, '');
}

/** Generate character bigrams from a string */
function bigrams(str) {
  const s = collapse(str); // compare without spaces
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Dice coefficient between two bigram sets (0–1) */
function bigramSimilarity(a, b) {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (!ba.size || !bb.size) return 0;
  let intersection = 0;
  for (const g of ba) if (bb.has(g)) intersection++;
  return (2 * intersection) / (ba.size + bb.size);
}

/** Jaro-Winkler distance (0–1). Good for short strings with transpositions. */
function jaroWinkler(s1, s2) {
  s1 = collapse(s1); s2 = collapse(s2);
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  // Winkler prefix boost
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Master account-matching score (0–100).
 * Combines: aliases, exact substring, word overlap, bigram similarity, Jaro-Winkler.
 */
function matchScore(titleNorm, candidateNorm, candidateWords, titleWords, titleCollapsed, titleBigrams) {
  // 0. Skip trivially short candidates
  if (!candidateNorm || candidateNorm.length < 2) return 0;

  // 1. Hard-coded alias match → instant win (handled externally, 100)

  // 2. Exact substring match
  if (titleNorm.includes(candidateNorm)) return 100;
  if (titleCollapsed.includes(collapse(candidateNorm))) return 95;

  // 3. Word-level overlap (significant words, ≥3 chars, not stop words)
  const STOP = new Set(['blackwell','bws','the','and','los','las','del','con','que','una','unos','por','para','mas','pero','como','este','esta','ese','esa']);
  const sigWords = candidateWords.filter(w => w.length >= 3 && !STOP.has(w));
  if (sigWords.length > 0) {
    let wordHits = 0;
    for (const w of sigWords) {
      if (titleWords.has(w) || titleCollapsed.includes(collapse(w))) wordHits++;
    }
    const wordRatio = wordHits / sigWords.length;
    if (wordRatio >= 1.0) return 90;   // all sig words found
    if (wordRatio >= 0.67) return 75;  // most sig words found
    if (wordRatio >= 0.5) return 60;   // at least half found
  }

  // 4. Bigram similarity against the full title (handles character transpositions & spacing)
  const candidateBigrams = bigrams(candidateNorm);
  const bigramSetSize = candidateBigrams.size + titleBigrams.size;
  let bigramIntersection = 0;
  if (bigramSetSize > 0) {
    for (const g of candidateBigrams) if (titleBigrams.has(g)) bigramIntersection++;
    const dice = (2 * bigramIntersection) / bigramSetSize;
    if (dice >= 0.6) return Math.round(dice * 55); // scale to max ~55
  }

  // 5. Jaro-Winkler for short single-word candidates vs each title token
  if (sigWords.length === 1) {
    const cw = sigWords[0];
    let bestJW = 0;
    for (const tw of titleWords) {
      const jw = jaroWinkler(cw, tw);
      if (jw > bestJW) bestJW = jw;
    }
    if (bestJW >= 0.92) return Math.round(bestJW * 50); // max ~46
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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

  console.log(`[import-gemini-email] Subject: "${subject}"`);

  // 1. Extract meeting title from subject
  let meetingTitle = subject || 'Reunión sin título';
  const subjectMatch = meetingTitle.match(/Notas:\s*"([^"]+)"/i);
  if (subjectMatch) meetingTitle = subjectMatch[1];

  // 2. Load aliases (fail-silently)
  let aliases = {};
  try {
    aliases = require('./account_aliases.json');
  } catch {
    console.warn('[import-gemini-email] No account_aliases.json found, proceeding without aliases.');
  }

  // 3. Prepare title tokens
  const titleNorm = normalize(meetingTitle);
  const titleCollapsed = collapse(titleNorm);
  const titleWords = new Set(titleNorm.split(' '));
  const titleBigrams = bigrams(titleNorm);

  // 4. Fetch accounts from Supabase
  let accountId = '00_INTERNAL';
  let matchedAccountName = 'Interno Blackwell';
  let matchMethod = 'default';

  try {
    const accResponse = await fetch(`${SB_URL}/rest/v1/wa_account_scores?select=account_id,account_name`, {
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` }
    });

    if (accResponse.ok) {
      const accounts = await accResponse.json();
      let bestScore = 0;
      let bestMatch = null;
      let bestMethod = 'none';

      for (const acc of accounts) {
        // Skip internal bucket itself
        if (acc.account_id === '00_INTERNAL') continue;

        const nameNorm = normalize(acc.account_name);
        const nameWords = nameNorm.split(' ');

        // A. Alias check (highest priority)
        const accAliases = (aliases[acc.account_id] || []).map(normalize);
        let aliasHit = false;
        for (const alias of accAliases) {
          if (
            titleNorm.includes(alias) ||
            titleCollapsed.includes(collapse(alias)) ||
            bigramSimilarity(titleNorm, alias) > 0.7
          ) {
            aliasHit = true;
            break;
          }
        }
        if (aliasHit && 100 > bestScore) {
          bestScore = 100;
          bestMatch = acc;
          bestMethod = 'alias';
          continue;
        }

        // B. Multi-signal score
        const score = matchScore(titleNorm, nameNorm, nameWords, titleWords, titleCollapsed, titleBigrams);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = acc;
          bestMethod = `score(${score})`;
        }
      }

      // Minimum confidence threshold: 40/100
      if (bestMatch && bestScore >= 40) {
        accountId = bestMatch.account_id;
        matchedAccountName = bestMatch.account_name;
        matchMethod = bestMethod;
      }
    }
  } catch (err) {
    console.error('[import-gemini-email] Error fetching accounts:', err);
  }

  console.log(`[import-gemini-email] "${meetingTitle}" → account_id: "${accountId}" (${matchedAccountName}) via ${matchMethod}`);

  // 5. Parse tasks from the email body (format: [Responsable] Título: Detalle)
  const bodyForParsing = body || htmlBody.replace(/<[^>]+>/g, '\n');
  const lines = bodyForParsing.split('\n');
  const parsedTasks = [];
  let currentTask = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const cleanLine = line.replace(/^[-*•\s+>]+\s*/, '');
    const match = cleanLine.match(/^\[([^\]]+)\]\s*([^:]+)\s*:\s*(.+)$/);
    if (match) {
      if (currentTask) parsedTasks.push(currentTask);
      currentTask = { owner: match[1].trim(), title: match[2].trim(), detail: match[3].trim() };
    } else if (currentTask) {
      currentTask.detail = `${currentTask.detail} ${cleanLine}`;
    }
  }
  if (currentTask) parsedTasks.push(currentTask);

  const now = new Date().toISOString();
  const analysis_date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });

  const tasks = parsedTasks.map(task => ({
    account_id: accountId,
    action: `${task.title}: ${task.detail}`,
    owner: task.owner,
    analysis_date,
    raw_action: {
      source: 'gemini_meet_email_sync',
      match_method: matchMethod,
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
    return res.status(200).json({ success: true, count: 0, message: 'No tasks extracted from body.' });
  }

  // 6. Deduplicate against today's existing tasks
  let tasksToInsert = [...tasks];
  try {
    const checkResponse = await fetch(
      `${SB_URL}/rest/v1/wa_tasks?select=action,owner&analysis_date=eq.${encodeURIComponent(analysis_date)}`,
      { headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` } }
    );
    if (checkResponse.ok) {
      const existingTasks = await checkResponse.json();
      const existingKeys = new Set(existingTasks.map(t => `${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
      tasksToInsert = tasks.filter(t => !existingKeys.has(`${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
    }
  } catch (err) {
    console.error('[import-gemini-email] Error checking for duplicates:', err);
  }

  if (tasksToInsert.length === 0) {
    return res.status(200).json({ success: true, count: 0, message: 'All tasks already imported.' });
  }

  // 7. Save to Supabase
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
    console.log(`[import-gemini-email] Imported ${tasksToInsert.length} tasks for account_id "${accountId}"`);
    return res.status(200).json({
      success: true,
      count: tasksToInsert.length,
      matched_account: { id: accountId, name: matchedAccountName, match_method: matchMethod },
      tasks_imported: tasksToInsert.map(t => ({ owner: t.owner, action: t.action }))
    });
  } catch (err) {
    console.error('[import-gemini-email] Error inserting tasks:', err);
    return res.status(500).json({ error: String(err) });
  }
}
