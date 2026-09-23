# Webhook Receiver

An Express service that verifies signed JSON webhooks, acknowledges valid deliveries quickly, and deduplicates event IDs in SQLite before invoking an asynchronous handler.

## Requirements

- Node.js 22 or newer
- npm

## Setup

```bash
npm ci
cp .env.example .env
```

Set `WEBHOOK_SECRET` in `.env` to the secret shared with the event producer. `DATABASE_PATH` defaults to `./data/webhooks.db`; the directory is created by SQLite when the parent directory exists, so create it before starting locally:

```bash
mkdir -p data
npm run build
npm start
```

The service listens on `http://localhost:4173` by default.

## Webhook contract

Send `POST /webhooks` with `Content-Type: application/json` and this shape:

```json
{
  "id": "evt_123",
  "type": "invoice.created",
  "created_at": "2026-01-01T12:00:00.000Z",
  "data": { "invoice_id": "inv_123" }
}
```

`X-Signature` must be the lowercase hexadecimal HMAC SHA-256 digest of the exact request body. The receiver also accepts the equivalent `sha256=<digest>` form. The service returns `200` for new and duplicate valid events, `401` for missing or invalid signatures, and `400` for invalid JSON or event fields.

## Valid curl example

This example uses the same secret as the command line and generates the signature from the exact JSON string sent to curl:

```bash
SECRET='replace-with-a-long-random-secret'
BODY='{"id":"evt_123","type":"invoice.created","created_at":"2026-01-01T12:00:00.000Z","data":{"invoice_id":"inv_123"}}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -i http://localhost:4173/webhooks \
  -H 'Content-Type: application/json' \
  -H "X-Signature: $SIGNATURE" \
  --data "$BODY"
```

The first request returns `{"accepted":true,"duplicate":false}`. Repeating the same request returns `{"accepted":true,"duplicate":true}` and does not invoke the handler again.

## Development commands

```bash
npm run format:check
npm run typecheck
npm test
npm run format
```

The default handler logs the event ID and type. Domain-specific behavior can be supplied by passing an `EventHandler` to `createApp`.
