/** Uptime check for external monitors: the web app and the Convex backend both answer. */
export async function GET() {
  const started = Date.now();
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    return Response.json({ ok: true, backendMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
