/**
 * Base path the app is mounted at. Set via NEXT_PUBLIC_BASE_PATH env var (e.g.
 * "/kidsync" for the niffty-ramen.com/kidsync deploy). Empty string in local
 * dev so URLs stay clean at http://localhost:3000.
 *
 * Use this for:
 *   - `fetch()` calls to internal API routes
 *   - Manually-built absolute URLs (ical feed, magic-link redirects)
 *
 * DO NOT use for `<Link>` or `useRouter().push/replace` — Next.js prepends
 * the configured basePath there automatically, so doubling it breaks routing.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Prepend BASE_PATH to an absolute path (idempotent if BASE_PATH is empty). */
export const withBasePath = (path: string): string => `${BASE_PATH}${path}`;
