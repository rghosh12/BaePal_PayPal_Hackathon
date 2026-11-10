import {
  html,
  css,
  client,
  scriptPath,
  cssPath,
  portraits,
} from "baepal:assets";
import { handleAPI } from "./api";
import type { Env } from "./types";
const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
};
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname.startsWith("/api/v1"))
      response = await handleAPI(request, env);
    else if (url.pathname === scriptPath)
      response = new Response(client, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public,max-age=31536000,immutable",
        },
      });
    else if (url.pathname === cssPath)
      response = new Response(css, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public,max-age=31536000,immutable",
        },
      });
    else if (portraits[url.pathname])
      response = new Response(portraits[url.pathname], {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public,max-age=3600",
        },
      });
    else if (url.pathname.startsWith("/socket.io/"))
      response = Response.json(
        { error: { message: "Hosted prototype uses authorized polling." } },
        { status: 404 },
      );
    else
      response = new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers))
      result.headers.set(key, value);
    return result;
  },
};
