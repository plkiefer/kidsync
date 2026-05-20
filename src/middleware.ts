import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BASE_PATH } from "@/lib/basePath";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin path so middleware-set cookies (refresh on each
      // request) land at the same path as browser-side cookies and
      // signOut deletions. See src/lib/supabase.ts for rationale.
      cookieOptions: { path: "/" },
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          );
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, { ...options, path: "/" })
          );
        },
      },
    }
  );

  // Refresh the session — this updates cookies on the response
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect authenticated users away from /login.
  // NextResponse.redirect does NOT auto-prepend basePath, so we include it
  // manually. Without the prefix, this redirects to e.g.
  // https://niffty-ramen.com/calendar (no /kidsync) which 404s.
  if (user && req.nextUrl.pathname === "/login") {
    const calendarUrl = new URL(`${BASE_PATH}/calendar`, req.url);
    return NextResponse.redirect(calendarUrl);
  }

  return res;
}

export const config = {
  matcher: ["/login"],
};
