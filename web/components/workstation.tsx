"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Bucket, Health, PlateLink, Recording } from "@/lib/types";
import { RecordingList } from "./recording-list";
import { DetailPane } from "./detail-pane";
import { Toolbar } from "./toolbar";
import { HealthBanner } from "./health-banner";
import { SyncButton } from "./sync-button";
import { IdeasList } from "./ideas-list";
import { MindPlate } from "./mind-plate";
import { usePlayback } from "./use-playback";

export type SortMode = "newest" | "oldest";
type Tab = "memos" | "mind" | "ideas";

export function Workstation({ recordings, health, links }: { recordings: Recording[]; health: Health; links: PlateLink[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("memos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const playback = usePlayback();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  useEffect(() => {
    if (selectedId && !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(null);
      setMobileView("list");
    }
  }, [recordings, selectedId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of recordings) c[r.bucket] = (c[r.bucket] ?? 0) + 1;
    return c;
  }, [recordings]);

  const ideaCount = useMemo(
    () => recordings.reduce((n, r) => n + r.threads.filter((t) => t.contentIdea).length, 0),
    [recordings],
  );

  const threadTotal = useMemo(
    () => recordings.reduce((n, r) => n + r.threads.length, 0),
    [recordings],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = recordings;
    if (bucket !== "all") list = list.filter((r) => r.bucket === bucket);
    if (q) {
      list = list.filter((r) =>
        [r.title ?? "", r.name, r.snippet, r.tags.join(" "), r.threads.map((t) => `${t.label} ${t.entities.join(" ")}`).join(" ")]
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
    setTab("memos");
    setSelectedId(id);
    setMobileView("detail");
  }, []);

  const syncedAgo = health.lastSyncAt
    ? new Date(health.lastSyncAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "NEVER";

  return (
    <div className="h-dvh flex flex-col">
      {/* health strip */}
      <div className="shrink-0 flex items-center gap-2 px-[18px] pt-3 pb-2.5" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <span className="size-[5px] rounded-full bg-accent rec-pulse shrink-0" />
        <span className="mono text-[9px] tracking-[0.16em] uppercase flex-1" style={{ color: "oklch(0.520 0.016 73)" }}>
          SYNCED {syncedAgo} · {threadTotal} THREADS INDEXED
        </span>
        <SyncButton lastSyncAt={health.lastSyncAt} onSynced={() => router.refresh()} />
      </div>

      <HealthBanner health={health} />

      {/* wordmark + tabs */}
      <div className="shrink-0 flex items-end px-[18px] pt-4 pb-0 gap-4">
        <span className="mono text-[12px] font-semibold tracking-[0.34em] mr-auto pb-3.5" style={{ color: "var(--ink)" }}>
          THREADS
        </span>
        <TabButton active={tab === "memos"} onClick={() => setTab("memos")}>MEMOS</TabButton>
        <TabButton active={tab === "mind"} onClick={() => setTab("mind")}>MIND</TabButton>
        <TabButton active={tab === "ideas"} onClick={() => setTab("ideas")}>IDEAS · {ideaCount}</TabButton>
        <Link
          href="/context"
          className="mono text-[11px] font-medium tracking-[0.2em] pb-3.5"
          style={{ color: "var(--ink-mute)" }}
        >
          CTX
        </Link>
      </div>

      {tab === "mind" ? (
        <MindPlate recordings={recordings} links={links} onOpen={select} />
      ) : tab === "ideas" ? (
        <IdeasList recordings={recordings} onOpen={select} />
      ) : (
        <div className="flex-1 min-h-0 lg:grid lg:grid-cols-3">
          <div
            className={`h-full min-h-0 flex-col lg:flex lg:col-span-1 ${mobileView === "list" ? "flex" : "hidden"}`}
            style={{ borderRight: "1px solid var(--hairline-panel)" }}
          >
            <Toolbar
              bucket={bucket}
              onBucket={setBucket}
              counts={counts}
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

          <div className={`h-full min-h-0 overflow-y-auto lg:block lg:col-span-2 ${mobileView === "detail" ? "block" : "hidden"}`}>
            <DetailPane
              recording={selected}
              recordings={recordings}
              playback={playback}
              onBack={() => setMobileView("list")}
              onOpenRecording={select}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mono text-[11px] font-medium tracking-[0.2em] pb-[13px]"
      style={{
        color: active ? "var(--ink-title)" : "var(--ink-mute)",
        borderBottom: `1px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}
