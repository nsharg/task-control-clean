"use client";

import { useMutation } from "convex/react";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";
import { ago, errorMessage } from "@/lib/format";
import { useDetail } from "../detail";
import { Segmented } from "../page-header";
import { StatusPicker } from "../pickers";
import { useWorkspace } from "../workspace";
import { Avatar, Badge, Empty } from "../../ui/misc";
import { PriorityIcon, StatusIcon, type StatusDef } from "../../ui/status";
import { categoryOf, childrenOf, isFeatureItem, isNoteType, type BoardData, type TaskItem } from "./types";

type Scope = "active" | "review" | "done" | "all" | "notes";
type Group = { id: string; name: string; hint?: string; rows: TaskItem[] };

/** A contract project's list: features by milestone, each opening to its tasks and notes. */
export function FeatureList({ board }: { board: BoardData }) {
  const ws = useWorkspace();
  const statuses = board.project.statuses as StatusDef[];
  const cat = categoryOf(statuses);
  const [scope, setScope] = useState<Scope>("active");
  const [groupBy, setGroupBy] = useState<"milestone" | "status">("milestone");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const kids = useMemo(() => childrenOf(board.tasks), [board.tasks]);
  const byId = useMemo(() => new Map(board.tasks.map((t) => [t.id as string, t])), [board.tasks]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (t: TaskItem) => `${t.key} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(needle);
    return board.tasks
      .filter((t) => {
        const c = cat(t.status);
        if (scope === "notes") {
          if (!isNoteType(t.type) || c === "completed" || c === "canceled") return false;
        } else {
          if (!isFeatureItem(t)) return false;
          if (scope === "active" && (c === "completed" || c === "canceled")) return false;
          if (scope === "review" && c !== "review") return false;
          if (scope === "done" && c !== "completed") return false;
        }
        if (mine && !t.assignees.some((a) => a.id === ws.me.id)) return false;
        // A feature matches when it or anything under it does.
        if (needle && !hit(t) && !(kids.get(t.id) ?? []).some(hit)) return false;
        return true;
      })
      .sort((a, b) => a.rank - b.rank);
  }, [board.tasks, scope, mine, q, cat, kids, ws.me.id]);

  const groups: Group[] = useMemo(() => {
    if (scope === "notes") return rows.length ? [{ id: "notes", name: "Open notes", hint: "Findings and ideas: promote, accept as a known limit, or drop", rows }] : [];
    if (groupBy === "status") {
      return statuses.map((s) => ({ id: s.key, name: s.name, rows: rows.filter((t) => t.status === s.key) })).filter((g) => g.rows.length);
    }
    const out: Group[] = board.milestones.map((m) => ({ id: m.id, name: `${m.key} · ${m.name}`, hint: m.closedAt ? "Closed" : undefined, rows: rows.filter((t) => t.milestoneId === m.id) }));
    const loose = rows.filter((t) => !t.milestoneId);
    if (loose.length) out.unshift({ id: "none", name: "No milestone", hint: "Bugs on shipped work, and proposals that still need one", rows: loose });
    return out.filter((g) => g.rows.length);
  }, [scope, groupBy, rows, statuses, board.milestones]);

  const flip = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8 w-48 rounded-full bg-muted pl-8 pr-3 text-[13px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-focus/30" />
        </div>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "active", label: "Active" },
            { value: "review", label: `In review${board.health?.inReview ? ` ${board.health.inReview}` : ""}` },
            { value: "done", label: "Done" },
            { value: "all", label: "All" },
            { value: "notes", label: `Notes${board.health?.notes ? ` ${board.health.notes}` : ""}` },
          ]}
        />
        <button onClick={() => setMine(!mine)} className={cn("h-8 rounded-full px-3 text-[13px] font-medium", mine ? "bg-accent text-accent-fg" : "bg-muted text-fg-2 hover:text-fg")}>
          Mine
        </button>
        {scope !== "notes" && (
          <div className="ml-auto flex items-center gap-2 text-[13px] text-fg-3">
            Group
            <Segmented
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "milestone", label: "Milestone" },
                { value: "status", label: "Status" },
              ]}
            />
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <Empty title={scope === "notes" ? "No open notes" : "No features match"}>{scope === "notes" ? "Findings and ideas noticed along the way land here." : "Try another filter, or press C to add a feature."}</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.id}>
            <button
              onClick={() => setCollapsed((s) => flip(s, g.id))}
              className="sticky top-[108px] z-10 flex h-10 w-full items-center gap-2 border-b border-line bg-sidebar/90 px-4 text-left text-[13px] font-medium backdrop-blur md:px-6"
            >
              <ChevronRight size={14} className={cn("text-fg-3 transition-transform", !collapsed.has(g.id) && "rotate-90")} />
              {groupBy === "status" && scope !== "notes" && <StatusIcon category={cat(g.id)} />}
              <span dir={textDir(g.name)}>{g.name}</span>
              <span className="text-fg-3">{g.rows.length}</span>
              {g.hint && <span className="hidden truncate font-normal text-fg-3 sm:inline">· {g.hint}</span>}
            </button>
            {!collapsed.has(g.id) &&
              g.rows.map((t) => {
                const under = kids.get(t.id) ?? [];
                const isOpen = open.has(t.id) || (!!q.trim() && under.length > 0);
                return (
                  <div key={t.id}>
                    <Row task={t} statuses={statuses} under={under} open={isOpen} onToggle={() => setOpen((s) => flip(s, t.id))} parent={t.parentTaskId ? byId.get(t.parentTaskId) : undefined} />
                    {isOpen && under.map((k) => <Row key={k.id} task={k} statuses={statuses} child />)}
                  </div>
                );
              })}
          </section>
        ))
      )}
    </div>
  );
}

function Row({ task: t, statuses, under, open, onToggle, child, parent }: { task: TaskItem; statuses: StatusDef[]; under?: TaskItem[]; open?: boolean; onToggle?: () => void; child?: boolean; parent?: TaskItem }) {
  const detail = useDetail();
  const update = useMutation(api.tasks.update);
  const cat = categoryOf(statuses);
  const work = (under ?? []).filter((k) => !isNoteType(k.type) && cat(k.status) !== "canceled");
  const done = work.filter((k) => cat(k.status) === "completed").length;
  const notes = (under ?? []).filter((k) => isNoteType(k.type) && cat(k.status) !== "completed" && cat(k.status) !== "canceled").length;
  const note = isNoteType(t.type);
  const faded = cat(t.status) === "completed" || cat(t.status) === "canceled";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => detail.open("task", t.id)}
      onKeyDown={(e) => e.key === "Enter" && detail.open("task", t.id)}
      className={cn("group flex cursor-default items-center gap-3 border-b border-line/60 px-4 text-sm hover:bg-muted md:px-6", child ? "h-9 bg-sidebar/40 pl-12 text-[13px] md:pl-14" : "h-11")}
    >
      {!child &&
        (under?.length ? (
          <button
            onClick={(e) => (e.stopPropagation(), onToggle?.())}
            aria-expanded={open}
            aria-label={open ? "Hide tasks" : "Show tasks"}
            className="-ml-1.5 rounded-md p-0.5 text-fg-3 hover:bg-hover hover:text-fg"
          >
            <ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-[14px]" />
        ))}
      <StatusPicker
        compact
        statuses={statuses}
        value={t.status}
        onChange={(status) => update({ taskId: t.id as Id<"tasks">, patch: { status } }).catch((e) => toast.error(errorMessage(e)))}
      />
      <span className="w-[76px] shrink-0 truncate font-mono text-xs text-fg-3">{t.key}</span>
      {t.priority === "urgent" && <PriorityIcon priority="urgent" />}
      <span className={cn("min-w-0 flex-1 truncate", faded && "text-fg-3")} dir={textDir(t.title)}>
        {t.title}
      </span>
      {note && <Badge tone={t.type === "finding" ? "amber" : "blue"}>{t.type}</Badge>}
      {note && parent && <span className="hidden font-mono text-xs text-fg-3 sm:inline">{parent.key}</span>}
      {t.type === "bug" && <Badge tone="red">bug</Badge>}
      {t.sentBack && cat(t.status) === "started" && <Badge tone="purple">sent back</Badge>}
      {t.blockedOn && cat(t.status) === "blocked" && <Badge tone="red" className="hidden sm:inline-flex">waits on {t.blockedOn}</Badge>}
      {t.openDeps > 0 && <Badge tone="amber" className="hidden sm:inline-flex">waits on {t.openDeps}</Badge>}
      {child && t.tier && t.tier !== "standard" && <Badge tone={t.tier === "critical" ? "red" : "neutral"}>{t.tier}</Badge>}
      {work.length > 0 && (
        <span className="hidden text-xs tabular-nums text-fg-3 sm:inline">
          {done}/{work.length}
        </span>
      )}
      {notes > 0 && <Badge className="hidden md:inline-flex">{notes} note{notes === 1 ? "" : "s"}</Badge>}
      {!child &&
        t.labels
          .filter((l) => l !== "known-limit")
          .slice(0, 1)
          .map((l) => (
            <Badge key={l} className="hidden lg:inline-flex">
              {l}
            </Badge>
          ))}
      {t.labels.includes("known-limit") && <Badge>known limit</Badge>}
      <span className="flex -space-x-1.5">
        {t.assignees.slice(0, 3).map((a) => (
          <Avatar key={a.id} name={a.name} kind={a.kind} size={20} className="ring-2 ring-bg" />
        ))}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-fg-3 sm:block">{ago(t.updatedAt)}</span>
    </div>
  );
}
