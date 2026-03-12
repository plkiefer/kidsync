"use client";

/**
 * Manually refresh the Supabase auth token by calling the token endpoint
 * directly with fetch(). This bypasses the Supabase JS client's internal
 * token refresh which can hang when the access token is expired.
 *
 * Returns the new session data if successful, or null if failed.
 */
export async function manualTokenRefresh(): Promise<{
  access_token: string;
  refresh_token: string;
  user: any;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookiePrefix = `sb-${projectRef}-auth-token`;

  // Read session from cookie(s) — handle both single and chunked formats
  const allCookies = document.cookie.split(";").map((c) => c.trim());
  let rawValue = "";

  // Try single cookie first
  const single = allCookies.find((c) => c.startsWith(cookiePrefix + "="));
  if (single) {
    rawValue = single.substring(cookiePrefix.length + 1);
  } else {
    // Try chunked: sb-xxx-auth-token.0, .1, .2 ...
    const chunks: string[] = [];
    for (let i = 0; ; i++) {
      const chunkName = `${cookiePrefix}.${i}=`;
      const chunk = allCookies.find((c) => c.startsWith(chunkName));
      if (!chunk) break;
      chunks.push(chunk.substring(chunkName.length));
    }
    if (chunks.length === 0) return null;
    rawValue = chunks.join("");
  }

  // Decode cookie value
  let sessionData: any;
  try {
    const decoded = decodeURIComponent(rawValue);
    if (decoded.startsWith("base64-")) {
      sessionData = JSON.parse(atob(decoded.slice(7)));
    } else {
      sessionData = JSON.parse(decoded);
    }
  } catch {
    console.error("[refreshToken] failed to parse cookie");
    return null;
  }

  const refreshToken = sessionData?.refresh_token;
  if (!refreshToken) {
    console.error("[refreshToken] no refresh_token in cookie");
    return null;
  }

  // Call Supabase auth token endpoint directly
  try {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (!response.ok) {
      console.error("[refreshToken] refresh failed:", response.status);
      return null;
    }

    const data = await response.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
    };
  } catch (err) {
    console.error("[refreshToken] fetch error:", err);
    return null;
  }
}
