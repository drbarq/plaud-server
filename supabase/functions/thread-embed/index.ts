// thread-embed: embeds threads that lack vectors (Supabase native gte-small,
// 384-dim) and builds cross-recording links per the PoC rule:
// cosine >= 0.42, or >= 0.32 with a shared RARE entity (global count <= 4),
// keep top 3 per thread. Runs on cron; idempotent. Auth: x-sync-secret.
//
// Embedding text = label + ". " + summary_line — deliberately NOT the raw
// thread text, so any row (PoC import or routine output) embeds identically
// from the database alone. Thresholds were fit on the PoC corpus with a
// different model; recalibrate once the corpus grows (issue tracked).
import postgres from "npm:postgres@3.4.7";

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, opts: Record<string, unknown>): Promise<number[]> } };
};

// Recalibrated 2026-08-16 for gte-small on label+summary text (the PoC's
// 0.42/0.32 were MiniLM-on-full-text values; gte-small's space is compressed
// into ~0.75-0.91). Anchored on validated pairs (0.90/0.899) and matched to
// the PoC's link density (38 vs 34 links on the same corpus).
const T_HIGH = Number(Deno.env.get("LINK_T_HIGH") ?? 0.86);
const T_ENT = Number(Deno.env.get("LINK_T_ENT") ?? 0.80);
const RARE = Number(Deno.env.get("LINK_RARE_MAX") ?? 4);
const TOP_K = 3;
// small batches: the in-worker ONNX inference hits WORKER_RESOURCE_LIMIT
// well before 32 embeddings; cron + repeat invocations drain the backlog
const BATCH = Number(Deno.env.get("THREAD_EMBED_BATCH") ?? 8);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  const secret = Deno.env.get("PLAUD_SYNC_SECRET");
  if (!secret) return json({ error: "PLAUD_SYNC_SECRET not configured" }, 500);
  if (req.headers.get("x-sync-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  const stats = { embedded: 0, links_added: 0, errors: [] as string[] };

  try {
    const [{ locked }] = await sql`select pg_try_advisory_lock(873430) as locked`;
    if (!locked) return json({ skipped: "another embed run is active" });

    const pending = await sql`select id, label, coalesce(summary_line, '') as summary_line
      from plaud.threads where embedding is null order by id limit ${BATCH}`;
    if (!pending.length) return json({ ok: true, ...stats, note: "nothing to embed" });

    const session = new Supabase.ai.Session("gte-small");
    const embedded: number[] = [];
    for (const row of pending) {
      try {
        const text = `${row.label}. ${row.summary_line}`.slice(0, 2000);
        const vec = await session.run(text, { mean_pool: true, normalize: true });
        await sql`update plaud.threads set embedding = ${JSON.stringify(Array.from(vec))}::extensions.vector
          where id = ${Number(row.id)}`;
        embedded.push(Number(row.id));
        stats.embedded++;
      } catch (e) {
        stats.errors.push(`embed ${row.id}: ${String(e).slice(0, 150)}`);
      }
    }

    // global entity rarity for the entity-boost rule
    const entityCounts = await sql`select e as entity, count(*)::int as n
      from plaud.threads, unnest(entities) as e group by e`;
    const rare = new Set(
      // deno-lint-ignore no-explicit-any
      entityCounts.filter((r: any) => r.n <= RARE).map((r: any) => r.entity),
    );

    for (const id of embedded) {
      try {
        const [self] = await sql`select recording_id, entities from plaud.threads where id = ${id}`;
        const neighbors = await sql`
          select t.id, t.entities, 1 - (t.embedding <=> s.embedding) as sim
          from plaud.threads t, (select embedding from plaud.threads where id = ${id}) s
          where t.id != ${id} and t.embedding is not null and t.recording_id != ${self.recording_id}
          order by t.embedding <=> s.embedding
          limit 8`;
        const kept = neighbors
          // deno-lint-ignore no-explicit-any
          .map((n: any) => {
            const shared = (n.entities as string[]).filter((e) =>
              (self.entities as string[]).includes(e) && rare.has(e)
            );
            return { id: Number(n.id), sim: Number(n.sim), shared };
          })
          .filter((n) => n.sim >= T_HIGH || (n.sim >= T_ENT && n.shared.length > 0))
          .slice(0, TOP_K);
        for (const n of kept) {
          const a = id < n.id ? id : n.id;
          const b = id < n.id ? n.id : id;
          const res = await sql`insert into plaud.thread_links (a, b, sim, shared_entities)
            values (${a}, ${b}, ${n.sim}, ${n.shared})
            on conflict (a, b) do nothing returning a`;
          if (res.length) stats.links_added++;
        }
      } catch (e) {
        stats.errors.push(`link ${id}: ${String(e).slice(0, 150)}`);
      }
    }

    const [{ count: remaining }] = await sql`select count(*)::int as count
      from plaud.threads where embedding is null`;
    return json({ ok: true, remaining_unembedded: remaining, ...stats });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 400), ...stats }, 500);
  } finally {
    await sql.end();
  }
});
