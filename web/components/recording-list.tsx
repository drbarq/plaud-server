"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Recording } from "@/lib/types";
import { RecordingRow } from "./recording-row";

const CHUNK = 50;

function groupLabel(iso: string | null): string {
  if (!iso) return "Undated";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
    return "Earlier this month";
  }
  const month = d.toLocaleString("en-US", { month: "long" });
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

  // reset the reveal window when the filter changes
  useEffect(() => setVisibleCount(CHUNK), [recordings]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((c) => c + CHUNK);
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const visible = recordings.slice(0, visibleCount);

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
        <div>
          <p className="text-dim italic">Nothing here.</p>
          <p className="mono text-xs text-faint mt-2">
            Adjust the filter, or record something worth remembering.
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
            <h2 className="sticky top-0 z-10 mono text-[10px] uppercase tracking-[0.16em] text-faint px-4 py-1.5 bg-bg/85 backdrop-blur border-b border-hairline/50">
              {g.label}
            </h2>
          )}
          <ul>
            {g.items.map((r, i) => (
              <RecordingRow
                key={r.id}
                recording={r}
                selected={r.id === selectedId}
                onSelect={() => onSelect(r.id)}
                delayMs={Math.min(gi * 60 + i * 25, 400)}
              />
            ))}
          </ul>
        </section>
      ))}
      <div ref={sentinelRef} className="h-1" />
    </div>
  );
}
