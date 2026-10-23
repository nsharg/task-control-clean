import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/**
 * Every public query or mutation must be built with the wrappers in
 * lib/functions.ts, which resolve the caller first. Raw builders are allowed
 * only for internal functions and the files listed here.
 */
// agent/gate.ts is called by the Next.js routes with a shared secret, before any token is known.
const ALLOWED = new Set(["lib/functions.ts", "auth.ts", "agent/gate.ts"]);

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "_generated" ? [] : files(p, base);
    return p.endsWith(".ts") ? [p.slice(base.length + 1)] : [];
  });
}

test("no public function skips the auth wrappers", () => {
  const root = join(process.cwd(), "convex");
  const offenders = files(root).filter((f) => {
    if (ALLOWED.has(f)) return false;
    const src = readFileSync(join(root, f), "utf8");
    const m = /import\s*{([^}]*)}\s*from\s*["'][./]*_generated\/server["']/.exec(src);
    if (!m) return false;
    const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, ""));
    return names.includes("query") || names.includes("mutation");
  });
  expect(offenders).toEqual([]);
});

test("the activity log has no update or delete path", () => {
  const root = join(process.cwd(), "convex");
  for (const f of files(root)) {
    const src = readFileSync(join(root, f), "utf8");
    expect(src, f).not.toMatch(/db\.(patch|replace|delete)\([^)]*activity/i);
  }
});
