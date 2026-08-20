// plaud-sync: cron- and button-triggered. Polls Plaud's official API,
// archives new MP3s to Storage, submits them to Deepgram (async callback),
// retries errored/stale/stuck work. Auth: x-sync-secret header.
import postgres from "npm:postgres@3.4.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLAUD_API = "https://platform.plaud.ai/developer/api";
const MIN_DURATION_MS = 4000;
const MAX_RETRIES = 5;
const BATCH = 5;
// Files above this skip the Storage archive (edge worker memory + Storage
// file-size limits) — they still transcribe: Deepgram fetches the URL itself.
const ARCHIVE_MAX_BYTES = Number(Deno.env.get("ARCHIVE_MAX_BYTES") ?? 45_000_000);

async function probeSize(url: string): Promise<number> {
  // presigned URLs are signed for GET, so HEAD fails — use a 1-byte range GET
  const resp = await fetch(url, { headers: { Range: "bytes=0-0" } });
  await resp.body?.cancel();
  const range = resp.headers.get("content-range"); // "bytes 0-0/12345678"
  if (range?.includes("/")) return Number(range.split("/")[1]) || 0;
  return Number(resp.headers.get("content-length") ?? 0);
}
const STALE_MS = 30 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Archive audio to Storage with bounded memory at any size.
 * ≤ ARCHIVE_MAX_BYTES: single buffered upload (simple, proven).
 * Larger: TUS resumable upload — the source is read in 6MB Range slices and
 * PATCHed sequentially, so the worker never holds more than one chunk.
 * Throws on failure (caller records the error and bounds retries). */
const TUS_CHUNK = 6 * 1024 * 1024; // Supabase requires exactly 6MB chunks (except the last)

async function archiveAudio(
  presignedUrl: string,
  storagePath: string,
  size: number,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<number> {
  if (!size || size <= ARCHIVE_MAX_BYTES) {
    const resp = await fetch(presignedUrl);
    if (!resp.ok) throw new Error(`audio download ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from("plaud-audio")
      .upload(storagePath, buf, { contentType: "audio/mpeg", upsert: true });
    if (upErr) throw new Error(`storage upload: ${upErr.message}`);
    return buf.byteLength;
  }

  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const create = await fetch(`${base}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key!,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(size),
      "Upload-Metadata":
        `bucketName ${btoa("plaud-audio")},objectName ${btoa(storagePath)},contentType ${btoa("audio/mpeg")}`,
      "x-upsert": "true",
    },
  });
  if (create.status !== 201) {
    throw new Error(`tus create ${create.status}: ${(await create.text()).slice(0, 150)}`);
  }
  const loc = create.headers.get("location");
  if (!loc) throw new Error("tus create returned no location");
  const uploadUrl = loc.startsWith("http") ? loc : `${base}${loc}`;

  let offset = 0;
  while (offset < size) {
    const end = Math.min(offset + TUS_CHUNK, size) - 1;
    const part = await fetch(presignedUrl, { headers: { Range: `bytes=${offset}-${end}` } });
    if (!part.ok) throw new Error(`range read ${part.status} at ${offset}`);
    const buf = new Uint8Array(await part.arrayBuffer());
    const patch = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key!,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
      },
      body: buf,
    });
    if (patch.status !== 204) {
      throw new Error(`tus patch ${patch.status} at ${offset}: ${(await patch.text()).slice(0, 120)}`);
    }
    offset = Number(patch.headers.get("upload-offset") ?? offset + buf.byteLength);
  }
  return size;
}

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

  // Plaud switched this endpoint to form-encoded (~2026-08-17); JSON now 422s.
  // Try form first, fall back to JSON in case they flip back.
  let resp = await fetch(`${PLAUD_API}/oauth/third-party/access-token/refresh`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: c.refresh_token }),
  });
  if (resp.status === 422 || resp.status === 415) {
    resp = await fetch(`${PLAUD_API}/oauth/third-party/access-token/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: c.refresh_token }),
    });
  }
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

// Per-file callback token (issue #5): HMAC-SHA256(file_id) under the dedicated
// callback secret. Deepgram stores callback URLs in its job records, so the
// URL must never carry a reusable credential — only this file-scoped token.
async function callbackToken(fileId: string): Promise<string> {
  const secret = Deno.env.get("DEEPGRAM_CALLBACK_SECRET") ?? Deno.env.get("PLAUD_SYNC_SECRET") ?? "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(fileId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function submitToDeepgram(presignedUrl: string, fileId: string, _secret: string,
                                keyterms: string[] = []): Promise<string> {
  const dgKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!dgKey) throw new Error("DEEPGRAM_API_KEY not configured");
  const cb = `${Deno.env.get("SUPABASE_URL")}/functions/v1/deepgram-callback?file_id=${fileId}&token=${await callbackToken(fileId)}`;
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

// Fallback sweep (issue #3 / PIPE-9): the callback's routine fire is
// fire-and-forget; if it fails or the daily cap was hit, rows strand at
// 'transcribed' until the NEXT recording arrives — unless we fire here.
async function fireRoutine(context: string): Promise<string> {
  const token = Deno.env.get("ROUTINE_FIRE_TOKEN");
  if (!token) return "skipped: ROUTINE_FIRE_TOKEN not set";
  try {
    const resp = await fetch(
      "https://api.anthropic.com/v1/claude_code/routines/trig_01D5qhb3VPougC2H6BnpXMED/fire",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: context }),
      },
    );
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return `fire failed ${resp.status}: ${JSON.stringify(body).slice(0, 150)}`;
    return body.claude_code_session_url ?? "fired";
  } catch (e) {
    return `fire error: ${String(e).slice(0, 150)}`;
  }
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
  const stats = { submitted: 0, skipped_short: 0, archive_skipped: 0, backfilled: 0, resubmitted: 0, errors: [] as string[] };

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
        const size = await probeSize(detail.presigned_url);
        // archive failure must never block transcription — the backfill pass
        // retries the archive later (bounded by retry_count)
        let audioPath: string | null = null;
        let audioBytes: number | null = size || null;
        try {
          audioBytes = await archiveAudio(detail.presigned_url, storagePath, size, supabase);
          audioPath = storagePath;
        } catch (e) {
          stats.archive_skipped++;
          stats.errors.push(`archive ${rec.id}: ${String(e).slice(0, 150)}`);
        }

        const requestId = await submitToDeepgram(detail.presigned_url, rec.id, secret, keyterms);
        await sql`insert into plaud.recordings (id, name, serial_number, started_at, created_at, duration_ms,
            audio_path, audio_bytes, status, dg_request_id, submitted_at, error, retry_count)
          values (${rec.id}, ${rec.name}, ${rec.serial_number}, ${toDate(rec.start_at)}, ${toDate(rec.created_at)},
            ${rec.duration}, ${audioPath}, ${audioBytes}, 'downloaded', ${requestId}, now(), null, ${retryCount})
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

    // backfill: recordings that completed without an archive copy. Attempts
    // are bounded by retry_count so a permanently-unarchivable row can't
    // occupy the two backfill slots forever (issue #1).
    const missing = await sql`select id, to_char(coalesce(started_at, created_at), 'YYYY-MM-DD') as day
      from plaud.recordings
      where audio_path is null and status in ('transcribed','processed')
        and duration_ms >= ${MIN_DURATION_MS} and retry_count < ${MAX_RETRIES}
      order by started_at desc limit 2`;
    for (const row of missing) {
      try {
        const detail = await plaudGet(token, `/open/third-party/files/${row.id}`);
        if (!detail.presigned_url) throw new Error("no presigned_url");
        const path = `${row.day}/${row.id}.mp3`;
        const size = await probeSize(detail.presigned_url);
        const bytes = await archiveAudio(detail.presigned_url, path, size, supabase);
        await sql`update plaud.recordings set audio_path = ${path}, audio_bytes = ${bytes}
          where id = ${row.id}`;
        stats.backfilled++;
      } catch (e) {
        await sql`update plaud.recordings set retry_count = retry_count + 1 where id = ${row.id}`;
        stats.errors.push(`backfill ${row.id}: ${String(e).slice(0, 150)}`);
      }
    }

    // rows at status='transcribed' are picked up by the Claude cloud routine;
    // if the oldest has waited >15 min the callback's fire was lost — re-fire.
    const [{ count: awaiting, oldest_s: oldestS }] = await sql`
      select count(*)::int as count,
             coalesce(extract(epoch from (now() - min(updated_at)))::int, 0) as oldest_s
      from plaud.recordings where status = 'transcribed'`;
    let routineFired = "not needed";
    if (awaiting > 0 && oldestS > 900) {
      routineFired = await fireRoutine(
        `Fallback sweep: ${awaiting} transcript(s) awaiting processing in plaud.recordings (oldest ${Math.round(oldestS / 60)} min). Sweep status='transcribed'.`,
      );
      if (routineFired.startsWith("http")) {
        await sql`update plaud.context set routine_last_fired_at = now() where id = 1`;
      }
    }

    // dead letters (issue #4): work that exhausted its retry budget
    const deadLettered = await sql`select id, name, status, retry_count, left(coalesce(error,'archive missing'), 200) as error
      from plaud.recordings
      where retry_count >= ${MAX_RETRIES}
        and (status = 'error' or (audio_path is null and status in ('transcribed','processed') and duration_ms >= ${MIN_DURATION_MS}))`;

    // repeated-failure escalation (issue #7): 3 consecutive erroring runs
    const recent = await sql`select errors from plaud.sync_runs order by ran_at desc limit 2`;
    // deno-lint-ignore no-explicit-any
    const priorFailing = recent.length === 2 && recent.every((r: any) => Array.isArray(r.errors) && r.errors.length > 0);
    const alert = stats.errors.length > 0 && priorFailing
      ? "ALERT: three consecutive sync runs have errored — check Plaud API / secrets"
      : null;

    const result = {
      ok: true, listed: listed.length, awaiting_routine: awaiting, routine_fired: routineFired,
      dead_lettered: deadLettered, reauth_required: false, alert, ...stats,
    };
    await sql`insert into plaud.sync_runs (listed, submitted, skipped_short, archive_skipped, backfilled, resubmitted, awaiting_routine, routine_fired, errors, dead_lettered, reauth_required)
      values (${listed.length}, ${stats.submitted}, ${stats.skipped_short}, ${stats.archive_skipped}, ${stats.backfilled}, ${stats.resubmitted}, ${awaiting}, ${routineFired}, ${JSON.stringify(stats.errors)}::jsonb, ${JSON.stringify(deadLettered)}::jsonb, false)`;
    return json(result);
  } catch (e) {
    const msg = String(e).slice(0, 500);
    const reauth = /reauth/i.test(msg);
    try {
      await sql`insert into plaud.sync_runs (listed, submitted, skipped_short, archive_skipped, backfilled, resubmitted, awaiting_routine, routine_fired, errors, reauth_required)
        values (0, 0, 0, 0, 0, 0, 0, 'run failed', ${JSON.stringify([msg])}::jsonb, ${reauth})`;
    } catch { /* recording the failure is best-effort */ }
    return json({ ok: false, error: msg, reauth_required: reauth, ...stats }, 500);
  } finally {
    await sql.end();
  }
});
