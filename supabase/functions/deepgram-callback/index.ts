// deepgram-callback: Deepgram POSTs the finished transcription here.
// Stores the transcript at status='transcribed', then FIRES the Claude cloud
// routine (plaud-process, Joe's account + connectors) via its API trigger.
// Auth: ?secret= must match PLAUD_SYNC_SECRET.
import postgres from "npm:postgres@3.4.7";

const ROUTINE_FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01D5qhb3VPougC2H6BnpXMED/fire";

async function fireRoutine(name: string, fileId: string): Promise<string> {
  const token = Deno.env.get("ROUTINE_FIRE_TOKEN");
  if (!token) return "skipped: ROUTINE_FIRE_TOKEN not set";
  try {
    const resp = await fetch(ROUTINE_FIRE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: `New Plaud transcript ready: "${name}" (file_id ${fileId}). Sweep plaud.recordings for status='transcribed'.`,
      }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) return `fire failed ${resp.status}: ${JSON.stringify(body).slice(0, 200)}`;
    return body.claude_code_session_url ?? "fired";
  } catch (e) {
    return `fire error: ${String(e).slice(0, 200)}`;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Utt {
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

// deno-lint-ignore no-explicit-any
function extractUtterances(body: any): Utt[] {
  const utts = body?.results?.utterances ?? [];
  const out: Utt[] = [];
  for (const u of utts) {
    const text = (u?.transcript ?? "").trim();
    if (!text) continue;
    out.push({
      speaker: u.speaker != null ? `Speaker ${u.speaker}` : null,
      start_ms: Math.round((u.start ?? 0) * 1000),
      end_ms: Math.round((u.end ?? 0) * 1000),
      text,
    });
  }
  if (out.length) return out;
  const flat = (body?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  return flat ? [{ speaker: null, start_ms: 0, end_ms: 0, text: flat }] : [];
}

// Mirrors plaud-sync's callbackToken: HMAC-SHA256(file_id) under the callback secret.
async function callbackToken(fileId: string): Promise<string> {
  const secret = Deno.env.get("DEEPGRAM_CALLBACK_SECRET") ?? Deno.env.get("PLAUD_SYNC_SECRET") ?? "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(fileId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("PLAUD_SYNC_SECRET");
  if (!secret) return json({ error: "PLAUD_SYNC_SECRET not configured" }, 500);
  const url = new URL(req.url);
  const fileId = url.searchParams.get("file_id");
  if (!fileId) return json({ error: "file_id required" }, 400);
  // primary auth: per-file HMAC token. Legacy static secrets stay accepted
  // only for Deepgram jobs already in flight with old-style URLs.
  const givenToken = url.searchParams.get("token");
  const givenLegacy = url.searchParams.get("secret");
  const cbSecret = Deno.env.get("DEEPGRAM_CALLBACK_SECRET") ?? secret;
  const tokenOk = givenToken != null && givenToken === (await callbackToken(fileId));
  const legacyOk = givenLegacy != null && (givenLegacy === cbSecret || givenLegacy === secret);
  if (!tokenOk && !legacyOk) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
  try {
    const rows = await sql`select id, name, started_at, duration_ms from plaud.recordings where id = ${fileId}`;
    if (!rows.length) {
      // Unknown id: acknowledge so Deepgram stops retrying, but say so.
      return json({ ok: false, warning: `no recording row for ${fileId}` });
    }
    const rec = rows[0];

    const utts = extractUtterances(body);
    const text = utts.map((u) => u.text).join("\n");

    if (!text) {
      await sql`update plaud.recordings set status = 'processed', transcript = '[]'::jsonb,
          transcript_text = '', transcript_source = 'deepgram', bucket = 'misc',
          summary_md = '(no usable speech)', processed_at = now(), error = null
        where id = ${fileId}`;
      return json({ ok: true, empty: true });
    }

    await sql`update plaud.recordings set
        transcript = ${JSON.stringify(utts)}::jsonb, transcript_text = ${text},
        transcript_source = 'deepgram', status = 'transcribed', error = null
      where id = ${fileId}`;

    // coalesce fires (issue #6): each routine run sweeps up to 20 rows, so a
    // burst of transcripts needs only one fire. The plaud-sync fallback sweep
    // (issue #3) guarantees coalesced-away rows still get processed.
    const [ctx] = await sql`select routine_last_fired_at from plaud.context where id = 1`;
    const lastMs = ctx?.routine_last_fired_at ? new Date(ctx.routine_last_fired_at).getTime() : 0;
    let fired = "coalesced (fired within last 3 min; sweep covers this row)";
    if (Date.now() - lastMs > 3 * 60 * 1000) {
      fired = await fireRoutine(rec.name, fileId);
      if (fired.startsWith("http")) {
        await sql`update plaud.context set routine_last_fired_at = now() where id = 1`;
      }
    }
    console.log(`transcript stored for ${fileId} (${rec.name}); routine: ${fired}`);
    return json({ ok: true, transcribed: true, routine: fired });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  } finally {
    await sql.end();
  }
});
