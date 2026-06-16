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
WA_PAIRING_PHONE_NUMBER=5215512345678
WA_PAIRING_RETRY_DELAY_MS=90000
```

Do not put these values in git.

`WA_PAIRING_PHONE_NUMBER` is optional but recommended on Railway because log
timestamps can make terminal QR codes hard to scan. Use digits only, including
country code.

`WA_PAIRING_RETRY_DELAY_MS` keeps Railway from generating replacement pairing
codes too quickly. The default is 90000 milliseconds.

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
2. In Railway Networking, generate a public domain for the service.
3. Open `https://your-railway-domain/qr`.
4. Scan the clean QR image there.
5. You can also use the printed pairing code in Railway logs if
   `WA_PAIRING_PHONE_NUMBER` is set.
6. Wait for:

```txt
WhatsApp connected.
24 mapped WhatsApp groups loaded from Supabase
```

After that, new messages from mapped groups are written to `wa_messages`.
