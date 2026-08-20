# plaud-server

Serverless pipeline + self-hosted front end that replace the Plaud AI
subscription while keeping the Plaud Note Pro fully useful. The pipeline runs
entirely inside Supabase project **thefullpicture** (`szsnocakbnrfoaauiqkr`) —
zero servers. The **Threads PWA** (`web/`) front end runs on a Mac mini behind
Tailscale at `https://mac-mini.tailf2ffdd.ts.net`: tailnet-only, never exposed
to the public internet.

## Why this works (verified 2026-08-16)

- Plaud's **free Starter tier is permanent**: audio keeps syncing device → app →
  Plaud cloud, storage is unlimited. Only their AI processing is quota'd.
- Plaud ships an **official, free third-party API** (behind `@plaud-ai/cli`,
  OAuth): every recording — processed or not — exposes a time-limited presigned
  URL to the original MP3. No reverse engineering, no ToS exposure.
- The Note Pro **deletes recordings from the device after sync**, so Plaud's
  cloud is otherwise the only copy. This pipeline archives every MP3 to
  Supabase Storage (`plaud-audio` bucket) as your independent backup.

## Architecture (all deployed)

```
Plaud Note Pro ──(app sync, free tier)──▶ Plaud cloud
                                             │
   pg_cron every 10 min ──▶ edge fn plaud-sync          ◀── PWA SYNC button
   (secret from Vault)        │  refresh Plaud OAuth (form-encoded, JSON fallback)
                              │  list recordings → diff vs plaud.recordings
                              │  archive MP3 → Storage plaud-audio/YYYY-MM-DD/
                              │  POST presigned URL to Deepgram Nova-3
                              │  (diarize + utterances + ≤100 keyterms from plaud.context)
                              │  (+ retry errored / stale / unsummarized work)
                              ▼
   Deepgram ──(async, seconds later)──▶ edge fn deepgram-callback
                              │  auth: per-file HMAC token in ?token=
                              │  store diarized transcript → status='transcribed'
                              │  fire cloud routine plaud-process (coalesced:
                              │  max one fire per 3 min — each run sweeps the queue)
                              ▼
   Claude cloud routine "plaud-process" (subscription + connectors — no API key)
   reads plaud.context, writes two layers:
     1  recording row → bucket · title · summary_md · action_items · tags
     2  thread extraction → plaud.threads (sentence_ids, spans_ms, entities,
        content_idea) · STT fixes → plaud.stt_corrections
                              ▼
   pg_cron at :05/:15/… ──▶ edge fn thread-embed
                              │  embed threads — Supabase.ai gte-small, 384-dim
                              │  link echoes across recordings (cosine ≥0.86, or
                              │  ≥0.80 + shared rare entity) → plaud.thread_links
                              ▼
   Threads PWA (web/) — MEMOS · MIND · IDEAS
   semantic search: /api/search → edge fn thread-search (gte-small, cosine KNN)
```

Safety net: plaud-sync re-fires the routine if any transcript has waited
>15 min (lost fire, daily routine cap). Large recordings (>45MB) archive via
TUS resumable upload in 6MB chunks, so multi-hour meetings never exceed worker
memory or a single-request limit.

Status flow: `new → downloaded → transcribed → processed` (+ `error`,
`retry_count` ≤ 5, swept by every sync run, then dead-lettered). Buckets:
`journal · idea · task · meeting · project-note · reference · misc`.

## Data model (schema `plaud`, service-role only)

`schema.sql` is the reference copy. Beyond `recordings` (status flow, diarized
`transcript` jsonb + `transcript_text` FTS, `dg_request_id`, `submitted_at`,
`waveform_peaks`):

- `threads` — extracted threads-of-consciousness, `vector(384)` + HNSW index
- `thread_links` — cross-recording echoes, top-3 per thread
- `stt_corrections` — the routine's fixes to Deepgram output
- `context` — `about_md`, `keyterms[]` (fed to Nova-3), coalescing timestamp
- `credentials` — Plaud OAuth custody (+ `reauth_required` state)
- `sync_runs` — one row per sync run; the ops log

## Front end — Threads PWA

Next.js 16 App Router · React 19 · Tailwind v4. "Threads v2" design: warm-paper
field-journal, Newsreader serif + IBM Plex Mono, per-bucket hues. Installable
from Safari (PWA manifest). Details in `docs/frontend.md`.

- **MEMOS** — master-detail. Date-grouped list, bucket-chip filter, keyword FTS
  and semantic search side by side. Detail: summary, checkable action items,
  threads with echo links and tap-to-seek span bars, diarized transcript with
  active-utterance highlight, fixed player bar with MediaSession.
- **MIND** — the week as a plate: days as columns, memos as vertical bands,
  threads as marks, embedding echoes as arcs. Tap a seam (cross-day link
  cluster) to isolate it. Portrait and landscape variants both render; CSS
  breakpoints pick one.
- **IDEAS** — feed of `content_idea` threads.
- Plus: health banner + SYNC button, and a CTX page (edit `about_md`/`keyterms`).

Auth: Supabase email OTP (6-digit code) locked to a single allowed address,
enforced by middleware (`proxy.ts`) on every route. The browser never touches
the `plaud` schema — server routes (`/api/detail/[id]`, `/api/action-items`,
`/api/sync`, `/api/search`, `/api/context`) query it via server-side
`postgres.js`; the sync secret stays server-side. Audio: 12h signed URLs.

## Deployment (Mac mini + Tailscale)

`deploy/mini-setup.sh` is the reference bootstrap (Homebrew-based). The
actual mini was set up by hand to avoid brew/sudo — Node 22 tarball at
`~/.local/node`, repo at `~/threads`, `web/.env.local` copied over,
`npm ci && npm run build` — but lands in the same shape either way: launchd
service `com.joe.threads` (KeepAlive, logs to `~/Library/Logs/threads.log`)
and `tailscale serve --bg 3000` for HTTPS at the tailnet hostname. Ship an
update:

```bash
ssh mac-mini 'cd ~/threads && git pull && cd web && npm ci && npm run build \
  && launchctl kickstart -k gui/$(id -u)/com.joe.threads'
```

## On-demand sync (SYNC button)

```bash
curl -s -X POST \
  -H "x-sync-secret: $PLAUD_SYNC_SECRET" \
  https://szsnocakbnrfoaauiqkr.supabase.co/functions/v1/plaud-sync
```

Returns `{ok, listed, awaiting_routine, routine_fired, dead_lettered[],
reauth_required, alert, submitted, skipped_short, archive_skipped, backfilled,
resubmitted, errors[]}`. The PWA's SYNC button does exactly this from a server
route that holds the secret. Every run also persists a row to `plaud.sync_runs`.

`thread-embed` and `thread-search` take the same `x-sync-secret` header. Link
thresholds are tunable via env: `LINK_T_HIGH`, `LINK_T_ENT`, `LINK_RARE_MAX`,
`THREAD_EMBED_BATCH`.

## Setting this up fresh

Everything above is deployed and live; this is the from-zero reference.

1. **Plaud tokens** — `npm i -g @plaud-ai/cli && plaud login`, then seed
   `~/.plaud/tokens.json` into `plaud.credentials`.
2. **Edge function secrets** (dashboard or `supabase secrets set`):
   - `PLAUD_SYNC_SECRET` — shared secret (`x-sync-secret`) for plaud-sync /
     thread-embed / thread-search; must equal `plaud_sync_secret` in Vault
   - `DEEPGRAM_API_KEY`
   - `DEEPGRAM_CALLBACK_SECRET` — HMAC key for callback auth: each submission
     carries `?token=` = HMAC-SHA256(file_id) truncated to 32 hex
     (`callbackToken()`); static `?secret=` is legacy for in-flight jobs only
   - `ROUTINE_FIRE_TOKEN` — API-trigger bearer token of the plaud-process
     routine (regenerate at claude.ai/code/routines if lost). No Anthropic API
     key anywhere — smart processing runs on the Claude subscription.
3. Apply `schema.sql`, deploy the four functions, schedule the crons
   (plaud-sync on the :00s, thread-embed on the :05s).
4. **PWA** — fill `web/.env.local`, then run `deploy/mini-setup.sh` on the
   mini (or `npm run dev` in `web/` locally).

## Repo layout

| path | purpose |
|---|---|
| `supabase/functions/plaud-sync/` | poller/archiver/retrier (cron + button) |
| `supabase/functions/deepgram-callback/` | transcript ingest + routine fire (coalesced) |
| `supabase/functions/thread-embed/` | thread embeddings + cross-recording links (cron) |
| `supabase/functions/thread-search/` | semantic search over threads (backs `/api/search`) |
| `web/` | Threads PWA — Next.js 16, React 19, Tailwind v4 |
| `deploy/mini-setup.sh` | Mac mini bootstrap (launchd + tailscale serve) |
| `schema.sql` | reference copy of the `plaud` schema (applied via migrations) |
| `routine-prompt.md` | deployed prompt of the plaud-process cloud routine |
| `docs/PRD.md` | product requirements (v1.2, kept current — shipped work annotated inline) |
| `docs/frontend.md` | front-end architecture and design notes |
| `docs/ui-patterns.md` | clean-room UI blueprint for the PWA |
| `docs/tickets.json` | issue tracker export |
| `legacy-mini/` | the original Mac-mini launchd pipeline (Python) — kept as fallback |

## Costs

Deepgram Nova-3 ~$0.0043/min (1,000 min/mo ≈ $4.30) · smart processing $0 (the
cloud routine runs on the Claude subscription — no Anthropic API spend) ·
Storage pennies · Supabase free tier · Mac mini already owned. Total ≈ $5/mo vs
Plaud Pro at $8.33–17.99/mo — better transcripts, your own archive, no lock-in.

## Failure & recovery model

- Every stage writes its status; `error` rows carry the message and retry up
  to 5 times (`retry_count`), then dead-letter (`dead_lettered[]`).
- Deepgram callback lost → `downloaded` rows older than 30 min are resubmitted.
- Routine fire lost (or daily cap hit) → plaud-sync re-fires when a transcript
  has waited >15 min.
- Routine output missing → row stays `transcribed`; the >15-min fallback
  fire (above) re-runs the routine until it lands.
- Plaud refresh token rejected → `plaud.credentials.status='reauth_required'`;
  re-run `plaud login` and re-seed.
- **Plaud's API drifts.** Three days after launch they switched the OAuth
  refresh endpoint to form-encoding; the pipeline errored `reauth_required`
  until fixed. `getFreshToken()` now sends form-encoded with a JSON fallback.
  Assume it will drift again — the surfaces below catch it.
- Ops surfaces: `plaud.sync_runs`, the 3-consecutive-failure alert, the PWA health banner.