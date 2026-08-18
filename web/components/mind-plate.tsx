"use client";

import { useMemo, useState } from "react";
import type { PlateLink, Recording } from "@/lib/types";

/** MIND: the week as a plate. Days as columns, memos as vertical bands,
 * threads as marks, embedding echoes as arcs. Seams = connected clusters
 * of linked threads across days; tapping one isolates its arcs. */

interface Node {
  id: string;            // rec:key
  rec: Recording;
  key: string;
  label: string;
  contentIdea: boolean;
  x: number;
  y: number;
  h: number;
}

interface Seam {
  id: number;
  name: string;
  nodeIds: Set<string>;
  days: Set<string>;
  threadCount: number;
  peak: number;
}

const PAD_L = 34, PAD_R = 14, PAD_T = 18, PAD_B = 26;
const MIN_START = 6 * 60, MIN_END = 23 * 60; // 06:00 → 23:00

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function MindPlate({
  recordings,
  links,
  onOpen,
}: {
  recordings: Recording[];
  links: PlateLink[];
  onOpen: (id: string) => void;
}) {
  const [isolated, setIsolated] = useState<number | null>(null);
  const W = 700, H = 560;

  const model = useMemo(() => {
    const dated = recordings.filter((r) => r.startedAt && r.threads.length > 0);
    // last 7 distinct days present, chronological
    const dayKeys = [...new Set(dated.map((r) => dayKey(r.startedAt!)))].sort((a, b) => {
      const [ya, ma, da] = a.split("-").map(Number);
      const [yb, mb, db] = b.split("-").map(Number);
      return new Date(ya, ma, da).getTime() - new Date(yb, mb, db).getTime();
    }).slice(-7);
    const colW = (W - PAD_L - PAD_R) / Math.max(1, dayKeys.length);
    const colX = (i: number) => PAD_L + colW * (i + 0.5);
    const y = (min: number) =>
      PAD_T + ((Math.min(MIN_END, Math.max(MIN_START, min)) - MIN_START) / (MIN_END - MIN_START)) * (H - PAD_T - PAD_B);

    const nodes = new Map<string, Node>();
    const bands: { rec: Recording; x: number; y0: number; h: number; clock: string }[] = [];

    for (const r of dated) {
      const dk = dayKey(r.startedAt!);
      const di = dayKeys.indexOf(dk);
      if (di < 0) continue;
      const d = new Date(r.startedAt!);
      const startMin = d.getHours() * 60 + d.getMinutes();
      const y0 = y(startMin);
      const h = Math.min(H * 0.3, 24 + (r.durationMs / 622_000) * H * 0.19);
      const x = colX(di);
      bands.push({
        rec: r, x, y0, h,
        clock: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      });
      const n = r.threads.length;
      const gapX = n > 6 ? 2.5 : 3.4;
      r.threads.forEach((t, ti) => {
        const total = r.durationMs || 1;
        const first = t.spans[0];
        const relMid = first ? (first.start + first.end) / 2 / total : 0.5;
        nodes.set(`${r.id}:${t.key}`, {
          id: `${r.id}:${t.key}`,
          rec: r, key: t.key, label: t.label, contentIdea: t.contentIdea,
          x: x + (ti - (n - 1) / 2) * gapX,
          y: y0 + relMid * h,
          h: first ? Math.max(1.8, ((first.end - first.start) / total) * h) : 1.8,
        });
      });
    }

    const edges = links
      .map((l) => ({ a: nodes.get(`${l.aRec}:${l.aKey}`), b: nodes.get(`${l.bRec}:${l.bKey}`), sim: l.sim, shared: l.sharedEntities }))
      .filter((e): e is { a: Node; b: Node; sim: number; shared: string[] } => !!e.a && !!e.b);

    // seams: connected components over the link graph, ≥2 distinct days
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    for (const e of edges) {
      for (const id of [e.a.id, e.b.id]) if (!parent.has(id)) parent.set(id, id);
      const ra = find(e.a.id), rb = find(e.b.id);
      if (ra !== rb) parent.set(ra, rb);
    }
    const comps = new Map<string, { ids: Set<string>; sims: number[]; entities: string[] }>();
    for (const e of edges) {
      const root = find(e.a.id);
      const c = comps.get(root) ?? { ids: new Set<string>(), sims: [], entities: [] };
      c.ids.add(e.a.id); c.ids.add(e.b.id);
      c.sims.push(e.sim);
      c.entities.push(...e.shared);
      comps.set(root, c);
    }
    const seams: Seam[] = [];
    let sid = 0;
    for (const c of comps.values()) {
      const days = new Set<string>();
      for (const id of c.ids) {
        const n = nodes.get(id)!;
        days.add(dayKey(n.rec.startedAt!));
      }
      if (days.size < 2) continue;
      const entityName = [...new Set(c.entities)].sort(
        (a, b) => c.entities.filter((e) => e === b).length - c.entities.filter((e) => e === a).length,
      )[0];
      const shortest = [...c.ids].map((id) => nodes.get(id)!.label).sort((a, b) => a.length - b.length)[0];
      seams.push({
        id: sid++,
        name: entityName ?? shortest.slice(0, 42),
        nodeIds: c.ids,
        days,
        threadCount: c.ids.size,
        peak: Math.max(...c.sims),
      });
    }
    seams.sort((a, b) => b.threadCount - a.threadCount);

    return { dayKeys, bands, nodes, edges, seams, y, colX };
  }, [recordings, links]);

  const iso = isolated != null ? model.seams.find((s) => s.id === isolated) : null;
  const inIso = (id: string) => !iso || iso.nodeIds.has(id);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-[18px] pb-12">
      <div className="pt-2 pb-4">
        <p className="italic text-[20px] leading-[1.3] font-light" style={{ color: "var(--ink-strong)" }}>
          The shape of the week.
        </p>
        <p className="text-[13px] leading-normal font-light mt-1.5" style={{ color: "var(--ink-snippet)" }}>
          Each column is a day; each band a memo; each mark a thread. The curves are echoes —
          places the index heard you circle back.
        </p>
      </div>

      <div className="flex items-center gap-2.5 pt-3 pb-2" style={{ borderTop: "1px solid var(--hairline)" }}>
        <span className="mono text-[9px] font-medium tracking-[0.22em] text-accent">
          {iso ? `ISOLATED: ${iso.name.toUpperCase().slice(0, 30)}` : "ALL ECHOES SHOWN"}
        </span>
        <span className="flex-1" />
        {iso && (
          <button onClick={() => setIsolated(null)} className="mono text-[8px] font-medium tracking-[0.16em]" style={{ color: "var(--ink-dim2, var(--ink-idx))" }}>
            RESET
          </button>
        )}
      </div>

      <svg viewBox={`0 0 700 560`} className="w-full" style={{ overflow: "visible" }}>
        {/* hour gridlines + labels */}
        {[6, 10, 14, 18, 22].map((h) => (
          <g key={h}>
            <line x1={PAD_L} x2={700 - PAD_R} y1={model.y(h * 60)} y2={model.y(h * 60)} stroke="var(--hairline-grid, oklch(0.876 0.012 82))" strokeWidth={1} />
            <text x={0} y={model.y(h * 60) + 3} className="mono" fontSize={8} fill="var(--ink-tick)" letterSpacing="0.14em">
              {String(h).padStart(2, "0")}:00
            </text>
          </g>
        ))}
        {/* day columns */}
        {model.dayKeys.map((dk, i) => {
          const [yr, mo, da] = dk.split("-").map(Number);
          const d = new Date(yr, mo, da);
          return (
            <g key={dk}>
              <line x1={model.colX(i)} x2={model.colX(i)} y1={PAD_T} y2={560 - PAD_B + 4} stroke="oklch(0.866 0.014 82)" strokeWidth={1} strokeDasharray="1 5" />
              <text x={model.colX(i)} y={560 - 6} textAnchor="middle" className="mono" fontSize={8} fill="var(--ink-dim)" letterSpacing="0.14em">
                {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()} {d.getDate()}
              </text>
            </g>
          );
        })}
        {/* echo arcs (under marks) */}
        {model.edges.map((e, i) => {
          const member = inIso(e.a.id) && inIso(e.b.id);
          const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
          const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = Math.min(560 * 0.085, 11 + len * 0.075);
          const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
          return (
            <g key={i}>
              <path
                d={`M ${e.a.x} ${e.a.y} Q ${cx} ${cy} ${e.b.x} ${e.b.y}`}
                fill="none"
                stroke={iso && member ? "var(--accent)" : "var(--ink-dim)"}
                strokeWidth={0.6 + (e.sim - 0.7) * 2.6 + (iso && member ? 0.5 : 0)}
                opacity={iso ? (member ? 0.95 : 0.07) : 0.26 + (e.sim - 0.7) * 1.3}
                strokeLinecap="round"
              />
              {[e.a, e.b].map((n, j) => (
                <circle
                  key={j}
                  cx={n.x} cy={n.y}
                  r={iso && member ? 2.6 : 1.9}
                  fill={iso && member ? "var(--accent)" : "var(--ink-dim)"}
                  opacity={iso ? (member ? 0.95 : 0.1) : 0.85}
                />
              ))}
            </g>
          );
        })}
        {/* memo bands + thread marks */}
        {model.bands.map((b) => (
          <g key={b.rec.id} onClick={() => onOpen(b.rec.id)} style={{ cursor: "pointer" }} data-bucket={b.rec.bucket}>
            <line x1={b.x} x2={b.x} y1={b.y0} y2={b.y0 + b.h} stroke="var(--hairline-strong)" strokeWidth={1} />
            <text x={b.x + 7} y={b.y0 - 4} className="mono" fontSize={7.5} fill="var(--ink-faint)" letterSpacing="0.1em">
              {b.clock}
            </text>
            <circle cx={b.x} cy={b.y0} r={2.6} fill="var(--bucket, var(--b-misc))" />
          </g>
        ))}
        {model.bands.map((b) =>
          b.rec.threads.map((t) => {
            const n = model.nodes.get(`${b.rec.id}:${t.key}`);
            if (!n) return null;
            const member = inIso(n.id);
            return (
              <rect
                key={n.id}
                x={n.x - 0.95} y={n.y - n.h / 2}
                width={1.9} height={n.h}
                fill={t.contentIdea ? "var(--b-idea)" : "var(--bucket, var(--b-misc))"}
                opacity={iso ? (member ? 1 : 0.14) : 0.9}
                data-bucket={b.rec.bucket}
                onClick={() => onOpen(b.rec.id)}
                style={{ cursor: "pointer" }}
              />
            );
          }),
        )}
      </svg>

      <p className="mono text-[8px] tracking-[0.15em] mt-3 pt-3" style={{ color: "var(--ink-dim2, var(--ink-idx))", borderTop: "1px solid var(--hairline)" }}>
        BAND ∝ DURATION · MARK = THREAD · CURVE = EMBEDDING ECHO · TAP A BAND TO OPEN
      </p>

      {/* seams */}
      <div className="rule-row accent mt-7">
        <span className="rr-label">Seams</span>
        <span className="rr-rule" />
        <span className="rr-count">TAP TO ISOLATE</span>
      </div>
      <p className="text-[13px] leading-relaxed font-light mb-3" style={{ color: "var(--ink-snippet)" }}>
        Themes the index keeps hearing — clusters of echoed threads across days.
      </p>
      {model.seams.length === 0 && (
        <p className="italic text-[14px]" style={{ color: "oklch(0.340 0.020 66)" }}>
          No cross-day seams yet — they appear as recordings accumulate.
        </p>
      )}
      {model.seams.map((s) => (
        <button
          key={s.id}
          onClick={() => setIsolated(isolated === s.id ? null : s.id)}
          className="block w-full text-left px-3 py-3 mb-2 transition-colors"
          style={{
            border: "1px solid var(--hairline)",
            borderLeft: `2px solid ${isolated === s.id ? "var(--accent)" : "transparent"}`,
            background: isolated === s.id ? "var(--bg-selected)" : undefined,
          }}
        >
          <p className="italic text-[15px] leading-[1.35]" style={{ color: isolated === s.id ? "var(--ink-strong)" : "oklch(0.340 0.020 66)" }}>
            {s.name}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <span className="flex gap-[3px]">
              {model.dayKeys.map((dk) => (
                <span
                  key={dk}
                  className="size-[7px]"
                  style={{ background: s.days.has(dk) ? (isolated === s.id ? "var(--accent)" : "var(--ink-dim)") : "var(--hairline)" }}
                />
              ))}
            </span>
            <span className="mono text-[8px] tracking-[0.13em]" style={{ color: "var(--ink-dim2, var(--ink-idx))" }}>
              {s.days.size} DAYS · {s.threadCount} THREADS · PEAK {s.peak.toFixed(2)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
