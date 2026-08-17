"use client";

import type { Health } from "@/lib/types";

export function HealthBanner({ health }: { health: Health }) {
  if (health.reauthRequired) {
    return (
      <Banner tone="danger">
        Plaud re-auth required — run <span className="mono">plaud login</span> and re-seed
        credentials. Sync is stopped.
      </Banner>
    );
  }
  if (health.deadLettered.length > 0) {
    return (
      <Banner tone="warn">
        {health.deadLettered.length} recording{health.deadLettered.length > 1 ? "s" : ""} gave up
        after 5 retries: {health.deadLettered.map((d) => d.name).join("; ").slice(0, 120)}
      </Banner>
    );
  }
  if (health.lastErrors.length > 0) {
    return (
      <Banner tone="warn">
        Last sync had {health.lastErrors.length} error{health.lastErrors.length > 1 ? "s" : ""}:{" "}
        <span className="mono text-[11px]">{health.lastErrors[0].slice(0, 100)}</span>
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className="shrink-0 px-4 py-2 text-[13px] border-b"
      style={{
        borderColor: tone === "danger" ? "var(--danger)" : "var(--accent)",
        color: tone === "danger" ? "var(--danger)" : "var(--accent)",
        background: "color-mix(in oklch, var(--bg-raised) 85%, transparent)",
      }}
    >
      {children}
    </div>
  );
}
