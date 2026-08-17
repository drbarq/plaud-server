import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, ALLOWED_EMAIL } from "@/lib/auth";

/** Email-link fallback: verifies a token_hash server-side (the @supabase/ssr
 * recommended pattern — no PKCE cookie continuity required, so it survives
 * email-client prefetching). The primary path remains the 6-digit code. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";

  const redirect = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!tokenHash) return redirect("/signin");

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    type: type as "email",
    token_hash: tokenHash,
  });
  if (error) return redirect("/signin");

  // single-user system: any other identity is signed straight back out
  if (data.user?.email?.toLowerCase() !== ALLOWED_EMAIL) {
    await supabase.auth.signOut();
    return redirect("/signin");
  }
  return redirect("/");
}
