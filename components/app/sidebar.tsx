"use client";

import { useQuery } from "convex/react";
import { Archive, Bell, ChevronsUpDown, CircleCheckBig, CircleUser, Inbox, LogOut, Moon, Plus, Search, Settings, Sun, Ticket, Monitor, SquareCheck, KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { Avatar, Kbd } from "../ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/menu";
import { NewProjectDialog } from "./new-project-dialog";
import { isAdmin, useWorkspace } from "./workspace";

export function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  const ws = useWorkspace();
  const projects = useQuery(api.projects.list, { workspaceId: ws.id });
  const unread = useQuery(api.notifications.unreadCount, { workspaceId: ws.id });
  const needs = useQuery(api.tasks.needsYou, { workspaceId: ws.id });
  const waiting = needs ? needs.toAccept.length + needs.blocked.length + needs.proposals.length + needs.stale.length : 0;
  const archived = projects?.filter((p) => p.archived) ?? [];
  const pathname = usePathname();
  const base = `/w/${ws.slug}`;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-[272px] shrink-0 flex-col bg-sidebar transition-transform duration-200 md:static md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="p-2">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" onClick={onNavigate}>
        <button
          onClick={() => window.dispatchEvent(new Event("tc:command"))}
          className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm text-fg-2 hover:bg-hover"
        >
          <Search size={16} />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <NavItem href={`${base}/inbox`} icon={<Inbox size={16} />} active={pathname.startsWith(`${base}/inbox`)} badge={unread || undefined}>
          Inbox
        </NavItem>
        <NavItem href={`${base}/needs-you`} icon={<CircleCheckBig size={16} />} active={pathname.startsWith(`${base}/needs-you`)} badge={waiting || undefined}>
          Needs you
        </NavItem>
        <NavItem href={`${base}/my-work`} icon={<SquareCheck size={16} />} active={pathname.startsWith(`${base}/my-work`)}>
          My work
        </NavItem>
        <NavItem href={`${base}/tickets`} icon={<Ticket size={16} />} active={pathname.startsWith(`${base}/tickets`)}>
          Tickets
        </NavItem>

        <div className="flex items-center justify-between px-2.5 pb-1 pt-5">
          <span className="text-xs font-medium text-fg-3">Projects</span>
          {ws.role !== "guest" && (
            <NewProjectDialog>
              <button className="rounded-md p-0.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="New project">
                <Plus size={15} />
              </button>
            </NewProjectDialog>
          )}
        </div>
        {projects?.filter((p) => !p.archived).map((p) => (
          <NavItem
            key={p.id}
            href={`${base}/p/${p.key}`}
            active={pathname.startsWith(`${base}/p/${p.key}`)}
            icon={<span className="m-[3px] h-2.5 w-2.5 rounded-[4px]" style={{ background: p.color }} />}
            trailing={<span className="text-xs tabular-nums text-fg-3">{p.progress.percent}%</span>}
          >
            {p.name}
          </NavItem>
        ))}
        {projects?.length === 0 && <p className="px-2.5 py-1 text-[13px] text-fg-3">No projects yet.</p>}
        {archived.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-5 text-xs font-medium text-fg-3">Archived</div>
            {archived.map((p) => (
              <NavItem key={p.id} href={`${base}/p/${p.key}`} active={pathname.startsWith(`${base}/p/${p.key}`)} icon={<Archive size={14} className="text-fg-3" />}>
                {p.name}
              </NavItem>
            ))}
          </>
        )}
      </nav>
      <div className="border-t border-line p-2">
        <UserMenu />
      </div>
    </aside>
  );
}

function NavItem({ href, icon, children, active, badge, trailing }: { href: string; icon: ReactNode; children: ReactNode; active?: boolean; badge?: number; trailing?: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm transition-colors",
        active ? "bg-hover font-medium text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
      )}
    >
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {badge ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-fg">{badge}</span> : trailing}
    </Link>
  );
}

function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const all = useQuery(api.workspaces.mine);
  const router = useRouter();
  return (
    <Menu>
      <MenuTrigger className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left hover:bg-hover">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-accent-fg">{ws.name[0]?.toUpperCase()}</span>
        <span className="flex-1 truncate font-display text-[15px] font-semibold">{ws.name}</span>
        <ChevronsUpDown size={15} className="text-fg-3" />
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel>Workspaces</MenuLabel>
        {all?.map((w) => (
          <MenuItem key={w.id} checked={w.id === ws.id} onSelect={() => router.push(`/w/${w.slug}`)}>
            {w.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        {ws.me.isSuperAdmin && (
          <MenuItem onSelect={() => router.push("/onboarding")}>
            <Plus size={15} /> New workspace
          </MenuItem>
        )}
        {isAdmin(ws.role) && (
          <MenuItem onSelect={() => router.push(`/w/${ws.slug}/settings`)}>
            <Settings size={15} /> Workspace settings
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const ws = useWorkspace();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  return (
    <Menu>
      <MenuTrigger className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left hover:bg-hover">
        <Avatar name={ws.me.name} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{ws.me.name}</span>
          <span className="block truncate text-xs capitalize text-fg-3">{ws.role}</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        <MenuLabel>{ws.me.email}</MenuLabel>
        <MenuItem onSelect={() => router.push(`/w/${ws.slug}/settings/account`)}>
          <CircleUser size={15} /> Account & security
        </MenuItem>
        {ws.me.isSuperAdmin && (
          <MenuItem onSelect={() => router.push("/admin")}>
            <ShieldCheck size={15} /> Admin console
          </MenuItem>
        )}
        {isAdmin(ws.role) && (
          <MenuItem onSelect={() => router.push(`/w/${ws.slug}/settings/agents`)}>
            <KeyRound size={15} /> Agents & API tokens
          </MenuItem>
        )}
        <MenuItem onSelect={() => router.push(`/w/${ws.slug}/inbox`)}>
          <Bell size={15} /> Notifications
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuItem checked={theme === "light"} onSelect={() => setTheme("light")}>
          <Sun size={15} /> Light
        </MenuItem>
        <MenuItem checked={theme === "dark"} onSelect={() => setTheme("dark")}>
          <Moon size={15} /> Dark
        </MenuItem>
        <MenuItem checked={theme === "system"} onSelect={() => setTheme("system")}>
          <Monitor size={15} /> System
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onSelect={async () => {
            await authClient.signOut();
            window.location.assign("/sign-in");
          }}
        >
          <LogOut size={15} /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
