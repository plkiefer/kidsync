import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  try {
    // This refreshes the auth session cookies on every matched request.
    // Without this, hard refresh on /calendar gets stale cookies and
    // the client-side getSession() never resolves.
    const supabase = createMiddlewareClient({ req, res });
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Redirect authenticated users away from /login
    if (session && req.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/calendar", req.url));
    }
  } catch {
    // If middleware auth fails, let the page handle it client-side
  }

  return res;
}

export const config = {
  matcher: ["/calendar/:path*", "/login"],
};
