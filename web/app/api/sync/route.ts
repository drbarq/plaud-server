import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

/** Sync-now: the PWA never holds the pipeline secret — this route does. */
export async function POST() {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const resp = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/plaud-sync`,
    {
      method: "POST",
      headers: { "x-sync-secret": process.env.PLAUD_SYNC_SECRET! },
      // long-running: big backlogs take a minute+
      signal: AbortSignal.timeout(150_000),
    },
  ).catch((e) => ({ ok: false, statusText: String(e) }) as const);

  if (!("json" in resp)) {
    return NextResponse.json({ ok: false, error: resp.statusText }, { status: 502 });
  }
  const body = await resp.json();
  return NextResponse.json(body, { status: resp.ok ? 200 : 502 });
}
