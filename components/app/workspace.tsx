"use client";

import { useQuery } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type Workspace = NonNullable<FunctionReturnType<typeof api.workspaces.bySlug>>;
const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ value, children }: { value: Workspace; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWorkspace outside a workspace");
  return w;
}

export const isAdmin = (role: string) => role === "owner" || role === "admin";

/** Workspace people and agents, for pickers and mentions. */
export function useMembers() {
  const w = useWorkspace();
  return useQuery(api.workspaces.members, { workspaceId: w.id });
}
