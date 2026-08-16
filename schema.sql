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
  retry_count   int not null default 0,

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
  updated_at timestamptz not null default now()
);
grant all on plaud.context to service_role;

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

-- lock the schema down: service-role key only (the mini + the Claude routine)
revoke all on schema plaud from anon, authenticated;
grant usage on schema plaud to service_role;
grant all on all tables in schema plaud to service_role;
alter default privileges in schema plaud grant all on tables to service_role;
