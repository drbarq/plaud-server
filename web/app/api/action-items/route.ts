import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";

/** Toggle one action item's done flag on a recording. Body: {recordingId, index, done} */
export async function PATCH(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { recordingId, index, done } = await req.json();
  if (typeof recordingId !== "string" || !Number.isInteger(index) || typeof done !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const [row] = await sql`
    update plaud.recordings
    set action_items = jsonb_set(action_items, ${`{${index},done}`}::text[], ${done}::text::jsonb)
    where id = ${recordingId}
      and jsonb_array_length(coalesce(action_items, '[]'::jsonb)) > ${index}
    returning action_items`;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, actionItems: row.action_items });
}
