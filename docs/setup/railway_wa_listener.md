# Railway WhatsApp Listener

This deploys the Baileys WhatsApp listener as a long-running Railway worker.

## Railway service

Use the GitHub repository connected to Railway and deploy from the repository root.

`railway.json` runs:

```bash
cd wa_listener && npm ci
cd wa_listener && npm start
```

## Variables

Set these in Railway service variables:

```env
SUPABASE_URL=https://vqgfkfvywbpjldreuplb.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
AUTH_DIR=/data/auth_state
```

Do not put these values in git.

## Persistent volume

Create a Railway volume and mount it at:

```txt
/data
```

The listener stores the WhatsApp linked-device session in:

```txt
/data/auth_state
```

Without this volume, every redeploy/restart may require scanning a new QR.

## First deploy

1. Deploy the service.
2. Open Railway logs.
3. Scan the QR printed by the listener.
4. Wait for:

```txt
WhatsApp connected.
24 mapped WhatsApp groups loaded from Supabase
```

After that, new messages from mapped groups are written to `wa_messages`.
