<!-- v1.1 — draft by subagent, revised per 11-finding adversarial critique 2026-08-16. Tickets: github.com/drbarq/plaud-server/issues -->
# PRD — plaud-server: Self-Hosted Plaud Pipeline + PWA

**Owner:** Joe Tustin · **Date:** 2026-08-16 · **Repo:** github.com/drbarq/plaud-server · **Status:** Pipeline shipped; PWA is the main new build

---

## 1. Overview & vision

plaud-server replaces the Plaud AI subscription ($8.33–17.99/mo) with a serverless pipeline Joe owns end to end: the Plaud Note Pro keeps syncing to Plaud's permanent free tier, the official third-party API hands us every MP3, Supabase archives and orchestrates, Deepgram Nova-3 transcribes with diarization and domain keyterms, and a Claude cloud routine classifies each recording into buckets with a title, summary, action items, and tags — all for under $10/mo with better transcripts and an independent audio archive. The remaining gap is the front door: a mobile-first PWA (per `docs/ui-patterns.md`) so Joe can browse, search, play, and act on his recordings from his phone, plus a daily aggregator routine that turns the `idea` bucket into a content-pipeline feed.

## 2. Current state (verified against code in repo)

**Shipped and live in Supabase project `thefullpicture` (`szsnocakbnrfoaauiqkr`), schema `plaud`:**

- **Tables:** `recordings` (status flow `new → downloaded → transcribed → processed` + `error` with `retry_count` max 5; transcript jsonb utterances + flattened `transcript_text` with GIN FTS index; `bucket/title/summary_md/action_items/tags`; `audio_path/audio_bytes`; `waveform_peaks` added for the PWA), `context` (singleton: `about_md` + `keyterms[]`), `credentials` (Plaud OAuth custody with `reauth_required` state). Schema is locked down: `anon`/`authenticated` revoked, `service_role` only.
- **Edge fn `plaud-sync`** (pg_cron every 10 min via Vault secret + manual `x-sync-secret` POST): advisory-lock dedup (`pg_try_advisory_lock(873429)`), OAuth refresh with reauth flagging, lists recordings (paged, ≤500), processes 5 new/retryable per run oldest-first, skips <4s recordings straight to `processed`, streams MP3s to Storage bucket `plaud-audio/YYYY-MM-DD/` (streaming pass-through, buffered fallback under `ARCHIVE_MAX_BYTES`=45MB, archive-skip rather than fail on Storage size limit), submits presigned URL to Deepgram Nova-3 (diarize + utterances + up to 100 keyterms from `plaud.context`), resubmits `downloaded` rows stale >30 min (3/run), backfills missing archive copies (2/run). Returns `{ok, listed, awaiting_routine, submitted, skipped_short, archive_skipped, backfilled, resubmitted, errors[]}`.
- **Edge fn `deepgram-callback`** (`?secret=` + `file_id` query params): stores diarized utterances at `status='transcribed'` (empty transcripts short-circuit to `processed` / "(no usable speech)"), then fires the Claude cloud routine `plaud-process` (`trig_01D5qhb3VPougC2H6BnpXMED`) via its API trigger with `ROUTINE_FIRE_TOKEN`.
- **Cloud routine `plaud-process`:** loads `plaud.context.about_md` as speaker calibration (data, not instructions), sweeps up to 20 `status='transcribed'` rows, writes bucket/title/summary_md/action_items/tags via an exact UPDATE contract (worked example in `routine-prompt.md`; `where … and status='transcribed'` guard; never touches transcript/audio columns).

**Known gaps/risks (do not re-ticket as new features):** Storage per-file limit needs a dashboard raise — 3 recordings currently unarchived, backfill auto-heals once raised; routine fires count against the daily routine cap; the Plaud official API is 3 days old; no UI exists. **Documentation drift:** README still describes inline Claude Haiku processing and an `ANTHROPIC_API_KEY` secret — the deployed `deepgram-callback` fires the cloud routine and uses no Anthropic key; `schema.sql` lacks `dg_request_id`, `submitted_at`, and `waveform_peaks`, which the deployed code/DB use.

## 3. Goals / Non-goals

**Goals**

1. Harden the shipped pipeline to zero-babysitting: every failure mode either self-heals or surfaces visibly.
2. Ship a phone-first PWA that makes the corpus usable daily: browse by bucket, search, read summaries, check off action items, play audio with tap-to-seek transcript.
3. Keep smart processing entirely on Claude cloud routines and keep total spend under ~$10/mo.
4. Add a daily idea-aggregator routine that turns `bucket='idea'` recordings into content-pipeline input.

**Non-goals**

- Multi-user support, sharing, or public access of any kind — this is Joe's personal infrastructure.
- Replacing Deepgram with local transcription (the `legacy-mini` Python pipeline stays as dormant fallback only).
- Recording or uploading audio from the PWA — the Plaud device + app remain the only capture path.
- Editing transcripts in the UI (read + seek only for v1).
- Native iOS/Android apps.

## 4. Users

One user: Joe. Single Google account (`j.tustin@gmail.com`), primary surface is his iPhone (PWA installed to home screen, resumed from background dozens of times a day), secondary surface the M4 Max MacBook. Design consequence: the detail pane, touch scrubbing, and cold-launch paint speed are designed first; desktop master-detail is the derivative layout. There is no onboarding, no empty-state marketing, no permissions model beyond "is this Joe's session."

## 5. Functional requirements

### A. Pipeline hardening

- **PIPE-1 (MUST).** Raise the Storage per-file size limit in the dashboard and confirm the 3 unarchived recordings backfill (the sweep heals 2 per run). Bound backfill attempts (a `backfill_attempts` counter or reuse of `retry_count`) so a permanently-unarchivable row cannot occupy the `order by started_at desc limit 2` slots forever and starve orphans behind it; surface permanently-unarchivable rows as a first-class sync-response field. Exit check: zero `processed`/`transcribed` rows ≥4s with `audio_path is null`, or each such row visibly dead-lettered.
- **PIPE-2 (MUST).** Reconcile `schema.sql` with the live database: add `dg_request_id`, `submitted_at`, `waveform_peaks` so the reference copy is trustworthy again.
- **PIPE-3 (MUST).** Fix README drift: remove the inline-Haiku / `ANTHROPIC_API_KEY` description and document the actual callback → routine-fire flow and `ROUTINE_FIRE_TOKEN` secret.
- **PIPE-4 (MUST).** Surface dead-lettered work: rows that hit `retry_count = 5` currently stop retrying silently. M1 scope: first-class `dead_lettered[]` and `reauth_required` fields in the sync response and persisted state (OPS-3). The PWA banner rendering of these lands with OPS-1 in M2.
- **PIPE-5 (SHOULD).** Defensive handling of the 3-day-old Plaud API: on repeated list/detail failures across consecutive runs, escalate to a visible alert rather than accruing per-row errors; tolerate response-shape changes in one place (`plaudGet` already normalizes `body.data ?? body`).
- **PIPE-6a (MUST).** Stop handing `PLAUD_SYNC_SECRET` to Deepgram: the callback URL currently embeds the same credential that authorizes sync invocation, and Deepgram stores callback URLs in its job records. Introduce a distinct `DEEPGRAM_CALLBACK_SECRET` (two-line change: one env read in each function).
- **PIPE-6b (SHOULD).** Per-submission callback tokens (HMAC of file_id) and a documented two-step rotation that doesn't strand in-flight callbacks.
- **PIPE-7 (SHOULD, requires PIPE-9).** Coalesce routine fires: every transcript fires `plaud-process` even though each run sweeps up to 20 rows, burning daily routine cap on bursts. Skip the fire when one was sent within the last few minutes (a `last_fired_at` check in the callback), relying on the sweep semantics. Must not land before PIPE-9, or coalesced-away fires strand rows.
- **PIPE-8 (COULD).** Store orphan transcripts: a callback for an unknown `file_id` is currently acknowledged and dropped; persist the payload to a holding row instead.
- **PIPE-9 (MUST).** Fallback sweep trigger — stranded `transcribed` rows must self-heal. Today the callback's routine fire is fire-and-forget (errors swallowed) and nothing else ever fires: a failed fire or exhausted daily routine cap strands rows at `transcribed` until the next recording arrives. `plaud-sync` must fire `plaud-process` when `awaiting_routine > 0` and the oldest `transcribed` row is older than ~15 minutes.

### B. PWA v1 (blueprint: `docs/ui-patterns.md` — follow it, including its "Gotchas" section verbatim)

- **PWA-1 (MUST).** Scaffold: Next.js + Tailwind 4 + shadcn, `manifest.ts` (standalone display, appleWebApp metadata, media-switched themeColor, 192/512 + maskable icons), next-themes class strategy with oklch shadcn tokens.
- **PWA-2 (MUST).** Supabase Auth with Google via `@supabase/ssr` cookie sessions, single allowed email (`j.tustin@gmail.com`). Data access is **server-only** (OQ-1 resolved as option a): RSCs and route handlers use the service-role key against the locked `plaud` schema; the client never holds a key that can reach it. Enforcement lives in middleware **and** every route handler **and** the RSC (one missed path = full corpus exposure); consequence: action-item writes (PWA-7), waveform cache-back (PWA-11), signed-URL minting (PWA-9), and context writes (PWA-13) all go through authenticated route handlers.
- **PWA-3 (MUST).** Server-fetch-then-props architecture: one async RSC runs queries in parallel and hands JSON props to a single client shell; list query selects light columns only (id, name, title, started_at, duration_ms, status, bucket, tags, has_summary) **plus a server-computed `snippet`** (`left(coalesce(summary_md, transcript_text), 140)`) so row second-lines and client search work without shipping content; one `toRecording()` serialization boundary (ISO timestamps, typed `Utterance[]`, bucket defaults `'misc'`); `router.refresh()` after mutations with optimistic state reconciled against fresh props in an effect.
- **PWA-4 (MUST).** Master-detail workstation: single screen, list 1/3 + sticky detail 2/3 on desktop; below `lg` a `mobileView` state toggles panes with `hidden` — both panes stay mounted so scroll/search/selection survive back-navigation; no routing for selection; mobile-only Back ghost button.
- **PWA-5 (MUST).** List: date-grouped sticky headers (Today / Yesterday / This week / Earlier this month / month, skipped for non-chronological sort); row = title (fallback name) + in-flight status chip, second line summary-first-line → transcript snippet → duration·time; leading bucket dot; selection = bg tint + 2px inset left bar; infinite scroll via `slice(0, visibleCount)` + IntersectionObserver sentinel (+~50, reset on filter change). No virtualization.
- **PWA-6 (MUST).** Toolbar: horizontally scrollable bucket-chip row (All + the 7 buckets) as primary navigation; v1 client search scope is title+name+tags+snippet (transcript-wide search is server-side FTS, PWA-16) with clear button and Enter-selects-first-hit; sort dropdown; "N of M" count.
- **PWA-7 (MUST).** Detail pane leads with `summary_md` (rendered markdown) + checkable action items that write `action_items` jsonb back, transcript below; per-recording async state tracked as `Map<id, op>`, never a boolean.
- **PWA-8 (MUST).** Utterance transcript: speaker label, mm:ss, text per row; tap a row → `seekToMs(start_ms)`; active-utterance highlight via binary search on currentTime; word-count footer + copy/export. Transcript jsonb, summary, and signed audio URL load per-recording on tap with AbortController cancellation — never in the list payload.
- **PWA-9 (MUST).** Playback engine: one hook owning a hidden `<audio>` whose src is a Supabase Storage signed URL (Range/206 seeking for free); all UI state derived from element events; central `seekToRatio()`/`seekToMs()` with `isSeekingRef` cleared on `seeked`; MediaSession lock-screen metadata; speed-cycle button (0.5–2x); no volume UI; monospace tabular-nums time label padded to duration width. Signed URLs: TTL 12h (outlives any listening session), reuse ONE signed URL per session for both the `<audio>` element and the waveform-decode fetch, re-sign and restore playback position on the `<audio>` `error` event; compare `audio.getAttribute('src')`, never `audio.src`. Degraded state: rows with `audio_path is null` (archive-skipped) show "audio not yet archived" instead of a player — never an error.
- **PWA-10 (MUST).** Sync-now: status-aware button ("Syncing… / Synced 2m ago / Retry sync") hitting the `plaud-sync` endpoint (v1 via a server route holding `x-sync-secret`; JWT check later per OQ-2), short cooldown + toast; "Synced 2m ago" reads from persisted run stats (OPS-3). On mount and `visibilitychange`, do `router.refresh()` (data refetch) only — pg_cron already runs the pipeline every 10 minutes, and a phone resumed dozens of times a day must not hammer a 3-day-old Plaud API; manual Sync-now is the only client-initiated pipeline trigger. Problems render as severity banners above content; server-side advisory lock remains the dedup backstop.
- **PWA-11 (SHOULD).** Waveform: client-side Web Audio decode on first listen → 500-bucket max-abs envelope normalized [0,1] → fire-and-forget cache-back to `waveform_peaks` guarded by `.is('waveform_peaks', null)`; auto-decode gated to <~20 min with a "Generate waveform" button beyond (abort the fetch on switch, drop stale results via current-id ref — `decodeAudioData` itself is uninterruptible); one DPR-scaled canvas re-aggregating to 3px+2px mirrored rounded bars, 4% min height, CSS-variable colors read at draw time, redraw on ~4Hz timeupdate; scrubbing via pointer events + `setPointerCapture` + `touch-action: none`, hover effects only when `pointerType !== 'touch'`, ARIA slider role with Home/End; thin progress-bar fallback until peaks exist.
- **PWA-12 (SHOULD).** Command palette + keyboard: cmdk dialog with recordings group (fuzzy value = title + bucket + tags + snippet — doubles as full-text search) and actions group (Sync now, Edit context, theme); one global listener — Cmd/Ctrl+K always wins, everything else bails in inputs; j/k, /, ? cheatsheet from a declarative config array, space/arrows in the player hook; all gated on no-modal-open.
- **PWA-13 (SHOULD).** Context editor page: `about_md` textarea + keyterms tag input writing `plaud.context` — the no-redeploy tuning surface for both Deepgram keyterms and routine calibration.
- **PWA-14 (SHOULD).** Service worker (Serwist): precache the shell, network-first for data, so cold launch from the home screen paints instantly.
- **PWA-15 (COULD).** Per-bucket accent CSS variables as a semantic layer over the theme tokens.
- **PWA-16 (COULD).** Server-side full-text search using the existing GIN FTS index once the corpus outgrows in-memory palette search.

### C. Smart processing & context

- **PROC-1 (MUST).** The `plaud-process` cloud routine remains the sole classifier/summarizer; the exact UPDATE contract in `routine-prompt.md` (jsonb string cast, `array[...]` literals, doubled quotes, `and status='transcribed'` guard, no other columns) is a stable interface the PWA and pipeline may rely on.
- **PROC-2 (MUST).** `plaud.context` stays the single tuning surface: `keyterms` flow to Nova-3 (capped at 100) and `about_md` calibrates the routine, both without redeploys; the PWA context editor (PWA-13) is the write path.
- **PROC-3 (SHOULD).** Prompt-sync discipline: `routine-prompt.md` mirrors the live routine; any change edits the file first, then pushes via RemoteTrigger update, so repo and deployed prompt never diverge.
- **PROC-4 (SHOULD).** Reprocess affordance: a PWA action resets a `processed` row to `'transcribed'` (clearing bucket/title/summary/action_items/tags) so recordings can be re-classified after context edits; next fire or sweep picks it up.
- **PROC-5 (COULD).** Speaker naming: map diarized "Speaker N" labels to real names using hints in `about_md` (e.g. the solo-speaker default is Joe).

### D. Daily idea aggregator routine

- **AGG-1 (MUST).** A scheduled (daily, not API-fired) Claude cloud routine reads recordings processed since its last run — primarily `bucket='idea'` plus prescribed tags like `video-idea` — and produces a digest: each idea one line with title, tags, and a one-sentence gist.
- **AGG-2 (MUST).** Cross-recording synthesis: cluster recurring themes across days ("you've circled this idea 3 times this month"), and surface the top 2–3 content bets for Joe's video pipeline.
- **AGG-3 (SHOULD).** Action-item routing in the same run: list open (`done:false`) action items across all buckets, flagging any with explicit deadlines or urgency (the per-transcript routine already flags these in its run summary — the aggregator makes them durable).
- **AGG-4 (SHOULD).** Weekly synthesis: a Sunday variant rolls the week up — bucket counts, dominant themes, stale action items.
- **AGG-5 (COULD).** Persist digests to a `plaud.digests` table so the PWA can render an "Ideas" view, in addition to whatever push channel OQ-5 lands on.

### E. Ops / observability

- **OPS-1 (MUST).** One health surface in the PWA: counts per status, oldest row not yet `processed`, last sync time and its `errors[]`, and dead-lettered rows (PIPE-4) — rendered as the severity banner + a small status view. No separate dashboard product.
- **OPS-2 (MUST).** Reauth alerting: `plaud.credentials.status='reauth_required'` currently sits silent until noticed. It must produce a prominent PWA banner, and the sync response must carry it as a first-class field (it already fails loudly in `errors`), with the fix documented (re-run `plaud login`, re-seed).
- **OPS-3 (MUST, M1).** Persist per-run sync stats (submitted/resubmitted/backfilled/archive_skipped/dead_lettered/errors) to a small `plaud.sync_runs` table instead of only returning them to the caller. Promoted to M1 because three things depend on it: PWA-10's "Synced 2m ago", OPS-1's last-sync surfacing, and PIPE-5's repeated-failure detection.
- **OPS-4 (SHOULD).** Budget watch: track Deepgram minutes/month (sum of `duration_ms` submitted) against the ~1,000 min ≈ $4.30 assumption, and routine fires/day against the cap; surface both in the health view.
- **OPS-5 (COULD).** Periodic Supabase advisor/log review (security + performance advisors, edge function error logs) as a monthly routine or checklist item.

## 6. Non-functional requirements

- **Cost ceiling ~$10/mo, hard.** Current model: Deepgram Nova-3 ~$0.0043/min (~$4.30 at 1,000 min), Storage ~300MB/mo ≈ pennies, edge functions + pg_cron on free tier, cloud routines on the existing Claude plan. Any feature that adds a metered dependency must fit inside the remaining headroom or is out.
- **No separate Anthropic API keys.** All smart processing (per-transcript classification, idea aggregation) runs on Claude cloud routines under Joe's plan — the edge functions hold a routine-fire token, never an API key. Consequence: routine-cap consumption is a managed resource (PIPE-7, OPS-4), not an afterthought.
- **No reverse-engineered APIs.** Plaud access is exclusively the official third-party API behind `@plaud-ai/cli` OAuth. If that API changes or dies, the answer is adaptation or the legacy-mini fallback — never scraping the consumer app.
- **Privacy.** Voice recordings are as personal as data gets: the `plaud` schema stays revoked from `anon`/`authenticated` (service-role only, with any PWA access path preserving that posture per OQ-1); the `plaud-audio` bucket stays private with short-lived signed URLs; auth is a single allowed Google identity; no analytics, no third parties beyond Supabase, Plaud, Deepgram, and Anthropic; repo is public so no secrets or personal data ever land in it.
- **Phone-first performance.** List payload proportional to row count, never content size; transcript/summary/audio deferred to selection; service-worker shell for instant cold paint; waveform decode gated at ~20 min so iOS Safari never OOM-kills the tab; touch scrubbing must not scroll the page (`touch-action: none`).
- **Reliability.** Every pipeline stage writes its status; retries are bounded (`retry_count` ≤ 5) and swept by the existing cron; sync runs are idempotent and deduped by advisory lock; a lost Deepgram callback self-heals within ~40 min. New work must preserve these invariants.

## 7. Milestones

- **M1 — Pipeline hardened.** PIPE-1..4, PIPE-6a, PIPE-9, OPS-2 (data-layer), OPS-3; PIPE-7 if cheap (after PIPE-9). Exit: Storage limit raised and the 3 orphans archived or visibly dead-lettered; every failure mode is a first-class field in the sync response and persisted in `plaud.sync_runs` (banner *rendering* is M2); repo docs match deployed reality.
- **M2 — PWA usable daily.** PWA-1..10 (scaffold, auth, RSC architecture, master-detail, list + chips + search, detail with summary/action items, utterance tap-to-seek, playback with thin progress bar, Sync-now), plus OPS-1 banner. Exit: Joe reaches for the PWA on his phone instead of the Plaud app for a full week.
- **M3 — Waveform + palette polish.** PWA-11..14 (waveform with cache-back, command palette + shortcuts, context editor, service worker), OPS-3, PROC-4. Exit: waveform renders from cached peaks on second listen; context edits round-trip to better keyterms/classification without a redeploy.
- **M4 — Aggregator.** AGG-1..3 (daily digest, synthesis, action-item routing), OPS-4, AGG-4/5 as stretch. Exit: a useful idea digest lands daily for two consecutive weeks and at least one digest item enters the video pipeline.

## 8. Open questions

1. ~~**PWA data access into the locked schema.**~~ **RESOLVED: (a) server-only access.** The privacy NFR mandates `plaud` stays revoked from `anon`/`authenticated`, which eliminates RLS-view exposure; RSCs and route handlers use the service-role key, the client never touches the schema, and all client-originated writes go through authenticated route handlers (folded into PWA-2).
2. **Sync-now auth swap.** When does `plaud-sync` accept a Supabase Auth JWT (verified against the single allowed email) instead of/alongside `x-sync-secret`? v1 hides the secret in a server route, but the cron and the PWA should ideally not share one static credential forever.
3. **Routine cap headroom.** How many routine fires/day does Joe's plan actually allow, and what do burst days (5+ transcripts) plus the daily aggregator consume? Determines how aggressive PIPE-7 coalescing must be, and whether the aggregator can also run a weekly variant.
4. **Plaud API stability.** The official API is 3 days old: unknown rate limits, presigned-URL TTL guarantees, pagination behavior past 500 files, and deprecation risk. What is the tripwire that triggers falling back to `legacy-mini`?
5. **Aggregator delivery channel.** iMessage via Hive, a PWA "Ideas" view backed by `plaud.digests`, or both? Affects AGG-1's output contract.
6. **`ARCHIVE_MAX_BYTES` after the limit raise.** Streaming pass-through should handle any size once the Storage limit is raised — is the 45MB buffered-fallback cap still meaningful, and what should the dashboard limit be set to (longest plausible recording ≈ multi-hour meeting ≈ 100–150MB MP3)?
7. **Signed-URL TTL number.** Spec is folded into PWA-9 (12h TTL + re-sign on `error` event); open only if 12h proves wrong.
8. **FTS trigger point.** At what corpus size does in-memory palette search degrade on the phone, prompting PWA-16's server-side FTS — and should the GIN index then also cover `title` and `tags`?