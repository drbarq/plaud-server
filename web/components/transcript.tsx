"use client";

import { useMemo } from "react";
import type { Utterance } from "@/lib/types";
import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";

export function Transcript({
  utterances,
  playback,
}: {
  utterances: Utterance[];
  playback: Playback;
}) {
  // active utterance via binary search on currentMs (blueprint)
  const activeIdx = useMemo(() => {
    const t = playback.currentMs;
    if (t <= 0) return -1;
    let lo = 0, hi = utterances.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (utterances[mid].start_ms <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }, [playback.currentMs, utterances]);

  const wordCount = useMemo(
    () => utterances.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0),
    [utterances],
  );

  const multiSpeaker = useMemo(
    () => new Set(utterances.map((u) => u.speaker).filter(Boolean)).size > 1,
    [utterances],
  );

  return (
    <div>
      <div className="space-y-1">
        {utterances.map((u, i) => (
          <button
            key={i}
            onClick={() => playback.seekToMs(u.start_ms)}
            className={`w-full text-left flex gap-3 rounded-lg px-2 py-1.5 transition-colors ${
              i === activeIdx ? "bg-raised shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-raised/50"
            }`}
          >
            <span className="mono text-[10px] text-faint shrink-0 pt-1 w-10 text-right">
              {fmtMs(u.start_ms)}
            </span>
            <span className="flex-1 leading-relaxed text-[15px]">
              {multiSpeaker && u.speaker && (
                <span className="mono text-[10px] uppercase tracking-wide text-dim mr-2">
                  {u.speaker}
                </span>
              )}
              {u.text}
            </span>
          </button>
        ))}
      </div>
      <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint mt-4">
        {wordCount.toLocaleString()} words · {utterances.length} utterances
      </p>
    </div>
  );
}
