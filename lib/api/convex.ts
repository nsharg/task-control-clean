import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

const url = process.env.NEXT_PUBLIC_CONVEX_URL!;

/**
 * Admits a REST/MCP request: token valid, within its per-minute budget, and
 * the caller's IP not locked out for repeated bad tokens. Returns a Response
 * to send back when refused, or null to go ahead.
 */
export async function admit(req: Request, token: string | null): Promise<Response | null> {
  const deny = (status: number, message: string, retryAfter?: number) =>
    new Response(JSON.stringify({ error: { code: status === 429 ? "rate_limited" : "unauthenticated", message } }), {
      status,
      headers: {
        "content-type": "application/json",
        ...(status === 401 ? { "www-authenticate": 'Bearer realm="task-control"' } : {}),
        ...(retryAfter ? { "retry-after": String(Math.ceil(retryAfter / 1000)) } : {}),
      },
    });
  if (!token) return deny(401, "Send Authorization: Bearer tc_…");
  const ip = (req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
  try {
    const res = await new ConvexHttpClient(url).mutation(api.agent.gate.check, { token, ip, secret: process.env.AUTH_PROXY_SECRET ?? "" });
    if (res.ok) return null;
    if (res.status === 429) return deny(429, "Too many requests. Slow down.", res.retryAfter);
    return deny(res.status, res.status === 401 ? "Invalid or expired token." : "Forbidden.");
  } catch (e) {
    console.error("[api] gate failed", e instanceof Error ? e.message : e);
    return deny(503, "Temporarily unavailable.");
  }
}

/** Pulls the bearer token off a request. Tokens look like `tc_…`. */
export function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(tc_[A-Za-z0-9_-]{40,64})$/.exec(h.trim());
  return m?.[1] ?? null;
}

type AgentFn<K extends "query" | "mutation"> = FunctionReference<K, "public", { token: string } & Record<string, unknown>>;

/** Calls Convex agent functions as the token's agent. Convex does all authorization. */
export function agentClient(token: string) {
  const client = new ConvexHttpClient(url);
  return {
    query: <F extends AgentFn<"query">>(fn: F, args: Omit<FunctionArgs<F>, "token">): Promise<FunctionReturnType<F>> =>
      client.query(fn as FunctionReference<"query">, { ...args, token }) as Promise<FunctionReturnType<F>>,
    mutation: <F extends AgentFn<"mutation">>(fn: F, args: Omit<FunctionArgs<F>, "token">): Promise<FunctionReturnType<F>> =>
      client.mutation(fn as FunctionReference<"mutation">, { ...args, token }) as Promise<FunctionReturnType<F>>,
  };
}
export type AgentClient = ReturnType<typeof agentClient>;

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  cycle: 400,
  managed: 409,
  archived: 409,
  conflict: 409,
  rate_limited: 429,
};

/** A Convex failure as `{ status, code, message }`, without leaking internals. */
export function describeError(e: unknown) {
  if (e instanceof ConvexError) {
    const d = e.data as { code?: string; message?: string };
    return { status: STATUS[d.code ?? ""] ?? 400, code: d.code ?? "error", message: d.message ?? "Request failed." };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/ArgumentValidationError|Validator error/.test(msg)) {
    const detail = /Validator error: (.*)/.exec(msg)?.[1] ?? "Invalid arguments.";
    return { status: 400, code: "invalid", message: detail.slice(0, 500) };
  }
  console.error("[api] unexpected error", msg);
  return { status: 500, code: "internal", message: "Something went wrong." };
}
