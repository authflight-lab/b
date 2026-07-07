// Same-origin API proxy (Cloudflare Pages Function).
//
// Why this exists: some Telegram in-app webviews receive a valid cross-origin
// 200 response but drop the Access-Control-Allow-Origin header, producing
// "No 'Access-Control-Allow-Origin' header is present" + net::ERR_FAILED.
// The webview CAN talk to this origin (the whole app loads from it), so we
// route /bt/api/* through here. The browser sees a SAME-ORIGIN request — no
// CORS, no preflight, no ACAO required — and we forward server-to-server to
// the FastAPI backend on Render.
//
// This file is intentionally hardcoded (per /app/ config policy). It matches
// every request under /bt/api/ via the [[path]] catch-all.

// NOTE: Render blocks the raw *.onrender.com subdomain
// (x-render-routing: blocked-render-subdomain), so we target the custom domain.
// This fetch is server-to-server from Cloudflare's edge, so it is NOT affected
// by the Telegram webview's cross-origin header-stripping bug.
const BACKEND = "https://api.partygc.online";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = BACKEND + url.pathname + url.search;

  // Forward request headers, but drop the incoming Host (fetch derives it from
  // the target URL). Preserve the real client IP so the backend's per-IP rate
  // limiter still works instead of seeing only Cloudflare egress IPs.
  const headers = new Headers(request.headers);
  headers.delete("host");
  const clientIP = request.headers.get("cf-connecting-ip");
  if (clientIP) headers.set("X-Forwarded-For", clientIP);

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);

  // Pass the response through unmodified. Keeping body + headers together (the
  // canonical Cloudflare proxy pattern) guarantees content-encoding/length stay
  // consistent with the bytes, so nothing gets corrupted. Same-origin means the
  // backend's CORS headers are simply ignored by the browser — harmless.
  return new Response(upstream.body, upstream);
}
