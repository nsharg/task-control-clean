"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, ArrowUpToLine, Check, GitCommitHorizontal, Link2, Lock, MoreHorizontal, Plus, Trash2, Undo2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ago, errorMessage } from "@/lib/format";
import { Button } from "../ui/button";
import { Sheet } from "../ui/dialog";
import { Input } from "../ui/input";
import { RichEditor } from "../ui/rich-editor";
import { Markdown } from "../ui/markdown";
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/menu";
import { Avatar, Badge, PageLoading } from "../ui/misc";
import { StatusIcon, TICKET_STATUS, type Category, type Priority } from "../ui/status";
import { useDetail } from "./detail";
import { AssigneePicker, PriorityPicker, StatusPicker } from "./pickers";
import { Composer, Thread } from "./thread";
import { useMembers, useWorkspace } from "./workspace";
import { textDir } from "@/lib/dir";

export function DetailSheets() {
  const { taskId, ticketId, close } = useDetail();
  return (
    <>
      <Sheet open={!!taskId} onOpenChange={(o) => !o && close()} title="Task">
        {taskId && <TaskDetail id={taskId as Id<"tasks">} onClose={close} />}
      </Sheet>
      <Sheet open={!!ticketId} onOpenChange={(o) => !o && close()} title="Ticket">
        {ticketId && <TicketDetail id={ticketId as Id<"tickets">} onClose={close} />}
      </Sheet>
    </>
  );
}

function SheetHeader({ children, onClose, menu }: { children: ReactNode; onClose: () => void; menu?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-[var(--header)] px-4 backdrop-blur-xl">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {menu}
      <button onClick={onClose} className="rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">
        <X size={18} />
      </button>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <span className="w-24 shrink-0 text-[13px] text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-fg-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Title and markdown body that turn into inputs on click, when allowed. */
function EditableText({ value, onSave, disabled, multiline, placeholder, className }: { value: string; onSave: (v: string) => Promise<unknown>; disabled?: boolean; multiline?: boolean; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const startEditing = () => {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  };
  const save = async () => {
    setEditing(false);
    if (draft.trim() === value.trim()) return;
    try {
      await onSave(draft);
    } catch (e) {
      toast.error(errorMessage(e));
      setDraft(value);
    }
  };
  if (!editing || disabled) {
    return (
      <div
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? undefined : 0}
        onClick={startEditing}
        onKeyDown={(e) => e.key === "Enter" && startEditing()}
        dir={multiline ? undefined : textDir(value)}
        className={`${disabled ? "" : "-mx-2 cursor-text rounded-xl px-2 hover:bg-muted"} ${className ?? ""}`}
      >
        {value ? multiline ? <Markdown>{value}</Markdown> : value : <span className="text-fg-3">{disabled ? "—" : placeholder}</span>}
      </div>
    );
  }
  return multiline ? (
    <div className="space-y-2">
      <RichEditor autoFocus defaultValue={value} onChange={setDraft} onSubmit={save} onEscape={() => (setDraft(value), setEditing(false))} placeholder={placeholder} className="rich-field min-h-40 border border-line-strong" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => (setDraft(value), setEditing(false))}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  ) : (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") (setDraft(value), setEditing(false));
      }}
      className={`h-auto border-transparent bg-muted px-2 py-1 ${className ?? ""}`}
    />
  );
}

const ACTION_LABEL: Record<string, string> = {
  created: "created this",
  status: "changed status",
  assigned: "assigned",
  renamed: "renamed",
  commented: "commented",
  accepted: "accepted this",
  "sent back": "sent this back",
  moved: "moved this under",
  type: "changed the type",
  milestone: "changed the milestone",
  ingested: "ingested as",
  linked: "linked a task",
  opened: "opened this",
  priority: "set priority",
  "edited description": "edited the description",
};

function Activity({ items, statusName }: { items: { id: string; actor: { name: string; kind: "user" | "agent" }; origin: string; action: string; from: string | null; to: string | null; at: number }[]; statusName: (k: string) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <div className="space-y-2.5">
      {shown.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-[13px] text-fg-2">
          <Avatar name={a.actor.name} kind={a.actor.kind} size={18} />
          <span className="font-medium text-fg">{a.actor.name}</span>
          <span>{ACTION_LABEL[a.action] ?? a.action}</span>
          {a.action === "status" && a.from && a.to ? (
            <span className="inline-flex items-center gap-1">
              {statusName(a.from)} <ArrowRight size={12} /> <span className="text-fg">{statusName(a.to)}</span>
            </span>
          ) : a.action === "ingested" || a.action === "assigned" || a.action === "moved" ? (
            <span className="text-fg">{a.to}</span>
          ) : null}
          {a.origin !== "app" && <Badge>via {a.origin}</Badge>}
          <span className="ml-auto shrink-0 text-fg-3">{ago(a.at)}</span>
        </div>
      ))}
      {items.length > 6 && (
        <button onClick={() => setAll(!all)} className="text-[13px] text-fg-3 hover:text-fg">
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function IngestBadge({ ingest }: { ingest: { state: string; ref?: string } }) {
  if (ingest.state === "done") return <Badge tone="green">Ingested → {ingest.ref}</Badge>;
  if (ingest.state === "claimed") return <Badge tone="amber">Being ingested</Badge>;
  if (ingest.state === "skipped") return <Badge>Skipped</Badge>;
  return null;
}

function TaskDetail({ id, onClose }: { id: Id<"tasks">; onClose: () => void }) {
  const ws = useWorkspace();
  const detail = useDetail();
  const task = useQuery(api.tasks.get, { taskId: id });
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const rankFirst = useMutation(api.tasks.rankFirst);

  if (task === undefined) return <PageLoading />;
  const t = task;
  const can = t.perms.edit;
  const statusName = (k: string) => t.project.statuses.find((s) => s.key === k)?.name ?? k;
  const patch = (p: Parameters<typeof update>[0]["patch"]) => update({ taskId: id, patch: p }).catch((e) => toast.error(errorMessage(e)));
  // In a contract project a row is a feature (or bug), a task under one, or a note.
  const contract = t.project.contract;
  const category = (t.project.statuses.find((s) => s.key === t.status)?.category ?? "backlog") as Category;
  const note = t.type === "finding" || t.type === "idea";
  const top = !t.parent;
  const feature = contract && top && !note;
  const tasks = t.subtasks.filter((x) => x.type !== "finding" && x.type !== "idea");
  const notes = t.subtasks.filter((x) => x.type === "finding" || x.type === "idea");
  const knownLimit = t.labels.includes("known-limit");

  return (
    <>
      <SheetHeader
        onClose={onClose}
        menu={
          can && (
            <Menu>
              <MenuTrigger className="rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="More">
                <MoreHorizontal size={18} />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  onSelect={() => {
                    navigator.clipboard.writeText(`${location.origin}/w/${ws.slug}/p/${t.project.key}?task=${id}`);
                    toast.success("Link copied");
                  }}
                >
                  <Link2 size={15} /> Copy link
                </MenuItem>
                {t.project.contract && (
                  <MenuItem
                    onSelect={() =>
                      rankFirst({ taskId: id })
                        .then(() => toast.success(t.parent ? "First under its feature" : "First in its milestone"))
                        .catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    <ArrowUpToLine size={15} /> Build this next
                  </MenuItem>
                )}
                <MenuItem
                  danger
                  onSelect={async () => {
                    if (!confirm(`Delete ${t.key}? This can't be undone.`)) return;
                    try {
                      await remove({ taskId: id });
                      onClose();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  <Trash2 size={15} /> Delete task
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      >
        <span className="font-mono text-[13px] text-fg-3">{t.key}</span>
        {t.alias && <Badge tone="blue">{t.alias}</Badge>}
        {contract && <Badge className="capitalize">{note ? t.type : top ? t.type : "task"}</Badge>}
        {t.parent && (
          <button onClick={() => detail.open("task", t.parent!.id)} className="min-w-0 truncate rounded-full px-2 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg">
            under <span className="font-mono">{t.parent.key}</span>
          </button>
        )}
        {t.managedBy && (
          <Badge>
            <Lock size={11} /> Synced from {t.managedBy}
          </Badge>
        )}
        <IngestBadge ingest={t.ingest} />
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 pb-10 pt-6">
          <EditableText value={t.title} disabled={!can} onSave={(title) => patch({ title })} className="font-display text-[22px] font-semibold leading-snug tracking-tight" />

          {feature && category === "review" && <ReviewBox id={id} summary={t.summary} can={can} />}
          {feature && category === "backlog" && (
            <Callout tone="amber" title={t.notReady ? "Not ready to start" : "A proposal, ready when you approve it"}>
              {t.notReady ?? "It has what it needs. Move it to To do to put it in the queue."}
              {!t.notReady && can && (
                <Button size="sm" className="mt-3 block" onClick={() => patch({ status: t.project.statuses.find((s) => s.category === "unstarted")?.key ?? "todo" })}>
                  Approve: move to To do
                </Button>
              )}
            </Callout>
          )}
          {t.blocked && category === "blocked" && (
            <Callout tone="red" title={`Waits on ${t.blocked.on}`}>
              {t.blocked.what}
            </Callout>
          )}
          {t.sentBackReason && category === "started" && (
            <Callout tone="purple" title="Sent back">
              {t.sentBackReason}
            </Callout>
          )}

          <div className="mt-5 space-y-0.5">
            <Prop label="Status">
              <StatusPicker statuses={t.project.statuses as { key: string; name: string; category: Category }[]} value={t.status} disabled={!can} onChange={(status) => patch({ status })} />
            </Prop>
            {contract ? (
              !note &&
              top && (
                <Prop label="Urgent">
                  <button
                    disabled={!can}
                    aria-pressed={t.priority === "urgent"}
                    onClick={() => patch({ priority: t.priority === "urgent" ? "none" : "urgent" })}
                    className={t.priority === "urgent" ? "h-7 rounded-full bg-red px-3 text-[13px] font-medium text-white" : "h-7 rounded-full px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg disabled:pointer-events-none"}
                  >
                    {t.priority === "urgent" ? "Urgent: built before anything else" : "No"}
                  </button>
                </Prop>
              )
            ) : (
              <Prop label="Priority">
                <PriorityPicker value={t.priority as Priority} disabled={!can} onChange={(priority) => patch({ priority })} />
              </Prop>
            )}
            <Prop label="Assignees">
              <AssigneePicker value={t.assignees} disabled={!can} onChange={(assigneeIds) => patch({ assigneeIds })} />
            </Prop>
            <Prop label="Type">
              {contract && can ? (
                <PropSelect value={t.type} onChange={(type) => patch({ type: type as typeof t.type })} options={(top ? ["feature", "bug", "chore", "finding", "idea"] : ["task", "bug", "chore", "finding", "idea"]).map((x) => [x, x[0].toUpperCase() + x.slice(1)])} />
              ) : (
                <Badge className="capitalize">{t.type}</Badge>
              )}
            </Prop>
            {contract && !note && (
              <Prop label="Tier">
                <PropSelect
                  value={t.tier ?? ""}
                  disabled={!can}
                  onChange={(tier) => patch({ tier: (tier || null) as "routine" | "standard" | "critical" | null })}
                  options={[
                    ["", "Standard (default)"],
                    ["routine", "Routine: exact instructions"],
                    ["standard", "Standard: judgement in one area"],
                    ["critical", "Critical: money, outside writes, client data"],
                  ]}
                />
              </Prop>
            )}
            {t.section && (
              <Prop label="Section">
                <span className="px-2.5 text-[13px]">{t.section.name}</span>
              </Prop>
            )}
            {contract && top && can ? (
              <Prop label="Milestone">
                <PropSelect value={t.milestone?.id ?? ""} onChange={(m) => patch({ milestoneId: (m || null) as Id<"milestones"> | null })} options={[["", "None"], ...t.milestones.map((m): [string, string] => [m.id, `${m.key} · ${m.name}`])]} />
              </Prop>
            ) : (
              t.milestone && (
                <Prop label="Milestone">
                  <span className="px-2.5 text-[13px]">
                    <span className="font-mono text-fg-3">{t.milestone.key}</span> {t.milestone.name}
                  </span>
                </Prop>
              )
            )}
            {t.origin && (
              <Prop label="Asked by">
                <span className="px-2.5 text-[13px] text-fg-2">{t.origin}</span>
              </Prop>
            )}
            {t.estimateDays != null && (
              <Prop label="Estimate">
                <span className="px-2.5 text-[13px]">{t.estimateDays} d</span>
              </Prop>
            )}
            <Prop label="Created">
              <span className="px-2.5 text-[13px] text-fg-2">
                {ago(t.createdAt)} by {t.createdBy.name}
              </span>
            </Prop>
          </div>

          <Section title="Description">
            <EditableText value={t.description} multiline disabled={!can} placeholder="Add a description…" onSave={(description) => patch({ description })} className="text-[15px]" />
          </Section>

          {(t.acceptance || can) && !(contract && (note || !top)) && (
            <Section title="Acceptance">
              <EditableText value={t.acceptance} multiline disabled={!can} placeholder={contract ? "2 to 5 lines, each: where → action → expected result" : "What does done look like?"} onSave={(acceptance) => patch({ acceptance })} className="text-[15px]" />
            </Section>
          )}
          {t.summary && category !== "review" && (
            <Section title="Summary">
              <Markdown className="text-[14px] text-fg-2">{t.summary}</Markdown>
            </Section>
          )}
          {contract && note && can && category !== "completed" && category !== "canceled" && (
            <Section title="Decide">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => patch({ type: t.parent ? "task" : "bug" })}>
                  Promote to {t.parent ? "a task" : "a bug"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => patch({ labels: knownLimit ? t.labels.filter((l) => l !== "known-limit") : [...t.labels, "known-limit"] })}>
                  {knownLimit ? "No longer a known limit" : "Accept as a known limit"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => patch({ status: t.project.statuses.find((s) => s.category === "canceled")?.key ?? "superseded" })}>
                  Drop
                </Button>
              </div>
            </Section>
          )}
          {t.evidence && (
            <Section title="Evidence">
              <Markdown className="text-[14px] text-fg-2">{t.evidence}</Markdown>
            </Section>
          )}

          {(t.dependsOn.length > 0 || t.blocks.length > 0) && (
            <Section title="Dependencies">
              <div className="space-y-1">
                {t.dependsOn.map((d) => (
                  <TaskRow key={d.id} label="Waits on" task={d} statusCat={(k) => t.project.statuses.find((s) => s.key === k)?.category as Category} onOpen={() => detail.open("task", d.id)} />
                ))}
                {t.blocks.map((d) => (
                  <TaskRow key={d.id} label="Blocks" task={d} statusCat={(k) => t.project.statuses.find((s) => s.key === k)?.category as Category} onOpen={() => detail.open("task", d.id)} />
                ))}
              </div>
            </Section>
          )}

          {(tasks.length > 0 || (feature && can)) && (
            <Section title={contract ? `Tasks${tasks.length ? ` · ${tasks.filter((x) => t.project.statuses.find((s) => s.key === x.status)?.category === "completed").length}/${tasks.length} done` : ""}` : "Subtasks"}>
              {tasks.map((d) => (
                <TaskRow key={d.id} task={d} badge={d.tier && d.tier !== "standard" ? d.tier : undefined} statusCat={(k) => t.project.statuses.find((s) => s.key === k)?.category as Category} onOpen={() => detail.open("task", d.id)} />
              ))}
              {feature && can && tasks.length < 7 && <AddTask projectId={t.project.id} parentId={id} />}
            </Section>
          )}
          {notes.length > 0 && (
            <Section title="Notes">
              {notes.map((d) => (
                <TaskRow key={d.id} task={d} badge={d.type} statusCat={(k) => t.project.statuses.find((s) => s.key === k)?.category as Category} onOpen={() => detail.open("task", d.id)} />
              ))}
            </Section>
          )}
          {t.commits.length > 0 && (
            <Section title={`Commits · ${t.commits.filter((c) => c.onMain).length} of ${t.commits.length} on main`}>
              <ul className="space-y-1">
                {t.commits.slice(0, 12).map((c) => (
                  <li key={c.sha} className="flex items-center gap-2.5 px-2 text-[13px] text-fg-2">
                    <GitCommitHorizontal size={14} className={c.onMain ? "shrink-0 text-green" : "shrink-0 text-fg-3"} />
                    <span className="shrink-0 font-mono text-xs text-fg-3">{c.sha.slice(0, 8)}</span>
                    <span className="min-w-0 flex-1 truncate" dir={textDir(c.subject)}>{c.subject}</span>
                    {c.model && <span className="hidden shrink-0 text-xs text-fg-3 sm:inline">{c.model.replace(/^Claude /, "")}</span>}
                  </li>
                ))}
              </ul>
              {t.commits.length > 12 && <p className="mt-1 px-2 text-[13px] text-fg-3">and {t.commits.length - 12} more</p>}
            </Section>
          )}

          {t.tickets.length > 0 && (
            <Section title="Tickets">
              {t.tickets.map((tk) =>
                tk ? (
                  <button key={tk.id} onClick={() => detail.open("ticket", tk.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted">
                    <span className="font-mono text-xs text-fg-3">{tk.key}</span>
                    <span className="flex-1 truncate" dir={textDir(tk.title)}>{tk.title}</span>
                    <Badge>{tk.relation}</Badge>
                  </button>
                ) : null,
              )}
            </Section>
          )}

          {t.activity.length > 0 && (
            <Section title="Activity">
              <Activity items={t.activity} statusName={statusName} />
            </Section>
          )}

          <Section title="Comments">
            <Thread target={{ type: "task", id }} />
          </Section>
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-bg px-6 pb-4 pt-3">
        <div className="mx-auto max-w-2xl">
          {t.perms.comment ? <Composer target={{ type: "task", id }} placeholder={t.managedBy ? "Comment on this synced task…" : "Write a comment…"} /> : null}
        </div>
      </div>
    </>
  );
}

function TaskRow({ task, label, badge, statusCat, onOpen }: { task: { id: string; key: string; alias: string | null; title: string; status: string }; label?: string; badge?: string; statusCat: (k: string) => Category; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted">
      {label && <span className="w-16 shrink-0 text-xs text-fg-3">{label}</span>}
      <StatusIcon category={statusCat(task.status) ?? "backlog"} />
      <span className="shrink-0 font-mono text-xs text-fg-3">{task.alias ?? task.key}</span>
      <span className="min-w-0 flex-1 truncate" dir={textDir(task.title)}>{task.title}</span>
      {badge && <Badge tone={badge === "critical" ? "red" : "neutral"}>{badge}</Badge>}
    </button>
  );
}

function Callout({ tone, title, children }: { tone: "amber" | "red" | "purple"; title: string; children: ReactNode }) {
  const tones = { amber: "border-amber/30 bg-amber/5", red: "border-red/30 bg-red/5", purple: "border-purple/30 bg-purple/5" };
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-sm ${tones[tone]}`}>
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-fg-2">{children}</div>
    </div>
  );
}

function PropSelect({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-72 rounded-full bg-transparent px-2.5 text-[13px] hover:bg-hover disabled:hover:bg-transparent">
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** A feature in review: what the agent says a person can now do, and the person's verdict. */
function ReviewBox({ id, summary, can }: { id: Id<"tasks">; summary: string | null; can: boolean }) {
  const review = useMutation(api.tasks.review);
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const run = (args: { accept: boolean; reason?: string }, done: string) =>
    review({ taskId: id, ...args })
      .then(() => toast.success(done))
      .catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="mt-4 rounded-2xl border border-purple/30 bg-purple/5 p-4">
      <div className="text-sm font-medium">Ready for you to try</div>
      {summary ? <Markdown className="mt-1 text-[14px] text-fg-2">{summary}</Markdown> : <p className="mt-1 text-sm text-fg-2">Run the acceptance lines below.</p>}
      {can &&
        (sending ? (
          <form onSubmit={(e) => (e.preventDefault(), run({ accept: false, reason }, "Sent back"))} className="mt-3 flex gap-2">
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One line: why it comes back" className="h-9 text-sm" maxLength={1000} />
            <Button type="submit" size="sm" disabled={!reason.trim()}>
              Send back
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSending(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => run({ accept: true }, "Accepted")}>
              <Check size={15} /> Accept
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSending(true)}>
              <Undo2 size={15} /> Send back
            </Button>
          </div>
        ))}
    </div>
  );
}

/** One line adds a task under the feature. */
function AddTask({ projectId, parentId }: { projectId: Id<"projects">; parentId: Id<"tasks"> }) {
  const create = useMutation(api.tasks.create);
  const [title, setTitle] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    try {
      await create({ projectId, parentTaskId: parentId, title, type: "task" });
      setTitle("");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <form onSubmit={(e) => (e.preventDefault(), add())} className="mt-1 flex items-center gap-2 px-2">
      <Plus size={14} className="shrink-0 text-fg-3" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task: a slice that can be merged on its own" maxLength={120} className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3" />
    </form>
  );
}

function TicketDetail({ id, onClose }: { id: Id<"tickets">; onClose: () => void }) {
  const ws = useWorkspace();
  const detail = useDetail();
  const ticket = useQuery(api.tickets.get, { ticketId: id });
  const update = useMutation(api.tickets.update);
  const remove = useMutation(api.tickets.remove);
  const members = useMembers();
  if (ticket === undefined) return <PageLoading />;
  const t = ticket;
  const canTriage = t.perms.write;
  const canEdit = canTriage || t.reporter.id === ws.me.id;
  const canDelete = t.perms.manage || t.reporter.id === ws.me.id;
  const commentsClosed = t.status === "closed";
  const save = (p: Omit<Parameters<typeof update>[0], "ticketId">) => update({ ticketId: id, ...p }).catch((e) => toast.error(errorMessage(e)));

  return (
    <>
      <SheetHeader
        onClose={onClose}
        menu={
          canDelete && (
            <Menu>
              <MenuTrigger className="rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="More">
                <MoreHorizontal size={18} />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  danger
                  onSelect={async () => {
                    if (!confirm(`Delete ${t.key}? This can't be undone.`)) return;
                    try {
                      await remove({ ticketId: id });
                      onClose();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  <Trash2 size={15} /> Delete ticket
                </MenuItem>
              </MenuContent>
            </Menu>
          )
        }
      >
        <span className="font-mono text-[13px] text-fg-3">{t.key}</span>
        <Badge tone={t.kind === "bug" ? "red" : t.kind === "feature" ? "purple" : "blue"} className="capitalize">
          {t.kind}
        </Badge>
        <IngestBadge ingest={t.ingest} />
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 pb-10 pt-6">
          <EditableText value={t.title} disabled={!canEdit} onSave={(title) => save({ title })} className="font-display text-[22px] font-semibold leading-snug tracking-tight" />
          <div className="mt-5 space-y-0.5">
            <Prop label="Status">
              <StatusPicker statuses={TICKET_STATUS} value={t.status} disabled={!canTriage} onChange={(s) => save({ status: s as typeof t.status })} />
            </Prop>
            <Prop label="Severity">
              <select
                value={t.severity}
                disabled={!canTriage}
                onChange={(e) => save({ severity: e.target.value as typeof t.severity })}
                className="h-8 rounded-full bg-transparent px-2.5 text-[13px] capitalize hover:bg-hover disabled:hover:bg-transparent"
              >
                {["low", "medium", "high", "critical"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Assignee">
              <select
                value={t.assignee?.id ?? ""}
                disabled={!canTriage}
                onChange={(e) => save({ assigneeId: e.target.value || null })}
                className="h-8 max-w-60 rounded-full bg-transparent px-2.5 text-[13px] hover:bg-hover disabled:hover:bg-transparent"
              >
                <option value="">Unassigned</option>
                {members?.people.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Prop>
            <Prop label="Project">
              <span className="px-2.5 text-[13px]">{t.project?.name ?? "—"}</span>
            </Prop>
            <Prop label="Reporter">
              <span className="inline-flex items-center gap-2 px-2.5 text-[13px]">
                <Avatar name={t.reporter.name} kind={t.reporter.kind} size={18} /> {t.reporter.name} · {ago(t.createdAt)}
              </span>
            </Prop>
          </div>

          <Section title="Details">
            <EditableText value={t.body} multiline disabled={!canEdit} placeholder="Add details…" onSave={(body) => save({ body })} className="text-[15px]" />
          </Section>

          <Section title="Linked tasks" action={t.perms.comment && <LinkTaskButton ticketId={id} />}>
            {t.tasks.length === 0 ? (
              <p className="px-2 text-[13px] text-fg-3">Not linked to a task yet.</p>
            ) : (
              t.tasks.map((task) => (
                <button key={task.id} onClick={() => detail.open("task", task.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted">
                  <span className="shrink-0 font-mono text-xs text-fg-3">{task.alias ?? task.key}</span>
                  <span className="flex-1 truncate" dir={textDir(task.title)}>{task.title}</span>
                  <Badge>{task.relation}</Badge>
                </button>
              ))
            )}
          </Section>

          {t.activity.length > 0 && (
            <Section title="Activity">
              <Activity items={t.activity} statusName={(k) => TICKET_STATUS.find((s) => s.key === k)?.name ?? k} />
            </Section>
          )}

          <Section title="Comments">
            <Thread target={{ type: "ticket", id }} />
          </Section>
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-bg px-6 pb-4 pt-3">
        <div className="mx-auto max-w-2xl">
          {commentsClosed ? (
            <p className="flex items-center gap-2 py-2 text-[13px] text-fg-3">
              <Lock size={14} /> This ticket is closed, so comments are closed. Reopen it to continue the conversation.
            </p>
          ) : (
            t.perms.comment && <Composer target={{ type: "ticket", id }} />
          )}
        </div>
      </div>
    </>
  );
}

function LinkTaskButton({ ticketId }: { ticketId: Id<"tickets"> }) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useQuery(api.search.run, open && q.trim() ? { workspaceId: ws.id, q } : "skip");
  const link = useMutation(api.tickets.link);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Link2 size={14} /> Link task
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks or type DEMO-12…" className="h-9 text-sm" />
        <div className="mt-1.5 max-h-64 overflow-y-auto">
          {results
            ?.filter((r) => r.type === "task")
            .map((r) => (
              <button
                key={r.id}
                onClick={async () => {
                  try {
                    await link({ ticketId, taskId: r.id as Id<"tasks">, relation: "relates" });
                    setOpen(false);
                    setQ("");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-hover"
              >
                <span className="font-mono text-xs text-fg-3">{r.key}</span>
                <span className="truncate" dir={textDir(r.title)}>{r.title}</span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
