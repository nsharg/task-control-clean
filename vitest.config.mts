import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test", "@convex-dev/better-auth", "@convex-dev/rate-limiter", "@convex-dev/resend"] } },
    include: ["tests/**/*.test.ts"],
  },
});
