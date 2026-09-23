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


# Revolte: first-run DX findings

Notes from a first session with Revolte, taken as a new user with no prior exposure to the product. I signed up, built a service end to end, pushed it to GitHub, and ran it locally.
---

## What I built

I gave it the requirements. I did not write any of the code.

**Verified locally after cloning from GitHub:**

| Check | Result |
|---|---|
| `npm test` | 5/5 passing |
| `npm install` | 0 vulnerabilities |
| Valid signed request | `200 {"accepted":true,"duplicate":false}` |
| Replay of same event ID | `200 {"accepted":true,"duplicate":true}` |
| Invalid signature | `401` |
| Malformed JSON | `400` |
| Survives restart | Dedup record persists |

---

## What impressed me

**1. The plan step is the product.**

Before writing anything, it asked four scoping questions, and every one of them genuinely changed the service contract: dedup behaviour across restarts and instances, what async processing should do, which signature encodings to accept, and how strict validation should be. These are the questions a senior engineer asks in code review, surfaced before the code exists.

The plan then caught three things I never specified:

- Raw body capture before parsing, which is the classic HMAC bug; re-serialised JSON produces a different digest
- `crypto.timingSafeEqual` rather than string comparison, closing a timing side channel
- Atomic `INSERT OR IGNORE` for dedup admission rather than a check-then-write race

It also wrote an explicit out-of-scope list (multi-instance dedup, queues, retry and dead-letter handling) instead of silently omitting them.

**2. It self-corrected three times, and reported failures honestly.**

- An `esbuild` postinstall failure on the dependency install: it removed the unnecessary transpiler and switched to Node's built-in test runner rather than retrying blindly
- Typecheck caught that test spy callbacks returned `Array.push`'s numeric result, violating the handler's `void | Promise<void>` contract
- The managed preview reported ready, then lost its listener. It reported the actual failure (`curl: (7) connection refused`), said it would only claim restart persistence if the process stayed reachable, restarted, and verified properly

That third one matters most. An agent that refuses to claim a result it did not observe is the governance thesis working under failure conditions, not on a marketing page.

**3. The generated code runs outside its own environment.**

Cloned fresh, installed clean, tests passed, service ran, all four HTTP behaviours verified by hand. This is not a given.

---

## Friction, in order of impact

### 1. The repo connection comes too late

I ran a complete session: 27 files, full test suite, live HTTP verification and was never asked where the code should go until it was already written. "Connect an application" only appeared in the source control panel after the build finished.

The CLI docs list a connected application as a prerequisite, so the two surfaces disagree about when this connection happens. A new user following the console path builds something real and then discovers the delivery loop was never wired up.

**Proposal:** ask for the repo at session start, or make sandbox-only an explicit choice rather than a silent default.

### 2. The PR step gives no confirmation

After creating a pull request, the panel still showed "Create pull request" with no link, no state change, no confirmation. From inside the product there is no way to tell whether the PR exists.

This sits at the most consequential moment in the loop — the point where a developer decides whether this thing actually delivers.

**Proposal:** replace the button with a link to the open PR.

### 3. Sandbox idle timeout is aggressive

"Sandbox will be deleted in 1 minute due to inactivity" fired while a dialog was open, during a session I had spent twenty minutes building. On free-tier evaluation, this can end someone's first session before they finish.

**Proposal:** longer grace period, or suppress the countdown while a modal is open.

### 4. The API preview opens in a browser and shows an error

The preview is declared `type: "api"` in `.revolte/preview.json`, so the product knows there is no root route. Clicking the preview link opens a browser tab showing `Cannot GET /`.

The service is working correctly. The interface makes it look broken.

**Proposal:** for API-type previews, show a curl snippet with the correct path instead of a browser link.

### 5. First-run choices with no guidance

The first screen asks a new user to pick a model (GPT 5.6 Luna, Medium) and compute size (2 vCPU / 4 GB), plus Interactive vs Autonomous. A first-time user has no basis for any of these. The docs cover the Interactive/Autonomous choice on a separate page, but the choice is made here.

**Proposal:** sensible defaults with a one-line "why this" hint, or defer the choice until it matters.

### 6. Repo picker requires an initialised repo, without saying so

Connecting an empty GitHub repo fails with *"The provided repository does not have any remote branches"* but only after filling in project name, application name, and repo, then clicking Proceed.

**Proposal:** state the requirement on the picker, or offer to initialise.

### 7. The README's curl example fails on macOS

The generated README extracts the HMAC digest with `awk '{print $2}'`. macOS OpenSSL prints `SHA2-256(stdin)= <hash>`, so the field position differs and `$SIG` comes back empty. The documented example returns 401 on a Mac.

`sed 's/^.*= *//'` handles both formats.

This one is generated output rather than product docs, but it is the single code sample a new user is most likely to copy.

### 8. Sandbox naming leaks into generated output

`package.json` came through as `"name": "sandbox"`, despite the application being named `webhook-receiver`. Minor, but it ends up committed to the user's repo.

---

## The pattern underneath

Three of these are the same shape: the product did the right thing and then gave a signal suggesting it hadn't. The PR completed but looked unfinished. The preview worked but rendered an error. The build succeeded but was never connected to a destination.

The engine is stronger than the signals around it. That gap is cheap to close and it is exactly what a new user judges the product on in the first ten minutes.

---

## Content this session would produce

Things I would ship from one hour of use:

1. **"I let an AI agent build a webhook receiver and checked its work"**, the honest version, including what it caught that I didn't specify and where the DX got in the way. Failure-inclusive posts travel further than clean demos in this category.
2. **Interactive workspace vs CLI, same task**. nobody has written this, and the choice keeps surfacing in the product rather than in the docs.
3. **`.revolte/guides.md` deep dive**, standing project context the agent reads before acting is the most interesting convention in the product, and it is currently a footnote at the bottom of an install guide.
4. **A governance-focused piece**, the customer quotes all sell auditability over speed, but the content doesn't yet show what that looks like in practice when an agent fails.
