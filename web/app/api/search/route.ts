import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

/** Semantic search proxy — the PWA never holds the pipeline secret. */
export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { q } = await req.json();
  if (typeof q !== "string" || !q.trim()) return NextResponse.json({ matches: [] });

  const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/thread-search`, {
    method: "POST",
    headers: {
      "x-sync-secret": process.env.PLAUD_SYNC_SECRET!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ q: q.slice(0, 500), limit: 8 }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!resp?.ok) return NextResponse.json({ matches: [] }, { status: 200 });

  const body = await resp.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (body.matches ?? []).map((m: any) => ({
    sim: Number(m.sim),
    label: m.label,
    summaryLine: m.summary_line || null,
    recordingId: m.recording_id,
    key: m.key,
    recordingTitle: m.recording_title || null,
    bucket: m.bucket,
    startedAt: m.started_at ? new Date(m.started_at).toISOString() : null,
    contentIdea: !!m.content_idea,
  }));
  return NextResponse.json({ matches });
}
