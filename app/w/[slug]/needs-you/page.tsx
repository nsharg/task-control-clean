"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, CircleCheckBig, Sparkles, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useDetail } from "@/components/app/detail";
import { PageHeader } from "@/components/app/page-header";
import { useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { Badge, Empty, PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { textDir } from "@/lib/dir";
import { ago, errorMessage } from "@/lib/format";

/** Every decision that waits on a person, oldest first: accept, unblock, approve, keep or drop. */
export default function NeedsYou() {
  const ws = useWorkspace();
  const data = useQuery(api.tasks.needsYou, { workspaceId: ws.id });
  const update = useMutation(api.tasks.update);
  const keep = useMutation(api.tasks.keep);
  const decide = useMutation(api.tasks.decide);
  const detail = useDetail();
  const [confirmingAll, setConfirmingAll] = useState(false);
  const run = (p: Promise<unknown>, done: string) => p.then(() => toast.success(done)).catch((e) => toast.error(errorMessage(e)));
  const drop = (id: Id<"tasks">) => run(update({ taskId: id, patch: { status: "superseded" } }), "Dropped");
  const apply = (t: Item) => decide({ taskId: t.id, verdict: t.advice!.verdict, reason: t.advice!.reason });
  const confirm = (t: Item) => run(apply(t), `${t.key}: ${VERDICT[t.advice!.verdict].toLowerCase()}`);

  if (data === undefined) {
    return (
      <>
        <PageHeader title="Needs you" />
        <PageLoading />
      </>
    );
  }
  const total = data.toAccept.length + data.blocked.length + data.proposals.length + data.stale.length;
  const suggested: Item[] = [...data.toAccept, ...data.blocked, ...data.proposals, ...data.stale].filter((t) => t.advice);
  // One at a time, so a refusal on one row (say, a proposal that lost its milestone) leaves the rest answered.
  const confirmAll = async () => {
    setConfirmingAll(false);
    let failed = 0;
    for (const t of suggested) await apply(t).catch(() => failed++);
    const done = suggested.length - failed;
    if (failed) toast.error(`${done} confirmed, ${failed} could not be. They stay on the page.`);
    else toast.success(`${done} suggestion${done === 1 ? "" : "s"} confirmed`);
  };
  const suggestion = (t: Item) => t.advice && <Suggestion advice={t.advice} onConfirm={() => confirm(t)} />;

  return (
    <>
      <PageHeader
        title="Needs you"
        subtitle={total ? `${total} decision${total === 1 ? "" : "s"} waiting, oldest first` : undefined}
        actions={
          suggested.length > 0 &&
          (confirmingAll ? (
            <>
              <Button size="sm" onClick={confirmAll}>
                Confirm {suggested.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingAll(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirmingAll(true)}>
              <Sparkles size={15} /> Confirm all {suggested.length} suggestion{suggested.length === 1 ? "" : "s"}
            </Button>
          ))
        }
      />
      {total === 0 ? (
        <Empty icon={<CircleCheckBig size={22} />} title="Nothing is waiting on you">
          Features to accept, rows blocked on a person and proposals to approve show up here.
        </Empty>
      ) : (
        <div className="mx-auto max-w-4xl space-y-10 p-4 md:p-8">
          {data.toAccept.length > 0 && (
            <List title="To accept" count={data.toAccept.length} hint="Built and on the main branch. Run the acceptance lines, then accept or send back.">
              {data.toAccept.map((t) => (
                <AcceptCard key={t.id} item={t} onOpen={() => detail.open("task", t.id)} suggestion={suggestion(t)} />
              ))}
            </List>
          )}

          {data.blocked.length > 0 && (
            <List title="Blocked" count={data.blocked.length} hint="Each waits on someone. Unblock it by changing its status once that is settled.">
              {data.blocked.map((t) => (
                <Line key={t.id} item={t} onOpen={() => detail.open("task", t.id)} suggestion={suggestion(t)}>
                  <span className="min-w-0 truncate text-[13px] text-fg-2">
                    {t.on ? (
                      <>
                        waits on <span className="font-medium text-fg">{t.on}</span>: {t.what}
                      </>
                    ) : (
                      "no reason given"
                    )}
                  </span>
                </Line>
              ))}
            </List>
          )}

          {data.proposals.length > 0 && (
            <List title="Proposals" count={data.proposals.length} hint="In the backlog. Approving one puts it in the queue; one that is not ready says what it lacks.">
              {data.proposals.map((t) => (
                <Line
                  key={t.id}
                  item={t}
                  onOpen={() => detail.open("task", t.id)}
                  suggestion={suggestion(t)}
                  actions={
                    <>
                      {t.notReady ? (
                        <Button size="sm" variant="secondary" onClick={() => detail.open("task", t.id)}>
                          Complete it
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => run(update({ taskId: t.id, patch: { status: "todo" } }), `${t.key} approved`)}>
                          Approve
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => drop(t.id)}>
                        Drop
                      </Button>
                    </>
                  }
                >
                  <span className="min-w-0 truncate text-[13px] text-fg-3">{t.notReady ?? (t.origin ? `asked by ${t.origin}` : `proposed by ${t.createdBy.name}`)}</span>
                </Line>
              ))}
            </List>
          )}

          {data.stale.length > 0 && (
            <List title="Untouched for 30 days" count={data.stale.length} hint="Keep it for another month, or drop it.">
              {data.stale.map((t) => (
                <Line
                  key={t.id}
                  item={t}
                  onOpen={() => detail.open("task", t.id)}
                  suggestion={suggestion(t)}
                  actions={
                    <>
                      <Button size="sm" variant="secondary" onClick={() => run(keep({ taskId: t.id }), "Kept")}>
                        Keep
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => drop(t.id)}>
                        Drop
                      </Button>
                    </>
                  }
                >
                  <span className="text-[13px] text-fg-3">last touched {ago(t.updatedAt)}</span>
                </Line>
              ))}
            </List>
          )}
        </div>
      )}
    </>
  );
}

type Verdict = "accept" | "send_back" | "unblock" | "approve" | "keep" | "drop";
type Advice = { verdict: Verdict; reason: string; by: string; at: number };
type Item = { id: Id<"tasks">; key: string; title: string; type: string; project: { key: string; name: string; color: string }; milestone: string | null; updatedAt: number; advice: Advice | null };

const VERDICT: Record<Verdict, string> = { accept: "Accept", send_back: "Send back", unblock: "Unblock", approve: "Approve", keep: "Keep", drop: "Drop" };

/** An agent's suggested answer. Confirming it does what the matching button does, with the agent's reason on the history. */
function Suggestion({ advice, onConfirm }: { advice: Advice; onConfirm: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-purple/8 px-3 py-2">
      <Sparkles size={14} className="mt-0.5 shrink-0 text-purple" />
      <div className="min-w-0 flex-1 text-[13px] text-fg-2">
        <span className="font-medium text-fg">{advice.by}</span> suggests <span className="font-medium text-fg">{VERDICT[advice.verdict].toLowerCase()}</span>:{" "}
        <span dir={textDir(advice.reason)}>{advice.reason}</span>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0" onClick={onConfirm}>
        Confirm
      </Button>
    </div>
  );
}

function List({ title, count, hint, children }: { title: string; count: number; hint: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-[17px] font-semibold tracking-tight">
        {title} <span className="font-normal text-fg-3">{count}</span>
      </h2>
      <p className="mt-0.5 text-[13px] text-fg-3">{hint}</p>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-3xl border border-line">{children}</div>
    </section>
  );
}

function Head({ item: t, onOpen }: { item: Item; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex min-w-0 items-center gap-2.5 text-left">
      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: t.project.color }} title={t.project.name} />
      <span className="shrink-0 font-mono text-xs text-fg-3">{t.key}</span>
      {t.type !== "feature" && <Badge tone={t.type === "bug" ? "red" : "neutral"}>{t.type}</Badge>}
      <span className="min-w-0 truncate text-sm font-medium hover:underline" dir={textDir(t.title)}>
        {t.title}
      </span>
      {t.milestone && <span className="shrink-0 font-mono text-xs text-fg-3">{t.milestone}</span>}
    </button>
  );
}

function Line({ item, onOpen, children, actions, suggestion }: { item: Item; onOpen: () => void; children: ReactNode; actions?: ReactNode; suggestion?: ReactNode }) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <Head item={item} onOpen={onOpen} />
          <div className="flex min-w-0 pl-[18px]">{children}</div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {suggestion}
    </div>
  );
}

function AcceptCard({ item: t, onOpen, suggestion }: { item: Item & { acceptance: string; summary: string | null; tasks: number; commits: number; sendBacks: number }; onOpen: () => void; suggestion?: ReactNode }) {
  const review = useMutation(api.tasks.review);
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const run = (args: { accept: boolean; reason?: string }, done: string) =>
    review({ taskId: t.id, ...args })
      .then(() => toast.success(done))
      .catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Head item={t} onOpen={onOpen} />
        </div>
        <span className="shrink-0 text-xs text-fg-3">
          {t.tasks > 0 && `${t.tasks} task${t.tasks === 1 ? "" : "s"} · `}
          {t.commits} commit{t.commits === 1 ? "" : "s"}
          {t.sendBacks > 0 && ` · sent back ${t.sendBacks}×`} · {ago(t.updatedAt)}
        </span>
      </div>
      {t.summary && <Markdown className="text-[14px] text-fg-2">{t.summary}</Markdown>}
      {t.acceptance && (
        <div className="rounded-2xl bg-muted px-4 py-3">
          <div className="mb-1 text-xs font-medium text-fg-3">Acceptance</div>
          <Markdown className="text-[14px]">{t.acceptance}</Markdown>
        </div>
      )}
      {suggestion}
      {sending ? (
        <form onSubmit={(e) => (e.preventDefault(), run({ accept: false, reason }, `${t.key} sent back`))} className="flex gap-2">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One line: why it comes back" className="h-9 text-sm" maxLength={1000} />
          <Button type="submit" size="sm" disabled={!reason.trim()}>
            Send back
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSending(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run({ accept: true }, `${t.key} accepted`)}>
            <Check size={15} /> Accept
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSending(true)}>
            <Undo2 size={15} /> Send back
          </Button>
        </div>
      )}
    </div>
  );
}
