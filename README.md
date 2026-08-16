# plaud-server

Serverless pipeline that replaces the Plaud AI subscription while keeping the
Plaud Note Pro fully useful. Runs entirely inside Supabase project
**thefullpicture** (`szsnocakbnrfoaauiqkr`) — no home hardware required.

## Why this works (verified 2026-08-16)

- Plaud's **free Starter tier is permanent**: audio keeps syncing device → app →
  Plaud cloud, storage is unlimited. Only their AI processing is quota'd.
- Plaud ships an **official, free third-party API** (behind `@plaud-ai/cli`,
  OAuth): every recording — processed or not — exposes a 24-hour presigned URL
  to the original MP3. No reverse engineering, no ToS exposure.
- The Note Pro **deletes recordings from the device after sync**, so Plaud's
  cloud is otherwise the only copy. This pipeline archives every MP3 to
  Supabase Storage (`plaud-audio` bucket) as your independent backup.

## Architecture (all deployed)

```
Plaud Note Pro ──(app sync, free tier)──▶ Plaud cloud
                                             │
   pg_cron every 10 min ──▶ edge fn plaud-sync          ◀── PWA "Sync now" button
   (secret from Vault)        │  refresh OAuth token (plaud.credentials)
                              │  list recordings → diff vs plaud.recordings
                              │  archive MP3 → Storage plaud-audio/YYYY-MM-DD/
                              │  POST presigned URL to Deepgram Nova-3
                              │  (+ retry errored / stale / unsummarized work)
                              ▼
   Deepgram ──(async, seconds later)──▶ edge fn deepgram-callback
                              │  store diarized transcript → status='transcribed'
                              │  inline Claude (Haiku, forced tool call):
                              │  bucket · title · summary · action items · tags
                              ▼
                    plaud.recordings  status='processed'
                              │
   Claude cloud routine (daily) — aggregator: idea digest across buckets,
   action-item routing, weekly synthesis (see routine-prompt.md)
```

Status flow: `new → downloaded → transcribed → processed` (+ `error` with
`retry_count`, max 5, swept by every sync run).

Buckets: `journal · idea · task · meeting · project-note · reference · misc`.

## One-time setup remaining

1. **Plaud tokens** — on any machine: `npm i -g @plaud-ai/cli && plaud login`,
   then seed `~/.plaud/tokens.json` into `plaud.credentials` (Claude can do
   the seeding via the Supabase connector).
2. **Edge function secrets** — dashboard → thefullpicture → Edge Functions →
   Secrets (or `supabase secrets set`):
   - `PLAUD_SYNC_SECRET` — must equal the `plaud_sync_secret` in Vault
   - `DEEPGRAM_API_KEY`
   - `ANTHROPIC_API_KEY`
3. Until secrets are set, the 10-minute cron fires and gets a clean
   "not configured" error — harmless.

## On-demand sync ("Sync now" button)

```bash
curl -s -X POST \
  -H "x-sync-secret: $PLAUD_SYNC_SECRET" \
  https://szsnocakbnrfoaauiqkr.supabase.co/functions/v1/plaud-sync
```

Returns `{ok, listed, submitted, resubmitted, summarized, errors[]}`. The PWA
button does exactly this (phase 2 swaps the shared secret for a Supabase Auth
JWT check).

## Repo layout

| path | purpose |
|---|---|
| `supabase/functions/plaud-sync/` | poller/archiver/retrier (cron + button) |
| `supabase/functions/deepgram-callback/` | transcript ingest + inline Claude processing |
| `schema.sql` | reference copy of the `plaud` schema (applied via migrations) |
| `routine-prompt.md` | prompt for the daily aggregator cloud routine |
| `legacy-mini/` | the original Mac-mini launchd pipeline (Python) — kept as fallback |

## Costs

Deepgram Nova-3 ~$0.0043/min (1,000 min/mo ≈ $4.30) · Claude Haiku ~$1–3/mo ·
Storage ~300MB/mo ≈ pennies · Edge functions/cron: free tier. Total well under
$10/mo vs Plaud Pro at $8.33–17.99/mo — with better transcripts, your own
archive, and no lock-in.

## Failure & recovery model

- Every stage writes its status; `error` rows carry the message and retry
  up to 5 times (bounded by `retry_count`).
- Deepgram callback lost → `downloaded` rows older than 30 min are resubmitted.
- Claude call failed → row stays `transcribed`; next sync retries inline.
- Plaud refresh token rejected → `plaud.credentials.status='reauth_required'`;
  re-run `plaud login` and re-seed.
