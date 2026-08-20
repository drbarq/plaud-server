"use client";

import { useMemo, useState } from "react";
import type { PlateLink, Recording } from "@/lib/types";

/** MIND: the week as a plate. Days as columns, memos as vertical bands,
 * threads as marks, embedding echoes as arcs. Seams = connected clusters
 * of linked threads across days; tapping one isolates its arcs.
 * Two fixed variants — portrait for phones, landscape for desktop — are
 * both rendered and toggled by CSS breakpoint, so each screen always gets
 * the plate drawn for its geometry (no JS screen detection). */

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

interface Dims {
  W: number;
  H: number;
  PAD_L: number;
  PAD_R: number;
  PAD_T: number;
  PAD_B: number;
}

// v2 spec: desktop plate 700-wide landscape; mobile variant is PORTRAIT
// (360x580) so marks and labels render near 1:1 device pixels on a phone.
const DESKTOP_DIMS: Dims = { W: 700, H: 560, PAD_L: 40, PAD_R: 14, PAD_T: 18, PAD_B: 28 };
const MOBILE_DIMS: Dims = { W: 360, H: 580, PAD_L: 36, PAD_R: 8, PAD_T: 18, PAD_B: 28 };

const MIN_START = 6 * 60, MIN_END = 23 * 60; // 06:00 → 23:00

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function buildModel(recordings: Recording[], links: PlateLink[], dims: Dims) {
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = dims;
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
}

function Plate({
  recordings,
  links,
  desktop,
  iso,
  onOpen,
}: {
  recordings: Recording[];
  links: PlateLink[];
  desktop: boolean;
  iso: Seam | null;
  onOpen: (id: string) => void;
}) {
  const dims = desktop ? DESKTOP_DIMS : MOBILE_DIMS;
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = dims;
  const model = useMemo(() => buildModel(recordings, links, dims), [recordings, links, desktop]); // eslint-disable-line react-hooks/exhaustive-deps
  const inIso = (id: string) => !iso || iso.nodeIds.has(id);
  const tickSize = desktop ? 10 : 9;
  const clockSize = desktop ? 9 : 8.5;

  // hover: a mark highlights its own arcs; a band highlights all of its memo's
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverRec, setHoverRec] = useState<string | null>(null);
  const hot = useMemo<Set<string> | null>(() => {
    if (hoverNode) return new Set([hoverNode]);
    if (hoverRec) {
      const s = new Set<string>();
      for (const id of model.nodes.keys()) if (id.startsWith(`${hoverRec}:`)) s.add(id);
      return s;
    }
    return null;
  }, [hoverNode, hoverRec, model]);
  const edgeHot = (a: string, b: string) => !!hot && (hot.has(a) || hot.has(b));
  // marks lit while hovering: the hovered set plus everything its arcs reach
  const lit = useMemo<Set<string> | null>(() => {
    if (!hot) return null;
    const s = new Set(hot);
    for (const e of model.edges) {
      if (hot.has(e.a.id)) s.add(e.b.id);
      if (hot.has(e.b.id)) s.add(e.a.id);
    }
    return s;
  }, [hot, model]);
  const FADE = { transition: "opacity 150ms, stroke-width 150ms" } as const;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: "visible" }}>
      {/* hour gridlines + labels */}
      {[6, 10, 14, 18, 22].map((h) => (
        <g key={h}>
          <line x1={PAD_L} x2={W - PAD_R} y1={model.y(h * 60)} y2={model.y(h * 60)} stroke="var(--hairline-grid, oklch(0.876 0.012 82))" strokeWidth={1} />
          <text x={0} y={model.y(h * 60) + 3} className="mono" fontSize={tickSize} fill="var(--ink-tick)" letterSpacing="0.1em">
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
            <line x1={model.colX(i)} x2={model.colX(i)} y1={PAD_T} y2={H - PAD_B + 4} stroke="oklch(0.866 0.014 82)" strokeWidth={1} strokeDasharray="1 5" />
            <text x={model.colX(i)} y={H - 6} textAnchor="middle" className="mono" fontSize={tickSize} fill="var(--ink-dim)" letterSpacing="0.14em">
              {desktop
                ? `${d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()} ${d.getDate()}`
                : `${d.toLocaleDateString("en-US", { weekday: "short" })[0].toUpperCase()} ${d.getDate()}`}
            </text>
          </g>
        );
      })}
      {/* echo arcs (under marks) */}
      {model.edges.map((e, i) => {
        const member = inIso(e.a.id) && inIso(e.b.id);
        const isHot = edgeHot(e.a.id, e.b.id);
        const emph = isHot || (!hot && iso && member);
        const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = Math.min(H * 0.085, 11 + len * 0.075);
        const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
        return (
          <g key={i}>
            <path
              d={`M ${e.a.x} ${e.a.y} Q ${cx} ${cy} ${e.b.x} ${e.b.y}`}
              fill="none"
              stroke={emph ? "var(--accent)" : "var(--ink-dim)"}
              strokeWidth={0.6 + (e.sim - 0.7) * 2.6 + (emph ? 0.6 : 0)}
              opacity={hot ? (isHot ? 0.95 : 0.06) : iso ? (member ? 0.95 : 0.07) : 0.26 + (e.sim - 0.7) * 1.3}
              strokeLinecap="round"
              style={FADE}
            />
            {[e.a, e.b].map((n, j) => (
              <circle
                key={j}
                cx={n.x} cy={n.y}
                r={emph ? 2.6 : 1.9}
                fill={emph ? "var(--accent)" : "var(--ink-dim)"}
                opacity={hot ? (isHot ? 0.95 : 0.08) : iso ? (member ? 0.95 : 0.1) : 0.85}
                style={FADE}
              />
            ))}
          </g>
        );
      })}
      {/* memo bands + thread marks */}
      {model.bands.map((b) => (
        <g
          key={b.rec.id}
          onClick={() => onOpen(b.rec.id)}
          onMouseEnter={() => setHoverRec(b.rec.id)}
          onMouseLeave={() => setHoverRec(null)}
          style={{ cursor: "pointer" }}
          data-bucket={b.rec.bucket}
        >
          <rect x={b.x - 11} y={b.y0 - 10} width={22} height={b.h + 20} fill="transparent" />
          <line x1={b.x} x2={b.x} y1={b.y0} y2={b.y0 + b.h} stroke="var(--hairline-strong)" strokeWidth={1} />
          <text x={b.x + 6} y={b.y0 - 4} className="mono" fontSize={clockSize} fill="var(--ink-faint)" letterSpacing="0.08em" opacity={hot && !b.rec.threads.some((t) => lit?.has(`${b.rec.id}:${t.key}`)) ? 0.3 : 1} style={FADE}>
            {b.clock}
          </text>
          <circle cx={b.x} cy={b.y0} r={desktop ? 2.6 : 3} fill="var(--bucket, var(--b-misc))" />
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
              x={n.x - (desktop ? 0.95 : 1.2)} y={n.y - n.h / 2}
              width={desktop ? 1.9 : 2.4} height={n.h}
              fill={t.contentIdea ? "var(--b-idea)" : "var(--bucket, var(--b-misc))"}
              opacity={hot ? (lit?.has(n.id) ? 1 : 0.15) : iso ? (member ? 1 : 0.14) : 0.9}
              data-bucket={b.rec.bucket}
              onClick={() => onOpen(b.rec.id)}
              onMouseEnter={() => setHoverNode(n.id)}
              onMouseLeave={() => setHoverNode(null)}
              style={{ cursor: "pointer", ...FADE }}
            />
          );
        }),
      )}
    </svg>
  );
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
  const [preview, setPreview] = useState<number | null>(null); // seam hovered in the list

  // seams + day dots are geometry-independent — compute once, shared by both plates
  const shared = useMemo(() => buildModel(recordings, links, MOBILE_DIMS), [recordings, links]);
  const picked = preview ?? isolated;
  const iso = picked != null ? shared.seams.find((s) => s.id === picked) ?? null : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-[18px] pb-12">
      <div className="max-w-[860px] mx-auto">
        <div className="pt-2 pb-4">
          <p className="italic text-[22px] leading-[1.3] font-light" style={{ color: "var(--ink-strong)" }}>
            The shape of the week.
          </p>
          <p className="text-[14.5px] leading-normal font-light mt-1.5" style={{ color: "var(--ink-snippet)" }}>
            Each column is a day; each band a memo; each mark a thread. The curves are echoes —
            places the index heard you circle back.
          </p>
        </div>

        <div className="flex items-center gap-2.5 pt-3 pb-2" style={{ borderTop: "1px solid var(--hairline)" }}>
          <span className="mono text-[11px] font-medium tracking-[0.22em] text-accent">
            {iso ? `${preview != null && preview !== isolated ? "PREVIEW" : "ISOLATED"}: ${iso.name.toUpperCase().slice(0, 30)}` : "ALL ECHOES SHOWN"}
          </span>
          <span className="flex-1" />
          {isolated != null && (
            <button onClick={() => setIsolated(null)} className="mono text-[11px] font-medium tracking-[0.16em]" style={{ color: "var(--ink-dim2, var(--ink-idx))" }}>
              RESET
            </button>
          )}
        </div>

        {/* portrait plate for phones, landscape for desktop — CSS picks, both always correct */}
        <div className="lg:hidden">
          <Plate recordings={recordings} links={links} desktop={false} iso={iso} onOpen={onOpen} />
        </div>
        <div className="hidden lg:block">
          <Plate recordings={recordings} links={links} desktop={true} iso={iso} onOpen={onOpen} />
        </div>

        <p className="mono text-[11px] tracking-[0.15em] mt-3 pt-3" style={{ color: "var(--ink-dim2, var(--ink-idx))", borderTop: "1px solid var(--hairline)" }}>
          BAND ∝ DURATION · MARK = THREAD · CURVE = EMBEDDING ECHO · TAP A BAND TO OPEN
        </p>

        {/* seams */}
        <div className="rule-row accent mt-7">
          <span className="rr-label">Seams</span>
          <span className="rr-rule" />
          <span className="rr-count">TAP TO ISOLATE</span>
        </div>
        <p className="text-[14.5px] leading-relaxed font-light mb-3" style={{ color: "var(--ink-snippet)" }}>
          Themes the index keeps hearing — clusters of echoed threads across days.
        </p>
        {shared.seams.length === 0 && (
          <p className="italic text-[15.5px]" style={{ color: "oklch(0.340 0.020 66)" }}>
            No cross-day seams yet — they appear as recordings accumulate.
          </p>
        )}
        {shared.seams.map((s) => (
          <button
            key={s.id}
            onClick={() => { setIsolated(isolated === s.id ? null : s.id); setPreview(null); }}
            onMouseEnter={() => setPreview(s.id)}
            onMouseLeave={() => setPreview(null)}
            className="block w-full text-left px-3 py-3 mb-2 transition-colors"
            style={{
              border: "1px solid var(--hairline)",
              borderLeft: `2px solid ${isolated === s.id ? "var(--accent)" : "transparent"}`,
              background: isolated === s.id ? "var(--bg-selected)" : undefined,
            }}
          >
            <p className="italic text-[16px] leading-[1.35]" style={{ color: isolated === s.id ? "var(--ink-strong)" : "oklch(0.340 0.020 66)" }}>
              {s.name}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="flex gap-[3px]">
                {shared.dayKeys.map((dk) => (
                  <span
                    key={dk}
                    className="size-[7px]"
                    style={{ background: s.days.has(dk) ? (isolated === s.id ? "var(--accent)" : "var(--ink-dim)") : "var(--hairline)" }}
                  />
                ))}
              </span>
              <span className="mono text-[11px] tracking-[0.13em]" style={{ color: "var(--ink-dim2, var(--ink-idx))" }}>
                {s.days.size} DAYS · {s.threadCount} THREADS · PEAK {s.peak.toFixed(2)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
