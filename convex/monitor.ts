/**
 * Security monitoring. Auth hooks and the agent gate record events; every five
 * minutes `scan` compares recent counts with thresholds and raises alerts. An
 * alert shows in /admin and, when ALERT_WEBHOOK_URL is set, is posted there
 * (Slack- and Discord-compatible JSON). Events are kept 30 days.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { requireSuperAdmin } from "./lib/access";
import { userMutation, userQuery } from "./lib/functions";
import { recordEvent } from "./lib/security";
import schema from "./schema";

const WINDOW = 15 * 60 * 1000;
const REALERT_AFTER = 60 * 60 * 1000;
const KEEP = 30 * 24 * 60 * 60 * 1000;

export const record = internalMutation({
  args: {
    kind: schema.tables.securityEvents.validator.fields.kind,
    ip: v.optional(v.string()),
    email: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { kind, ...e }) => recordEvent(ctx, kind, e),
});

type Rule = { kind: string; severity: "warning" | "critical"; check: (e: Ev[]) => string | null };
type Ev = { kind: string; ip?: string; email?: string };

const countBy = (evs: Ev[], key: "ip" | "email") => {
  const m = new Map<string, number>();
  for (const e of evs) if (e[key]) m.set(e[key]!, (m.get(e[key]!) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** What counts as worth waking someone up for, per 15 minutes. */
const RULES: Rule[] = [
  {
    kind: "brute_force_account",
    severity: "critical",
    check: (e) => {
      const top = countBy(e.filter((x) => x.kind === "sign_in_failed" || x.kind === "sign_in_throttled"), "email")[0];
      return top && top[1] >= 8 ? `${top[1]} failed or throttled sign-ins for ${top[0]} in 15 minutes.` : null;
    },
  },
  {
    kind: "password_spraying",
    severity: "critical",
    check: (e) => {
      const failed = e.filter((x) => x.kind === "sign_in_failed");
      const accounts = new Set(failed.map((x) => x.email)).size;
      return failed.length >= 20 && accounts >= 5 ? `${failed.length} failed sign-ins across ${accounts} accounts in 15 minutes.` : null;
    },
  },
  {
    kind: "failed_sign_ins",
    severity: "warning",
    check: (e) => {
      const n = e.filter((x) => x.kind === "sign_in_failed").length;
      return n >= 10 ? `${n} failed sign-ins in 15 minutes.` : null;
    },
  },
  {
    kind: "disabled_account_use",
    severity: "warning",
    check: (e) => {
      const hits = e.filter((x) => x.kind === "sign_in_disabled");
      return hits.length ? `Disabled account${hits.length > 1 ? "s" : ""} tried to sign in: ${[...new Set(hits.map((h) => h.email))].join(", ")}.` : null;
    },
  },
  {
    kind: "sign_up_probing",
    severity: "warning",
    check: (e) => {
      const n = e.filter((x) => x.kind === "sign_up_rejected").length;
      return n >= 3 ? `${n} rejected sign-up attempts in 15 minutes.` : null;
    },
  },
  {
    kind: "bad_tokens",
    severity: "critical",
    check: (e) => {
      const bad = e.filter((x) => x.kind === "bad_token");
      const top = countBy(bad, "ip")[0];
      return bad.length >= 10 ? `${bad.length} API calls with invalid tokens in 15 minutes${top ? ` (most from ${top[0]})` : ""}.` : null;
    },
  },
  {
    kind: "token_rate_limited",
    severity: "warning",
    check: (e) => {
      const n = e.filter((x) => x.kind === "token_rate_limited").length;
      return n >= 5 ? `An API token hit its rate limit ${n} times in 15 minutes.` : null;
    },
  },
  {
    kind: "proxy_bypass",
    severity: "critical",
    check: (e) => {
      const hits = e.filter((x) => x.kind === "proxy_secret_missing");
      const top = countBy(hits, "ip")[0];
      return hits.length ? `${hits.length} auth requests tried to skip the app and hit Convex directly${top ? ` (from ${top[0]})` : ""}.` : null;
    },
  },
];

export const recent = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const events = await ctx.db.query("securityEvents").withIndex("by_at", (q) => q.gt("at", since)).take(5000);
    const lastAlerts = await ctx.db.query("alerts").withIndex("by_at", (q) => q.gt("at", Date.now() - REALERT_AFTER)).collect();
    return { events: events.map((e) => ({ kind: e.kind, ip: e.ip, email: e.email })), alerted: [...new Set(lastAlerts.map((a) => a.kind))] };
  },
});

export const raise = internalMutation({
  args: { kind: v.string(), severity: v.union(v.literal("warning"), v.literal("critical")), message: v.string() },
  handler: (ctx, a) => ctx.db.insert("alerts", { ...a, at: Date.now(), delivered: false }),
});

export const markDelivered = internalMutation({
  args: { id: v.id("alerts") },
  handler: (ctx, { id }) => ctx.db.patch(id, { delivered: true }),
});

export const scan = internalAction({
  args: {},
  handler: async (ctx) => {
    const { events, alerted } = await ctx.runQuery(internal.monitor.recent, { since: Date.now() - WINDOW });
    for (const rule of RULES) {
      if (alerted.includes(rule.kind)) continue;
      const message = rule.check(events);
      if (!message) continue;
      const id = await ctx.runMutation(internal.monitor.raise, { kind: rule.kind, severity: rule.severity, message });
      const url = process.env.ALERT_WEBHOOK_URL;
      if (!url) continue;
      const text = `${rule.severity === "critical" ? "🔴" : "🟠"} Task Control security alert: ${message}\nReview: ${process.env.SITE_URL ?? ""}/admin`;
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }) });
        if (res.ok) await ctx.runMutation(internal.monitor.markDelivered, { id });
        else console.error(`[monitor] webhook returned ${res.status}`);
      } catch (e) {
        console.error("[monitor] webhook failed", e instanceof Error ? e.message : e);
      }
    }
  },
});

export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("securityEvents").withIndex("by_at", (q) => q.lt("at", Date.now() - KEEP)).take(2000);
    for (const e of old) await ctx.db.delete(e._id);
    const oldAlerts = await ctx.db.query("alerts").withIndex("by_at", (q) => q.lt("at", Date.now() - 4 * KEEP)).take(500);
    for (const a of oldAlerts) await ctx.db.delete(a._id);
  },
});

// ---------- admin console ----------

export const overview = userQuery({
  args: {},
  handler: async (ctx) => {
    requireSuperAdmin(ctx.actor);
    const alerts = await ctx.db.query("alerts").withIndex("by_at").order("desc").take(50);
    const events = await ctx.db.query("securityEvents").withIndex("by_at").order("desc").take(100);
    const day = Date.now() - 24 * 60 * 60 * 1000;
    const last24 = await ctx.db.query("securityEvents").withIndex("by_at", (q) => q.gt("at", day)).take(5000);
    const counts: Record<string, number> = {};
    for (const e of last24) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    return {
      webhook: !!process.env.ALERT_WEBHOOK_URL,
      counts,
      alerts: alerts.map((a) => ({ id: a._id, at: a.at, kind: a.kind, severity: a.severity, message: a.message, acknowledged: !!a.acknowledgedAt, delivered: a.delivered })),
      events: events.map((e) => ({ id: e._id, at: e.at, kind: e.kind, ip: e.ip ?? null, email: e.email ?? null, detail: e.detail ?? null })),
    };
  },
});

export const acknowledge = userMutation({
  args: { id: v.optional(v.id("alerts")) },
  handler: async (ctx, { id }) => {
    requireSuperAdmin(ctx.actor);
    const rows = id ? [await ctx.db.get(id)] : await ctx.db.query("alerts").withIndex("by_at").order("desc").take(200);
    for (const a of rows) if (a && !a.acknowledgedAt) await ctx.db.patch(a._id, { acknowledgedAt: Date.now() });
  },
});
