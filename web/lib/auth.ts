import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL ?? "j.tustin@gmail.com").toLowerCase();

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try {
            all.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from an RSC render — middleware refreshes sessions instead
          }
        },
      },
    },
  );
}

/** The single gate every server path goes through. Returns the user or null.
 * Any identity other than ALLOWED_EMAIL is treated as unauthenticated. */
export async function currentUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!data.user || email !== ALLOWED_EMAIL) return null;
  return data.user;
}
