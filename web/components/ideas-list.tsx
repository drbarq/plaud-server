"use client";

import type { Recording } from "@/lib/types";
import { fmtMs } from "./use-playback";

interface Idea {
  note: string;
  label: string;
  entities: string[];
  recording: Recording;
  spanLabel: string;
}

export function IdeasList({
  recordings,
  onOpen,
}: {
  recordings: Recording[];
  onOpen: (id: string) => void;
}) {
  const ideas: Idea[] = recordings.flatMap((r) =>
    r.threads
      .filter((t) => t.contentIdea)
      .map((t) => ({
        note: t.ideaNote || t.label,
        label: t.label,
        entities: t.entities,
        recording: r,
        spanLabel: t.spans[0] ? `SPAN ${fmtMs(t.spans[0].start)}–${fmtMs(t.spans[0].end)}` : "",
      })),
  );

  if (!ideas.length) {
    return (
      <div className="flex-1 grid place-items-center px-8 text-center">
        <p className="italic text-[17px] leading-normal" style={{ color: "oklch(0.340 0.020 66)" }}>
          Nothing flagged as an idea yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-10">
      <p className="italic text-[15px] leading-normal font-normal px-[18px] pt-1.5 pb-4" style={{ color: "oklch(0.400 0.020 68)" }}>
        Threads the pipeline flagged as something to make, not just something to feel.
      </p>
      {ideas.map((idea, i) => {
        const d = idea.recording.startedAt ? new Date(idea.recording.startedAt) : null;
        const prov = [
          `FROM “${(idea.recording.title ?? idea.recording.name).slice(0, 40)}”`,
          d ? d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }).toUpperCase() : "",
          idea.spanLabel,
        ].filter(Boolean).join(" · ");
        return (
          <button
            key={`${idea.recording.id}-${i}`}
            data-bucket={idea.recording.bucket}
            onClick={() => onOpen(idea.recording.id)}
            className="block w-full text-left mx-[18px] mb-3 px-[15px] pt-3.5 pb-3 transition-colors"
            style={{
              width: "calc(100% - 36px)",
              background: "var(--bg-idea-card)",
              border: "1px solid var(--hairline-strong)",
              borderTop: "2px solid var(--bucket, var(--b-misc))",
              animation: `fadeup 0.5s ease both`,
              animationDelay: `${Math.min(i * 60, 500)}ms`,
            }}
          >
            <p className="italic text-[15px] leading-[1.45]" style={{ color: "var(--ink-title)" }}>
              {idea.note}
            </p>
            {idea.entities.length > 0 && (
              <div className="flex flex-wrap gap-[5px] mt-2.5 mb-1">
                {idea.entities.map((e) => (
                  <span key={e} className="mono text-[8px] uppercase tracking-[0.13em] px-1.5 py-1" style={{ color: "var(--ink-meta)", border: "1px solid var(--hairline-chip)" }}>
                    {e}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--hairline-chip)" }}>
              <span className="mono text-[8px] leading-normal tracking-[0.14em] flex-1" style={{ color: "var(--ink-dim2, var(--ink-idx))" }}>
                {prov}
              </span>
              <span className="text-accent">→</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
