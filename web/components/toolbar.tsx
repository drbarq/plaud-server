"use client";

import { BUCKETS, type Bucket } from "@/lib/types";
import type { SortMode } from "./workstation";

const CHIP_LABEL: Record<Bucket, string> = {
  journal: "journal",
  idea: "idea",
  task: "task",
  meeting: "meeting",
  "project-note": "project",
  reference: "ref",
  misc: "misc",
};

export function Toolbar(props: {
  bucket: Bucket | "all";
  onBucket: (b: Bucket | "all") => void;
  query: string;
  onQuery: (q: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  shown: number;
  total: number;
  onEnter: () => void;
}) {
  const { bucket, onBucket, query, onQuery, sort, onSort, shown, total, onEnter } = props;
  return (
    <div className="shrink-0 border-b border-hairline">
      {/* bucket chips — primary navigation, thumb-scrollable */}
      <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-2 [scrollbar-width:none]">
        <Chip active={bucket === "all"} onClick={() => onBucket("all")} label="all" />
        {BUCKETS.map((b) => (
          <Chip
            key={b}
            active={bucket === b}
            onClick={() => onBucket(bucket === b ? "all" : b)}
            label={CHIP_LABEL[b]}
            bucket={b}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 pb-3">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEnter()}
            placeholder="Search titles, tags, summaries…"
            className="w-full bg-inset border border-hairline rounded-lg pl-3 pr-8 py-2 mono text-[13px] outline-none focus:border-accent placeholder:text-faint"
          />
          {query && (
            <button
              onClick={() => onQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink mono text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => onSort(sort === "newest" ? "oldest" : "newest")}
          className="mono text-[11px] uppercase tracking-wide text-dim hover:text-ink whitespace-nowrap"
        >
          {sort === "newest" ? "newest ↓" : "oldest ↑"}
        </button>
      </div>

      <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint px-3 pb-2">
        {shown === total ? `${total} recordings` : `${shown} of ${total}`}
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  bucket,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  bucket?: Bucket;
}) {
  return (
    <button
      onClick={onClick}
      data-bucket={bucket}
      className={`shrink-0 mono text-[11px] uppercase tracking-wide rounded-full px-3 py-1.5 border transition-colors ${
        active
          ? "border-accent text-ink bg-raised"
          : "border-hairline text-dim hover:text-ink"
      }`}
    >
      {bucket && <span className="bucket-dot inline-block size-1.5 rounded-full mr-1.5 align-middle" />}
      {label}
    </button>
  );
}
