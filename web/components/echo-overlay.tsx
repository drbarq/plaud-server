"use client";

import type { ThreadFull, ThreadLink } from "@/lib/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.abs(Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000));
}

export function SimTicks({ sim, size = 7 }: { sim: number; size?: number }) {
  const on = Math.round(sim * 8);
  return (
    <span className="sim-ticks" aria-label={`similarity ${sim.toFixed(2)}`}>
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} className={i < on ? "on" : ""} style={{ height: size }} />
      ))}
    </span>
  );
}

/** The "connects" moment: this thread remembered across days. */
export function EchoOverlay({
  thread,
  link,
  thisStartedAt,
  onOpen,
  onClose,
}: {
  thread: ThreadFull;
  link: ThreadLink;
  thisStartedAt: string | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const days = daysApart(thisStartedAt, link.otherStartedAt);
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-center px-4 lg:px-0 lg:items-center overflow-y-auto"
      style={{ background: "var(--bg-scrim)", backdropFilter: "blur(10px)", animation: "drift 0.35s ease both" }}
      onClick={onClose}
    >
      <div
        className="w-full lg:max-w-md py-6"
        style={{ animation: "echoin 0.55s cubic-bezier(0.2,0.75,0.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <span className="mono text-[11px] font-medium tracking-[0.26em] text-accent">ECHO</span>
          <span className="flex-1 h-px" style={{ background: "oklch(0.575 0.200 47 / 0.38)" }} />
          <SimTicks sim={link.sim} size={9} />
          <span className="mono text-[11px]" style={{ color: "oklch(0.340 0.020 66)" }}>
            {link.sim.toFixed(2)}
          </span>
        </div>

        {/* card A — this thread */}
        <div className="p-4" style={{ background: "var(--bg-raised)", border: "1px solid var(--scroll-thumb)" }}>
          <p className="mono text-[10px] tracking-[0.2em] uppercase mb-2.5" style={{ color: "oklch(0.562 0.016 74)" }}>
            THIS THREAD · {fmtDate(thisStartedAt)}
          </p>
          <p className="italic text-[17px] leading-[1.38]" style={{ color: "var(--ink-title)" }}>
            {thread.label}
          </p>
          {thread.summaryLine && thread.summaryLine !== thread.label && (
            <p className="text-[14.5px] leading-normal font-light mt-2" style={{ color: "oklch(0.482 0.018 71)" }}>
              &ldquo;{thread.summaryLine}&rdquo;
            </p>
          )}
        </div>

        {/* bridge */}
        <div className="flex flex-col items-center">
          <span className="w-px h-[22px] origin-top" style={{ background: "oklch(0.575 0.200 47 / 0.55)", animation: "grow 0.5s 0.25s cubic-bezier(0.2,0.75,0.2,1) both" }} />
          <span className="flex items-center gap-2 py-1.5">
            <span className="size-1.5 rotate-45 bg-accent" />
            <span className="mono text-[10px] font-medium tracking-[0.2em] text-accent">
              {days != null && days > 0 ? `REMEMBERED ACROSS ${days} DAY${days === 1 ? "" : "S"}` : "REMEMBERED"}
            </span>
          </span>
          <span className="w-px h-[22px] origin-top" style={{ background: "oklch(0.575 0.200 47 / 0.55)", animation: "grow 0.5s 0.45s cubic-bezier(0.2,0.75,0.2,1) both" }} />
        </div>

        {/* card B — the remembered memo */}
        <div className="p-4" style={{ background: "var(--bg-echo-b)", border: "1px solid oklch(0.575 0.200 47 / 0.38)" }}>
          <p className="mono text-[10px] tracking-[0.2em] uppercase mb-2.5 text-accent">
            {fmtDate(link.otherStartedAt)}{link.otherRecordingTitle ? ` · ${link.otherRecordingTitle.toUpperCase().slice(0, 44)}` : ""}
          </p>
          <p className="italic text-[17px] leading-[1.38]" style={{ color: "var(--ink-title)" }}>
            {link.otherLabel}
          </p>
          {link.otherSummaryLine && link.otherSummaryLine !== link.otherLabel && (
            <p className="text-[14.5px] leading-normal font-light mt-2" style={{ color: "oklch(0.482 0.018 71)" }}>
              &ldquo;{link.otherSummaryLine}&rdquo;
            </p>
          )}
        </div>

        {link.sharedEntities.length > 0 && (
          <div className="mt-4 pt-3.5" style={{ borderTop: "1px solid var(--hairline-strong)" }}>
            <p className="mono text-[10px] tracking-[0.2em] mb-2" style={{ color: "oklch(0.582 0.015 75)" }}>
              SHARED ENTITIES
            </p>
            <div className="flex flex-wrap gap-1.5">
              {link.sharedEntities.map((e) => (
                <span key={e} className="mono text-[10px] uppercase tracking-[0.13em] text-accent px-1.5 py-1" style={{ border: "1px solid oklch(0.575 0.200 47 / 0.42)" }}>
                  {e}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onOpen}
            className="flex-1 mono text-[11px] font-medium tracking-[0.18em] py-3 bg-accent"
            style={{ color: "var(--accent-ink)" }}
          >
            OPEN THAT MEMO
          </button>
          <button
            onClick={onClose}
            className="mono text-[11px] font-medium tracking-[0.18em] py-3 px-4"
            style={{ border: "1px solid var(--control-line)", color: "oklch(0.440 0.018 70)" }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
