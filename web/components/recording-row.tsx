"use client";

import type { Recording } from "@/lib/types";
import { fmtMs } from "./use-playback";

/** Signature element: the thread-span timeline — the shape of the memo's
 * consciousness. Each thread renders its spans as segments on one time axis. */
function ThreadTimeline({ recording }: { recording: Recording }) {
  const { threads, durationMs } = recording;
  if (!threads.length || durationMs <= 0) return null;
  return (
    <div className="relative h-[3px] mt-2 rounded-full bg-inset overflow-hidden">
      {threads.map((t, ti) =>
        t.spans.map((s, si) => {
          const left = Math.min(100, (s.start / durationMs) * 100);
          const width = Math.max(0.8, ((s.end - s.start) / durationMs) * 100);
          return (
            <span
              key={`${t.key}-${si}`}
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: t.contentIdea ? "var(--b-idea)" : "var(--ink-faint)",
                opacity: 0.4 + 0.6 * ((ti % 3) / 2),
              }}
            />
          );
        }),
      )}
    </div>
  );
}

export function RecordingRow({
  recording: r,
  selected,
  onSelect,
  delayMs,
}: {
  recording: Recording;
  selected: boolean;
  onSelect: () => void;
  delayMs: number;
}) {
  const time = r.startedAt
    ? new Date(r.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  const pending = r.status !== "processed";

  return (
    <li
      className="rise"
      style={{ animationDelay: `${delayMs}ms` }}
      data-bucket={r.bucket}
    >
      <button
        onClick={onSelect}
        className={`w-full text-left px-4 py-3 border-b border-hairline/60 transition-colors ${
          selected ? "bg-raised shadow-[inset_2px_0_0_var(--bucket)]" : "hover:bg-raised/50"
        }`}
      >
        <div className="flex items-baseline gap-2">
          <span className="bucket-dot size-1.5 rounded-full shrink-0 translate-y-[-2px]" />
          <span className="flex-1 truncate leading-snug">
            {r.title ?? r.name}
          </span>
          {pending && (
            <span className="mono text-[9px] uppercase tracking-wide text-accent rec-pulse shrink-0">
              {r.status}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <p className="flex-1 truncate text-[13px] text-dim italic">
            {r.snippet || `${fmtMs(r.durationMs)} recording`}
          </p>
          <span className="mono text-[10px] text-faint shrink-0">
            {fmtMs(r.durationMs)}{time ? ` · ${time}` : ""}
          </span>
        </div>
        <ThreadTimeline recording={r} />
      </button>
    </li>
  );
}
