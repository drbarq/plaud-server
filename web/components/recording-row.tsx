"use client";

import type { Recording } from "@/lib/types";
import { fmtMs } from "./use-playback";

/** Thread-span comb (v2 §4.1): one lane per thread, dotted holds between
 * spans, hairline baseline. The shape of the memo's consciousness. */
function Comb({ recording: r }: { recording: Recording }) {
  const { threads, durationMs } = r;
  if (!threads.length || durationMs <= 0) return null;
  const n = threads.length;
  const pitch = n <= 5 ? 3.6 : 2.5;
  const barH = n <= 5 ? 2 : 1.5;
  return (
    <div className="relative mt-2.5" style={{ height: n * pitch }}>
      <span className="absolute left-0 right-0 h-px" style={{ top: "50%", background: "var(--hairline-panel)" }} />
      {threads.map((t, ti) => {
        const alpha = Math.max(0.35, 0.95 - ti * 0.06);
        const spans = t.spans.map((s) => ({
          left: Math.min(100, (s.start / durationMs) * 100),
          width: Math.max(0.7, ((s.end - s.start) / durationMs) * 100),
        }));
        return (
          <span key={t.key}>
            {spans.map((s, si) => (
              <span
                key={si}
                className="absolute rounded-[1px]"
                style={{
                  left: `${s.left}%`, width: `${s.width}%`,
                  top: ti * pitch, height: barH,
                  background: `color-mix(in oklch, ${t.contentIdea ? "var(--b-idea)" : "var(--bucket, var(--b-misc))"} ${alpha * 100}%, transparent)`,
                }}
              />
            ))}
            {spans.slice(1).map((s, si) => {
              const prev = spans[si];
              return (
                <span
                  key={`h${si}`}
                  className="absolute h-0"
                  style={{
                    left: `${prev.left + prev.width}%`,
                    width: `${Math.max(0, s.left - prev.left - prev.width)}%`,
                    top: ti * pitch + barH / 2,
                    borderTop: "1px dotted color-mix(in oklch, var(--bucket, var(--b-misc)) 40%, transparent)",
                  }}
                />
              );
            })}
          </span>
        );
      })}
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
    ? new Date(r.startedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
  const pending = r.status !== "processed";
  const ideaCount = r.threads.filter((t) => t.contentIdea).length;

  return (
    <li className="rise" style={{ animationDelay: `${delayMs}ms` }} data-bucket={r.bucket}>
      <button
        onClick={onSelect}
        className="w-full text-left px-[18px] pt-3 pb-3.5 transition-colors"
        style={{
          borderBottom: "1px solid var(--hairline-row)",
          background: selected ? "var(--bg-row-selected)" : undefined,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="bucket-dot size-[5px] rounded-full shrink-0" />
          <span className="mono text-[11px] tracking-[0.15em] flex-1" style={{ color: "var(--ink-dim)" }}>
            {time} · {fmtMs(r.durationMs)} · {r.threads.length || "–"} THREAD{r.threads.length === 1 ? "" : "S"}
          </span>
          {pending ? (
            <span className="mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent rec-pulse-fast shrink-0">
              {r.status}
            </span>
          ) : ideaCount > 0 ? (
            <span className="mono text-[11px] font-medium tracking-[0.14em] shrink-0" style={{ color: "var(--idea)" }}>
              ◆ {ideaCount}
            </span>
          ) : null}
        </div>
        <p className="italic text-[18.5px] leading-[1.32] mt-1.5" style={{ color: "var(--ink)", letterSpacing: "-0.005em" }}>
          {r.title ?? r.name}
        </p>
        {r.snippet && (
          <p
            className="text-[14.5px] leading-normal font-light mt-1 overflow-hidden"
            style={{
              color: "var(--ink-snippet)",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}
          >
            {r.snippet}
          </p>
        )}
        <Comb recording={r} />
        <div className="flex justify-between mt-1.5">
          <span className="mono text-[10px] tracking-[0.14em]" style={{ color: "var(--ink-tick)" }}>0:00</span>
          <span className="mono text-[10px] tracking-[0.14em]" style={{ color: "var(--ink-tick)" }}>{fmtMs(r.durationMs)}</span>
        </div>
      </button>
    </li>
  );
}
