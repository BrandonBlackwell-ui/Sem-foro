/**
 * computeMetaMonthly — llamada de IA barata que convierte el texto libre de la meta de
 * entregables en un ENTERO de publicaciones/mes (más robusto que el regex del front).
 * Devuelve null si no hay una meta fija de publicaciones (solo monitoreo/asesoría), o si
 * no hay API key (en ese caso el front cae al regex). Se guarda en drive_account_intel.meta_monthly.
 */
const META_MODEL = process.env.OPENROUTER_MODEL_META || 'google/gemini-3.1-flash-lite';

export async function computeMetaMonthly(metaText) {
  const text = String(metaText || '').trim();
  if (!text) return null;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  const system =
    'Eres analista de contratos de una agencia de comunicación. Extraes la meta MENSUAL de ' +
    'publicaciones/entregables comprometida en el contrato. Respondes SOLO JSON válido.';
  const user =
    'Del siguiente texto de meta de entregables, dime cuántas publicaciones/notas/boletines/' +
    'columnas/colocaciones/impactos se comprometen POR MES, como ENTERO.\n' +
    'Convierte la periodicidad a mensual: trimestral÷3, cuatrimestral÷4, semestral÷6, anual÷12, ' +
    'quincenal×2, semanal×4. Si es un rango, usa el MÍNIMO garantizado. Si el número viene en letra ' +
    '("cuatro"→4) o entre paréntesis ("(4)"→4), úsalo. Si NO hay un número fijo de publicaciones ' +
    '(p.ej. solo monitoreo, reportes o asesoría sin meta de publicaciones), devuelve null.\n' +
    `Texto: """${text}"""\n` +
    'Devuelve JSON: {"meta_mensual": <entero o null>, "razon": "muy breve"}';

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://github.com/BrandonBlackwell-ui/Sem-foro',
        'X-Title': 'Blackwell Semaforo Meta',
      },
      body: JSON.stringify({
        model: META_MODEL,
        temperature: 0,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    const j = JSON.parse(raw);
    const n = j.meta_mensual;
    if (n === null || n === undefined || n === 'null') return null;
    const num = Math.round(Number(n));
    return Number.isFinite(num) && num > 0 && num <= 200 ? num : null;
  } catch {
    return null;
  }
}

export default { computeMetaMonthly };
