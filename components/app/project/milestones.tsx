"use client";

import { ChevronRight, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { MilestoneDialog } from "./milestone-dialog";
import { useDetail } from "../detail";
import { Badge, Progress } from "../../ui/misc";
import { Tip } from "../../ui/menu";
import { StatusIcon, type StatusDef } from "../../ui/status";
import { categoryOf, childrenOf, type BoardData, type planOf, type TaskItem } from "./types";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";
import { fmtHours, shortDate } from "@/lib/format";

type Milestone = BoardData["milestones"][number];

/** Milestones in build order, each with its roadmap estimate; each opens to its tasks, open work first and finished work folded away. */
export function MilestoneList({ board, plan }: { board: BoardData; plan: ReturnType<typeof planOf> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const byId = new Map(board.tasks.map((t) => [t.id as string, t]));
  const slotOf = new Map(plan.slots.map((s) => [s.id, s]));
  const [editing, setEditing] = useState<string | null>(null);
  const kids = board.project.contract ? childrenOf(board.tasks) : undefined;
  const edited = board.milestones.find((m) => m.id === editing);

  return (
    <div className="divide-y divide-line overflow-hidden rounded-3xl border border-line">
      {edited && <MilestoneDialog key={edited.id} projectId={board.project.id as Id<"projects">} milestone={edited} suggestedKey={edited.key} open onOpenChange={(o) => !o && setEditing(null)} />}
      {board.milestones.map((m) => {
        const isOpen = open.has(m.id);
        const slot = slotOf.get(m.id);
        const derived = m.agentHours === null;
        return (
          <div key={m.id} className="group/ms relative">
            {board.perms.manage && !m.managedBy && (
              <button onClick={() => setEditing(m.id)} aria-label={`Edit ${m.key}`} className="absolute right-1.5 top-1.5 rounded-full p-1.5 text-fg-3 opacity-0 hover:bg-hover hover:text-fg focus:opacity-100 group-hover/ms:opacity-100">
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={() => toggle(m.id)}
              aria-expanded={isOpen}
              aria-controls={`ms-${m.id}`}
              className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-muted"
            >
              <ChevronRight size={14} className={cn("-ml-1 shrink-0 text-fg-3 transition-transform", isOpen && "rotate-90")} />
              <span className="w-12 shrink-0 font-mono text-xs text-fg-3">{m.key}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium" dir={textDir(m.name)}>
                    {m.name}
                  </span>
                  {m.closedAt && <Badge className="shrink-0">Closed</Badge>}
                  {m.waitsOn.length > 0 && (
                    <Badge tone="amber" className="shrink-0">
                      waits on {m.waitsOn.join(", ")}
                    </Badge>
                  )}
                </div>
                {m.goal && (
                  <div className="truncate text-[13px] text-fg-3" dir={textDir(m.goal)}>
                    {m.goal}
                  </div>
                )}
              </div>
              <div className="hidden w-40 sm:block">
                <Progress value={m.progress.percent} />
              </div>
              <div className="w-24 shrink-0 text-right tabular-nums">
                <div className="text-[13px] text-fg-2">
                  {m.progress.done}/{m.progress.counted}
                </div>
                {m.unplanned && (
                  <Tip label="A parking lot: its tasks are not scheduled, so the roadmap leaves it out">
                    <div className="truncate text-[12px] text-fg-3">Not planned</div>
                  </Tip>
                )}
                {slot && (slot.shipped || m.remainingHours > 0) && (
                  <Tip
                    label={
                      slot.shipped
                        ? `Shipped ${shortDate(slot.end)}`
                        : `${derived ? "About " : ""}${fmtHours(m.remainingHours)} agent-hours left${m.agentHours !== null ? ` of ${fmtHours(m.agentHours)}` : ", sized from its tasks"} · ships ${shortDate(slot.end)}`
                    }
                  >
                    <div className="truncate text-[12px] text-fg-3">
                      {slot.shipped ? (
                        <>Shipped {shortDate(slot.end)}</>
                      ) : (
                        <>
                          {derived ? "~" : ""}
                          {fmtHours(m.remainingHours)} h · {shortDate(slot.end)}
                        </>
                      )}
                    </div>
                  </Tip>
                )}
              </div>
            </button>
            {isOpen && (
              <div id={`ms-${m.id}`} className="border-t border-line/60 bg-sidebar/40 px-3 py-2 sm:pl-[88px]">
                <MilestoneTasks milestone={m} byId={byId} statuses={board.project.statuses as StatusDef[]} kids={kids} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** `kids` is given for a contract project: its rows are features, and each shows the tasks and notes under it. */
export function MilestoneTasks({ milestone: m, byId, statuses, kids }: { milestone: Milestone; byId: Map<string, TaskItem>; statuses: StatusDef[]; kids?: Map<string, TaskItem[]> }) {
  const [showDone, setShowDone] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const cat = categoryOf(statuses);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is TaskItem => !!t);
  const tasks = pick(m.tasks);
  const done = tasks.filter((t) => cat(t.status) === "completed");
  const open = tasks.filter((t) => cat(t.status) !== "completed");
  // What sits under a feature is drawn under it, so only loose rows are "other".
  const other = pick(m.other).filter((t) => !kids || !t.parentTaskId);

  if (!tasks.length && !other.length) return <p className="px-2 py-2 text-[13px] text-fg-3">{kids ? "No features in this milestone yet." : "No tasks in this milestone yet."}</p>;
  return (
    <div>
      {open.length > 0 ? <Tree tasks={open} statuses={statuses} kids={kids} /> : <p className="px-2 py-1.5 text-[13px] text-fg-3">Everything here is done.</p>}
      {done.length > 0 && (
        <Fold label={`${showDone ? "Hide" : "Show"} ${done.length} done`} open={showDone} onToggle={() => setShowDone((v) => !v)}>
          <Tree tasks={done} statuses={statuses} kids={kids} />
        </Fold>
      )}
      {other.length > 0 && (
        <Fold label={`${other.length} not counted toward progress`} open={showOther} onToggle={() => setShowOther((v) => !v)}>
          <Tree tasks={other} statuses={statuses} muted />
        </Fold>
      )}
    </div>
  );
}

function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-fg-3 hover:text-fg-2">
        <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
        {label}
      </button>
      {open && children}
    </div>
  );
}

/** Tasks in the given order, with subtasks nested under a parent that is in the same list. */
function Tree({ tasks, statuses, muted, kids }: { tasks: TaskItem[]; statuses: StatusDef[]; muted?: boolean; kids?: Map<string, TaskItem[]> }) {
  const ids = new Set(tasks.map((t) => t.id as string));
  const children = new Map<string, TaskItem[]>(kids);
  if (!kids) for (const t of tasks) if (t.parentTaskId && ids.has(t.parentTaskId)) children.set(t.parentTaskId, [...(children.get(t.parentTaskId) ?? []), t]);
  const walk = (t: TaskItem, depth: number): ReactNode[] => [
    <TaskLine key={t.id} task={t} depth={depth} statuses={statuses} muted={muted} />,
    ...(children.get(t.id) ?? []).flatMap((c) => walk(c, depth + 1)),
  ];
  return <ul>{tasks.filter((t) => !t.parentTaskId || !ids.has(t.parentTaskId)).flatMap((t) => walk(t, 0))}</ul>;
}

function TaskLine({ task: t, depth, statuses, muted }: { task: TaskItem; depth: number; statuses: StatusDef[]; muted?: boolean }) {
  const detail = useDetail();
  const status = statuses.find((s) => s.key === t.status);
  const category = categoryOf(statuses)(t.status);
  const faded = muted || category === "completed" || category === "canceled";
  return (
    <li>
      <button
        onClick={() => detail.open("task", t.id)}
        className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[13px] hover:bg-hover"
        style={{ paddingLeft: `calc(${depth * 20}px + 0.5rem)` }}
      >
        <StatusIcon category={category} size={13} />
        <span className="w-[76px] shrink-0 truncate font-mono text-[11.5px] text-fg-3">{t.alias ?? t.key}</span>
        <span className={cn("min-w-0 flex-1 truncate", faded && "text-fg-3")} dir={textDir(t.title)}>
          {t.title}
        </span>
        {t.openDeps > 0 && (
          <Badge tone="amber" className="hidden shrink-0 sm:inline-flex">
            waits on {t.openDeps}
          </Badge>
        )}
        <span className="hidden w-24 shrink-0 truncate text-right text-xs text-fg-3 sm:block">{status?.name ?? t.status}</span>
      </button>
    </li>
  );
}
