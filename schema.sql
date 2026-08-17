-- Supabase schema for the Plaud pipeline. Run once in the SQL editor.
create schema if not exists plaud;

create table if not exists plaud.recordings (
  id            text primary key,              -- Plaud file id
  name          text not null,
  serial_number text,
  started_at    timestamptz,
  created_at    timestamptz,                   -- Plaud-side creation
  duration_ms   bigint,
  audio_path    text,                          -- local archive path on the mini
  audio_bytes   bigint,

  status        text not null default 'new'
                check (status in ('new','downloaded','transcribed','processed','error')),
  error         text,
  retry_count   int not null default 0,     -- ingest retries AND backfill attempts, max 5
  dg_request_id text,                       -- Deepgram async job id
  submitted_at  timestamptz,                -- when sent to Deepgram (stale >30min → resubmit)
  waveform_peaks jsonb,                     -- 500-bucket envelope, cached by the PWA

  transcript_source text check (transcript_source in ('plaud','deepgram','parakeet','whisper')),
  transcript    jsonb,                         -- [{speaker,start_ms,end_ms,text}]
  transcript_text text,                        -- flattened, for FTS

  -- filled by the Claude routine
  title         text,
  summary_md    text,
  action_items  jsonb,                         -- [{text,done,due?}]
  tags          text[],
  bucket        text,                          -- journal | idea | task | meeting | project-note | reference | misc
  processed_at  timestamptz,

  inserted_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists recordings_status_idx on plaud.recordings (status);
create index if not exists recordings_started_idx on plaud.recordings (started_at desc);
create index if not exists recordings_fts_idx on plaud.recordings
  using gin (to_tsvector('english', coalesce(transcript_text,'') || ' ' || coalesce(summary_md,'')));

create or replace function plaud.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;

drop trigger if exists recordings_touch on plaud.recordings;
create trigger recordings_touch before update on plaud.recordings
  for each row execute function plaud.touch_updated_at();

-- Speaker context: who Joe is + Deepgram keyterms. Edited without redeploys —
-- the routine reads about_md each run; plaud-sync passes keyterms to Nova-3.
create table if not exists plaud.context (
  id         int primary key default 1 check (id = 1),
  about_md   text not null,
  keyterms   text[] not null default '{}',
  routine_last_fired_at timestamptz,        -- coalescing window for routine fires
  updated_at timestamptz not null default now()
);
grant all on plaud.context to service_role;

-- Per-run sync observability (powers "Synced 2m ago", trend checks, alerts)
create table if not exists plaud.sync_runs (
  id              bigint generated always as identity primary key,
  ran_at          timestamptz not null default now(),
  listed          int,
  submitted       int,
  skipped_short   int,
  archive_skipped int,
  backfilled      int,
  resubmitted     int,
  awaiting_routine int,
  routine_fired   text,
  errors          jsonb,
  dead_lettered   jsonb,
  reauth_required boolean not null default false
);
grant all on plaud.sync_runs to service_role;
create index if not exists sync_runs_ran_at_idx on plaud.sync_runs (ran_at desc);

-- Plaud OAuth token custody (seeded from ~/.plaud/tokens.json after `plaud login`)
create table if not exists plaud.credentials (
  id            int primary key default 1 check (id = 1),
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz,
  status        text not null default 'ok' check (status in ('ok','reauth_required')),
  updated_at    timestamptz not null default now()
);
grant all on plaud.credentials to service_role;

-- Thread layer: a memo is threads of consciousness, not a chunk. Extracted by
-- the plaud-process routine (source='routine'; sentence_ids index into
-- recordings.transcript utterances). Rows imported from the Aug 2026 PoC use
-- source='poc' (their sentence_ids reference the PoC's own split — spans_ms
-- is the always-valid reference). Embeddings: gte-small over label + ". " +
-- summary_line, filled by the thread-embed function on cron.
create table if not exists plaud.threads (
  id            bigint generated always as identity primary key,
  recording_id  text not null references plaud.recordings(id) on delete cascade,
  key           text not null,               -- T1, T2… unique per recording
  label         text not null,
  summary_line  text,
  sentence_ids  int[] not null,
  spans_ms      jsonb,                       -- [[start,end],…] resurfacing = >1 span
  entities      text[] not null default '{}',
  action_items  jsonb not null default '[]',
  content_idea  boolean not null default false,
  idea_note     text,
  source        text not null default 'routine' check (source in ('routine','poc')),
  embedding     extensions.vector(384),
  created_at    timestamptz not null default now(),
  unique (recording_id, key)
);
create index if not exists threads_embedding_idx on plaud.threads using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists threads_entities_idx on plaud.threads using gin (entities);
create index if not exists threads_recording_idx on plaud.threads (recording_id);

-- Cross-recording links: cosine >= 0.86, or >= 0.80 with a shared rare entity
-- (global count <= 4), top 3 per thread. Thresholds recalibrated for gte-small
-- on label+summary text (PoC's 0.42/0.32 were MiniLM-on-full-text values).
create table if not exists plaud.thread_links (
  a bigint references plaud.threads(id) on delete cascade,
  b bigint references plaud.threads(id) on delete cascade,
  sim real not null,
  shared_entities text[] not null default '{}',
  primary key (a, b)
);

-- STT-correction feedback loop: routine logs manglings it fixed; reviewed
-- ones graduate into plaud.context.keyterms
create table if not exists plaud.stt_corrections (
  id           bigint generated always as identity primary key,
  recording_id text references plaud.recordings(id) on delete set null,
  heard        text not null,
  canonical    text not null,
  created_at   timestamptz not null default now(),
  reviewed     boolean not null default false,
  unique (heard, canonical)
);

grant all on plaud.threads, plaud.thread_links, plaud.stt_corrections to service_role;

-- lock the schema down: service-role key only (the mini + the Claude routine)
revoke all on schema plaud from anon, authenticated;
grant usage on schema plaud to service_role;
grant all on all tables in schema plaud to service_role;
alter default privileges in schema plaud grant all on tables to service_role;
