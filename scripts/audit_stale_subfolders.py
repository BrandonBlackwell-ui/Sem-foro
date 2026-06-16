#!/usr/bin/env python3
"""
audit_stale_subfolders.py
-------------------------
Detecta y reporta subfolders con datos posiblemente stale en accounts_status.json.

NO ejecuta el re-crawl directo a Drive — eso requiere correr el SKILL del cron
con un agente que tenga acceso a las MCP de Drive. Este script identifica los
candidatos, escribe un reporte CSV+JSON, y permite priorizar manualmente o
alimentar la próxima corrida del cron con la lista exacta de subfolderIds que
necesitan re-verificación.

USO:
    python3 audit_stale_subfolders.py
        → Lista de candidatos a stdout + escribe stale_audit_<fecha>.json

    python3 audit_stale_subfolders.py --max-age-days 7 --only-critical
        → Solo slots 01.* con age > 7 días

    python3 audit_stale_subfolders.py --json-out /path/to/output.json
        → Output JSON a archivo específico

POLÍTICA DE STALENESS (v4.1):
  1. Slots críticos siempre: nombre empieza con "01." (Contrato_OC)
  2. Root tocado: cuenta con folderModifiedTime en los últimos N días
  3. Stale >7 días: last_verified_at ausente o > N días
  4. Sospechoso: source=carried_forward_from_prior_sync Y fileCount=0
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta, timezone

# Auto-detecta path: macOS native vs sandbox
_CANDIDATES = [
    '/Users/estebanhernandeztames/Desktop/Blackwell/data',
    '/sessions/zealous-charming-heisenberg/mnt/Blackwell/data',
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if os.path.dirname(os.path.abspath(__file__)).endswith('scripts') else None,
]
DATA = next((p for p in _CANDIDATES if p and os.path.exists(os.path.join(p, 'accounts_status.json'))), _CANDIDATES[0])

def parse_iso(s):
    if not s or s == 'never': return None
    s = s.replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None

def is_stale(sub, now, max_age_days, name=''):
    """Devuelve (es_stale: bool, motivos: [str])"""
    motivos = []
    fc = sub.get('fileCount')
    src = sub.get('source', '') or ''
    lva = sub.get('last_verified_at')
    lva_dt = parse_iso(lva) if lva else None

    # 1. Slots críticos siempre
    if name.startswith('01.') or name.startswith('01 '):
        motivos.append('slot_critico_01')

    # 4. Sospechoso
    if 'carried_forward' in src and (fc == 0 or fc is None):
        motivos.append('sospechoso_carried_forward_fc0')

    # 3. Stale >N días
    if lva is None or lva == 'never':
        motivos.append('last_verified_at_ausente')
    elif lva_dt and (now - lva_dt).days > max_age_days:
        motivos.append(f'last_verified_at_age>{max_age_days}d')

    return (len(motivos) > 0, motivos)

def main():
    ap = argparse.ArgumentParser(description='Audita subfolders con datos stale.')
    ap.add_argument('--max-age-days', type=int, default=7, help='Umbral en días para last_verified_at (default 7)')
    ap.add_argument('--only-critical', action='store_true', help='Sólo slots 01.* (Contrato_OC)')
    ap.add_argument('--only-suspect', action='store_true', help='Sólo carried_forward + fileCount=0')
    ap.add_argument('--json-out', type=str, help='Escribir output JSON a este path')
    ap.add_argument('--snapshot', type=str, default=f'{DATA}/accounts_status.json', help='Path del accounts_status.json')
    ap.add_argument('--root-touch-days', type=int, default=2, help='N días para considerar root reciente (default 2)')
    args = ap.parse_args()

    with open(args.snapshot) as f:
        status = json.load(f)

    now = datetime.now(timezone.utc)
    cutoff_root = now - timedelta(days=args.root_touch_days)

    candidates = []
    total_subs = 0
    for a in status.get('accounts', []):
        folder_title = a.get('folderTitle', '?')
        root_mt_dt = parse_iso(a.get('folderModifiedTime') or '')
        root_recent = root_mt_dt and root_mt_dt > cutoff_root

        for name, sub in (a.get('subfolderActivity') or {}).items():
            if not isinstance(sub, dict): continue
            total_subs += 1
            es_stale, motivos = is_stale(sub, now, args.max_age_days, name=name)

            if root_recent:
                motivos.append('root_touched_recent')
                es_stale = True

            if args.only_critical and 'slot_critico_01' not in motivos:
                continue
            if args.only_suspect and 'sospechoso_carried_forward_fc0' not in motivos:
                continue

            if es_stale:
                candidates.append({
                    'account': folder_title,
                    'account_number': a.get('number'),
                    'subfolder_name': name,
                    'subfolderId': sub.get('subfolderId'),
                    'fileCount': sub.get('fileCount'),
                    'latestFile': sub.get('latestFile'),
                    'latestModified': sub.get('latestModified'),
                    'source': sub.get('source'),
                    'last_verified_at': sub.get('last_verified_at'),
                    'motivos': motivos,
                    'priority': priority_score(motivos)
                })

    candidates.sort(key=lambda c: (-c['priority'], c['account_number'] or '99'))

    # ---- Print ----
    print(f"\nAudit stale subfolders — accounts_status.json @ {status.get('syncedAt','?')}")
    print(f"Total subfolders analizados: {total_subs}")
    print(f"Candidatos a re-verificación: {len(candidates)}")
    print(f"Política: max_age_days={args.max_age_days}, root_touch_days={args.root_touch_days}, only_critical={args.only_critical}, only_suspect={args.only_suspect}")
    print()
    print(f"{'Pri':>3} | {'Cuenta':40s} | {'Subfolder':38s} | {'fc':>4s} | {'src/age'}")
    print('-' * 130)
    for c in candidates[:80]:
        fc = c['fileCount'] if c['fileCount'] is not None else '?'
        src_age = c.get('source','') or '?'
        if c.get('last_verified_at') and c['last_verified_at'] != 'never':
            lva_dt = parse_iso(c['last_verified_at'])
            if lva_dt:
                age = (now - lva_dt).days
                src_age = f"{src_age} (age={age}d)"
        else:
            src_age = f"{src_age} (no_lva)"
        print(f"{c['priority']:>3} | {c['account'][:40]:40s} | {c['subfolder_name'][:38]:38s} | {str(fc):>4s} | {src_age[:60]}")
    if len(candidates) > 80:
        print(f"\n... ({len(candidates) - 80} más en el JSON output)")

    # ---- Write JSON output ----
    if args.json_out:
        out_path = args.json_out
    else:
        ts = now.strftime('%Y%m%dT%H%M')
        out_path = f'{DATA}/scripts/stale_audit_{ts}.json'
    with open(out_path, 'w') as f:
        json.dump({
            'generated_at': now.isoformat(),
            'snapshot_synced_at': status.get('syncedAt'),
            'policy': {
                'max_age_days': args.max_age_days,
                'root_touch_days': args.root_touch_days,
                'only_critical': args.only_critical,
                'only_suspect': args.only_suspect,
            },
            'total_subfolders_analyzed': total_subs,
            'candidates_count': len(candidates),
            'candidates': candidates,
        }, f, indent=2, ensure_ascii=False)
    print(f"\nJSON output: {out_path}")
    print(f"\nPara aplicar fixes, alimentar este JSON al cron (Step 2.6) o ejecutar hotfix manual.")

def priority_score(motivos):
    """Asigna prioridad numérica al candidato.
    Mayor número = más urgente."""
    score = 0
    if 'slot_critico_01' in motivos: score += 100
    if 'sospechoso_carried_forward_fc0' in motivos: score += 50
    if 'root_touched_recent' in motivos: score += 30
    if 'last_verified_at_ausente' in motivos: score += 20
    if any('age>' in m for m in motivos): score += 10
    return score

if __name__ == '__main__':
    main()
