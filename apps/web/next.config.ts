import type { NextConfig } from "next";
// Accept a bare host:port (no scheme) as well as a full origin.
const rawApi = (process.env.API_ORIGIN || "http://127.0.0.1:4000").replace(
  /\/$/,
  "",
);
const api = /^https?:\/\//.test(rawApi) ? rawApi : `http://${rawApi}`;
const config: NextConfig = {
  poweredByHeader: false,
  // Socket.IO requests `/socket.io/?EIO=…`; a trailing-slash redirect breaks it.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/socket.io/", destination: `${api}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
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
