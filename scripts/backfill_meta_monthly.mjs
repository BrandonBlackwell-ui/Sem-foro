// Backfill: calcula meta_monthly (IA barata) para todas las filas actuales de
// drive_account_intel que tengan meta_entregables. Uso: node scripts/backfill_meta_monthly.mjs
import { computeMetaMonthly } from '../api/_metaMonthly.js';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const rows = await (await fetch(`${url}/rest/v1/drive_account_intel?select=account_number,meta_entregables,meta_monthly`, { headers: h })).json();
console.log(`${rows.length} cuentas en drive_account_intel`);

let updated = 0, nulled = 0, skipped = 0;
for (const r of rows) {
  const text = (r.meta_entregables || '').trim();
  if (!text) { skipped++; continue; }
  const meta = await computeMetaMonthly(text);
  await fetch(`${url}/rest/v1/drive_account_intel?account_number=eq.${encodeURIComponent(r.account_number)}`, {
    method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({ meta_monthly: meta }),
  });
  if (meta == null) nulled++; else updated++;
  console.log(`  ${r.account_number}: "${text.slice(0, 45)}" → meta_monthly=${meta}`);
}
console.log(`\nListo. Con meta: ${updated} | sin meta fija (null): ${nulled} | sin texto: ${skipped}`);
