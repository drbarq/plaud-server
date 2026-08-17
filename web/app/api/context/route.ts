import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [row] = await sql`select about_md, keyterms, updated_at from plaud.context where id = 1`;
  return NextResponse.json({
    aboutMd: row?.about_md ?? "",
    keyterms: row?.keyterms ?? [],
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  });
}

export async function PUT(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { aboutMd, keyterms } = await req.json();
  if (typeof aboutMd !== "string" || !Array.isArray(keyterms)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const clean = keyterms.map(String).map((k) => k.trim()).filter(Boolean).slice(0, 100);
  await sql`update plaud.context
    set about_md = ${aboutMd}, keyterms = ${clean}, updated_at = now()
    where id = 1`;
  return NextResponse.json({ ok: true });
}
