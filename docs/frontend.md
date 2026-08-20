# Threads — the front end (`web/`)

Threads is the PWA face of the pipeline: a single-user, installable Next.js
app over everything the pipeline archives, transcribes, and processes. Three
tabs — **MEMOS** (master-detail browser with player and diarized transcript),
**MIND** (the week as a plate of bands, marks, and embedding-echo arcs),
**IDEAS** (content-idea threads as a flat feed) — plus a CTX editor and a sync
button. Served tailnet-only from the Mac mini, unreachable from the internet.

## Stack

Next.js 16 (App Router; middleware ships as `proxy.ts` per the 16.x
convention), React 19, Tailwind v4, TypeScript. Data deps: `@supabase/ssr`,
`@supabase/supabase-js`, `postgres`. No shadcn, no cmdk, no next-themes, no
service worker, no client data library.

## Architecture

- **Server-fetch-then-props.** One RSC (`app/page.tsx`, `force-dynamic`)
  gates on `currentUser()`, runs `listRecordings()` / `health()` /
  `listLinks()` in parallel, and hands JSON props to one `"use client"` shell
  (`Workstation`). No SWR/React Query — `router.refresh()` after sync and on
  `visibilitychange` re-runs the RSC; a reconciliation effect clears a
  selection whose id vanished from fresh props.
- **Light list, heavy detail.** The list query pulls light columns plus a
  140-char snippet; every thread's label/spans/entities ride the initial
  payload too (comb rows, MIND, and IDEAS need them). Transcript, summary, and
  the signed audio URL load per-recording from `/api/detail/[id]`, with
  AbortController cancellation on switch.
- **One serialization boundary.** `lib/types.ts` (`toRecording` /
  `toThreadFull` / `toDetail`) coerces loose jsonb rows to wire types — span
  arrays → `{start,end}`, string action items → `{text, done:false}`,
  timestamps → ISO, buckets default to `misc`. Coercion happens nowhere else.
- **Server-only data path.** The `plaud` schema is not PostgREST-exposed; it
  is reached exclusively via server-side postgres.js (`lib/db.ts`:
  `DATABASE_URL`, transaction pooler, `prepare:false`). The service-role
  client (`lib/supabase-admin.ts`) is server-only and does one thing: 12-hour
  signed URLs on the `plaud-audio` bucket. The browser never holds a key that
  can reach data; pipeline secrets appear only in the sync/search handlers.
- **Mutations.** Action-item toggle is optimistic with rollback (`jsonb_set`
  by index, bounds-checked); context save is a plain state machine.

## Auth

Email OTP (two-stage: email → 6-digit code), one allowed user — chosen over
the blueprint's Google OAuth for zero GCloud setup. `ALLOWED_EMAIL`
(lowercased comparison) is enforced at four layers:

1. `proxy.ts` middleware — `supabase.auth.getUser()` per request; matcher
   excludes only static assets; authed users on `/signin` bounce to `/`.
2. `lib/auth.ts` `currentUser()` — the single gate every server path goes
   through; any other identity reads as signed-out. Every API route opens with
   a 401 check; `/` redirects.
3. The sign-in server actions reject wrong emails before Supabase is called.
4. `/auth/confirm` verifies email-link `token_hash` server-side (survives
   email-client prefetch, needs no PKCE cookie) and signs out a
   verified-but-wrong identity.

## The three tabs

### MEMOS — master-detail

- Desktop `lg:grid-cols-3` (list 1/3, detail 2/3); below lg a `mobileView`
  state toggles `hidden`/`flex` — **both panes stay mounted**, so scroll,
  search, and selection survive the mobile back button. Selection is state,
  not routing.
- List: toolbar (underline search, shown/total count, bucket chips with color
  dots + counts, newest/oldest toggle), date-grouped rows under sticky
  backdrop-blur headers, infinite scroll (slice + IO sentinel, +50 per chunk).
  Each row: bucket dot, mono meta line, italic serif title, 2-line snippet,
  and a **thread-span comb** — one lane per thread, bucket-colored span bars
  with dotted holds.
- Detail: MEMO NN/NN header, then staggered sections — summary, checkable
  action items (optimistic PATCH), threads of consciousness, tap-to-seek
  transcript, fixed player bar.
- Thread cards: span times + mini span bar (tap a span → seek), green
  idea-note callout, entity chips, inline actions, and "CONNECTS TO" rows for
  embedding links → **EchoOverlay**: a full-screen modal pairing this thread
  with the remembered memo ("REMEMBERED ACROSS N DAYS"), shared-entity chips.
- Transcript: mono timestamps, speaker labels only when >1 distinct speaker,
  active utterance found by binary search on `currentMs`.
- Player: fixed bottom bar spanning the detail column; synthetic 60-bar
  waveform (decorative until real peaks land — issue #18), ARIA-slider
  progress with pointer-capture scrubbing and keyboard, ↺15/15↻ skips, speed
  cycle, MediaSession. `use-playback.ts` owns one hidden `Audio()` — state
  projected from element events, `seekToMs` the single seek path, a tracked
  `srcRef` compared instead of `audio.src` (the absolutized-URL gotcha).

### MIND — the week as a plate

- SVG: the last 7 recorded days as columns, y = time-of-day clamped
  06:00–23:00 with hour gridlines. Memo = vertical band (bucket-colored dot
  at start, height ∝ duration, capped at 30% of the plate). Thread = small
  mark on its memo's band at its first span's midpoint (idea threads green).
  Embedding link = quadratic-Bézier **echo arc**; stroke and opacity scale
  with similarity.
- Two fixed variants both always render — portrait 360×580 (`lg:hidden`) and
  landscape 700×560 (`hidden lg:block`); CSS breakpoints pick one, no JS
  screen detection, so marks sit near 1:1 device px on phones.
- Hover: a mark lights its own arcs; a band lights all the memo's arcs. Hot
  arcs go accent, the rest fade; marks the hot arcs don't reach dim out.
- **Seams**: union-find connected components over the link graph, kept when
  they span ≥2 distinct days, named by the most-frequent shared entity.
  Seam-list hover = preview isolation; tap = sticky isolate (tap again or
  RESET clears). Tap any band or mark → opens that memo in MEMOS.

### IDEAS

- Flat feed of every `contentIdea` thread across all recordings, built from
  the list payload (no extra fetch): italic idea note, entity chips,
  provenance footer (memo title · date · span), bucket-colored top border,
  live count in the tab label.

## Search

Keyword and semantic run side by side off one input. Keyword filters
client-side over title + name + snippet + tags + thread labels + entities —
not full transcript text; only the 140-char snippet rides the wire. Semantic
(`useSemanticSearch`: 550ms debounce, min 3 chars) POSTs to `/api/search` →
edge function `thread-search` (gte-small embedding, cosine KNN over threads);
results render as a "BY MEANING" section above the list with sim ticks and
scores. Failures degrade to empty matches, never errors.

## Design system — "Threads v2"

- Warm-paper field instrument, deliberately **light-only**; every component
  bespoke. Fonts: Newsreader (serif; italic for titles/display; body default)
  + IBM Plex Mono (instrument labels, tnum) via `next/font/google`.
- oklch everywhere (`app/globals.css`): ~12 bg tokens, a ~17-step ink ladder
  (`--ink-strong` → `--ink-ghost`), ~10 hairline steps, burnt-orange accent
  `oklch(0.575 0.200 47)`, idea green, danger red.
- Per-bucket hues: `[data-bucket]` sets `--bucket`; bucket dots, comb bars,
  span bars, MIND marks, chip dots, and idea-card borders inherit it. Film
  grain: fixed inline-SVG feTurbulence on `body::before`, multiply, 0.06.
- Type scale (after the 2026-08-19 phone-legibility bump): mono labels
  10–13px wide-tracked, body 14.5–15.5px light, thread labels 16–17px italic,
  row titles 18.5px italic, detail h1 27/32px, `.prose-memo` 15.5px/1.6.
- Tailwind v4 `@theme inline` maps a token subset to utilities; most color
  still lands via inline `style` with raw tokens.

## Routes

| Route | Kind | Purpose |
|---|---|---|
| `/` | RSC, `force-dynamic` | auth gate → parallel list/health/links queries → `<Workstation/>` |
| `/signin` | client + server actions | two-stage email → 6-digit OTP; allowlist checked before Supabase |
| `/auth/confirm` | GET | email-link `token_hash` verification fallback |
| `/context` | client | CTX editor: `about_md` + keyterms over `/api/context` |
| `/api/detail/[id]` | GET | summary, action items, transcript, threads + links, 12h signed audio URL |
| `/api/action-items` | PATCH | toggle one item's `done` by index (`jsonb_set`, bounds-checked) |
| `/api/sync` | POST | proxies edge fn `plaud-sync` with `x-sync-secret` held server-side; 150s timeout |
| `/api/search` | POST | proxies edge fn `thread-search`; q ≤500 chars, limit 8, 20s timeout |
| `/api/context` | GET/PUT | reads/writes `plaud.context`; keyterms cleaned, capped at 100 |
| `/manifest.webmanifest` | — | PWA manifest: standalone, 192/512 + maskable icons |

## Deployment

Runs on the Mac mini under launchd (`com.joe.threads`) behind
`tailscale serve` — tailnet-only HTTPS. Bootstrap, env, and the update
one-liner live in the README and `deploy/mini-setup.sh`.
