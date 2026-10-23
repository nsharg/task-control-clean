"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, Check, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { isAdmin, useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Empty } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ago, errorMessage, shortDate } from "@/lib/format";

type Scope = "read" | "write" | "comment" | "sync" | "ingest" | "admin" | "decide";
const SCOPES: { s: Scope; label: string; hint: string }[] = [
  { s: "read", label: "Read", hint: "Projects, tasks, tickets, comments" },
  { s: "comment", label: "Comment", hint: "Comment and link tickets" },
  { s: "write", label: "Write", hint: "Create and update tasks and tickets" },
  { s: "sync", label: "Sync", hint: "Mirror a source into projects (needs a source name)" },
  { s: "ingest", label: "Ingest", hint: "Claim partner items and mark them picked up" },
  { s: "admin", label: "Admin", hint: "Create, change and archive projects and milestones; set who is in a project" },
  { s: "decide", label: "Decide", hint: "Answer your Needs you queue when you ask it to: accept or send back, approve, keep or drop" },
];

const PRESETS: { name: string; scopes: Scope[]; source?: string }[] = [
  { name: "Coding agent", scopes: ["read", "comment", "write"] },
  { name: "Owner's assistant", scopes: ["read", "comment", "write", "decide"] },
  { name: "Project manager", scopes: ["read", "comment", "write", "admin"] },
  { name: "Read only", scopes: ["read"] },
];

export default function AgentsPage() {
  const ws = useWorkspace();
  const agents = useQuery(api.agents.list, isAdmin(ws.role) ? { workspaceId: ws.id } : "skip");
  const create = useMutation(api.agents.create);
  const revoke = useMutation(api.agents.revokeToken);
  if (!isAdmin(ws.role)) return <Empty title="Admins only" />;

  return (
    <>
      <PageHeader
        title="Agents & API tokens"
        subtitle="Let Claude and other agents read and update this workspace over MCP or REST"
        actions={
          <NewAgentDialog onCreate={(name) => create({ workspaceId: ws.id, name }).then(() => undefined)} />
        }
      />
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        {agents?.length === 0 && (
          <Empty icon={<Bot size={22} />} title="No agents yet">
            Create an agent (for example &ldquo;Claude&rdquo;), then give it a token. Everything it does is attributed to it.
          </Empty>
        )}
        {agents?.map((a) => (
          <section key={a.id} className="rounded-3xl border border-line">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#d97757] text-white">
                <Bot size={18} />
              </span>
              <div className="flex-1">
                <div className="font-medium">{a.name}</div>
                <div className="text-[13px] text-fg-3">{a.tokens.filter((t) => !t.revoked).length} active tokens</div>
              </div>
              <NewTokenDialog agentId={a.id} />
            </div>
            <ul className="divide-y divide-line">
              {a.tokens.map((t) => (
                <li key={t.id} className={`flex flex-wrap items-center gap-2 px-5 py-3 text-sm ${t.revoked ? "opacity-50" : ""}`}>
                  <KeyRound size={15} className="text-fg-3" />
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-fg-3">{t.prefix}…</span>
                  {t.source && <Badge tone="blue">source: {t.source}</Badge>}
                  {t.scopes.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                  <span className="ml-auto text-xs text-fg-3">
                    {t.revoked ? "revoked" : t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : "never used"}
                    {t.expiresAt && !t.revoked && ` · expires ${shortDate(t.expiresAt)}`}
                  </span>
                  {!t.revoked && (
                    <Button size="sm" variant="ghost" onClick={() => confirm("Revoke this token? Anything using it stops working.") && revoke({ tokenId: t.id })}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <HowTo />
      </div>
    </>
  );
}

function NewAgentDialog({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Claude");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={15} /> New agent
        </Button>
      </DialogTrigger>
      <DialogContent title="New agent" description="An identity for an AI agent. Its comments and changes are attributed to it.">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onCreate(name);
              setOpen(false);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Create agent
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTokenDialog({ agentId }: { agentId: Id<"agents"> }) {
  const ws = useWorkspace();
  const createToken = useAction(api.agents.createToken);
  const projects = useQuery(api.projects.list, { workspaceId: ws.id });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("laptop");
  const [scopes, setScopes] = useState<Scope[]>(["read", "comment", "write"]);
  const [source, setSource] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expires, setExpires] = useState("90");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await createToken({
        agentId,
        name,
        scopes,
        projectIds: projectIds as Id<"projects">[],
        source: source.trim() || undefined,
        expiresInDays: expires ? Number(expires) : undefined,
      });
      setToken(res.token);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const site = typeof window !== "undefined" ? window.location.origin : "";
  const cmd = token ? `claude mcp add --transport http task-control ${site}/api/mcp --header "Authorization: Bearer ${token}"` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && setToken(null))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus size={15} /> Token
        </Button>
      </DialogTrigger>
      <DialogContent title={token ? "Copy your token now" : "New API token"} description={token ? "It won't be shown again. Store it in your keychain or a secret manager." : undefined} className="max-w-xl">
        {token ? (
          <div className="space-y-4">
            <CopyBox label="Token" value={token} />
            <CopyBox label="Add to Claude Code" value={cmd} />
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => (setScopes(p.scopes), setSource(p.source ?? ""), setName(p.source ?? "token"))}
                  className="h-8 rounded-full border border-line-strong px-3 text-[13px] text-fg-2 hover:bg-hover"
                >
                  {p.name}
                </button>
              ))}
            </div>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
            </Field>
            <Field label="Scopes">
              <div className="space-y-1">
                {SCOPES.map(({ s, label, hint }) => (
                  <label key={s} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} className="accent-[var(--accent)]" />
                    <span className="w-20 text-sm font-medium">{label}</span>
                    <span className="text-[13px] text-fg-3">{hint}</span>
                  </label>
                ))}
              </div>
            </Field>
            {scopes.includes("sync") && (
              <Field label="Source name" hint="Mirrored items are marked with it and are read-only for everyone else.">
                <Input value={source} onChange={(e) => setSource(e.target.value.toLowerCase())} placeholder="my-tracker" required pattern="[a-z0-9][a-z0-9\-]{1,39}" className="font-mono" />
              </Field>
            )}
            <Field label="Projects" hint="None selected means every project.">
              <div className="flex flex-wrap gap-2">
                {projects?.map((p) => {
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
            <Field label="Expires">
              <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In a year</option>
                <option value="">Never</option>
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!scopes.length}>
                Create token
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label}>
      <div className="flex items-start gap-2 rounded-xl bg-muted p-2 pl-3">
        <code className="flex-1 break-all py-1 font-mono text-[12.5px]">{value}</code>
        <Button type="button" size="sm" variant="secondary" onClick={() => (navigator.clipboard.writeText(value), setCopied(true), setTimeout(() => setCopied(false), 1500))}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
    </Field>
  );
}

function HowTo() {
  return (
    <section className="rounded-3xl bg-muted p-6 text-sm leading-relaxed text-fg-2">
      <h3 className="mb-2 font-display text-[15px] font-semibold text-fg">How agents connect</h3>
      <p>
        <span className="font-medium text-fg">MCP:</span> <code className="font-mono text-[12.5px]">/api/mcp</code> (Streamable HTTP) with the header <code className="font-mono text-[12.5px]">Authorization: Bearer tc_…</code>.
      </p>
      <p className="mt-1">
        <span className="font-medium text-fg">REST:</span> <code className="font-mono text-[12.5px]">/api/v1</code>, reference at <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>.
      </p>
      <p className="mt-3">Text people write reaches agents as <code className="font-mono text-[12.5px]">untrusted_content</code>. Partner input is only ingested when you ask.</p>
    </section>
  );
}
