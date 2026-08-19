"use client";

import { useEffect, useRef, useState } from "react";
import type { Recording, RecordingDetail } from "@/lib/types";
import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";
import { Player } from "./player";
import { ThreadList } from "./thread-list";
import { Transcript } from "./transcript";

export function DetailPane({
  recording,
  recordings,
  playback,
  onBack,
  onOpenRecording,
}: {
  recording: Recording | null;
  recordings: Recording[];
  playback: Playback;
  onBack: () => void;
  onOpenRecording: (id: string) => void;
}) {
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setDetail(null);
    if (!recording) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    fetch(`/api/detail/${recording.id}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        setDetail(d);
        playback.load(d.audioUrl, recording.title ?? recording.name, recording.bucket);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.id]);

  if (!recording) {
    return (
      <div className="h-full grid place-items-center px-8 text-center">
        <div>
          <p className="text-2xl italic" style={{ color: "oklch(0.340 0.020 66)" }}>Select a recording</p>
          <p className="mono text-[11px] uppercase tracking-[0.16em] mt-3" style={{ color: "var(--ink-faint)" }}>
            THREADS OF CONSCIOUSNESS, INDEXED
          </p>
        </div>
      </div>
    );
  }

  const memoIdx = recordings.findIndex((r) => r.id === recording.id);

  const dateLine = recording.startedAt
    ? new Date(recording.startedAt)
        .toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
        .toUpperCase()
    : "";

  return (
    <article className="max-w-3xl mx-auto px-4 lg:px-8 py-5 pb-28" data-bucket={recording.bucket}>
      <div className="flex items-center gap-3 -mx-1 mb-4 pb-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <button onClick={onBack} className="lg:hidden mono text-[13px] px-1" style={{ color: "oklch(0.340 0.020 66)" }}>
          ←
        </button>
        <span className="mono text-[11px] tracking-[0.18em] flex-1" style={{ color: "var(--ink-idx)" }}>
          {memoIdx >= 0 ? `MEMO ${String(memoIdx + 1).padStart(2, "0")} / ${String(recordings.length).padStart(2, "0")}` : ""}
        </span>
        <span className="flex items-center gap-1.5 px-2 py-1" style={{ border: "1px solid var(--bucket, var(--b-misc))" }}>
          <span className="bucket-dot size-1 rounded-full" />
          <span className="mono text-[11px] font-medium tracking-[0.16em] uppercase bucket-ink">{recording.bucket}</span>
        </span>
      </div>

      <header className="rise">
        <p className="mono text-[11px] tracking-[0.18em] uppercase mb-3" style={{ color: "oklch(0.520 0.016 73)" }}>
          {dateLine} · {fmtMs(recording.durationMs)}
        </p>
        <h1 className="text-[27px] lg:text-[32px] leading-[1.24] italic font-light" style={{ color: "var(--ink-strong)", letterSpacing: "-0.012em" }}>
          {recording.title ?? recording.name}
        </h1>
        {recording.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3.5">
            {recording.tags.map((t) => (
              <span key={t} className="mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--ink-meta)" }}>
                #{t}
              </span>
            ))}
          </div>
        )}
      </header>

      {loading && <p className="mono text-xs text-faint mt-8 rec-pulse">Loading…</p>}

      {detail && (
        <div className="space-y-10 mt-8">
          {detail.summaryMd && (
            <section className="rise" style={{ animationDelay: "60ms" }}>
              <SectionRule label="Summary" />
              <div className="prose-memo whitespace-pre-wrap">{detail.summaryMd}</div>
            </section>
          )}

          {detail.actionItems.length > 0 && (
            <section className="rise" style={{ animationDelay: "110ms" }}>
              <SectionRule label="Action items" count={`${detail.actionItems.filter((a) => !a.done).length} OPEN`} />
              <ActionItems detail={detail} onLocalChange={setDetail} />
            </section>
          )}

          {detail.threads.length > 0 && (
            <section className="rise" style={{ animationDelay: "160ms" }}>
              <SectionRule label="Threads of consciousness" count={`${detail.threads.length} THREADS`} />
              <ThreadList threads={detail.threads} playback={playback} durationMs={recording.durationMs} thisStartedAt={recording.startedAt} onOpenRecording={onOpenRecording} />
            </section>
          )}

          {detail.transcript.length > 0 && (
            <section className="rise" style={{ animationDelay: "210ms" }}>
              <SectionRule label="Transcript" count="TAP TO SEEK" />
              <Transcript utterances={detail.transcript} playback={playback} />
            </section>
          )}
        </div>
      )}

      <Player playback={playback} available={!!detail?.audioUrl} />
    </article>
  );
}

function SectionRule({ label, count }: { label: string; count?: string }) {
  return (
    <div className="rule-row">
      <h2 className="rr-label">{label}</h2>
      <div className="rr-rule" />
      {count && <span className="rr-count">{count}</span>}
    </div>
  );
}

function ActionItems({
  detail,
  onLocalChange,
}: {
  detail: RecordingDetail;
  onLocalChange: (d: RecordingDetail) => void;
}) {
  async function toggle(index: number) {
    const items = detail.actionItems.map((a, i) => (i === index ? { ...a, done: !a.done } : a));
    onLocalChange({ ...detail, actionItems: items }); // optimistic
    const res = await fetch("/api/action-items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordingId: detail.id, index, done: items[index].done }),
    });
    if (!res.ok) onLocalChange(detail); // rollback
  }

  return (
    <ul className="space-y-2">
      {detail.actionItems.map((a, i) => (
        <li key={i} style={{ borderBottom: "1px solid var(--hairline-row)" }}>
          <button onClick={() => toggle(i)} className="flex items-start gap-[11px] text-left w-full py-[9px] group">
            <span
              className="mt-0.5 size-[13px] shrink-0 grid place-items-center transition-colors"
              style={{ border: `1px solid ${a.done ? "var(--accent)" : "oklch(0.702 0.016 78)"}` }}
            >
              <span className="size-[5px] bg-accent transition-opacity" style={{ opacity: a.done ? 1 : 0 }} />
            </span>
            <span
              className="text-[15.5px] leading-[1.45] font-light"
              style={a.done ? { color: "oklch(0.622 0.015 76)", textDecoration: "line-through" } : { color: "var(--ink-body)" }}
            >
              {a.text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
