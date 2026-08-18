"use client";

import { useMemo } from "react";
import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";

/** Synthetic 60-bar waveform (v2 `waveOf`) — decorative until real peaks (#18). */
function useWave(durationMs: number): number[] {
  return useMemo(() => {
    const durS = durationMs / 1000;
    return Array.from({ length: 60 }, (_, i) => {
      const x = i / 60;
      const h =
        21 *
        (0.3 +
          0.7 * Math.abs(Math.sin(x * 9.3 + (durS % 7))) * Math.abs(Math.cos(x * 3.9 + 1.1)) +
          0.14 * (((i * 37) % 11) / 11));
      return Math.min(22, Math.max(3, h));
    });
  }, [durationMs]);
}

export function Player({ playback, available }: { playback: Playback; available: boolean }) {
  const { currentMs, durationMs, playing, speed } = playback;
  const ratio = durationMs > 0 ? currentMs / durationMs : 0;
  const wave = useWave(durationMs);

  if (!available) {
    return (
      <div className="fixed bottom-0 inset-x-0 lg:left-1/3 px-4 py-3" style={{ background: "var(--bg-player)", borderTop: "1px solid var(--scroll-thumb)", backdropFilter: "blur(8px)" }}>
        <p className="mono text-[9px] uppercase tracking-[0.16em] text-center" style={{ color: "var(--ink-faint)" }}>
          AUDIO NOT YET ARCHIVED
        </p>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-0 inset-x-0 lg:left-1/3 px-[18px] pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
      style={{ background: "var(--bg-player)", borderTop: "1px solid var(--scroll-thumb)", backdropFilter: "blur(8px)" }}
    >
      {/* waveform */}
      <div
        className="flex items-end gap-px h-6 mb-2 cursor-pointer select-none"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          playback.seekToRatio((e.clientX - rect.left) / rect.width);
        }}
      >
        {wave.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-[0.5px]"
            style={{ height: h, background: i / 60 <= ratio ? "var(--accent)" : "var(--wave-off)" }}
          />
        ))}
      </div>

      {/* progress */}
      <div
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={`${fmtMs(currentMs, durationMs)} of ${fmtMs(durationMs)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); playback.skip(-5); }
          if (e.key === "ArrowRight") { e.preventDefault(); playback.skip(5); }
          if (e.key === "Home") { e.preventDefault(); playback.seekToMs(0); }
          if (e.key === "End") { e.preventDefault(); playback.seekToMs(durationMs); }
          if (e.key === " ") { e.preventDefault(); playback.toggle(); }
        }}
        onPointerDown={(e) => {
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const seek = (clientX: number) => {
            const rect = el.getBoundingClientRect();
            playback.seekToRatio((clientX - rect.left) / rect.width);
          };
          seek(e.clientX);
          const onMove = (ev: PointerEvent) => seek(ev.clientX);
          const onUp = () => {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
          };
          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerup", onUp);
          el.addEventListener("pointercancel", onUp);
        }}
        className="relative h-5 flex items-center cursor-pointer select-none touch-none mb-1"
      >
        <div className="relative h-px w-full" style={{ background: "var(--hairline-strong)" }}>
          <div className="absolute inset-y-0 left-0" style={{ width: `${ratio * 100}%`, background: "var(--accent)" }} />
          <span
            className="absolute size-[7px] rounded-full"
            style={{ top: -3, left: `${ratio * 100}%`, marginLeft: -3.5, background: "var(--accent)", boxShadow: "0 0 8px 1px oklch(0.575 0.200 47 / 0.38)" }}
          />
        </div>
      </div>

      <div className="flex items-center">
        <span className="mono text-[10px] tracking-[0.1em] w-[82px]" style={{ color: "oklch(0.282 0.020 64)" }}>
          {fmtMs(currentMs, durationMs)} / {fmtMs(durationMs)}
        </span>
        <div className="flex-1 flex items-center justify-center gap-[18px]">
          <button onClick={() => playback.skip(-15)} className="mono text-[9px] tracking-[0.08em]" style={{ color: "oklch(0.440 0.018 70)" }}>
            ↺15
          </button>
          <button
            onClick={playback.toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="size-10 rounded-full grid place-items-center mono text-[12px] font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 0 20px -4px oklch(0.575 0.200 47 / 0.60)" }}
          >
            {playing ? "❙❙" : "▶"}
          </button>
          <button onClick={() => playback.skip(15)} className="mono text-[9px] tracking-[0.08em]" style={{ color: "oklch(0.440 0.018 70)" }}>
            15↻
          </button>
        </div>
        <button onClick={playback.cycleSpeed} className="mono text-[10px] font-medium text-accent w-[82px] text-right">
          {speed}×
        </button>
      </div>
    </div>
  );
}
