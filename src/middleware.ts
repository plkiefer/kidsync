import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If no session and trying to access protected routes, redirect to login
  if (!session && req.nextUrl.pathname.startsWith("/calendar")) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // If session and trying to access login, redirect to calendar
  if (session && req.nextUrl.pathname === "/login") {
    const calendarUrl = new URL("/calendar", req.url);
    return NextResponse.redirect(calendarUrl);
  }

  return res;
}

export const config = {
  matcher: ["/calendar/:path*", "/login"],
};
