import type { NextConfig } from "next";

// The site has no backend of its own — no API routes, no env-configured
// secrets, no database calls (confirmed by audit before this file was
// written). These headers are the actual remaining security surface: they
// don't protect data the app doesn't hold, but they do close off
// clickjacking, MIME-sniffing, and third-party embedding by default, and
// give a real (if currently permissive-by-necessity, see below) baseline
// to tighten once real embedded media/analytics are chosen.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    // next/font self-hosts Fraunces/Inter at build time (see app/layout.tsx)
    // — no runtime request to fonts.googleapis.com exists, so this CSP
    // doesn't need to allow it. Tighten default-src further once a real
    // analytics/embed provider is chosen (Stage 30).
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://upload.wikimedia.org",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Phase 4 visual prototype: a small number of temporary, properly
    // licensed demo photos are hotlinked from Wikimedia Commons (see
    // DEMO_MEDIA in lib/media.ts) so the site can be experienced with
    // real photography before real P2P media exists. No other remote
    // host is needed or allowed.
    remotePatterns: [{ protocol: "https", hostname: "upload.wikimedia.org" }],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
