"use client";

import { BUCKETS, type Bucket } from "@/lib/types";
import type { SortMode } from "./workstation";

export function Toolbar(props: {
  bucket: Bucket | "all";
  onBucket: (b: Bucket | "all") => void;
  counts: Record<string, number>;
  query: string;
  onQuery: (q: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  shown: number;
  total: number;
  onEnter: () => void;
}) {
  const { bucket, onBucket, counts, query, onQuery, sort, onSort, shown, total, onEnter } = props;
  return (
    <div className="shrink-0">
      {/* search — v2 underline style */}
      <div className="px-[18px] pb-3 pt-1">
        <div className="flex items-center gap-2 pb-2" style={{ borderBottom: "1px solid var(--hairline-strong)" }}>
          <span className="text-[13px]" style={{ color: "var(--ink-mute)" }}>⌕</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEnter()}
            placeholder="SEARCH TRANSCRIPTS, THREADS, ENTITIES"
            className="mono flex-1 bg-transparent text-[12px] tracking-[0.1em] uppercase outline-none"
            style={{ color: "var(--ink-body)" }}
          />
          {query ? (
            <button onClick={() => onQuery("")} className="mono text-[12px]" style={{ color: "var(--ink-mute)" }} aria-label="Clear search">
              ✕
            </button>
          ) : (
            <button
              onClick={() => onSort(sort === "newest" ? "oldest" : "newest")}
              className="mono text-[11px] tracking-[0.1em]"
              style={{ color: "var(--ink-faint)" }}
            >
              {sort === "newest" ? "↓" : "↑"}
            </button>
          )}
          <span className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {shown}/{total}
          </span>
        </div>
      </div>

      {/* bucket chips */}
      <div className="flex gap-[7px] overflow-x-auto px-[18px] pt-1 pb-4 [scrollbar-width:none]">
        <Chip active={bucket === "all"} onClick={() => onBucket("all")} label="ALL" count={total} />
        {BUCKETS.map((b) => (
          <Chip
            key={b}
            active={bucket === b}
            onClick={() => onBucket(bucket === b ? "all" : b)}
            label={b.toUpperCase()}
            count={counts[b] ?? 0}
            bucket={b}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  active, onClick, label, count, bucket,
}: {
  active: boolean; onClick: () => void; label: string; count: number; bucket?: Bucket;
}) {
  return (
    <button
      onClick={onClick}
      data-bucket={bucket}
      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-[2px] transition-colors"
      style={{
        border: `1px solid ${active ? "oklch(0.502 0.016 73)" : "var(--hairline-chip)"}`,
        background: active ? "var(--bg-chip-active)" : "transparent",
      }}
    >
      <span className="size-[5px] rounded-full" style={{ background: bucket ? "var(--bucket)" : "var(--ink)" }} />
      <span className="mono text-[11px] font-medium tracking-[0.15em]" style={{ color: active ? "var(--ink-title)" : "oklch(0.64 0.016 76)" }}>
        {label}
      </span>
      <span className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>{count}</span>
    </button>
  );
}
