# WhatsApp Daily Analysis

This replaces the old Google Drive reading pipeline.

## 1. Supabase SQL

Run this file in Supabase SQL Editor:

```text
supabase/migrations/002_wa_daily_analysis.sql
```

It creates:

- `wa_account_scores`: base score, current score, cumulative delta.
- `wa_daily_analysis`: one LLM analysis per WhatsApp group per day.

Existing `wa_messages` rows are not moved or deleted.

## 2. Required GitHub Secrets

Add these in GitHub repo settings:

```text
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
```

Optional GitHub variable:

```text
WA_ANALYSIS_MODEL=claude-haiku-4-5
```

## 3. Daily Behavior

The workflow runs once per day and:

1. Reads only yesterday's WhatsApp messages.
2. Groups them by `account_id` + `group_jid`.
3. Skips groups with no message text.
4. Asks the LLM for a conservative score delta from `-10` to `+10`.
5. Writes one row to `wa_daily_analysis`.
6. Recalculates `wa_account_scores.current_score` as `base_score + sum(score_delta)`.

Re-running the same date updates that group's row instead of creating duplicates.

## 4. Manual Run

From GitHub Actions, run `WhatsApp daily analysis` manually and optionally pass:

```text
2026-06-17
```

Local command:

```bash
python scripts/sync/wa_daily_analyzer.py --date 2026-06-17
```
