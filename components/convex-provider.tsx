"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
  return (
    // The provider's type only knows the base client; the plugins we add are extra endpoints.
    <ConvexBetterAuthProvider client={convex} authClient={authClient as never} initialToken={initialToken}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
