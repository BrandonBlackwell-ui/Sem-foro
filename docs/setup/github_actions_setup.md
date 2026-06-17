# GitHub Actions Setup

The active daily workflow is `WhatsApp daily analysis`.

## Secrets

Set these repository secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
```

## Optional Variables

Set this repository variable only if you want to override the model:

```text
WA_ANALYSIS_MODEL=claude-haiku-4-5
```

## What The Workflow Does

- Runs daily.
- Reads only the previous Mexico City day from `wa_messages`.
- Analyzes only accounts with new messages.
- Writes daily results to `wa_daily_analysis`.
- Updates cumulative scores in `wa_account_scores`.

It does not read Google Drive.
