"use client";

import { useEffect, useRef, useState } from "react";
import { SimTicks } from "./echo-overlay";

export interface SemanticMatch {
  sim: number;
  label: string;
  summaryLine: string | null;
  recordingId: string;
  key: string;
  recordingTitle: string | null;
  bucket: string;
  startedAt: string | null;
  contentIdea: boolean;
}

export function useSemanticSearch(query: string) {
  const [results, setResults] = useState<SemanticMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    abortRef.current?.abort();
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q }),
          signal: ctrl.signal,
        });
        const body = await res.json();
        setResults(body.matches ?? []);
      } catch {
        /* aborted or failed — keep prior results */
      } finally {
        setLoading(false);
      }
    }, 550);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  return { results, loading };
}

export function SemanticResults({
  results,
  loading,
  onOpen,
}: {
  results: SemanticMatch[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (!loading && !results.length) return null;
  return (
    <div className="shrink-0 px-[18px] pb-2" style={{ borderBottom: "1px solid var(--hairline)" }}>
      <div className="rule-row accent" style={{ marginBottom: 6 }}>
        <span className="rr-label">By meaning</span>
        <span className="rr-rule" />
        <span className="rr-count">{loading ? "SEARCHING…" : `${results.length} THREADS`}</span>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {results.slice(0, 6).map((m, i) => (
          <button
            key={`${m.recordingId}-${m.key}-${i}`}
            data-bucket={m.bucket}
            onClick={() => onOpen(m.recordingId)}
            className="block w-full text-left py-2 transition-colors"
            style={{ borderBottom: i < Math.min(results.length, 6) - 1 ? "1px solid var(--hairline-row)" : undefined }}
          >
            <span className="flex items-center gap-2">
              <span className="bucket-dot size-1 rounded-full shrink-0" />
              <SimTicks sim={m.sim} size={6} />
              <span className="mono text-[10px] tracking-[0.12em]" style={{ color: "var(--ink-dim)" }}>
                {m.sim.toFixed(2)}
              </span>
            </span>
            <span className="block italic text-[15.5px] leading-[1.35] mt-1" style={{ color: "var(--ink-title)" }}>
              {m.label}
            </span>
            {m.recordingTitle && (
              <span className="block mono text-[10px] tracking-[0.14em] uppercase mt-1" style={{ color: "var(--ink-idx)" }}>
                {m.recordingTitle.slice(0, 52)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
