"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function ContextEditor() {
  const [aboutMd, setAboutMd] = useState("");
  const [keyterms, setKeyterms] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    fetch("/api/context")
      .then((r) => r.json())
      .then((d) => {
        setAboutMd(d.aboutMd);
        setKeyterms((d.keyterms ?? []).join("\n"));
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  async function save() {
    setState("saving");
    const res = await fetch("/api/context", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        aboutMd,
        keyterms: keyterms.split("\n").map((k) => k.trim()).filter(Boolean),
      }),
    });
    setState(res.ok ? "saved" : "error");
    if (res.ok) setTimeout(() => setState("ready"), 1500);
  }

  return (
    <main className="min-h-dvh max-w-3xl mx-auto px-5 py-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="mono text-xs uppercase tracking-[0.14em] text-dim hover:text-ink">
            ← Threads
          </Link>
          <h1 className="text-2xl italic mt-2">Speaker context</h1>
          <p className="text-sm text-dim mt-1">
            The routine reads <span className="mono">about</span> before every classification;
            keyterms ride along on every Deepgram transcription. No redeploys — edits apply
            to the next recording.
          </p>
        </div>
      </header>

      {state === "loading" ? (
        <p className="mono text-sm text-dim">Loading…</p>
      ) : (
        <div className="space-y-8">
          <section>
            <label className="mono block text-xs uppercase tracking-[0.14em] text-dim mb-2">
              about.md
            </label>
            <textarea
              value={aboutMd}
              onChange={(e) => setAboutMd(e.target.value)}
              rows={22}
              className="w-full bg-inset border border-hairline rounded-lg px-4 py-3 text-sm leading-relaxed outline-none focus:border-accent font-serif"
            />
          </section>
          <section>
            <label className="mono block text-xs uppercase tracking-[0.14em] text-dim mb-2">
              keyterms — one per line ({keyterms.split("\n").filter((k) => k.trim()).length})
            </label>
            <textarea
              value={keyterms}
              onChange={(e) => setKeyterms(e.target.value)}
              rows={12}
              className="w-full bg-inset border border-hairline rounded-lg px-4 py-3 mono text-sm outline-none focus:border-accent"
            />
          </section>
          <div className="flex items-center gap-4">
            <button
              onClick={save}
              disabled={state === "saving"}
              className="rounded-lg bg-accent text-accent-ink px-6 py-2.5 mono text-sm font-semibold disabled:opacity-50"
            >
              {state === "saving" ? "Saving…" : "Save"}
            </button>
            {state === "saved" && <span className="mono text-xs text-dim">Saved.</span>}
            {state === "error" && <span className="mono text-xs text-danger">Failed — retry.</span>}
          </div>
        </div>
      )}
    </main>
  );
}
