import "server-only";
import { sql } from "./db";
import { toRecording, type Health, type Recording } from "./types";

export async function listRecordings(): Promise<Recording[]> {
  const rows = await sql`
    select id, name, title, bucket, tags, status, started_at, duration_ms,
      left(coalesce(nullif(summary_md, ''), transcript_text, ''), 140) as snippet,
      (summary_md is not null and summary_md != '') as has_summary,
      (audio_path is not null) as has_audio
    from plaud.recordings
    order by started_at desc nulls last`;

  const threadRows = await sql`
    select recording_id, key, label, spans_ms, content_idea, idea_note, entities
    from plaud.threads order by recording_id, key`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byRecording = new Map<string, any[]>();
  for (const t of threadRows) {
    const list = byRecording.get(t.recording_id);
    if (list) list.push(t);
    else byRecording.set(t.recording_id, [t]);
  }

  return rows.map((r) => toRecording(r, byRecording.get(r.id) ?? []));
}

export async function health(): Promise<Health> {
  const [run] = await sql`
    select ran_at, errors, dead_lettered, reauth_required, awaiting_routine
    from plaud.sync_runs order by ran_at desc limit 1`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dead = Array.isArray(run?.dead_lettered) ? (run.dead_lettered as any[]) : [];
  return {
    lastSyncAt: run?.ran_at ? new Date(run.ran_at).toISOString() : null,
    lastErrors: Array.isArray(run?.errors) ? run.errors : [],
    deadLettered: dead.map((d) => ({ id: d.id, name: d.name, error: d.error })),
    reauthRequired: !!run?.reauth_required,
    awaiting: Number(run?.awaiting_routine ?? 0),
  };
}
