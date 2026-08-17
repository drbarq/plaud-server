"use client";

import type { ThreadFull } from "@/lib/types";
import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";

export function ThreadList({
  threads,
  playback,
  durationMs,
}: {
  threads: ThreadFull[];
  playback: Playback;
  durationMs: number;
}) {
  return (
    <div className="space-y-3">
      {threads.map((t) => (
        <div key={t.key} className="border border-hairline rounded-xl bg-raised/40 px-4 py-3">
          <button
            onClick={() => t.spans[0] && playback.seekToMs(t.spans[0].start)}
            className="w-full text-left group"
          >
            <div className="flex items-baseline gap-2">
              <span className="mono text-[10px] text-faint shrink-0">{t.key}</span>
              <span className="flex-1 leading-snug group-hover:text-accent transition-colors">
                {t.label}
              </span>
              {t.contentIdea && (
                <span
                  className="mono text-[9px] uppercase tracking-wide shrink-0 rounded-full px-2 py-0.5 border"
                  style={{ color: "var(--b-idea)", borderColor: "var(--b-idea)" }}
                >
                  idea
                </span>
              )}
            </div>
            {t.summaryLine && t.summaryLine !== t.label && (
              <p className="text-[13px] text-dim italic mt-1 leading-snug">{t.summaryLine}</p>
            )}
          </button>

          {/* span map for this thread */}
          {durationMs > 0 && t.spans.length > 0 && (
            <div className="relative h-[3px] mt-2.5 rounded-full bg-inset overflow-hidden">
              {t.spans.map((s, i) => (
                <button
                  key={i}
                  onClick={() => playback.seekToMs(s.start)}
                  aria-label={`Play from ${fmtMs(s.start)}`}
                  className="absolute top-0 h-full rounded-full bg-[var(--bucket,var(--accent))] opacity-80 hover:opacity-100"
                  style={{
                    left: `${Math.min(100, (s.start / durationMs) * 100)}%`,
                    width: `${Math.max(1, ((s.end - s.start) / durationMs) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}

          {t.ideaNote && (
            <p className="text-[13px] mt-2 pl-3 border-l-2" style={{ borderColor: "var(--b-idea)" }}>
              {t.ideaNote}
            </p>
          )}

          {(t.entities.length > 0 || t.actionItems.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {t.entities.map((e) => (
                <span key={e} className="mono text-[10px] text-dim bg-inset rounded px-1.5 py-0.5">
                  {e}
                </span>
              ))}
              {t.actionItems.map((a, i) => (
                <span key={`a${i}`} className="mono text-[10px] text-accent">
                  → {a.text}
                </span>
              ))}
            </div>
          )}

          {t.links.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-hairline/60 space-y-1">
              {t.links.map((l, i) => (
                <p key={i} className="text-[12px] text-dim leading-snug">
                  <span className="mono text-[9px] uppercase tracking-wide text-faint mr-1.5">
                    connects · {l.sim.toFixed(2)}
                  </span>
                  <span className="italic">{l.otherLabel}</span>
                  {l.otherRecordingTitle && (
                    <span className="text-faint"> — {l.otherRecordingTitle}</span>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
