// plaud-sync: cron- and button-triggered. Polls Plaud's official API,
// archives new MP3s to Storage, submits them to Deepgram (async callback),
// retries errored/stale/stuck work. Auth: x-sync-secret header.
import postgres from "npm:postgres@3.4.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLAUD_API = "https://platform.plaud.ai/developer/api";
const MIN_DURATION_MS = 4000;
const MAX_RETRIES = 5;
const BATCH = 5;
const STALE_MS = 30 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { "content-type": "application/json" },
  });

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// deno-lint-ignore no-explicit-any
type Sql = any;

async function getFreshToken(sql: Sql): Promise<string> {
  const rows = await sql`select * from plaud.credentials where id = 1`;
  if (!rows.length) throw new Error("No Plaud credentials seeded (plaud.credentials is empty)");
  const c = rows[0];
  if (c.status === "reauth_required") {
    throw new Error("Plaud re-auth required: run `plaud login` and re-seed plaud.credentials");
  }
  const exp = c.expires_at ? new Date(c.expires_at).getTime() : 0;
  if (exp && exp > Date.now() + 2 * 60 * 1000) return c.access_token;

  const resp = await fetch(`${PLAUD_API}/oauth/third-party/access-token/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });
  if (!resp.ok) {
    if (resp.status >= 400 && resp.status < 500) {
      await sql`update plaud.credentials set status = 'reauth_required', updated_at = now() where id = 1`;
    }
    throw new Error(`Plaud token refresh failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  }
  const body = await resp.json();
  const p = body.data ?? body;
  const access = p.access_token ?? c.access_token;
  const refresh = p.refresh_token ?? c.refresh_token;
  const expiresAt = p.expires_at
    ? toDate(p.expires_at)
    : p.expires_in
    ? new Date(Date.now() + p.expires_in * 1000)
    : null;
  await sql`update plaud.credentials set
      access_token = ${access}, refresh_token = ${refresh},
      expires_at = ${expiresAt}, status = 'ok', updated_at = now()
    where id = 1`;
  return access;
}

async function plaudGet(token: string, path: string) {
  const resp = await fetch(`${PLAUD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Plaud API ${resp.status} on ${path}: ${(await resp.text()).slice(0, 200)}`);
  const body = await resp.json();
  return body.data ?? body;
}

// deno-lint-ignore no-explicit-any
async function listAllRecordings(token: string): Promise<any[]> {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const data = await plaudGet(token, `/open/third-party/files/?page=${page}&page_size=50`);
    const items = Array.isArray(data) ? data : data.data ?? [];
    for (const it of items) if (it && typeof it === "object" && it.id) out.push(it);
    if (items.length < 50) break;
  }
  return out;
}

async function submitToDeepgram(presignedUrl: string, fileId: string, secret: string,
                                keyterms: string[] = []): Promise<string> {
  const dgKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!dgKey) throw new Error("DEEPGRAM_API_KEY not configured");
  const cb = `${Deno.env.get("SUPABASE_URL")}/functions/v1/deepgram-callback?file_id=${fileId}&secret=${secret}`;
  const qs = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    diarize: "true",
    utterances: "true",
    callback: cb,
    callback_method: "post",
  });
  // Nova-3 keyterm prompting: boosts recognition of Joe's domain vocabulary
  // (editable in plaud.context.keyterms — no redeploy needed)
  for (const term of keyterms.slice(0, 100)) qs.append("keyterm", term);
  const resp = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
    method: "POST",
    headers: { Authorization: `Token ${dgKey}`, "content-type": "application/json" },
    body: JSON.stringify({ url: presignedUrl }),
  });
  if (!resp.ok) throw new Error(`Deepgram ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return (await resp.json()).request_id ?? "unknown";
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("PLAUD_SYNC_SECRET");
  if (!secret) return json({ error: "PLAUD_SYNC_SECRET not configured" }, 500);
  if (req.headers.get("x-sync-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const stats = { submitted: 0, skipped_short: 0, resubmitted: 0, errors: [] as string[] };

  try {
    const [{ locked }] = await sql`select pg_try_advisory_lock(873429) as locked`;
    if (!locked) return json({ skipped: "another sync is running" });

    const token = await getFreshToken(sql);
    const ctxRows = await sql`select keyterms from plaud.context where id = 1`;
    const keyterms: string[] = ctxRows[0]?.keyterms ?? [];
    const listed = await listAllRecordings(token);
    const existing = await sql`select id, status, retry_count, submitted_at from plaud.recordings`;
    // deno-lint-ignore no-explicit-any
    const byId = new Map<string, any>(existing.map((r: any) => [r.id, r]));

    const work = listed
      .filter((r) => {
        const e = byId.get(r.id);
        return !e || (e.status === "error" && e.retry_count < MAX_RETRIES);
      })
      .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")))
      .slice(0, BATCH);

    for (const rec of work) {
      const prev = byId.get(rec.id);
      const retryCount = prev?.retry_count ?? 0;
      const day = String(rec.start_at ?? rec.created_at ?? "unknown").slice(0, 10);
      try {
        if ((rec.duration ?? 0) < MIN_DURATION_MS) {
          await sql`insert into plaud.recordings (id, name, serial_number, started_at, created_at, duration_ms,
              status, transcript, transcript_text, bucket, title, error)
            values (${rec.id}, ${rec.name}, ${rec.serial_number}, ${toDate(rec.start_at)}, ${toDate(rec.created_at)},
              ${rec.duration}, 'processed', '[]'::jsonb, '', 'misc', ${rec.name}, null)
            on conflict (id) do update set status = 'processed', error = null`;
          stats.skipped_short++;
          continue;
        }

        const detail = await plaudGet(token, `/open/third-party/files/${rec.id}`);
        if (!detail.presigned_url) throw new Error("no presigned_url in file detail");

        const storagePath = `${day}/${rec.id}.mp3`;
        const audioResp = await fetch(detail.presigned_url);
        if (!audioResp.ok) throw new Error(`audio download ${audioResp.status}`);
        const audioBuf = new Uint8Array(await audioResp.arrayBuffer());
        const { error: upErr } = await supabase.storage
          .from("plaud-audio")
          .upload(storagePath, audioBuf, { contentType: "audio/mpeg", upsert: true });
        if (upErr) throw new Error(`storage upload: ${upErr.message}`);

        const requestId = await submitToDeepgram(detail.presigned_url, rec.id, secret, keyterms);
        await sql`insert into plaud.recordings (id, name, serial_number, started_at, created_at, duration_ms,
            audio_path, audio_bytes, status, dg_request_id, submitted_at, error, retry_count)
          values (${rec.id}, ${rec.name}, ${rec.serial_number}, ${toDate(rec.start_at)}, ${toDate(rec.created_at)},
            ${rec.duration}, ${storagePath}, ${audioBuf.byteLength}, 'downloaded', ${requestId}, now(), null, ${retryCount})
          on conflict (id) do update set
            audio_path = excluded.audio_path, audio_bytes = excluded.audio_bytes,
            status = 'downloaded', dg_request_id = excluded.dg_request_id,
            submitted_at = now(), error = null, retry_count = ${retryCount}`;
        stats.submitted++;
      } catch (e) {
        const msg = String(e).slice(0, 500);
        stats.errors.push(`${rec.id}: ${msg}`);
        await sql`insert into plaud.recordings (id, name, serial_number, started_at, created_at, duration_ms, status, error, retry_count)
          values (${rec.id}, ${rec.name}, ${rec.serial_number}, ${toDate(rec.start_at)}, ${toDate(rec.created_at)},
            ${rec.duration}, 'error', ${msg}, ${retryCount + 1})
          on conflict (id) do update set status = 'error', error = ${msg}, retry_count = ${retryCount + 1}`;
      }
    }

    // Deepgram callback never arrived (>30 min): resubmit with a fresh URL
    const stale = await sql`select id from plaud.recordings
      where status = 'downloaded' and submitted_at < now() - interval '30 minutes'
        and retry_count < ${MAX_RETRIES} limit 3`;
    for (const row of stale) {
      try {
        const detail = await plaudGet(token, `/open/third-party/files/${row.id}`);
        if (!detail.presigned_url) throw new Error("no presigned_url on resubmit");
        const requestId = await submitToDeepgram(detail.presigned_url, row.id, secret, keyterms);
        await sql`update plaud.recordings set dg_request_id = ${requestId}, submitted_at = now(),
          retry_count = retry_count + 1 where id = ${row.id}`;
        stats.resubmitted++;
      } catch (e) {
        stats.errors.push(`resubmit ${row.id}: ${String(e).slice(0, 200)}`);
      }
    }

    // rows at status='transcribed' are picked up by the Claude cloud routine
    const [{ count: awaiting }] = await sql`select count(*)::int as count
      from plaud.recordings where status = 'transcribed'`;

    return json({ ok: true, listed: listed.length, awaiting_routine: awaiting, ...stats });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 500), ...stats }, 500);
  } finally {
    await sql.end();
  }
});
