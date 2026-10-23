/**
 * The front door for REST and MCP. The Next.js routes call `check` once per
 * request, before the real function. A valid token draws from its per-minute
 * budget. An invalid one counts against the caller's IP, and that IP is shut
 * out for a while after repeated misses. The token itself is 256 bits, so
 * guessing is hopeless; this keeps noise down and feeds the monitor.
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAgent } from "../lib/access";
import { rateLimiter } from "../lib/rateLimits";
import { recordEvent } from "../lib/security";

export const check = mutation({
  args: { token: v.string(), ip: v.optional(v.string()), secret: v.string() },
  handler: async (ctx, { token, ip, secret }): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 429; retryAfter?: number }> => {
    // Only the app's own routes know this; direct callers can't use the gate to probe.
    if (!process.env.AUTH_PROXY_SECRET || secret !== process.env.AUTH_PROXY_SECRET) return { ok: false, status: 403 };
    const ipKey = ip || "unknown";
    const blocked = await rateLimiter.check(ctx, "badTokenPerIp", { key: ipKey });
    if (!blocked.ok) return { ok: false, status: 429, retryAfter: blocked.retryAfter };
    let tokenId: string;
    try {
      tokenId = (await requireAgent(ctx, token)).tokenId;
    } catch {
      await rateLimiter.limit(ctx, "badTokenPerIp", { key: ipKey });
      await recordEvent(ctx, "bad_token", { ip, detail: token.slice(0, 7) });
      return { ok: false, status: 401 };
    }
    const budget = await rateLimiter.limit(ctx, "agentRequest", { key: tokenId });
    if (!budget.ok) {
      await recordEvent(ctx, "token_rate_limited", { ip, detail: tokenId });
      return { ok: false, status: 429, retryAfter: budget.retryAfter };
    }
    return { ok: true };
  },
});
