"use client";

import type { Playback } from "./use-playback";
import { fmtMs } from "./use-playback";

/** Fixed bottom player bar. Thin scrubber (waveform lands with issue #18). */
export function Player({ playback, available }: { playback: Playback; available: boolean }) {
  const { currentMs, durationMs, playing, speed } = playback;
  const ratio = durationMs > 0 ? currentMs / durationMs : 0;

  if (!available) {
    return (
      <div className="fixed bottom-0 inset-x-0 lg:left-1/3 border-t border-hairline bg-bg/95 backdrop-blur px-4 py-3">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint text-center">
          audio not yet archived
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 inset-x-0 lg:left-1/3 border-t border-hairline bg-bg/95 backdrop-blur px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* scrubber */}
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
        className="relative h-6 flex items-center cursor-pointer select-none touch-none"
      >
        <div className="relative h-[3px] w-full rounded-full bg-inset overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-accent rounded-full"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div
          className="absolute size-3 rounded-full bg-accent -translate-x-1/2"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={playback.toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="size-10 rounded-full bg-accent text-accent-ink grid place-items-center text-sm"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button onClick={() => playback.skip(-15)} className="mono text-[11px] text-dim hover:text-ink">
          −15s
        </button>
        <button onClick={() => playback.skip(15)} className="mono text-[11px] text-dim hover:text-ink">
          +15s
        </button>
        <span className="mono text-[11px] text-dim ml-auto tabular-nums">
          {fmtMs(currentMs, durationMs)} / {fmtMs(durationMs)}
        </span>
        <button
          onClick={playback.cycleSpeed}
          className="mono text-[11px] text-dim hover:text-ink w-10 text-right"
        >
          {speed}×
        </button>
      </div>
    </div>
  );
}
