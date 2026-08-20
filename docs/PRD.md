<!-- v1.2 — brought current 2026-08-19: pipeline + PWA + thread layer shipped and deployed; shipped requirements annotated inline, deviations recorded. v1.1 — draft by subagent, revised per 11-finding adversarial critique 2026-08-16. Tickets: github.com/drbarq/plaud-server/issues -->
# PRD — plaud-server: Self-Hosted Plaud Pipeline + PWA

**Owner:** Joe (`drbarq`) · **Date:** 2026-08-19 (v1.2; v1.1 2026-08-16) · **Repo:** github.com/drbarq/plaud-server · **Status:** Pipeline + PWA + thread layer shipped and deployed; remaining work tracked in issues

---

## 1. Overview & vision

plaud-server replaces the Plaud AI subscription ($8.33–17.99/mo) with a serverless pipeline Joe owns end to end: the Plaud Note Pro keeps syncing to Plaud's permanent free tier, the official third-party API hands us every MP3, Supabase archives and orchestrates, Deepgram Nova-3 transcribes with diarization and domain keyterms, and the Claude cloud routine classifies each recording into buckets with a title, summary, action items, and tags — and, as of routine v3, also extracts threads-of-consciousness that are embedded and linked across recordings. The front door now exists: **"Threads,"** a phone-first PWA (MEMOS · MIND · IDEAS, built from `docs/ui-patterns.md`) for browsing, searching (keyword + semantic), playing, and acting on recordings, deployed on Joe's Mac mini and reachable only over his tailnet. Total spend ≈ $5/mo actual against the ~$10/mo ceiling, with better transcripts and an independent audio archive. The remaining unbuilt piece of the original vision is the daily aggregator routine that turns the `idea` bucket into a content-pipeline feed (Goal 4, §5.D).

## 2. Current state (verified against code in repo, 2026-08-19)

Two halves, both shipped and live:

1. **Serverless pipeline** in Supabase project `thefullpicture` (`szsnocakbnrfoaauiqkr`), schema `plaud` — service-role only, not PostgREST-exposed; `anon`/`authenticated` revoked.
2. **"Threads" PWA** in `web/`, deployed on the Mac mini behind Tailscale at `https://mac-mini.tailf2ffdd.ts.net` (tailscale serve → localhost:3000, launchd service `com.joe.threads`).

**Data model** (`schema.sql` is reconciled with the live DB — #2):

- `plaud.recordings` — status flow `new → downloaded → transcribed → processed` + `error` with `retry_count` ≤ 5; transcript jsonb utterances + flattened `transcript_text` (GIN FTS index); `bucket/title/summary_md/action_items/tags`; `audio_path/audio_bytes`; `dg_request_id`, `submitted_at`, `waveform_peaks`.
- `plaud.threads` — routine-extracted threads-of-consciousness (utterance-index `sentence_ids`, `spans_ms`, `entities`, `content_idea`/`idea_note`) with `vector(384)` embeddings under an HNSW index.
- `plaud.thread_links` — cross-recording echo links between threads.
- `plaud.stt_corrections` — routine-proposed STT fixes.
- `plaud.context` — singleton: `about_md`, `keyterms[]`, `routine_last_fired_at` (fire-coalescing state).
- `plaud.credentials` — Plaud OAuth custody with `reauth_required` state.
- `plaud.sync_runs` — per-run ops log (OPS-3, #28).

**Pipeline (edge functions, all deployed):**

- **`plaud-sync` (v17)** — pg_cron every 10 min (secret from Vault) + PWA Sync-now (`x-sync-secret` header), advisory-lock deduped (`pg_try_advisory_lock(873429)`). Refreshes Plaud OAuth **form-encoded with JSON fallback** (Plaud changed the refresh endpoint's encoding ~2026-08-17, which caused an outage until adapted — API drift is now a proven, handled failure mode). Lists recordings (paged, ≤500), skips <4s recordings straight to `processed`, archives MP3s to Storage `plaud-audio/YYYY-MM-DD/` (buffered ≤45MB, **TUS 6MB-chunk uploads above** — no per-file size cap; `ARCHIVE_MAX_BYTES`=45MB is the buffered-vs-TUS threshold, not a limit), submits presigned URLs to Deepgram Nova-3 (diarize + utterances + up to 100 keyterms from `plaud.context`), resubmits `downloaded` rows stale >30 min, backfills missing archive copies, **dead-letters after 5 retries** with `dead_lettered[]` and `reauth_required` as first-class response fields (#4), escalates to a visible alert after 3 consecutive failed runs (#7), logs every run to `plaud.sync_runs` (#28), and **fires the routine as a fallback when transcripts wait >15 min** (#3).
- **`deepgram-callback` (v13)** — **per-file HMAC token auth**: `?token=` = HMAC-SHA256(`file_id`, `DEEPGRAM_CALLBACK_SECRET`) truncated to 32 hex (#5; the sync secret is never handed to Deepgram). Stores diarized utterances at `status='transcribed'` (empty transcripts short-circuit to `processed` / "(no usable speech)"), then fires the cloud routine **coalesced to at most one fire per 3 minutes** via `plaud.context.routine_last_fired_at` (#6) — safe because the sync fallback fire (#3) catches anything coalesced away.
- **`thread-embed` (v5)** — cron at :05/:15/:25… (10-min cadence offset from sync). Embeds new threads with Supabase.ai gte-small (384-dim, batches of 8) and builds cross-recording links: cosine ≥ 0.86, or ≥ 0.80 with a shared rare entity (global count ≤ 4); top-3 links per thread; HNSW index.
- **`thread-search` (v1)** — embeds a query with gte-small and runs cosine KNN over threads; backs the PWA's `/api/search` semantic search.

**Smart processing — cloud routine `plaud-process` (v3)** (API trigger `trig_01D5qhb3VPougC2H6BnpXMED`; reference copy `routine-prompt.md`, current): runs on Joe's Claude subscription — not an API call, zero Anthropic API spend — fired by `deepgram-callback` or the sync fallback. Loads `plaud.context.about_md` as speaker calibration (data, not instructions), sweeps up to 10 `status='transcribed'` rows, and writes a **two-layer output**: (1) the recording row — `bucket/title/summary_md/action_items/tags` (buckets: journal · idea · task · meeting · project-note · reference · misc); (2) thread extraction into `plaud.threads` plus STT corrections into `plaud.stt_corrections`. It still never touches transcript/audio columns.

**"Threads" PWA (`web/`)** — Next.js 16 App Router (React 19, Turbopack, `proxy.ts` middleware convention), Tailwind v4, TypeScript. Design: **"Threads v2"** — light-only warm-paper field-journal aesthetic (Newsreader serif with italic titles + IBM Plex Mono instrument labels, oklch tokens, per-bucket hues, grain overlay, burnt-orange accent; type scale bumped 2026-08-19 for phone legibility). **Auth: Supabase email OTP** (6-digit code) locked to a single allowed email, with an `/auth/confirm` token_hash fallback for email links; middleware (`proxy.ts`) gates every route; the `plaud` schema is reached only via server-side `postgres.js` over `DATABASE_URL` (transaction pooler) — never exposed to the client; audio via 12h signed Storage URLs. Tabs:

- **MEMOS** — master-detail: date-grouped list, bucket-chip filter, keyword + semantic search side by side; detail = summary, checkable action items, threads with echo links and tap-to-seek span bars, diarized transcript with active-utterance highlight, fixed player bar with MediaSession.
- **MIND** — the week as a plate: days as columns, memos as vertical bands, threads as marks, embedding echoes as arcs; portrait (360×580) and landscape (700×560) variants both rendered, CSS breakpoints picking one; hover highlights connected arcs; tap a seam (cross-day link cluster) to isolate.
- **IDEAS** — feed of `content_idea` threads.

Plus: health banner + SYNC button (a server route holds the secret), CTX page (edit `about_md`/`keyterms`), installable PWA manifest. API routes: `/api/detail/[id]`, `/api/action-items`, `/api/sync`, `/api/context`, `/api/search`, `/auth/confirm`.

**Deployment (Mac mini)** — `deploy/mini-setup.sh` is the reference bootstrap (Homebrew-based); the actual mini was hand-set-up with a Node 22 tarball at `~/.local/node` (no brew/sudo), repo at `~/threads`, `web/.env.local` copied over, `npm ci && npm run build`. Either path lands at: launchd `com.joe.threads` (KeepAlive, logs to `~/Library/Logs/threads.log`), `tailscale serve --bg 3000` → HTTPS at the tailnet hostname. Update path: ssh in, `git pull`, `npm ci`, `npm run build`, `launchctl kickstart -k`. The app is **unreachable from the public internet by design** (tailnet-only).

**Deviations from the v1.1 spec (recorded deliberately, not regressions):**

1. **Auth (PWA-2/OQ-1):** spec said Supabase Auth Google OAuth via `@supabase/ssr`, single allowed email. Shipped: **Supabase email OTP** (6-digit code) locked to the single allowed email, `/auth/confirm` token_hash fallback, middleware gate in `proxy.ts`. Rationale: zero Google Cloud setup for a single-user system; server-side enforcement everywhere is preserved.
2. **Data access (PWA-2/OQ-1):** spec said service-role key in RSCs/route handlers. Shipped: server-side `postgres.js` over `DATABASE_URL` (transaction pooler). Same server-only posture, different mechanism — "service-role key" wording below is historical.
3. **Theming (PWA-1):** spec said next-themes class strategy with dark/light oklch shadcn tokens. Shipped: light-only Threads v2 design; no dark mode, no next-themes.
4. **Stack:** Next.js 16 + React 19 + Turbopack; `proxy.ts`, not `middleware.ts`.
5. **Search (PWA-6/PWA-16):** v1 shipped keyword **and** semantic vector search side by side, exceeding spec; server-side FTS (PWA-16) is largely mooted.
6. **PROC-1 contract:** the routine's write contract expanded to the two-layer output above (recording row + threads + STT corrections) — see the rewritten PROC-1.
7. **Milestone order:** M3 items (#19, #22, #28) and the unplanned thread epic landed before the M2 exit criterion was verified (#21 still open); OPS-1's health view (#29) was deferred out of M2.
8. **Deployment:** the PRD specified none; shipped tailnet-only Mac mini hosting — a material improvement to the privacy/ops posture, now documented here.

**Shipped beyond PRD scope (no v1.1 requirement existed):** the thread layer — extraction, embeddings, cross-recording links (#35); the MIND week-plate visualization (#36); semantic search (`thread-search`); the IDEAS tab; the Threads v2 restyle + type-scale bump (2026-08-19); the Mac mini + Tailscale deployment (`deploy/mini-setup.sh`). Follow-on thread-epic tickets are open: #32 (chunk-then-merge for >30 min recordings), #33 (entity graph), #34 (revisit link thresholds at 10× corpus), #37 (v2 state screens).

**Known gaps / open work (tracked in issues — do not re-ticket):** end-to-end iPhone verification of PWA v1 (#21) is the outstanding M2 exit check; waveform (#18), Serwist service worker (#20), reprocess affordance (#23), ops health view (#29), budget watch (#30), advisor review (#31), aggregator (#25–#27), thread follow-ons (#32–#34, #37), plus #8 and #24. **Documentation drift is being closed by this very pass:** this PRD update (v1.2) and the concurrent README rewrite replace the stale inline-Haiku/`ANTHROPIC_API_KEY` description with the real callback → routine flow; `schema.sql` is already reconciled (#2). The former Storage per-file-limit gap is resolved by TUS chunking (#1). Routine-cap burn is mitigated by 3-min coalescing (#6). The Plaud API is no longer "3 days old" — it has already drifted once (refresh-endpoint encoding) and been adapted to.

## 3. Goals / Non-goals

**Goals**

1. ✅ **Achieved.** Harden the shipped pipeline to zero-babysitting: every failure mode either self-heals or surfaces visibly (PIPE-1..7 and PIPE-9 shipped; failures are first-class sync-response fields, persisted to `plaud.sync_runs`, surfaced in the PWA health banner).
2. ✅ **Achieved.** Ship a phone-first PWA that makes the corpus usable daily: browse by bucket, search, read summaries, check off action items, play audio with tap-to-seek transcript (formal week-of-daily-use verification tracked as #21).
3. ✅ **Achieved.** Keep smart processing entirely on Claude cloud routines and keep total spend under ~$10/mo (actual ≈ $5/mo, zero Anthropic API spend).
4. **Open.** Add a daily idea-aggregator routine that turns `bucket='idea'` recordings into content-pipeline input (§5.D, #25–#27).

**Non-goals** (all five hold unchanged)

- Multi-user support, sharing, or public access of any kind — this is Joe's personal infrastructure.
- Replacing Deepgram with local transcription (the `legacy-mini` Python pipeline stays as dormant fallback only).
- Recording or uploading audio from the PWA — the Plaud device + app remain the only capture path.
- Editing transcripts in the UI (read + seek only for v1).
- Native iOS/Android apps.

## 4. Users

One user: Joe. A single allowed email (set via `ALLOWED_EMAIL`) authenticated via Supabase email OTP. Phone-first (PWA installed to the home screen); desktop is the derivative layout. Design consequence: the detail pane, touch scrubbing, and cold-launch paint speed are designed first; desktop master-detail is the derivative layout. There is no onboarding, no empty-state marketing, no permissions model beyond "is this Joe's session."

## 5. Functional requirements

Shipped items are marked **✅ Shipped (#issue)** and kept for the record; deviations from the letter of the spec are noted inline (details in §2).

### A. Pipeline hardening

- **PIPE-1 (MUST). ✅ Shipped (#1) — superseded by TUS chunking.** Raise the Storage per-file size limit in the dashboard and confirm the 3 unarchived recordings backfill (the sweep heals 2 per run). Bound backfill attempts so a permanently-unarchivable row cannot starve orphans behind it; surface permanently-unarchivable rows as a first-class sync-response field. *Outcome: no dashboard raise needed — `plaud-sync` v17 uploads anything above 45MB via TUS in 6MB chunks, so no per-file cap remains; the unarchived backlog cleared; dead-letter surfacing landed via PIPE-4.*
- **PIPE-2 (MUST). ✅ Shipped (#2).** Reconcile `schema.sql` with the live database: `dg_request_id`, `submitted_at`, `waveform_peaks` added — the reference copy is trustworthy again.
- **PIPE-3 (MUST). ✅ Shipped (README rewrite in flight as part of the same doc-truth pass as this PRD update).** Fix README drift: remove the inline-Haiku / `ANTHROPIC_API_KEY` description and document the actual callback → routine-fire flow and `ROUTINE_FIRE_TOKEN` secret.
- **PIPE-4 (MUST). ✅ Shipped (#4).** Surface dead-lettered work: `dead_lettered[]` and `reauth_required` are first-class fields in the sync response and persisted state (OPS-3); the PWA banner renders them.
- **PIPE-5 (SHOULD). ✅ Shipped (#7).** Defensive handling of the young Plaud API: repeated failures across 3 consecutive runs escalate to a visible alert rather than accruing per-row errors; response-shape tolerance stays centralized in `plaudGet`. *Vindicated in practice by the 2026-08-17 refresh-encoding drift.*
- **PIPE-6a (MUST). ✅ Shipped (#5).** Stop handing `PLAUD_SYNC_SECRET` to Deepgram: callback auth now uses a distinct `DEEPGRAM_CALLBACK_SECRET`.
- **PIPE-6b (SHOULD). ✅ Shipped (#5, together with 6a).** Per-submission callback tokens: `?token=` = HMAC-SHA256(`file_id`, `DEEPGRAM_CALLBACK_SECRET`) truncated to 32 hex, with a two-step rotation path that doesn't strand in-flight callbacks.
- **PIPE-7 (SHOULD, required PIPE-9). ✅ Shipped (#6).** Coalesce routine fires: at most one fire per 3 minutes via `plaud.context.routine_last_fired_at`; the sweep semantics plus the PIPE-9 fallback fire make coalescing safe.
- **PIPE-8 (COULD). Open (no ticket).** Store orphan transcripts: a callback for an unknown `file_id` is currently acknowledged and dropped; persist the payload to a holding row instead.
- **PIPE-9 (MUST). ✅ Shipped (#3).** Fallback sweep trigger: `plaud-sync` fires `plaud-process` when transcripts have been waiting >15 minutes, so a failed fire or exhausted routine cap can no longer strand `transcribed` rows.

### B. PWA v1 (blueprint: `docs/ui-patterns.md`) — **shipped as "Threads"** (#9–#17, #19, #22); see §2 for the deviations from spec

- **PWA-1 (MUST). ✅ Shipped (#9) — deviations: theming, no shadcn.** Scaffold: Next.js + Tailwind 4, `manifest.ts` (standalone display, appleWebApp metadata, 192/512 + maskable icons). *Shipped light-only Threads v2 instead of next-themes dark/light tokens (§2 deviation 3); shadcn was dropped entirely — every component is bespoke.*
- **PWA-2 (MUST). ✅ Shipped (#10) — deviations: auth + data-access mechanism.** Single allowed email, data access **server-only**, enforcement in middleware **and** every route handler **and** the RSC; all client-originated writes go through authenticated route handlers. *Shipped Supabase email OTP instead of Google OAuth, and server-side `postgres.js` over `DATABASE_URL` instead of the service-role key (§2 deviations 1–2); the server-only posture is unchanged.*
- **PWA-3 (MUST). ✅ Shipped (#11).** Server-fetch-then-props architecture: one async RSC, light list columns + server-computed `snippet`, one `toRecording()` serialization boundary, `router.refresh()` reconciliation.
- **PWA-4 (MUST). ✅ Shipped (#12).** Master-detail workstation: list + sticky detail on desktop, `mobileView` pane toggle below `lg` with both panes mounted, no routing for selection, mobile-only Back button.
- **PWA-5 (MUST). ✅ Shipped (#12).** List: date-grouped sticky headers, title + status chip + snippet second line, leading bucket dot, selection tint, infinite scroll via IntersectionObserver sentinel. No virtualization.
- **PWA-6 (MUST). ✅ Shipped (#13) — exceeded spec.** Toolbar: bucket-chip row, search with clear + Enter-selects-first-hit, sort dropdown, "N of M" count. *Shipped keyword and semantic search side by side, ahead of the v1 client-search scope.*
- **PWA-7 (MUST). ✅ Shipped (#14).** Detail pane leads with rendered `summary_md` + checkable action items writing `action_items` jsonb back; per-recording async state as `Map<id, op>`.
- **PWA-8 (MUST). ✅ Shipped (#15).** Utterance transcript: speaker + mm:ss rows, tap-to-seek, active-utterance highlight via binary search, copy/export; transcript/summary/audio URL lazy-loaded per recording with AbortController.
- **PWA-9 (MUST). ✅ Shipped (#16) — OQ-7 implemented.** Playback engine: one hook owning a hidden `<audio>` with signed-URL src, central seek functions, MediaSession metadata, speed cycle, 12h signed-URL TTL with re-sign-and-restore on `error`; archive-skipped rows degrade to "audio not yet archived."
- **PWA-10 (MUST). ✅ Shipped (#17).** Sync-now: status-aware button hitting `plaud-sync` via a server route holding `x-sync-secret`; "Synced 2m ago" from `plaud.sync_runs`; refresh-on-resume is data-refetch only; problems render as severity banners.
- **PWA-11 (SHOULD). Open (#18).** Waveform: client-side Web Audio decode on first listen → 500-bucket envelope → cache-back to `waveform_peaks`; auto-decode gated to <~20 min; DPR-scaled canvas, pointer-capture scrubbing, ARIA slider; thin progress-bar fallback until peaks exist.
- **PWA-12 (SHOULD). ✖ Not shipped (#19 closed unplanned).** Command palette + keyboard nav (cmdk dialog, j/k, ? cheatsheet) was cut: the shipped UI is touch-first and the palette never justified itself on the primary surface. Reopen if desktop use grows.
- **PWA-13 (SHOULD). ✅ Shipped (#22).** Context editor page (CTX): `about_md` textarea + keyterms tag input writing `plaud.context` — the no-redeploy tuning surface.
- **PWA-14 (SHOULD). Open (#20).** Service worker (Serwist): precache the shell, network-first for data, instant cold paint from the home screen.
- **PWA-15 (COULD). Partial.** Per-bucket accent CSS variables: the Threads v2 design bakes per-bucket hues into its token system; verify whether a separate semantic accent layer still adds anything before ticketing.
- **PWA-16 (COULD). Largely mooted.** Server-side FTS: semantic search (`thread-search`) plus keyword search shipped in v1; revisit only if transcript-wide keyword recall becomes a felt gap (OQ-8).

### C. Smart processing & context

- **PROC-1 (MUST). ✅ Shipped — contract expanded (routine v3).** The `plaud-process` cloud routine remains the sole classifier/summarizer, and its write contract is now **two-layer**: (1) the recording-row UPDATE — `bucket/title/summary_md/action_items/tags` with the `and status='transcribed'` guard, jsonb string cast, `array[...]` literals, doubled quotes; (2) INSERTs into `plaud.threads` (utterance-index `sentence_ids`, `spans_ms`, `entities`, `content_idea`/`idea_note`) and `plaud.stt_corrections`. It touches nothing else — never transcript/audio columns, never other tables. `routine-prompt.md` (current, mirrors the live v3 routine) is the stable interface the PWA and pipeline rely on.
- **PROC-2 (MUST). ✅ Shipped.** `plaud.context` stays the single tuning surface: `keyterms` flow to Nova-3 (capped at 100), `about_md` calibrates the routine, both without redeploys; the write path is the CTX page (#22).
- **PROC-3 (SHOULD). Ongoing discipline — in force.** `routine-prompt.md` mirrors the live routine; any change edits the file first, then pushes via RemoteTrigger update, so repo and deployed prompt never diverge. (Held through the v3 rewrite.)
- **PROC-4 (SHOULD). Open (#23).** Reprocess affordance: a PWA action resets a `processed` row to `'transcribed'` (clearing bucket/title/summary/action_items/tags) so recordings can be re-classified after context edits. *Open design point: reprocess semantics must now also handle the thread layer (stale `plaud.threads` / `plaud.stt_corrections` rows for the recording).*
- **PROC-5 (COULD). Open.** Speaker naming: map diarized "Speaker N" labels to real names using hints in `about_md` (e.g. the solo-speaker default is Joe).

### D. Daily idea aggregator routine — **entirely unshipped; requirements stand** (tracked in #25, #26, #27)

- **AGG-1 (MUST).** A scheduled (daily, not API-fired) Claude cloud routine reads recordings processed since its last run — primarily `bucket='idea'` plus prescribed tags like `video-idea` — and produces a digest: each idea one line with title, tags, and a one-sentence gist. *Note: the thread layer gives the aggregator a richer substrate than v1.1 anticipated — `content_idea` threads and `plaud.thread_links` already isolate and connect ideas; the IDEAS tab renders the raw feed today.*
- **AGG-2 (MUST).** Cross-recording synthesis: cluster recurring themes across days ("you've circled this idea 3 times this month"), and surface the top 2–3 content bets for Joe's video pipeline. *`plaud.thread_links` provides the clustering signal.*
- **AGG-3 (SHOULD).** Action-item routing in the same run: list open (`done:false`) action items across all buckets, flagging any with explicit deadlines or urgency.
- **AGG-4 (SHOULD).** Weekly synthesis: a Sunday variant rolls the week up — bucket counts, dominant themes, stale action items.
- **AGG-5 (COULD).** Persist digests to a `plaud.digests` table so the PWA can render them, in addition to whatever push channel OQ-5 lands on.

### E. Ops / observability

- **OPS-1 (MUST). Partial — open (#29).** One health surface in the PWA: the severity banner shipped (#17); the small status view (counts per status, oldest unprocessed row, last sync time + `errors[]`, dead-lettered rows) remains open. No separate dashboard product.
- **OPS-2 (MUST). Partial.** Reauth alerting: `reauth_required` is a first-class sync-response field and persisted (#4), and the PWA banner surfaces it; folding it into the health view lands with #29. Fix path documented (re-run `plaud login`, re-seed).
- **OPS-3 (MUST, M1). ✅ Shipped (#28).** Per-run sync stats persisted to `plaud.sync_runs`; feeds PWA-10's "Synced 2m ago", the health banner, and PIPE-5's consecutive-failure detection.
- **OPS-4 (SHOULD). Open (#30).** Budget watch: track Deepgram minutes/month against the ~1,000 min ≈ $4.30 assumption, and routine fires/day against the cap; surface both in the health view.
- **OPS-5 (COULD). Open (#31).** Periodic Supabase advisor/log review (security + performance advisors, edge function error logs) as a monthly routine or checklist item.

## 6. Non-functional requirements

- **Cost ceiling ~$10/mo, hard — actual ≈ $5/mo.** Deepgram Nova-3 ~$0.0043/min (~$4.30 at 1,000 min), Storage pennies, edge functions + pg_cron on free tier, cloud routines on the existing Claude plan, Mac mini hosting free (already owned). Versus Plaud Pro at $8.33–17.99/mo. Any feature that adds a metered dependency must fit inside the remaining headroom or is out.
- **No separate Anthropic API keys.** Holds: all smart processing runs on Claude cloud routines under Joe's plan — zero Anthropic API spend; the edge functions hold a routine-fire token, never an API key. Routine-cap consumption is managed (3-min coalescing #6, fallback sweep #3, budget watch #30).
- **No reverse-engineered APIs.** Holds: Plaud access is exclusively the official third-party API behind `@plaud-ai/cli` OAuth. The 2026-08-17 refresh-encoding drift was handled by adapting the official client path (form-encoded with JSON fallback) — never scraping. If the API dies outright, the answer remains `legacy-mini`.
- **Privacy — strengthened.** The `plaud` schema stays revoked from `anon`/`authenticated` (server-side access only); the `plaud-audio` bucket stays private with 12h signed URLs; auth is a single allowed email via Supabase OTP, gated server-side on every route; the PWA is reachable **only over the tailnet** — never the public internet; no analytics, no third parties beyond Supabase, Plaud, Deepgram, and Anthropic; repo is public so no secrets or personal data ever land in it.
- **Phone-first performance.** List payload proportional to row count, never content size; transcript/summary/audio deferred to selection; type scale tuned for phone legibility (2026-08-19); service-worker shell (#20) and waveform decode gating (#18) still pending; touch scrubbing must not scroll the page.
- **Reliability.** Every pipeline stage writes its status; retries bounded (`retry_count` ≤ 5) with dead-lettering; sync runs idempotent and advisory-lock deduped; a lost Deepgram callback self-heals within ~40 min; coalesced routine fires are backstopped by the >15 min fallback fire. New work must preserve these invariants.

## 7. Milestones

- **M1 — Pipeline hardened. ✅ Complete** (#1–#7, #28 all closed). Every failure mode is a first-class sync-response field persisted in `plaud.sync_runs`; repo docs match deployed reality (this v1.2 pass + README rewrite close the last drift).
- **M2 — PWA usable daily. ✅ Built; exit verification open.** PWA-1..10 shipped (#9–#17) plus the severity banner. The exit criterion — Joe reaching for the PWA instead of the Plaud app for a full week — is not yet formally verified (#21); OPS-1's health view was deferred to #29.
- **M3 — Waveform + polish. Partly landed (early, out of order).** PWA-13 (#22) and OPS-3 (#28) shipped before M2 exit; PWA-12 (#19) was cut. Remaining: PWA-11 waveform (#18), PWA-14 Serwist (#20), PROC-4 reprocess (#23).
- **(Unplanned) Thread epic — shipped.** Thread extraction + embeddings + cross-recording links (#35), MIND week-plate (#36), semantic search, IDEAS tab, Threads v2 restyle, Mac mini + Tailscale deployment. Follow-ons open: #32 (chunk-then-merge >30 min), #33 (entity graph), #34 (link thresholds at 10× corpus), #37 (v2 state screens).
- **M4 — Aggregator. Not started.** AGG-1..3 (#25–#27), OPS-4 (#30), AGG-4/5 as stretch. Exit: a useful idea digest lands daily for two consecutive weeks and at least one digest item enters the video pipeline.

## 8. Open questions

1. ~~**PWA data access into the locked schema.**~~ **RESOLVED: (a) server-only access — implemented.** Shipped via server-side `postgres.js` over `DATABASE_URL` rather than the service-role key in RSCs; the client never touches the schema and all client-originated writes go through authenticated route handlers. Posture identical to the resolution; mechanism differs (§2 deviation 2).
2. **Sync-now auth swap. Still open.** `/api/sync` is a server route holding `x-sync-secret`; the cron and the PWA still share one static credential. When does `plaud-sync` accept a Supabase Auth JWT instead/alongside?
3. **Routine cap headroom. Partially mitigated.** 3-min coalescing (#6) plus the fallback sweep bound burst consumption, but the actual fires/day allowance is still unmeasured — it matters again when the daily aggregator (M4) starts consuming cap.
4. **Plaud API stability. Partially answered by events.** The API drifted once (~2026-08-17: refresh endpoint switched to form-encoding, causing an outage) and was adapted same-cycle with a JSON fallback retained — drift is survivable in one place. The tripwire for falling back to `legacy-mini` remains undefined; rate limits, presigned-URL TTLs, and pagination past 500 files are still unverified.
5. **Aggregator delivery channel. Still open.** iMessage via Hive, a PWA view backed by `plaud.digests`, or both? The IDEAS tab now exists as a natural render target. Affects AGG-1's output contract.
6. ~~**`ARCHIVE_MAX_BYTES` after the limit raise.**~~ **ANSWERED: TUS chunking.** Uploads above 45MB go via TUS in 6MB chunks — no dashboard limit in play; 45MB persists only as the buffered-vs-TUS threshold.
7. ~~**Signed-URL TTL number.**~~ **IMPLEMENTED at 12h** (#16); reopen only if it proves wrong.
8. ~~**FTS trigger point.**~~ **MOOTED.** Keyword + semantic search shipped in v1 (`thread-search` KNN over threads); server-side transcript FTS would only return if keyword recall over full transcripts becomes a felt gap.