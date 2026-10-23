import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  agentWrite: { kind: "token bucket", rate: 240, period: MINUTE, capacity: 60 },
  // Sign-in attempts per account, whatever IP they come from.
  signInPerAccount: { kind: "token bucket", rate: 10, period: 15 * MINUTE, capacity: 10 },
  userWrite: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 40 },
  // Every REST/MCP request, per token.
  agentRequest: { kind: "token bucket", rate: 600, period: MINUTE, capacity: 120 },
  // Invalid tokens per IP: after 10 in 10 minutes the IP waits.
  badTokenPerIp: { kind: "fixed window", rate: 10, period: 10 * MINUTE },
  tokenCreate: { kind: "fixed window", rate: 20, period: HOUR },
});
