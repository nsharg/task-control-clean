import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type schema from "../schema";

type Kind = Infer<(typeof schema)["tables"]["securityEvents"]["validator"]>["kind"];

/** The client IP as Vercel reports it. Trusted only on requests that came through the app. */
export function clientIp(headers: Headers | undefined | null) {
  const raw = headers?.get("x-vercel-forwarded-for") ?? headers?.get("x-real-ip") ?? headers?.get("x-forwarded-for") ?? "";
  return raw.split(",")[0].trim().slice(0, 64) || undefined;
}

export async function recordEvent(ctx: MutationCtx, kind: Kind, e: { ip?: string; email?: string; detail?: string } = {}) {
  await ctx.db.insert("securityEvents", {
    at: Date.now(),
    kind,
    ip: e.ip,
    email: e.email?.toLowerCase().slice(0, 254),
    detail: e.detail?.slice(0, 500),
  });
}
