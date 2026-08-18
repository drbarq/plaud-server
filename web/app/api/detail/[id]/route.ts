import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { signAudioUrl } from "@/lib/supabase-admin";
import { toDetail, toThreadFull } from "@/lib/types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const [row] = await sql`
    select id, summary_md, action_items, transcript, audio_path
    from plaud.recordings where id = ${id}`;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const threadRows = await sql`
    select id, key, label, summary_line, sentence_ids, spans_ms, entities,
           action_items, content_idea, idea_note
    from plaud.threads where recording_id = ${id} order by key`;

  const linkRows = await sql`
    select case when ta.recording_id = ${id} then ta.id else tb.id end as this_id,
           l.sim, l.shared_entities,
           case when ta.recording_id = ${id} then tb.label else ta.label end as other_label,
           case when ta.recording_id = ${id} then tb.summary_line else ta.summary_line end as other_summary_line,
           case when ta.recording_id = ${id} then tb.recording_id else ta.recording_id end as other_recording_id,
           case when ta.recording_id = ${id} then rb.title else ra.title end as other_recording_title,
           case when ta.recording_id = ${id} then rb.started_at else ra.started_at end as other_started_at
    from plaud.thread_links l
    join plaud.threads ta on ta.id = l.a
    join plaud.threads tb on tb.id = l.b
    join plaud.recordings ra on ra.id = ta.recording_id
    join plaud.recordings rb on rb.id = tb.recording_id
    where ta.recording_id = ${id} or tb.recording_id = ${id}
    order by l.sim desc`;

  const threads = threadRows.map((t) =>
    toThreadFull(t, linkRows.filter((l) => Number(l.this_id) === Number(t.id))),
  );

  const audioUrl = await signAudioUrl(row.audio_path);
  return NextResponse.json(toDetail(row, threads, audioUrl));
}
