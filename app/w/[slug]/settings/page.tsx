"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { isAdmin, useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Avatar, Empty } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/format";

type Role = "owner" | "admin" | "member" | "guest";
export default function WorkspaceSettings() {
  const ws = useWorkspace();
  if (!isAdmin(ws.role)) return <Empty title="Admins only">Ask an owner or admin to change workspace settings.</Empty>;
  return (
    <>
      <PageHeader title="Workspace settings" subtitle={ws.name} />
      <div className="mx-auto max-w-3xl space-y-12 p-4 md:p-8">
        <People />
        <Members />
      </div>
    </>
  );
}

function People() {
  const ws = useWorkspace();
  return (
    <section className="rounded-3xl bg-muted p-5 text-sm text-fg-2">
      <h2 className="font-display text-[15px] font-semibold text-fg">Adding people</h2>
      <p className="mt-1">Accounts are created by the super admin, who hands each person a one-time password. Partners join as guests and see only the projects they are given.</p>
      {ws.me.isSuperAdmin && (
        <Button asChild size="sm" className="mt-3">
          <Link href="/admin">Open the admin console</Link>
        </Button>
      )}
    </section>
  );
}

function Members() {
  const ws = useWorkspace();
  const members = useQuery(api.workspaces.members, { workspaceId: ws.id });
  const setRole = useMutation(api.workspaces.setRole);
  const remove = useMutation(api.workspaces.removeMember);
  const run = (p: Promise<unknown>) => p.catch((e) => toast.error(errorMessage(e)));
  return (
    <section>
      <h2 className="font-display text-[17px] font-semibold tracking-tight">Members</h2>
      <ul className="mt-4 divide-y divide-line rounded-3xl border border-line">
        {members?.people.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={m.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {m.name} {m.userId === ws.me.id && <span className="text-fg-3">(you)</span>}
              </div>
              <div className="truncate text-[13px] text-fg-3">{m.email}</div>
            </div>
            <Menu>
              <MenuTrigger className="h-8 rounded-full px-3 text-[13px] capitalize text-fg-2 hover:bg-hover" disabled={m.userId === ws.me.id}>
                {m.role}
              </MenuTrigger>
              <MenuContent align="end">
                {(["owner", "admin", "member", "guest"] as Role[]).map((r) => (
                  <MenuItem key={r} checked={m.role === r} disabled={r === "owner" && ws.role !== "owner"} onSelect={() => run(setRole({ workspaceId: ws.id, userId: m.userId, role: r }))}>
                    <span className="capitalize">{r}</span>
                  </MenuItem>
                ))}
                <MenuItem danger onSelect={() => confirm(`Remove ${m.name} from ${ws.name}?`) && run(remove({ workspaceId: ws.id, userId: m.userId }))}>
                  Remove from workspace
                </MenuItem>
              </MenuContent>
            </Menu>
          </li>
        ))}
      </ul>
    </section>
  );
}
