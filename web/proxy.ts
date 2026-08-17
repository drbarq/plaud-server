import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL ?? "j.tustin@gmail.com").toLowerCase();

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  const authed = !!data.user && email === ALLOWED_EMAIL;
  const isSignin = request.nextUrl.pathname.startsWith("/signin");

  if (!authed && !isSignin) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (authed && isSignin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // everything except static assets and PWA plumbing
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|icon-512.png).*)"],
};
