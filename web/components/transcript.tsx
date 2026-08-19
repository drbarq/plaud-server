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
  const activeIdx = useMemo(() => {
    const t = playback.currentMs;
    if (t <= 0) return -1;
    let lo = 0, hi = utterances.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (utterances[mid].start_ms <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
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
      <div>
        {utterances.map((u, i) => {
          const active = i === activeIdx;
          return (
            <button
              key={i}
              onClick={() => playback.seekToMs(u.start_ms)}
              className="w-full text-left flex gap-3 px-2.5 py-2"
              style={{
                transition: "background 0.25s ease, color 0.25s ease",
                background: active ? "var(--bg-tx-active)" : undefined,
                borderLeft: active ? "2px solid var(--accent)" : "1px solid var(--tx-rule)",
              }}
            >
              <span className="mono text-[11px] leading-[1.7] shrink-0 w-[30px]" style={{ color: active ? "var(--accent)" : "var(--ink-tx-t)", letterSpacing: "0.06em" }}>
                {fmtMs(u.start_ms)}
              </span>
              <span className="flex-1 text-[15.5px] leading-[1.55] font-light" style={{ color: active ? "var(--ink-strong)" : "var(--ink-tx)" }}>
                {multiSpeaker && u.speaker && (
                  <span className="mono text-[11px] uppercase tracking-[0.14em] mr-2" style={{ color: "var(--ink-meta)" }}>
                    {u.speaker}
                  </span>
                )}
                {u.text}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mono text-[11px] uppercase tracking-[0.14em] mt-4" style={{ color: "var(--ink-faint)" }}>
        {wordCount.toLocaleString()} WORDS · {utterances.length} UTTERANCES
      </p>
    </div>
  );
}
