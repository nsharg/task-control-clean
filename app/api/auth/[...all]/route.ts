/**
 * Forwards Better Auth requests to Convex, adding the shared secret that the
 * Convex auth routes require for anything but reads (see convex/http.ts).
 * Everything reaching here already passed the geo rule in proxy.ts.
 */
const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;

async function forward(req: Request) {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  for (const h of ["transfer-encoding", "content-length", "connection", "x-tc-proxy-secret"]) headers.delete(h);
  headers.set("accept-encoding", "application/json");
  headers.set("host", new URL(convexSite).host);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));
  headers.set("x-better-auth-forwarded-host", url.host);
  headers.set("x-better-auth-forwarded-proto", url.protocol.replace(/:$/, ""));
  if (process.env.AUTH_PROXY_SECRET) headers.set("x-tc-proxy-secret", process.env.AUTH_PROXY_SECRET);

  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.arrayBuffer();
    if (body.byteLength > 64 * 1024) return new Response(JSON.stringify({ message: "Request too large." }), { status: 413 });
    if (body.byteLength) init.body = body;
  }
  return fetch(`${convexSite}${url.pathname}${url.search}`, init);
}

export { forward as GET, forward as POST };
