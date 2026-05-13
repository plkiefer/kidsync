/** @type {import('next').NextConfig} */
const nextConfig = {
  // Subpath the app is served under. Set via NEXT_PUBLIC_BASE_PATH env var
  // (e.g. "/kidsync" in the Vercel deploy that backs niffty-ramen.com/kidsync).
  // Empty string locally so `npm run dev` keeps the clean http://localhost:3000
  // URLs.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

module.exports = nextConfig;
