"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Recording } from "@/lib/types";
import { RecordingRow } from "./recording-row";

const CHUNK = 50;

function groupLabel(iso: string | null): string {
  if (!iso) return "UNDATED";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 7) return "THIS WEEK";
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return "EARLIER THIS MONTH";
  const month = d.toLocaleString("en-US", { month: "long" }).toUpperCase();
  return d.getFullYear() === now.getFullYear() ? month : `${month} ${d.getFullYear()}`;
}

export function RecordingList({
  recordings,
  selectedId,
  onSelect,
  grouped,
}: {
  recordings: Recording[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  grouped: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(CHUNK);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setVisibleCount(CHUNK), [recordings]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleCount((c) => c + CHUNK); },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const visible = recordings.slice(0, visibleCount);
  const threadTotal = recordings.reduce((n, r) => n + r.threads.length, 0);

  const groups = useMemo(() => {
    if (!grouped) return [{ label: null as string | null, items: visible }];
    const out: { label: string | null; items: Recording[] }[] = [];
    for (const r of visible) {
      const label = groupLabel(r.startedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [visible, grouped]);

  if (!recordings.length) {
    return (
      <div className="flex-1 grid place-items-center px-8 text-center">
        <div className="flex flex-col items-center">
          <span className="size-[54px] rounded-full grid place-items-center mb-5" style={{ border: "1px solid var(--scroll-thumb)" }}>
            <span className="size-1.5 rounded-full" style={{ background: "oklch(0.722 0.030 62)" }} />
          </span>
          <p className="mono text-[8px] tracking-[0.22em] mb-3.5" style={{ color: "oklch(0.582 0.015 75)" }}>
            NOTHING FILED HERE YET
          </p>
          <p className="italic text-[17px] leading-normal max-w-[26ch]" style={{ color: "oklch(0.340 0.020 66)" }}>
            The recorder has been quiet in this drawer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {groups.map((g, gi) => (
        <section key={g.label ?? `g${gi}`}>
          {g.label && (
            <div className="sticky top-0 z-10 flex items-center gap-2.5 px-[18px] pt-3 pb-2 backdrop-blur" style={{ background: "color-mix(in oklch, var(--bg) 85%, transparent)" }}>
              <span className="mono text-[9px] font-medium tracking-[0.22em] shrink-0" style={{ color: "oklch(0.440 0.018 70)" }}>
                {g.label}
              </span>
              <span className="flex-1 h-px" style={{ background: "var(--hairline-chip)" }} />
              <span className="mono text-[9px] tracking-[0.1em] shrink-0" style={{ color: "var(--ink-faint)" }}>
                {g.items.length} MEMO{g.items.length === 1 ? "" : "S"}
              </span>
            </div>
          )}
          <ul>
            {g.items.map((r, i) => (
              <RecordingRow
                key={r.id}
                recording={r}
                selected={r.id === selectedId}
                onSelect={() => onSelect(r.id)}
                delayMs={Math.min(gi * 60 + i * 55, 440)}
              />
            ))}
          </ul>
        </section>
      ))}
      <p className="mono text-[9px] leading-[1.8] tracking-[0.16em] text-center px-[18px] pt-[22px] pb-10" style={{ color: "var(--ink-ghost)" }}>
        — ARCHIVE: {threadTotal} THREADS · {recordings.length} MEMOS —
      </p>
      <div ref={sentinelRef} className="h-1" />
    </div>
  );
}
