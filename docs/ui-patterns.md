> **Historical — pre-build blueprint (kept for rationale).** Written 2026-08-16
> as a clean-room pattern study of riffado, before a line of `web/` existed.
> The PWA has since shipped; **`docs/frontend.md` documents what was actually
> built** and is the current reference. Most of this blueprint landed as
> written — server-fetch-then-props, master-detail, the playback engine,
> infinite scroll. Divergences: email OTP instead of Google auth; a bespoke
> light-only token sheet instead of shadcn/next-themes; waveform peaks, the
> command palette, and the service worker never shipped. Everything
> thread-shaped — thread cards, echo links, the MIND plate, IDEAS, semantic
> search — postdates this document entirely.

# UI Patterns — the wheel study

Clean-room pattern extraction from riffado v0.6.x (AGPL) — we adopt **approaches,
not code**, so our PWA carries no license entanglement. Three readers went through
the source (screens/IA, audio player, data-flow/PWA) on 2026-08-16. This document
is the blueprint for our build against `plaud.recordings`.

## Architecture (adopt)

- **Server-fetch-then-props.** One async server component runs the queries in
  parallel and hands JSON props to a single client shell. No client data library.
  After mutations, `router.refresh()` re-runs the RSC; React reconciliation keeps
  selection/scroll/search alive. Our version: `@supabase/ssr`, light columns only
  (id, name, title, started_at, duration_ms, status, bucket, tags, has_summary).
- **Heavy content deferred to selection.** Transcript jsonb, summary_md, and the
  signed audio URL load per-recording on tap, with AbortController cancellation.
  List payload stays proportional to row count, never content size.
- **One serialization boundary.** A single `toRecording()` module: timestamps →
  ISO strings, transcript jsonb → typed `Utterance[]`, empty arrays → null,
  bucket defaults to 'misc'. Every surface consumes only the wire type.
- **Composition-root client component.** One shell owns selection + mobileView;
  everything else is one-hook-per-concern (usePlayback, useSyncNow, useTheme,
  useKeyboardNav). Per-recording async state is a `Map<id, op>`, never a boolean
  (riffado documents the race that motivated this).

## Screens & layout

- **Single-screen master-detail workstation (adopt).** List 1/3, detail 2/3 on
  desktop (detail sticky, own scroll). Below lg: a `mobileView` state toggles
  panes with the `hidden` class — **both stay mounted**, so scroll/search/
  selection survive back-navigation. No routing for selection. Mobile-only
  "Back" ghost button. We're phone-first: design detail pane first.
- **Date-grouped list, sticky headers (adopt).** Today / Yesterday / This week /
  Earlier this month / month — tiny uppercase sticky headers with backdrop-blur.
  Skip grouping when sort is non-chronological.
- **Row anatomy (adapt).** Line 1: title (fallback: name) + in-flight status
  chip. Line 2: summary first-line, else transcript snippet (~140 chars), else
  "duration · time". Selection = bg tint + 2px inset left bar. OURS: leading
  bucket dot/badge; tags live in detail only; no hover-reveal menus on touch.
- **Toolbar (adapt).** Search (clear button; Enter selects first hit) + "N of M"
  count + sort dropdown. OURS: horizontally scrollable **bucket chips** row
  (All · journal · idea · task · meeting · project-note · reference · misc) as
  primary navigation. Search matches title+name+transcript_text+summary+tags.
- **Infinite scroll (adopt).** No virtualization: `slice(0, visibleCount)` + a
  4px IntersectionObserver sentinel (200px rootMargin) growing the count by ~50.
  Reset on filter change.
- **Sync status (adopt).** One status-aware button: "Syncing… / Synced 2m ago /
  Retry sync"; problems as severity banners above content. Wire to our Sync-now
  endpoint; keep server-side in-progress dedup (advisory lock already does this).
- **Auto-sync triggers (adapt).** Sync on mount + on `visibilitychange` when
  more than half the interval has elapsed — THE pattern for a phone PWA resumed
  from the home screen. Manual button gets a short cooldown + toast. Skip
  riffado's cross-tab token/TTL lock ceremony (single user; the advisory lock
  in the edge function is the backstop).

## Audio player (the part we least want to rebuild blind)

- **Playback engine hook owns a hidden `<audio>` (adopt).** All UI state derives
  from element events (timeupdate/loadedmetadata/ended/seeked). One central
  `seekToRatio()` used by every control; an `isSeekingRef` set on seek and
  cleared on `seeked` is the detail that makes drag-scrubbing feel solid.
  OURS: add `seekToMs()` for transcript-row clicks; `<audio>` src = Supabase
  Storage signed URL (Storage speaks Range/206 natively — seeking before full
  download for free, which riffado hand-rolls). MediaSession metadata for
  lock-screen controls. Speed cycle button (0.5–2x). No volume UI.
- **Waveform: client-side peaks with server cache-back (adopt — the surprise).**
  Riffado computes NO peaks server-side. Browser decodes audio on first listen
  (Web Audio API), computes a 500-bucket max-abs envelope normalized to [0,1],
  fire-and-forget POSTs it back for caching. Decode cost paid once ever, zero
  server audio machinery. OURS: `waveform_peaks jsonb` column (added), PWA
  writes back via supabase-js `update().is('waveform_peaks', null)`.
- **Duration gate (adopt).** Auto-decode only under ~20 min (decodeAudioData
  inflates to float32 PCM, ~10MB/stereo-minute; iOS Safari will kill the tab on
  a 2-hour meeting). Longer recordings get a "Generate waveform" button. Abort
  the fetch on recording switch; drop stale results via a current-id ref.
- **Canvas rendering (adopt).** One DPR-scaled canvas; re-aggregate 500 stored
  buckets to however many 3px+2px bars fit (max-per-group); mirrored rounded
  bars, 4% min height so silence reads as a dotted line; colors read from CSS
  variables at draw time (dark mode for free); redraw on ~4Hz timeupdate ratio
  prop — no rAF loop.
- **Scrubbing (adopt verbatim in spirit).** Pointer events on the wrapper with
  `setPointerCapture`, `touch-action: none` (the single most important line for
  mobile), `select-none`, hover effects only when `pointerType !== 'touch'`.
  ARIA slider role + Home/End keys. Thin progress-bar fallback until peaks
  exist (and permanently for gated long recordings).
- **Stable time label (adopt).** Monospace tabular-nums; pad current time to the
  duration's segment structure so the label never changes width mid-playback.

## Transcript UX — where we beat the reference

Riffado renders the entire transcript as one `<p>` — no speakers, no timestamps,
no click-to-seek (their data is a flat string; ours is structured utterances).
OURS: a real utterance list — speaker label, mm:ss, text per row; **tap a row →
`seekToMs(start_ms)`**; active-utterance highlight via binary search on
currentTime; keep their word-count metadata footer and copy/export affordance.

## Command palette & keyboard (adapt)

cmdk in a dialog: recordings group (fuzzy value = title + bucket + tags +
snippet — the palette doubles as full-text search with zero infra), actions
group (Sync now, Edit context, theme), status icons per row. Global shortcuts:
one window listener, Cmd/Ctrl+K always wins, everything else bails in inputs;
j/k nav, / search, ? cheatsheet (declarative config array), space/arrows in the
player-owned hook. Gate all of it on "no modal open".

## PWA & theme

- **Manifest baseline (adopt).** Next `manifest.ts` (served at
  /manifest.webmanifest), display standalone, appleWebApp metadata,
  media-switched themeColor, 192/512 icons **plus maskable** (riffado lacks it).
- **Go further (ours).** Minimal service worker (Serwist): precache the shell,
  network-first for data, so cold launch from home screen paints instantly.
  Riffado ships no SW at all.
- **Theme (adopt).** next-themes class strategy + suppressHydrationWarning +
  disableTransitionOnChange; oklch shadcn tokens in :root/.dark; a semantic
  layer on top — OURS: per-bucket accent CSS vars. localStorage persistence
  only (single user).

## What we add that the reference doesn't have

1. Bucket chips as primary navigation + per-bucket accent colors.
2. Detail pane leads with **summary_md + checkable action_items** (writes
   `action_items` jsonb back), transcript below.
3. Context editor page (`plaud.context`: about_md textarea + keyterms tag input).
4. Sync-now wired to our edge function (x-sync-secret v1; Supabase Auth JWT later).
5. Full-text search server-side via the existing FTS index when the corpus
   outgrows in-memory search.

## Gotchas collected (do not re-learn these)

- Signed URLs differ per `getSignedUrl` call → browser cache won't dedupe the
  waveform-decode fetch vs the `<audio>` stream. Reuse ONE signed URL for both
  within a session.
- Riffado has a latent bug we must not copy: comparing `audio.src` (absolute)
  against a relative path — guard never matches, src re-set + load() on every
  effect re-run. Compare `audio.getAttribute('src')` or memoize.
- `router.refresh()` preserves client state → optimistic state MUST be
  reconciled against fresh props in an effect (ghost selections otherwise).
- RSC props must be JSON-serializable; coerce jsonb to typed shapes at the one
  boundary module.
- decodeAudioData is uninterruptible once started — abort only the fetch.
- Runtime env branching in RSCs gets baked at build; `force-dynamic` where it
  matters.

## v1 build order

1. Scaffold (Next.js + Tailwind 4 + shadcn init, manifest, theme tokens).
2. Supabase Auth (Google, single allowed email) + RSC list query + wire types.
3. List: rows, date groups, bucket chips, search, infinite scroll.
4. Detail: summary + action items + utterance list.
5. Player: engine hook + controls + thin progress bar (waveform later).
6. Sync-now button + status surfacing.
7. Waveform + palette + shortcuts + SW polish.
8. Context editor.
