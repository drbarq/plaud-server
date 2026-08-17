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
  playback,
  onBack,
}: {
  recording: Recording | null;
  playback: Playback;
  onBack: () => void;
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
          <p className="text-2xl italic text-dim">Select a recording</p>
          <p className="mono text-xs text-faint mt-3 max-w-xs">
            Threads of consciousness, indexed. Pick one from the list.
          </p>
        </div>
      </div>
    );
  }

  const dateLine = recording.startedAt
    ? new Date(recording.startedAt).toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : "";

  return (
    <article className="max-w-3xl mx-auto px-4 lg:px-8 py-5 pb-28" data-bucket={recording.bucket}>
      <button
        onClick={onBack}
        className="lg:hidden mono text-xs uppercase tracking-[0.14em] text-dim hover:text-ink mb-4"
      >
        ← Recordings
      </button>

      <header className="rise">
        <div className="mono text-[10px] uppercase tracking-[0.16em] text-faint flex items-center gap-2">
          <span className="bucket-dot size-1.5 rounded-full" />
          <span className="bucket-ink">{recording.bucket}</span>
          <span>·</span>
          <span>{dateLine}</span>
          <span>·</span>
          <span>{fmtMs(recording.durationMs)}</span>
        </div>
        <h1 className="text-[1.7rem] leading-tight italic mt-2">
          {recording.title ?? recording.name}
        </h1>
        {recording.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {recording.tags.map((t) => (
              <span key={t} className="mono text-[10px] uppercase tracking-wide text-dim border border-hairline rounded-full px-2 py-0.5">
                {t}
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
              <SectionRule label="Action items" />
              <ActionItems detail={detail} onLocalChange={setDetail} />
            </section>
          )}

          {detail.threads.length > 0 && (
            <section className="rise" style={{ animationDelay: "160ms" }}>
              <SectionRule label={`Threads · ${detail.threads.length}`} />
              <ThreadList threads={detail.threads} playback={playback} durationMs={recording.durationMs} />
            </section>
          )}

          {detail.transcript.length > 0 && (
            <section className="rise" style={{ animationDelay: "210ms" }}>
              <SectionRule label="Transcript" />
              <Transcript utterances={detail.transcript} playback={playback} />
            </section>
          )}
        </div>
      )}

      <Player playback={playback} available={!!detail?.audioUrl} />
    </article>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="mono text-[10px] uppercase tracking-[0.18em] text-dim shrink-0">{label}</h2>
      <div className="h-px flex-1 bg-hairline" />
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
        <li key={i}>
          <button onClick={() => toggle(i)} className="flex items-start gap-3 text-left w-full group">
            <span
              className={`mono mt-0.5 size-4 shrink-0 rounded border grid place-items-center text-[10px] transition-colors ${
                a.done ? "bg-accent border-accent text-accent-ink" : "border-hairline group-hover:border-accent"
              }`}
            >
              {a.done ? "✓" : ""}
            </span>
            <span className={a.done ? "text-faint line-through" : ""}>{a.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
