import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every request:
 * 1. Geography. The app and its sign-in are reachable only from ALLOWED_COUNTRIES
 *    (explicitly configured by the operator), by Vercel's own geo-IP. The agent API (/api/v1, /api/mcp)
 *    and /api/health are open worldwide, so Claude Code and Codex can reach them
 *    from anywhere, including cloud runners; they need a token and are rate-limited.
 * 2. A fresh nonce per page and a strict Content Security Policy. Only scripts
 *    carrying the nonce (Next's own, next-themes) may run.
 * 3. Signed-out visitors go to /sign-in. That is only a convenience: every
 *    Convex function checks the session itself.
 */
const PUBLIC = ["/sign-in", "/sign-up"];
const AGENT_API = ["/api/v1/", "/api/mcp", "/api/health"];
const ALLOWED = (process.env.ALLOWED_COUNTRIES ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);

function blocked(req: NextRequest, country: string | null) {
  const body = req.nextUrl.pathname.startsWith("/api/")
    ? JSON.stringify({ error: { code: "geo_blocked", message: "Not available in your region." } })
    : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not available</title><body style="font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#5d5d5d"><p>Task Control is not available in your region.</p></body>`;
  return new NextResponse(body, {
    status: 403,
    headers: {
      "content-type": req.nextUrl.pathname.startsWith("/api/") ? "application/json" : "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-geo-country": country ?? "unknown",
    },
  });
}

function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // React and Radix set inline style attributes, which nonces cannot cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${convex} ${convex.replace(/^http/, "ws")}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (AGENT_API.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) return NextResponse.next();

  // On Vercel the header is always set; a missing one means we can't tell, so refuse.
  const country = req.headers.get("x-vercel-ip-country");
  if (process.env.VERCEL && (!ALLOWED.length || !country || !ALLOWED.includes(country.toUpperCase()))) return blocked(req, country);
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("better-auth.session_token"));
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
