"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Bucket, Health, Recording } from "@/lib/types";
import { RecordingList } from "./recording-list";
import { DetailPane } from "./detail-pane";
import { Toolbar } from "./toolbar";
import { HealthBanner } from "./health-banner";
import { SyncButton } from "./sync-button";
import { usePlayback } from "./use-playback";
import Link from "next/link";

export type SortMode = "newest" | "oldest";

export function Workstation({ recordings, health }: { recordings: Recording[]; health: Health }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const playback = usePlayback();

  // refresh-on-resume: data refetch only — the cron runs the pipeline (PWA-10)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // reconcile: clear selection if the row vanished after refresh (blueprint gotcha)
  useEffect(() => {
    if (selectedId && !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(null);
      setMobileView("list");
    }
  }, [recordings, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = recordings;
    if (bucket !== "all") list = list.filter((r) => r.bucket === bucket);
    if (q) {
      list = list.filter((r) =>
        [r.title ?? "", r.name, r.snippet, r.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (sort === "oldest") list = [...list].reverse();
    return list;
  }, [recordings, bucket, query, sort]);

  const selected = recordings.find((r) => r.id === selectedId) ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  }, []);

  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div className="h-dvh flex flex-col">
      <header className="shrink-0 border-b border-hairline px-4 lg:px-6 py-3 flex items-center gap-3">
        <span className="size-2.5 rounded-full bg-accent" />
        <h1 className="text-xl italic tracking-tight mr-auto">Threads</h1>
        <Link
          href="/context"
          className="mono text-[11px] uppercase tracking-[0.14em] text-dim hover:text-ink"
        >
          Context
        </Link>
        <SyncButton lastSyncAt={health.lastSyncAt} onSynced={() => router.refresh()} />
      </header>

      <HealthBanner health={health} />

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-3">
        {/* list pane — stays mounted on mobile so scroll/search survive */}
        <div
          ref={listRef}
          className={`h-full min-h-0 flex-col border-r border-hairline lg:flex lg:col-span-1 ${
            mobileView === "list" ? "flex" : "hidden"
          }`}
        >
          <Toolbar
            bucket={bucket}
            onBucket={setBucket}
            query={query}
            onQuery={setQuery}
            sort={sort}
            onSort={setSort}
            shown={filtered.length}
            total={recordings.length}
            onEnter={() => filtered[0] && select(filtered[0].id)}
          />
          <RecordingList
            recordings={filtered}
            selectedId={selectedId}
            onSelect={select}
            grouped={sort === "newest"}
          />
        </div>

        {/* detail pane — sticky scroll column on desktop */}
        <div
          className={`h-full min-h-0 overflow-y-auto lg:block lg:col-span-2 ${
            mobileView === "detail" ? "block" : "hidden"
          }`}
        >
          <DetailPane
            recording={selected}
            playback={playback}
            onBack={() => setMobileView("list")}
          />
        </div>
      </div>
    </div>
  );
}
