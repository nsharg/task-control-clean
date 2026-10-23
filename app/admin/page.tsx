"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowLeft, Check, Copy, KeyRound, LogOut, MoreHorizontal, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Avatar, Badge, Empty, PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ago, errorMessage, shortDate } from "@/lib/format";

type Role = "owner" | "admin" | "member" | "guest";
type Issued = { name: string; email: string; password: string };

/** The super admin's console: create accounts, hand over one-time passwords, disable access. */
export default function Admin() {
  const me = useQuery(api.admin.me);
  if (me === undefined) return <PageLoading />;
  if (!me.isSuperAdmin) return <Empty title="Super admin only" />;
  return (
    <main className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-[var(--header)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <Link href="/" className="rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Back to the app">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="flex-1 font-display text-[17px] font-semibold tracking-tight">Admin console</h1>
          <CreateUserDialog />
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-10 p-4 md:p-8">
        <Security />
        <Users selfId={me.id} />
      </div>
    </main>
  );
}

const EVENT_LABEL: Record<string, string> = {
  sign_in_failed: "Failed sign-in",
  sign_in_throttled: "Sign-in throttled",
  sign_in_disabled: "Disabled account tried to sign in",
  sign_up_rejected: "Sign-up rejected",
  bad_token: "Invalid API token",
  token_rate_limited: "API token rate-limited",
  proxy_secret_missing: "Direct backend call refused",
  admin_action: "Admin action",
};

function Security() {
  const data = useQuery(api.monitor.overview);
  const ack = useMutation(api.monitor.acknowledge);
  const [showEvents, setShowEvents] = useState(false);
  if (!data) return null;
  const open = data.alerts.filter((a) => !a.acknowledged);
  const counted = Object.entries(data.counts).filter(([k]) => k !== "admin_action");
  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-display text-[17px] font-semibold tracking-tight">Security</h2>
        {open.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => ack({})}>
            Acknowledge all
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-2">
        Checked every 5 minutes. {data.webhook ? "Alerts are also posted to your webhook." : "Set ALERT_WEBHOOK_URL on the Convex deployment to get alerts in Slack or Discord."}
      </p>
      {open.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-green/10 px-4 py-3 text-sm text-green">
          <ShieldCheck size={16} /> No open alerts.
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {open.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${a.severity === "critical" ? "bg-red/10" : "bg-amber/12"}`}>
              <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${a.severity === "critical" ? "text-red" : "text-amber"}`} />
              <div className="flex-1">
                <div className="font-medium">{a.message}</div>
                <div className="text-[12.5px] text-fg-3">
                  {ago(a.at)} · {a.kind.replace(/_/g, " ")}
                  {data.webhook && (a.delivered ? " · sent to webhook" : " · webhook delivery failed")}
                </div>
              </div>
              <button onClick={() => ack({ id: a.id })} className="text-[13px] text-fg-2 hover:text-fg">
                Acknowledge
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-[13px] text-fg-2">
        <span className="text-fg-3">Last 24 hours:</span>
        {counted.length === 0 ? <span>nothing unusual</span> : counted.map(([k, n]) => <Badge key={k}>{EVENT_LABEL[k] ?? k}: {n}</Badge>)}
        <button onClick={() => setShowEvents(!showEvents)} className="ml-auto text-fg-3 hover:text-fg">
          {showEvents ? "Hide log" : "Show log"}
        </button>
      </div>
      {showEvents && (
        <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-2xl border border-line text-[13px]">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 px-4 py-2">
              <span className="w-24 shrink-0 text-fg-3">{ago(e.at)}</span>
              <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
              {e.email && <span className="text-fg-2">{e.email}</span>}
              {e.ip && <span className="font-mono text-fg-3">{e.ip}</span>}
              {e.detail && e.kind === "admin_action" && <span className="text-fg-3">{e.detail}</span>}
            </li>
          ))}
          {data.events.length === 0 && <li className="px-4 py-3 text-fg-3">No events yet.</li>}
        </ul>
      )}
    </section>
  );
}

function Users({ selfId }: { selfId: string }) {
  const users = useQuery(api.admin.users);
  const [issued, setIssued] = useState<Issued | null>(null);
  const reset = useAction(api.admin.resetPassword);
  const setDisabled = useAction(api.admin.setDisabled);
  const signOut = useAction(api.admin.signOutEverywhere);
  if (users === undefined) return <PageLoading />;
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section>
      <h2 className="font-display text-[17px] font-semibold tracking-tight">People</h2>
      <p className="mt-1 text-sm text-fg-2">Everyone who can sign in. There is no public sign-up.</p>
      <ul className="mt-4 divide-y divide-line rounded-3xl border border-line">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${u.disabled ? "opacity-50" : ""}`}>
            <Avatar name={u.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {u.name}
                {u.id === selfId && <span className="text-fg-3">(you)</span>}
              </div>
              <div className="truncate text-[13px] text-fg-3">
                {u.email} · since {shortDate(u.createdAt)}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {u.workspaces.map((w) => (
                <Badge key={w.id}>
                  {w.name} · {w.role}
                </Badge>
              ))}
              {u.mustChangePassword && <Badge tone="amber">Password not yet changed</Badge>}
              {u.disabled && <Badge tone="red">Disabled</Badge>}
            </div>
            <AddToWorkspace userId={u.id} />
            {u.id !== selfId && (
              <Menu>
                <MenuTrigger className="rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label={`Actions for ${u.name}`}>
                  <MoreHorizontal size={17} />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem
                    onSelect={async () => {
                      if (!confirm(`Issue a new one-time password for ${u.name}? Their current password stops working and they are signed out.`)) return;
                      try {
                        const { password } = await reset({ userId: u.id });
                        setIssued({ name: u.name, email: u.email, password });
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <KeyRound size={15} /> Reset password
                  </MenuItem>
                  <MenuItem onSelect={() => run(signOut({ userId: u.id }), `${u.name} was signed out everywhere`)}>
                    <LogOut size={15} /> Sign out everywhere
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger={!u.disabled} onSelect={() => run(setDisabled({ userId: u.id, disabled: !u.disabled }), u.disabled ? "Enabled" : "Disabled and signed out")}>
                    {u.disabled ? "Enable account" : "Disable account"}
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </li>
        ))}
      </ul>
      <CredentialsDialog issued={issued} onClose={() => setIssued(null)} />
    </section>
  );
}

function Placement({
  workspaceId,
  setWorkspaceId,
  role,
  setRole,
  projectIds,
  setProjectIds,
}: {
  workspaceId: string;
  setWorkspaceId: (v: string) => void;
  role: Role;
  setRole: (r: Role) => void;
  projectIds: string[];
  setProjectIds: (p: string[]) => void;
}) {
  const options = useQuery(api.admin.workspaceOptions);
  const ws = options?.find((w) => w.id === workspaceId);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Workspace">
          <Select value={workspaceId} onChange={(e) => (setWorkspaceId(e.target.value), setProjectIds([]))}>
            <option value="">No workspace yet</option>
            {options?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={!workspaceId}>
            <option value="member">Member: every open project</option>
            <option value="guest">Guest (partner): chosen projects only</option>
            <option value="admin">Admin: manages the workspace</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
      </div>
      {ws && role === "guest" && (
        <Field label="Projects they can see">
          <div className="flex flex-wrap gap-2">
            {ws.projects.map((p) => {
              const on = projectIds.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setProjectIds(on ? projectIds.filter((x) => x !== p.id) : [...projectIds, p.id])}
                  className={`h-8 rounded-full border px-3 text-[13px] ${on ? "border-accent bg-accent text-accent-fg" : "border-line-strong text-fg-2 hover:bg-hover"}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </>
  );
}

function CreateUserDialog() {
  const create = useAction(api.admin.createUser);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const { password } = await create({
        name,
        email,
        workspaceId: (workspaceId || undefined) as Id<"workspaces"> | undefined,
        role: workspaceId ? role : undefined,
        projectIds: projectIds as Id<"projects">[],
      });
      setOpen(false);
      setIssued({ name, email: email.trim().toLowerCase(), password });
      setName("");
      setEmail("");
      setProjectIds([]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">
            <UserPlus size={15} /> Add person
          </Button>
        </DialogTrigger>
        <DialogContent title="Add a person" description="They get a one-time password to change at first sign-in." className="max-w-xl">
          <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
              </Field>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off" />
              </Field>
            </div>
            <Placement workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} role={role} setRole={setRole} projectIds={projectIds} setProjectIds={setProjectIds} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!name.trim() || !email || (!!workspaceId && role === "guest" && !projectIds.length)}>
                Create account
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <CredentialsDialog issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}

function AddToWorkspace({ userId }: { userId: string }) {
  const add = useMutation(api.admin.addToWorkspace);
  const [open, setOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Add to workspace
        </Button>
      </DialogTrigger>
      <DialogContent title="Add to a workspace">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await add({ userId, workspaceId: workspaceId as Id<"workspaces">, role, projectIds: projectIds as Id<"projects">[] });
              toast.success("Added");
              setOpen(false);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
          className="space-y-4"
        >
          <Placement workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} role={role} setRole={setRole} projectIds={projectIds} setProjectIds={setProjectIds} />
          <div className="flex justify-end">
            <Button type="submit" disabled={!workspaceId || (role === "guest" && !projectIds.length)}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shown once. The password is not stored anywhere readable. */
function CredentialsDialog({ issued, onClose }: { issued: Issued | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!issued) return null;
  const site = window.location.origin;
  const message = `Hi ${issued.name.split(" ")[0]}, here is your Task Control access:\n\n${site}/sign-in\nEmail: ${issued.email}\nOne-time password: ${issued.password}\n\nYou'll be asked to choose your own password when you first sign in.`;
  return (
    <Dialog open onOpenChange={(o) => !o && (setCopied(false), onClose())}>
      <DialogContent title="Hand over these credentials" description="This password is shown only now. Send it privately (not in a shared channel); it stops working once they set their own.">
        <pre className="whitespace-pre-wrap break-all rounded-xl bg-muted p-4 font-mono text-[13px]">{message}</pre>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => (navigator.clipboard.writeText(message), setCopied(true))}>
            {copied ? <Check size={15} /> : <Copy size={15} />} Copy message
          </Button>
          <Button onClick={() => (setCopied(false), onClose())}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
