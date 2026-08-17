import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client — server only, used exclusively for Storage signed URLs.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SIGNED_URL_TTL_S = 12 * 60 * 60; // 12h — outlives any listening session (PWA-9)

export async function signAudioUrl(audioPath: string | null): Promise<string | null> {
  if (!audioPath) return null;
  const { data, error } = await supabaseAdmin.storage
    .from("plaud-audio")
    .createSignedUrl(audioPath, SIGNED_URL_TTL_S);
  if (error) return null;
  return data.signedUrl;
}
