// One serialization boundary (blueprint): every surface consumes these wire
// types; all coercion of DB rows happens here and nowhere else.

export type Bucket =
  | "journal" | "idea" | "task" | "meeting"
  | "project-note" | "reference" | "misc";

export const BUCKETS: Bucket[] = [
  "journal", "idea", "task", "meeting", "project-note", "reference", "misc",
];

export interface Utterance {
  speaker: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface ActionItem {
  text: string;
  done: boolean;
}

export interface ThreadSpan { start: number; end: number }

export interface ThreadLite {
  key: string;
  label: string;
  spans: ThreadSpan[];
  contentIdea: boolean;
  ideaNote: string | null;
  entities: string[];
}

export interface Recording {
  id: string;
  name: string;
  title: string | null;
  bucket: Bucket;
  tags: string[];
  status: string;
  startedAt: string | null; // ISO
  durationMs: number;
  snippet: string;
  hasSummary: boolean;
  hasAudio: boolean;
  threads: ThreadLite[];
}

export interface ThreadLink {
  sim: number;
  otherLabel: string;
  otherSummaryLine: string | null;
  otherRecordingId: string;
  otherRecordingTitle: string | null;
  otherStartedAt: string | null;
  sharedEntities: string[];
}

export interface ThreadFull {
  id: number;
  key: string;
  label: string;
  summaryLine: string | null;
  sentenceIds: number[];
  spans: ThreadSpan[];
  entities: string[];
  actionItems: ActionItem[];
  contentIdea: boolean;
  ideaNote: string | null;
  links: ThreadLink[];
}

export interface RecordingDetail {
  id: string;
  summaryMd: string | null;
  actionItems: ActionItem[];
  transcript: Utterance[];
  threads: ThreadFull[];
  audioUrl: string | null;
}

export interface Health {
  lastSyncAt: string | null;
  lastErrors: string[];
  deadLettered: { id: string; name: string; error: string }[];
  reauthRequired: boolean;
  awaiting: number;
}

// deno-style loose row in, typed value out
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function coerceSpans(spansMs: unknown): ThreadSpan[] {
  if (!Array.isArray(spansMs)) return [];
  return spansMs
    .filter((s) => Array.isArray(s) && s.length === 2)
    .map((s) => ({ start: Number(s[0]), end: Number(s[1]) }));
}

function coerceActionItems(v: unknown): ActionItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((a) => (typeof a === "string" ? { text: a, done: false } : a))
    .filter((a) => a && typeof a.text === "string")
    .map((a) => ({ text: a.text, done: !!a.done }));
}

export function toRecording(row: Row, threads: Row[]): Recording {
  return {
    id: row.id,
    name: row.name ?? "",
    title: row.title || null,
    bucket: (BUCKETS as string[]).includes(row.bucket) ? row.bucket : "misc",
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: row.status ?? "new",
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    durationMs: Number(row.duration_ms ?? 0),
    snippet: (row.snippet ?? "").replace(/\s+/g, " ").trim(),
    hasSummary: !!row.has_summary,
    hasAudio: !!row.has_audio,
    threads: threads.map((t) => ({
      key: t.key,
      label: t.label,
      spans: coerceSpans(t.spans_ms),
      contentIdea: !!t.content_idea,
      ideaNote: t.idea_note || null,
      entities: Array.isArray(t.entities) ? t.entities : [],
    })),
  };
}

export function toThreadFull(row: Row, links: Row[]): ThreadFull {
  return {
    id: Number(row.id),
    key: row.key,
    label: row.label,
    summaryLine: row.summary_line || null,
    sentenceIds: Array.isArray(row.sentence_ids) ? row.sentence_ids.map(Number) : [],
    spans: coerceSpans(row.spans_ms),
    entities: Array.isArray(row.entities) ? row.entities : [],
    actionItems: coerceActionItems(row.action_items),
    contentIdea: !!row.content_idea,
    ideaNote: row.idea_note || null,
    links: links.map((l) => ({
      sim: Number(l.sim),
      otherLabel: l.other_label,
      otherSummaryLine: l.other_summary_line || null,
      otherRecordingId: l.other_recording_id,
      otherRecordingTitle: l.other_recording_title || null,
      otherStartedAt: l.other_started_at ? new Date(l.other_started_at).toISOString() : null,
      sharedEntities: Array.isArray(l.shared_entities) ? l.shared_entities : [],
    })),
  };
}

export function toDetail(row: Row, threads: ThreadFull[], audioUrl: string | null): RecordingDetail {
  const transcript: Utterance[] = Array.isArray(row.transcript)
    ? row.transcript.map((u: Row) => ({
        speaker: u.speaker ?? null,
        start_ms: Number(u.start_ms ?? 0),
        end_ms: Number(u.end_ms ?? 0),
        text: String(u.text ?? ""),
      }))
    : [];
  return {
    id: row.id,
    summaryMd: row.summary_md || null,
    actionItems: coerceActionItems(row.action_items),
    transcript,
    threads,
    audioUrl,
  };
}
