// thread-search: semantic search over plaud.threads. Embeds the query with
// the SAME model that embedded the threads (gte-small, 384-dim) and runs
// cosine KNN over the HNSW index. Auth: x-sync-secret.
import postgres from "npm:postgres@3.4.7";

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts: Record<string, unknown>): Promise<number[]> } };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  const secret = Deno.env.get("PLAUD_SYNC_SECRET");
  if (!secret) return json({ error: "PLAUD_SYNC_SECRET not configured" }, 500);
  if (req.headers.get("x-sync-secret") !== secret) return json({ error: "unauthorized" }, 401);

  let q = "", limit = 12;
  try {
    const body = await req.json();
    q = String(body.q ?? "").slice(0, 500);
    limit = Math.min(20, Math.max(1, Number(body.limit ?? 12)));
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!q.trim()) return json({ matches: [] });

  const session = new Supabase.ai.Session("gte-small");
  const vec = JSON.stringify(Array.from(await session.run(q, { mean_pool: true, normalize: true })));

  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  try {
    const rows = await sql`
      select t.recording_id, t.key, t.label, t.summary_line, t.content_idea, t.spans_ms,
             r.title as recording_title, r.bucket, r.started_at,
             1 - (t.embedding <=> ${vec}::extensions.vector) as sim
      from plaud.threads t
      join plaud.recordings r on r.id = t.recording_id
      where t.embedding is not null
      order by t.embedding <=> ${vec}::extensions.vector
      limit ${limit}`;
    return json({ matches: rows });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  } finally {
    await sql.end();
  }
});
