import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — this updates cookies on the response
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect authenticated users away from /login
  if (user && req.nextUrl.pathname === "/login") {
    const calendarUrl = new URL("/calendar", req.url);
    return NextResponse.redirect(calendarUrl);
  }

  return res;
}

export const config = {
  matcher: ["/login"],
};
