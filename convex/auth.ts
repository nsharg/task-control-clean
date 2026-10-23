import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { clientIp } from "./lib/security";
import { isSuperAdminEmail } from "./lib/superAdmin";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3200";

export const authComponent = createClient<DataModel>(components.betterAuth);

/** Present when Better Auth runs inside an HTTP action (sign-in, sign-up, …). */
const asAction = (ctx: GenericCtx<DataModel>) => ("runMutation" in ctx && "runAction" in ctx ? (ctx as ActionCtx) : null);

/**
 * Accounts are made by the super admin (see admin.ts), never by visitors.
 * The one exception is the very first sign-up by a super-admin email, to
 * bootstrap the deployment; after that the sign-up endpoint accepts nobody.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    appName: "Task Control",
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      // No email in the beta: admins hand out credentials, so there is nothing to verify by mail.
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 30,
      customRules: {
        // Read-only session plumbing fires in parallel on every page load.
        "/get-session": false,
        "/convex/token": false,
        "/convex/jwks": false,
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 3 },
        "/change-password": { window: 300, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: siteUrl.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // Vercel sets these; locally there is none and limits fall back to one bucket.
      ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip"] },
    },
    hooks: {
      before: createAuthMiddleware(async (c) => {
        const action = asAction(ctx);
        if (!action) return;
        // Per-account throttle on top of Better Auth's per-IP limits, so rotating
        // (or spoofing) IPs does not buy more guesses against one account.
        if (c.path === "/sign-in/email" || c.path === "/sign-up/email") {
          const email = String((c.body as { email?: unknown })?.email ?? "").trim().toLowerCase();
          if (email) {
            const ok = await action.runMutation(internal.admin.consumeSignInAttempt, { email });
            if (!ok) {
              await action.runMutation(internal.monitor.record, { kind: "sign_in_throttled", email, ip: clientIp(c.headers) });
              throw new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again in 15 minutes." });
            }
          }
        }
      }),
      after: createAuthMiddleware(async (c) => {
        const action = asAction(ctx);
        if (action && c.path === "/sign-in/email" && c.context.returned instanceof APIError) {
          const email = String((c.body as { email?: unknown })?.email ?? "").trim().toLowerCase();
          const status = c.context.returned.statusCode;
          // 403 is a disabled account (recorded by the session hook); 429 is recorded above.
          if (status === 401) await action.runMutation(internal.monitor.record, { kind: "sign_in_failed", email, ip: clientIp(c.headers) });
        }
        // A successful password change clears the "change your password" flag.
        const userId = c.context.session?.user.id;
        if (action && c.path === "/change-password" && userId && !(c.context.returned instanceof APIError)) {
          await action.runMutation(internal.admin.clearMustChangePassword, { userId });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, endpoint) => {
            // Admin-created users come through the internal adapter (no endpoint).
            if (!endpoint) return;
            const action = asAction(ctx);
            const email = String(user.email).toLowerCase();
            const allowed =
              endpoint.path === "/sign-up/email" &&
              isSuperAdminEmail(email) &&
              !!action &&
              !(await action.runQuery(internal.admin.anyUserExists, { email }));
            if (!allowed) {
              await action?.runMutation(internal.monitor.record, { kind: "sign_up_rejected", email, ip: clientIp(endpoint.headers) });
              throw new APIError("FORBIDDEN", { message: "Accounts are created by an administrator." });
            }
          },
        },
      },
      session: {
        create: {
          // Disabled accounts cannot start a session at all.
          before: async (session, endpoint) => {
            const action = asAction(ctx);
            if (action && (await action.runQuery(internal.admin.isDisabled, { userId: session.userId as string }))) {
              const email = String((endpoint?.body as { email?: unknown } | undefined)?.email ?? "") || undefined;
              await action.runMutation(internal.monitor.record, { kind: "sign_in_disabled", email, ip: clientIp(endpoint?.headers), detail: String(session.userId) });
              throw new APIError("FORBIDDEN", { message: "This account is disabled." });
            }
          },
        },
      },
    },
    plugins: [convex({ authConfig })],
  });

/** The signed-in user, or null. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return {
      id: user._id as string,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
    };
  },
});
