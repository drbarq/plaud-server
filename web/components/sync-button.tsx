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
      className="mono text-[11px] font-medium uppercase tracking-[0.16em] px-2.5 py-1.5 transition-colors shrink-0"
      style={{
        border: `1px solid ${state === "error" ? "oklch(0.540 0.190 34 / 0.4)" : "var(--hairline-chip)"}`,
        color: state === "syncing" ? "var(--accent)" : state === "error" ? "var(--danger-ink)" : "var(--ink-mid, oklch(0.440 0.018 70))",
      }}
    >
      {state === "syncing" ? "SYNCING…" : state === "error" ? "RETRY SYNC" : `SYNC · ${ago(lastSyncAt)}`}
    </button>
  );
}
