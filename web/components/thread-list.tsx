"use client";

import { useState } from "react";
import type { ThreadFull, ThreadLink } from "@/lib/types";
import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";
import { EchoOverlay, SimTicks } from "./echo-overlay";

function spanLabel(t: ThreadFull): string {
  return t.spans.map((s) => `${fmtMs(s.start)}–${fmtMs(s.end)}`).join(" · ");
}

export function ThreadList({
  threads,
  playback,
  durationMs,
  thisStartedAt,
  onOpenRecording,
}: {
  threads: ThreadFull[];
  playback: Playback;
  durationMs: number;
  thisStartedAt: string | null;
  onOpenRecording: (id: string) => void;
}) {
  const [echo, setEcho] = useState<{ thread: ThreadFull; link: ThreadLink } | null>(null);

  return (
    <div className="space-y-2.5">
      {threads.map((t) => (
        <div
          key={t.key}
          className="px-3.5 pt-3.5 pb-3 cursor-pointer transition-colors"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--hairline-chip)" }}
          onClick={() => t.spans[0] && playback.seekToMs(t.spans[0].start)}
        >
          <div className="flex items-baseline gap-2">
            <span className="mono text-[9px] font-medium tracking-[0.16em] shrink-0" style={{ color: "color-mix(in oklch, var(--bucket, var(--ink)) 72%, transparent)" }}>
              {t.key}
            </span>
            <span className="mono text-[9px] tracking-[0.13em] flex-1" style={{ color: "var(--ink-meta)" }}>
              {spanLabel(t)}
            </span>
            {t.contentIdea && (
              <span className="mono text-[8px] font-medium tracking-[0.16em] shrink-0 px-1.5 py-1 flex items-center gap-1" style={{ color: "var(--idea)", border: "1px solid oklch(0.520 0.150 128 / 0.5)" }}>
                <span className="size-1 rounded-full" style={{ background: "var(--idea)" }} />
                IDEA
              </span>
            )}
          </div>

          <p className="italic text-[16px] leading-[1.35] mt-1.5" style={{ color: "var(--ink-title)" }}>
            {t.label}
          </p>
          {t.summaryLine && t.summaryLine !== t.label && (
            <p className="text-[13px] leading-normal font-light mt-1" style={{ color: "var(--ink-snippet)" }}>
              {t.summaryLine}
            </p>
          )}

          {/* mini span bar */}
          {durationMs > 0 && t.spans.length > 0 && (
            <div className="relative h-1.5 mt-2.5">
              <span className="absolute left-0 right-0 h-px" style={{ top: 2.5, background: "var(--hairline-panel)" }} />
              {t.spans.map((s, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); playback.seekToMs(s.start); }}
                  aria-label={`Play from ${fmtMs(s.start)}`}
                  className="absolute top-0 h-full rounded-[1px]"
                  style={{
                    left: `${Math.min(100, (s.start / durationMs) * 100)}%`,
                    width: `${Math.max(1, ((s.end - s.start) / durationMs) * 100)}%`,
                    background: "var(--bucket, var(--accent))",
                  }}
                />
              ))}
            </div>
          )}

          {t.ideaNote && (
            <div className="mt-3 px-3 py-2.5" style={{ background: "oklch(0.520 0.150 128 / 0.10)", borderLeft: "2px solid oklch(0.520 0.150 128 / 0.55)" }}>
              <p className="mono text-[8px] font-medium tracking-[0.18em] mb-1.5" style={{ color: "var(--idea)" }}>
                CONTENT IDEA
              </p>
              <p className="italic text-[13px] leading-normal font-light" style={{ color: "oklch(0.300 0.020 64)" }}>
                {t.ideaNote}
              </p>
            </div>
          )}

          {(t.entities.length > 0 || t.actionItems.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {t.entities.map((e) => (
                <span key={e} className="mono text-[8px] uppercase tracking-[0.13em] px-1.5 py-1" style={{ color: "var(--ink-dim)", border: "1px solid var(--hairline-strong)" }}>
                  {e}
                </span>
              ))}
              {t.actionItems.map((a, i) => (
                <span key={`a${i}`} className="mono text-[9px] text-accent">→ {a.text}</span>
              ))}
            </div>
          )}

          {t.links.map((l, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setEcho({ thread: t, link: l }); }}
              className="block w-full text-left mt-3 pl-3"
              style={{ borderLeft: "1px solid oklch(0.575 0.200 47 / 0.42)" }}
            >
              <span className="flex items-center gap-2">
                <span className="mono text-[8px] font-medium tracking-[0.2em] text-accent">CONNECTS TO</span>
                <SimTicks sim={l.sim} />
                <span className="mono text-[8px] tracking-[0.12em]" style={{ color: "var(--ink-dim)" }}>
                  {l.sim.toFixed(2)}
                </span>
              </span>
              <span className="block italic text-[14px] leading-[1.4] mt-1" style={{ color: "oklch(0.300 0.024 60)" }}>
                {l.otherLabel}
              </span>
              {l.otherRecordingTitle && (
                <span className="block mono text-[8px] tracking-[0.15em] uppercase mt-1.5" style={{ color: "var(--ink-idx)" }}>
                  {l.otherRecordingTitle.slice(0, 52)}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}

      {echo && (
        <EchoOverlay
          thread={echo.thread}
          link={echo.link}
          thisStartedAt={thisStartedAt}
          onOpen={() => { onOpenRecording(echo.link.otherRecordingId); setEcho(null); }}
          onClose={() => setEcho(null)}
        />
      )}
    </div>
  );
}
