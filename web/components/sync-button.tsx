"use client";

import { useState } from "react";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SyncButton({
  lastSyncAt,
  onSynced,
}: {
  lastSyncAt: string | null;
  onSynced: () => void;
}) {
  const [state, setState] = useState<"idle" | "syncing" | "error">("idle");

  async function sync() {
    if (state === "syncing") return;
    setState("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const body = await res.json();
      setState(res.ok && body.ok !== false ? "idle" : "error");
      onSynced();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={sync}
      className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.12em] border border-hairline rounded-full px-3 py-1.5 text-dim hover:text-ink hover:border-accent transition-colors"
    >
      <span
        className={`size-1.5 rounded-full ${
          state === "syncing" ? "bg-accent rec-pulse" : state === "error" ? "bg-danger" : "bg-accent"
        }`}
      />
      {state === "syncing" ? "Syncing…" : state === "error" ? "Retry sync" : `Synced ${ago(lastSyncAt)}`}
    </button>
  );
}
