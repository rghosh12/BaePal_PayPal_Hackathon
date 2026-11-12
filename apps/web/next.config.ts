import type { NextConfig } from "next";
// Render's private-network `hostport` has no scheme; accept both forms.
const rawApi = process.env.API_ORIGIN || "http://127.0.0.1:4000";
process.env.API_ORIGIN = /^https?:\/\//.test(rawApi)
  ? rawApi
  : `http://${rawApi}`;
const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/api/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/socket.io/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
