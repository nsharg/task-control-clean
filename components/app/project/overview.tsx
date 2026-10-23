"use client";

import { AlertCircle, Flag, Play, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "../../ui/button";
import { MilestoneDialog } from "./milestone-dialog";
import { useDetail } from "../detail";
import { MilestoneList } from "./milestones";
import { Progress } from "../../ui/misc";
import { CATEGORY_COLOR, StatusIcon, type Category, type StatusDef } from "../../ui/status";
import { categoryOf, isFeatureItem, planOf, type BoardData, type TaskItem } from "./types";
import { textDir } from "@/lib/dir";
import { ago, longDate } from "@/lib/format";

export function Overview({ board }: { board: BoardData }) {
  const statuses = board.project.statuses as StatusDef[];
  const cat = categoryOf(statuses);
  const detail = useDetail();
  const top = board.sections.filter((s) => !s.parentId).sort((a, b) => a.order - b.order);
  const contract = board.project.contract;
  // In a contract project the cards hold features; tasks and notes live under them.
  const rows = contract ? board.tasks.filter(isFeatureItem) : board.tasks;
  const position = new Map(board.milestones.map((m, i) => [m.id as string, i]));
  const blocked = board.tasks.filter((t) => cat(t.status) === "blocked");
  const active = rows.filter((t) => cat(t.status) === "started" || cat(t.status) === "review");
  const next = rows
    .filter((t) => (cat(t.status) === "unstarted" || (!contract && cat(t.status) === "backlog")) && t.openDeps === 0)
    .sort((a, b) => (contract ? (position.get(a.milestoneId ?? "") ?? -1) - (position.get(b.milestoneId ?? "") ?? -1) : 0) || a.rank - b.rank)
    .slice(0, 8);
  const [newMilestone, setNewMilestone] = useState(false);
  const unit = contract ? "features" : "tasks";
  const h = board.health;
  // The next free "M<n>" key, to prefill a new milestone.
  const suggestedKey = `M${Math.max(0, ...board.milestones.map((m) => Number(/^M(\d+)$/.exec(m.key)?.[1] ?? 0))) + 1}`;
  const counts = board.progress.counts as Partial<Record<Category, number>>;
  const order: Category[] = ["completed", "review", "started", "blocked", "unstarted", "backlog"];
  const total = order.reduce((a, c) => a + (counts[c] ?? 0), 0) || 1;
  const plan = useMemo(() => planOf(board), [board]);
  // Rough while any unfinished milestone is sized from its tasks rather than estimated.
  const rough = board.milestones.some((m) => m.agentHours === null && m.remainingHours > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-4 md:p-8">
      <section className="rounded-3xl border border-line p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-display text-5xl font-semibold tracking-tight tabular-nums">{board.progress.percent}%</div>
            <div className="mt-1 text-sm text-fg-2">
              {board.progress.done} of {board.progress.counted} {unit} done{board.progress.weighted ? ", weighted by estimate" : ""}
            </div>
            {board.milestones.length > 0 && (
              <div className="mt-0.5 text-sm text-fg-2">
                {plan.finish ? (
                  <>
                    Ships by <span className="font-medium text-fg">{longDate(plan.finish)}</span>
                    <span className="text-fg-3">
                      {" · "}
                      {rough ? "~" : ""}
                      <span className="tabular-nums">{plan.hoursLeft}</span> agent-hours left
                    </span>
                  </>
                ) : (
                  "Every milestone has shipped"
                )}
              </div>
            )}
          </div>
          {board.project.description && <p className="max-w-md text-sm text-fg-2">{board.project.description}</p>}
        </div>
        <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-hover" role="img" aria-label={contract ? "Features by status" : "Tasks by status"}>
          {order.map((c) => (counts[c] ? <div key={c} style={{ width: `${((counts[c] ?? 0) / total) * 100}%`, background: CATEGORY_COLOR[c] }} /> : null))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-2">
          {order.map((c) =>
            counts[c] ? (
              <span key={c} className="inline-flex items-center gap-1.5">
                <StatusIcon category={c} size={12} /> {statuses.find((s) => s.category === c)?.name ?? c} <span className="tabular-nums text-fg-3">{counts[c]}</span>
              </span>
            ) : null,
          )}
        </div>
        {h && (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[13px] text-fg-2" aria-label="Health">
            <Stat label="in review" value={h.inReview} note={h.oldestReviewAt ? `oldest ${ago(h.oldestReviewAt)}` : undefined} />
            <Stat label="proposals to approve" value={h.proposals} />
            <Stat label="open notes" value={h.notes} />
            <Stat label="untouched for 30 days" value={h.stale} warn={h.stale > 0} />
            <Stat label="without a milestone or a feature" value={h.orphans} warn={h.orphans > 0} />
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <TaskCard title="Blocked" icon={<AlertCircle size={15} className="text-red" />} tasks={blocked} empty="Nothing blocked." cat={cat} onOpen={(id) => detail.open("task", id)} />
        <TaskCard title="In progress" icon={<Play size={15} className="text-amber" />} tasks={active} empty="Nothing in progress." cat={cat} onOpen={(id) => detail.open("task", id)} />
        <TaskCard title="Up next" icon={<Flag size={15} className="text-blue" />} tasks={next} empty="Nothing ready to start." cat={cat} onOpen={(id) => detail.open("task", id)} />
      </div>

      {(board.milestones.length > 0 || (contract && board.perms.manage)) && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[17px] font-semibold tracking-tight">Milestones</h2>
            {board.perms.manage && !board.source && (
              <Button size="sm" variant="secondary" onClick={() => setNewMilestone(true)}>
                <Plus size={14} /> Milestone
              </Button>
            )}
          </div>
          {board.milestones.length > 0 ? (
            <MilestoneList board={board} plan={plan} />
          ) : (
            <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-sm text-fg-2">No milestones yet. A feature needs one before it can start.</p>
          )}
          {newMilestone && <MilestoneDialog projectId={board.project.id as Id<"projects">} suggestedKey={suggestedKey} open onOpenChange={setNewMilestone} />}
        </section>
      )}

      {top.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[17px] font-semibold tracking-tight">Areas</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((s) => {
              const children = board.sections.filter((c) => c.parentId === s.id && c.progress.total > 0).sort((a, b) => a.order - b.order);
              return (
                <div key={s.id} className="min-w-0 rounded-2xl border border-line p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="text-[13px] tabular-nums text-fg-2">{s.progress.percent}%</span>
                  </div>
                  <Progress value={s.progress.percent} className="mt-2.5" />
                  <div className="mt-3 space-y-1">
                    {children.slice(0, 5).map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-[12.5px] text-fg-3">
                        <span className="truncate">{c.name}</span>
                        <span className="tabular-nums">
                          {c.progress.done}/{c.progress.counted}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={warn ? "font-medium tabular-nums text-amber" : "font-medium tabular-nums text-fg"}>{value}</span> {label}
      {note && <span className="text-fg-3">· {note}</span>}
    </span>
  );
}

function TaskCard({ title, icon, tasks, empty, cat, onOpen }: { title: string; icon: ReactNode; tasks: TaskItem[]; empty: string; cat: (k: string) => Category; onOpen: (id: string) => void }) {
  return (
    <section className="min-w-0 rounded-3xl border border-line p-4">
      <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
        {icon} {title} <span className="text-fg-3">{tasks.length}</span>
      </h3>
      {tasks.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-fg-3">{empty}</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {tasks.slice(0, 30).map((t) => (
            <li key={t.id}>
              <button onClick={() => onOpen(t.id)} className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left text-[13px] hover:bg-muted">
                <StatusIcon category={cat(t.status)} size={13} />
                <span className="shrink-0 font-mono text-[11.5px] text-fg-3">{t.alias ?? t.key}</span>
                <span className="truncate" dir={textDir(t.title)}>{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
