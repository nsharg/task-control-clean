import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { agentToken, world } from "./setup";

type Gate = { ok: boolean; status?: number };

process.env.AUTH_PROXY_SECRET = "test-secret";

describe("agent gate", () => {
  test("needs the app's secret", async () => {
    const { t, workspaceId } = await world();
    const token = await agentToken(t, workspaceId, { scopes: ["read"] });
    expect(await t.mutation(api.agent.gate.check, { token, secret: "wrong" })).toEqual({ ok: false, status: 403 });
    expect(await t.mutation(api.agent.gate.check, { token, secret: "test-secret" })).toEqual({ ok: true });
  });

  test("bad tokens are recorded and lock the IP out after 10", async () => {
    const { t } = await world();
    const bad = `tc_${"z".repeat(43)}`;
    for (let i = 0; i < 10; i++) {
      expect(((await t.mutation(api.agent.gate.check, { token: bad, ip: "192.0.2.1", secret: "test-secret" })) as Gate).status).toBe(401);
    }
    expect(((await t.mutation(api.agent.gate.check, { token: bad, ip: "192.0.2.1", secret: "test-secret" })) as Gate).status).toBe(429);
    expect((await t.run((ctx) => ctx.db.query("securityEvents").collect())).filter((e) => e.kind === "bad_token")).toHaveLength(10);
  });
});

describe("monitor", () => {
  test("repeated failed sign-ins on one account raise one critical alert", async () => {
    const { t } = await world();
    for (let i = 0; i < 8; i++) await t.mutation(internal.monitor.record, { kind: "sign_in_failed", email: "victim@example.com", ip: "198.51.100.1" });
    await t.action(internal.monitor.scan, {});
    await t.action(internal.monitor.scan, {});
    const alerts = await t.run((ctx) => ctx.db.query("alerts").collect());
    expect(alerts.map((a) => [a.kind, a.severity])).toContainEqual(["brute_force_account", "critical"]);
    expect(alerts.filter((a) => a.kind === "brute_force_account")).toHaveLength(1);
  });

  test("only the super admin sees the security overview", async () => {
    const { owner, member } = await world();
    await expect(member.as.query(api.monitor.overview, {})).rejects.toThrow();
    expect((await owner.as.query(api.monitor.overview, {})).alerts).toEqual([]);
  });
});
