import { createRequire } from 'module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);

const SB_URL = process.env.SUPABASE_URL || 'https://vqgfkfvywbpjldreuplb.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.1-flash-lite';

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
// LLM analysis (ported from scripts/sync/analyze_meet_transcription.py,
// extended to also return structured action_items in a single call)
// ---------------------------------------------------------------------------

const LLM_SYSTEM_PROMPT = `Eres un analista interno de Blackwell Strategy. Tu tarea es evaluar la transcripción de una junta de estatus (Meet/Zoom/Teams) con un cliente para determinar las señales de satisfacción presentes según la metodología SC de Blackwell.

Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto extra).
`;

function llmUserPrompt(accountName, period, transcript) {
  return `TRANSCRIPCIÓN DE JUNTA
Cliente: ${accountName}
Fecha: ${period}

---
${transcript}
---

INSTRUCCIONES:

PASO 1 — ASISTENCIA Y PUNTUALIDAD
Determina si el cliente (no el equipo Blackwell) asistió a la junta.
Si hay evidencia de que el cliente llegó a tiempo (dentro de los primeros 5 min), marca attended_on_time=true.
Si el cliente llegó tarde o no asistió, ajusta correspondientemente.

PASO 2 — PARTICIPACIÓN ACTIVA
¿El cliente hizo preguntas, aportó contexto, compartió información estratégica sobre su negocio, o lideró partes de la conversación? Evalúa y asigna nivel: "alta", "media", "baja" o "ninguna".

PASO 3 — COMENTARIOS POSITIVOS EXPLÍCITOS
¿El cliente expresó satisfacción, felicitó al equipo, validó resultados o agradeció el trabajo? Detecta el tono general: positivo, neutro, negativo o mixto.

PASO 4 — INFORMACIÓN ESTRATÉGICA COMPARTIDA
¿El cliente compartió información sensible de negocio, nuevos objetivos, contexto interno o datos confidenciales que demuestran confianza en el equipo?

PASO 5 — SEÑALES NEGATIVAS
¿Hay señales de presión, molestia, queja explícita, crítica al equipo o al servicio, o comentarios que indiquen insatisfacción?

PASO 5.5 — EVALUACIÓN DE ENCUESTA (SURVEY)
Identifica si durante la junta se formularon y respondieron de viva voz preguntas directas de satisfacción (encuesta) del cliente:
- Tipo A (Satisfacción General): Ejemplos: "¿cómo calificarías el servicio?", "¿qué tan satisfecho estás con la atención?".
  Si se responde con escala numérica (1 a 10), mapea: 9-10 -> score 100, 7-8 -> score 75, 5-6 -> score 50, 3-4 -> score 25, 1-2 -> score 0.
- Tipo B (Impacto en Objetivo): Ejemplos: "¿el trabajo movió la aguja?", "¿la cobertura refuerza la narrativa?".
  Mapea la respuesta: "Sí claramente/Sí" -> score 100, "En proceso/parcialmente" -> score 60, "Poco" -> score 20, "No" -> score 0.
Si no se hicieron estas preguntas directas y no hay respuesta en la transcripción, pon tanto "question_a" como "question_b" en null.

PASO 6 — CALCULA EL SESION_SCORE
Aplica la siguiente tabla de ajustes partiendo de base=50:
  +25  si hay comentarios positivos explícitos del cliente
  +15  si el cliente asistió y llegó puntual
  +15  si el cliente participó activamente (nivel "alta")
  +10  si el cliente compartió información estratégica
  +5   si participación fue "media" (en lugar de +15)
  0    si participación fue "baja" o "ninguna"
  -15  si tono general fue defensivo o hubo presión/molestia
  -25  si hubo queja explícita o escalamiento
Mínimo: 0. Máximo: 100.

PASO 7 — CHECKLIST DE EVIDENCIA
Genera 3-5 frases "Si:" (señal positiva detectada) o "No:" (señal negativa o ausente) que expliquen el score.

PASO 8 — TAREAS / PRÓXIMOS PASOS
Extrae los compromisos accionables de la junta. Para cada uno indica el responsable exacto mencionado, el tipo de responsable (client|blackwell|shared|unknown), la urgencia (low|medium|high), la fecha límite en formato YYYY-MM-DD o null, y el tipo de trabajo (Reunión / Seguimiento|Campaña|Nota a cliente|Crisis|Media training|Análisis|Reporte|Otro).

RESPONDE con este JSON exacto:
{
  "attended": true_o_false,
  "attended_on_time": true_o_false,
  "participation_level": "alta|media|baja|ninguna",
  "positive_comments": true_o_false,
  "shared_strategic_info": true_o_false,
  "negative_signals": true_o_false,
  "negative_detail": "descripción breve si hay señales negativas, sino null",
  "tone": "positivo|neutro|negativo|mixto",
  "sesion_score": número_entero_0_a_100,
  "checklist": ["Si: ...", "No: ...", ...],
  "reasoning": "explicación breve de 2-3 oraciones del score asignado",
  "action_items": [
    {"action":"...", "owner":"...", "owner_type":"client|blackwell|shared|unknown", "urgency":"low|medium|high", "due_date":"YYYY-MM-DD o null", "work_type":"Reunión / Seguimiento|Campaña|Nota a cliente|Crisis|Media training|Análisis|Reporte|Otro"}
  ],
  "survey": {
    "question_a": {"question":"texto o null", "answer":"respuesta o null", "score":100|75|50|25|0|null},
    "question_b": {"question":"texto o null", "answer":"respuesta o null", "score":100|60|20|0|null}
  }
}
`;
}

async function analyzeTranscript(transcript, accountName, period) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured on the server.');

  const payload = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: llmUserPrompt(accountName, period, (transcript || '').slice(0, 12000)) },
    ],
    max_tokens: 1200,
    temperature: 0.1,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let body;
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/BrandonBlackwell-ui/Sem-foro',
        'X-Title': 'Blackwell Semaforo',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${await resp.text()}`);
    body = await resp.json();
  } finally {
    clearTimeout(timer);
  }

  let raw = (body.choices?.[0]?.message?.content || '').trim();
  raw = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(raw);
  return { parsed, model: body.model || OPENROUTER_MODEL };
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

  // 5. Build the transcript text and a content-hash dedup key. The hash is
  //    stable across mailboxes, so the same Gemini notes forwarded by several
  //    teammates (or re-sent another day) is analyzed & billed only once.
  const transcript = (body && body.trim()) ? body : htmlBody.replace(/<[^>]+>/g, '\n');
  const dedupKey = crypto
    .createHash('sha256')
    .update(`${normalize(subject)}\n${normalize(transcript)}`)
    .digest('hex');

  const now = new Date().toISOString();
  const analysis_date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
  // Meeting month (YYYY-MM) in Mexico City, from the email date when available.
  const meetingDate = payload.date ? new Date(payload.date) : new Date();
  const period = (isNaN(meetingDate.getTime()) ? new Date() : meetingDate)
    .toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })
    .slice(0, 7);

  // 6. DEDUP FILTER — runs BEFORE spending any LLM tokens. If these exact notes
  //    were already analyzed, stop here (no LLM call, no double info).
  try {
    const dupResp = await fetch(
      `${SB_URL}/rest/v1/meet_transcription_analyses?select=id,account_id&dedup_key=eq.${encodeURIComponent(dedupKey)}`,
      { headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` } }
    );
    if (dupResp.ok) {
      const dup = await dupResp.json();
      if (Array.isArray(dup) && dup.length > 0) {
        console.log(`[import-gemini-email] Duplicate notes (dedup_key hit) — skipping LLM. account_id="${dup[0].account_id}"`);
        return res.status(200).json({
          success: true,
          duplicate: true,
          skipped_llm: true,
          message: 'Estas notas ya fueron analizadas (dedup por contenido). No se llamó al LLM.',
          matched_account: { id: accountId, name: matchedAccountName, match_method: matchMethod },
        });
      }
    }
  } catch (err) {
    console.error('[import-gemini-email] Dedup check failed (continuing):', err);
  }

  // 7. Run the LLM analysis (tasks + survey + session). If the LLM is
  //    unavailable, fall back to a regex task parse so tasks are never lost —
  //    and in that case do NOT record the analysis row, leaving it retryable.
  let llm = null;
  let model = null;
  let analysisRecorded = false;
  let tasks = [];

  try {
    const out = await analyzeTranscript(transcript, matchedAccountName, period);
    llm = out.parsed;
    model = out.model;
    tasks = (Array.isArray(llm.action_items) ? llm.action_items : [])
      .filter(it => it && String(it.action || '').trim())
      .map(it => ({
        account_id: accountId,
        action: String(it.action).trim(),
        owner: it.owner || null,
        owner_type: it.owner_type || null,
        urgency: it.urgency || null,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(it.due_date || '') ? it.due_date : null,
        work_type: it.work_type || null,
        analysis_date,
        raw_action: {
          source: 'gemini_meet_email_sync',
          match_method: matchMethod,
          extracted_by: 'llm',
          email_subject: subject || '',
          email_from: payload.from || '',
          email_message_id: payload.messageId || '',
          email_thread_id: payload.threadId || '',
          email_date: payload.date || null,
          created_at: now,
        },
        created_at: now,
        updated_at: now,
      }));
  } catch (err) {
    console.error('[import-gemini-email] LLM analysis failed, falling back to regex tasks:', err);
    const parsedTasks = [];
    let currentTask = null;
    for (let line of transcript.split('\n')) {
      line = line.trim();
      if (!line) continue;
      const cleanLine = line.replace(/^[-*•\s+>]+\s*/, '');
      const m = cleanLine.match(/^\[([^\]]+)\]\s*([^:]+)\s*:\s*(.+)$/);
      if (m) {
        if (currentTask) parsedTasks.push(currentTask);
        currentTask = { owner: m[1].trim(), title: m[2].trim(), detail: m[3].trim() };
      } else if (currentTask) {
        currentTask.detail = `${currentTask.detail} ${cleanLine}`;
      }
    }
    if (currentTask) parsedTasks.push(currentTask);
    tasks = parsedTasks.map(t => ({
      account_id: accountId,
      action: `${t.title}: ${t.detail}`,
      owner: t.owner,
      analysis_date,
      raw_action: {
        source: 'gemini_meet_email_sync',
        match_method: matchMethod,
        extracted_by: 'regex_fallback',
        email_subject: subject || '',
        email_from: payload.from || '',
        email_message_id: payload.messageId || '',
        email_thread_id: payload.threadId || '',
        email_date: payload.date || null,
        created_at: now,
      },
      created_at: now,
      updated_at: now,
    }));
  }

  // 8. Persist the analysis (survey + session) when the LLM succeeded. The
  //    unique dedup_key makes this idempotent under concurrent teammate sends.
  if (llm) {
    const analysisRow = {
      account_id: accountId,
      account_name: matchedAccountName,
      period,
      meeting_title: meetingTitle,
      meeting_date: payload.date || null,
      dedup_key: dedupKey,
      sesion_score: Number.isFinite(Number(llm.sesion_score)) ? Math.round(Number(llm.sesion_score)) : null,
      attended: llm.attended ?? null,
      attended_on_time: llm.attended_on_time ?? null,
      participation_level: llm.participation_level || null,
      positive_comments: llm.positive_comments ?? null,
      shared_strategic_info: llm.shared_strategic_info ?? null,
      negative_signals: llm.negative_signals ?? null,
      negative_detail: llm.negative_detail || null,
      tone: llm.tone || null,
      survey: llm.survey ?? null,
      action_items: Array.isArray(llm.action_items) ? llm.action_items : [],
      checklist: Array.isArray(llm.checklist) ? llm.checklist : [],
      reasoning: llm.reasoning || null,
      source: 'gemini_meet_email',
      email_message_id: payload.messageId || null,
      email_thread_id: payload.threadId || null,
      email_from: payload.from || null,
      model,
      raw_analysis: llm,
      created_at: now,
      updated_at: now,
    };
    try {
      const resp = await fetch(`${SB_URL}/rest/v1/meet_transcription_analyses?on_conflict=dedup_key`, {
        method: 'POST',
        headers: {
          apikey: SB_SERVICE_KEY,
          Authorization: `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(analysisRow),
      });
      if (resp.ok) analysisRecorded = true;
      else console.error(`[import-gemini-email] Analysis insert failed (${resp.status}): ${await resp.text()}`);
    } catch (err) {
      console.error('[import-gemini-email] Error inserting analysis:', err);
    }
  }

  // 9. Mirror action items into wa_tasks, deduped against today's rows.
  let tasksInserted = 0;
  let tasksToInsert = tasks;
  if (tasks.length > 0) {
    try {
      const checkResponse = await fetch(
        `${SB_URL}/rest/v1/wa_tasks?select=action,owner&analysis_date=eq.${encodeURIComponent(analysis_date)}`,
        { headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` } }
      );
      if (checkResponse.ok) {
        const existing = await checkResponse.json();
        const seen = new Set(existing.map(t => `${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
        tasksToInsert = tasks.filter(t => !seen.has(`${t.owner || ''}::${t.action || ''}`.toLowerCase().trim()));
      }
    } catch (err) {
      console.error('[import-gemini-email] Task dedup check failed (continuing):', err);
    }

    if (tasksToInsert.length > 0) {
      try {
        const resp = await fetch(`${SB_URL}/rest/v1/wa_tasks`, {
          method: 'POST',
          headers: {
            apikey: SB_SERVICE_KEY,
            Authorization: `Bearer ${SB_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(tasksToInsert),
        });
        if (resp.ok) tasksInserted = tasksToInsert.length;
        else console.error(`[import-gemini-email] wa_tasks insert failed (${resp.status}): ${await resp.text()}`);
      } catch (err) {
        console.error('[import-gemini-email] Error inserting tasks:', err);
      }
    }
  }

  const surveyDetected = !!(llm && llm.survey && (llm.survey.question_a?.score != null || llm.survey.question_b?.score != null));
  console.log(`[import-gemini-email] account_id="${accountId}" period=${period} analysis_recorded=${analysisRecorded} survey=${surveyDetected} tasks_inserted=${tasksInserted}`);

  return res.status(200).json({
    success: true,
    matched_account: { id: accountId, name: matchedAccountName, match_method: matchMethod },
    period,
    analysis_recorded: analysisRecorded,
    llm_used: !!llm,
    sesion_score: llm ? llm.sesion_score : null,
    survey_detected: surveyDetected,
    survey: llm ? (llm.survey ?? null) : null,
    tasks_inserted: tasksInserted,
    tasks_imported: tasksToInsert.map(t => ({ owner: t.owner, action: t.action })),
  });
}
