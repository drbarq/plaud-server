"use server";

import { ALLOWED_EMAIL, supabaseServer } from "@/lib/auth";

type Result = { ok: true } | { ok: false; error: string };

export async function requestOtp(email: string): Promise<Result> {
  if (email.toLowerCase() !== ALLOWED_EMAIL) {
    return { ok: false, error: "This is a single-user system." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyOtp(email: string, token: string): Promise<Result> {
  if (email.toLowerCase() !== ALLOWED_EMAIL) {
    return { ok: false, error: "This is a single-user system." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
