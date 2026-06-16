import json
import re

TICK3 = chr(96) * 3

raw = open('drive_intelligence.js', 'r', encoding='utf-8').read().split('=', 1)[1].strip().rstrip(';')
di = json.loads(raw)

TEXT_FIELDS = ('content_summary', 'business_risk', 'recommended_action', 'opportunity')
EXTRA_FIELDS = ('key_facts', 'dated_deltas', 'pq_assessment', 'sc_signals',
                'co_assessment', 'media_reconciliation',
                'score_adjustment_recommendation', 'monday_ticket')

fixed = 0
for a in di['accounts']:
    summ = a.get('account_summary', {})
    if not isinstance(summ, dict):
        continue

    for field in TEXT_FIELDS:
        cs = summ.get(field, '')
        if not isinstance(cs, str):
            continue
        s = cs.strip()
        if not s.startswith(TICK3):
            continue

        # Strip backtick fence
        parts = s.split(TICK3)
        candidates = [p[4:] if p.lstrip().startswith('json') else p for p in parts]
        body = max(candidates, key=len).strip()

        # 1. Try full JSON parse
        try:
            nested = json.loads(body)
            if isinstance(nested, dict):
                for k in TEXT_FIELDS + EXTRA_FIELDS:
                    if k in nested and nested[k] and (k not in summ or not summ[k]):
                        summ[k] = nested[k]
                if field in nested and isinstance(nested[field], str):
                    summ[field] = nested[field]
                a['account_summary'] = summ
                fixed += 1
                print(f'JSON-fixed {a.get("account_name", "?")}')
                break
        except Exception:
            pass

        # 2. Regex fallback for truncated JSON: extract each text field
        patched = False
        for f2 in TEXT_FIELDS:
            cur = summ.get(f2, '')
            if cur and isinstance(cur, str) and not cur.strip().startswith(TICK3):
                continue  # already clean
            pattern = '"' + f2 + r'"\s*:\s*"((?:[^"\\]|\\.)*)'
            m = re.search(pattern, body)
            if m:
                extracted = m.group(1)
                # Unescape basic sequences
                extracted = extracted.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
                if len(extracted) > 20:
                    if len(extracted) > 100:
                        extracted = extracted + ' …[truncado]'
                    summ[f2] = extracted
                    patched = True

        if patched:
            a['account_summary'] = summ
            fixed += 1
            name = a.get('account_name', a.get('number', '?'))
            print(f'Regex-fixed [{name}]: {str(summ.get(field, ""))[:80]}')
        break

print(f'Total fixed: {fixed}')

json_str = json.dumps(di, ensure_ascii=False, indent=2)
with open('drive_intelligence.js', 'w', encoding='utf-8') as f:
    f.write(f'window.DRIVE_INTELLIGENCE = {json_str};\n')
print('Saved drive_intelligence.js')
