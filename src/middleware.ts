import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // Refresh the session so cookies stay valid
  await supabase.auth.getSession();

  // The calendar page handles its own auth guard client-side (useAuth hook).
  // We only use middleware to redirect authenticated users away from /login.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session && req.nextUrl.pathname === "/login") {
    const calendarUrl = new URL("/calendar", req.url);
    return NextResponse.redirect(calendarUrl);
  }

  return res;
}

export const config = {
  matcher: ["/calendar/:path*", "/login"],
};
