import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("hosted pages stay closed until countries are explicitly configured", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALLOWED_COUNTRIES", "");
  const { proxy } = await import("../proxy");
  const response = proxy(new NextRequest("https://example.com/sign-in", { headers: { "x-vercel-ip-country": "US" } }));
  expect(response.status).toBe(403);
});

test("configured country can reach sign-in", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALLOWED_COUNTRIES", "US");
  const { proxy } = await import("../proxy");
  expect(proxy(new NextRequest("https://example.com/sign-in", { headers: { "x-vercel-ip-country": "US" } })).status).toBe(200);
});

test("unknown country is refused with an explicit allowlist", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALLOWED_COUNTRIES", "US");
  const { proxy } = await import("../proxy");
  expect(proxy(new NextRequest("https://example.com/sign-in")).status).toBe(403);
});
