"use client";

import { useState } from "react";
import { requestOtp, verifyOtp } from "./actions";

export default function SignIn() {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await requestOtp(email.trim());
    setBusy(false);
    if (res.ok) setStage("code");
    else setError(res.error);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await verifyOtp(email.trim(), code.trim());
    setBusy(false);
    if (res.ok) window.location.href = "/";
    else setError(res.error);
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm rise">
        <div className="flex items-center gap-3 mb-10">
          <span className="size-3 rounded-full bg-accent rec-pulse" />
          <h1 className="text-3xl italic tracking-tight">Threads</h1>
        </div>

        {stage === "email" ? (
          <form onSubmit={submitEmail} className="space-y-4">
            <label className="mono block text-xs uppercase tracking-[0.14em] text-dim">
              Your email
            </label>
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-inset border border-hairline rounded-lg px-4 py-3 mono text-sm outline-none focus:border-accent"
              placeholder="you@example.com"
            />
            <button
              disabled={busy}
              className="w-full rounded-lg bg-accent text-accent-ink py-3 mono text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="space-y-4">
            <label className="mono block text-xs uppercase tracking-[0.14em] text-dim">
              Code sent to {email}
            </label>
            <input
              inputMode="numeric"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-inset border border-hairline rounded-lg px-4 py-3 mono text-xl tracking-[0.5em] text-center outline-none focus:border-accent"
              placeholder="••••••"
            />
            <button
              disabled={busy}
              className="w-full rounded-lg bg-accent text-accent-ink py-3 mono text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Checking…" : "Enter"}
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    </main>
  );
}
