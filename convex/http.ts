import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { clientIp } from "./lib/security";

const http = httpRouter();

/**
 * Auth writes (sign-in, sign-up, password change, sign-out) must come through
 * the Next.js app, which adds a shared secret. Calls straight to this
 * deployment would skip the configured geographic restriction and could forge client IPs, so
 * they are refused and recorded. Reads (session, token, JWKS) stay open;
 * Convex itself fetches the JWKS.
 */
const guarded = ((ctx: Parameters<typeof createAuth>[0]) => {
  const auth = createAuth(ctx);
  return {
    ...auth,
    handler: async (req: Request) => {
      const secret = process.env.AUTH_PROXY_SECRET;
      if (secret && req.method !== "GET" && req.headers.get("x-tc-proxy-secret") !== secret) {
        if ("runMutation" in ctx) {
          await ctx.runMutation(internal.monitor.record, {
            kind: "proxy_secret_missing",
            ip: clientIp(req.headers),
            detail: new URL(req.url).pathname,
          });
        }
        return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
      }
      return auth.handler(req);
    },
  };
}) as typeof createAuth;

authComponent.registerRoutes(http, guarded);

/** For uptime monitors: the backend is up and answering. */
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "cache-control": "no-store" } })),
});

export default http;
