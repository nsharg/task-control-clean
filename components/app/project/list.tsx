"use client";

import { useMutation } from "convex/react";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { ago, errorMessage } from "@/lib/format";
import { useDetail } from "../detail";
import { Segmented } from "../page-header";
import { StatusPicker } from "../pickers";
import { useWorkspace } from "../workspace";
import { Avatar, Badge, Empty } from "../../ui/misc";
import { PriorityIcon, StatusIcon, type Priority, type StatusDef } from "../../ui/status";
import { FeatureList } from "./features";
import { categoryOf, type BoardData, type TaskItem } from "./types";
import { textDir } from "@/lib/dir";

type Scope = "active" | "all" | "done" | "partners";
type Group = { id: string; name: string; depth: number; tasks: TaskItem[]; color?: string };

export function ListView({ board }: { board: BoardData }) {
  return board.project.contract ? <FeatureList board={board} /> : <TaskList board={board} />;
}

function TaskList({ board }: { board: BoardData }) {
  const ws = useWorkspace();
  const statuses = board.project.statuses as StatusDef[];
  const cat = categoryOf(statuses);
  const [scope, setScope] = useState<Scope>("active");
  const [groupBy, setGroupBy] = useState<"section" | "status">(board.sections.length ? "section" : "status");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tasks = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return board.tasks
      .filter((t) => {
        const c = cat(t.status);
        if (scope === "active" && (c === "completed" || c === "canceled")) return false;
        if (scope === "done" && c !== "completed") return false;
        if (scope === "partners" && t.managedBy) return false;
        if (mine && !t.assignees.some((a) => a.id === ws.me.id)) return false;
        if (needle && !`${t.key} ${t.alias ?? ""} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => a.rank - b.rank);
  }, [board.tasks, scope, mine, q, cat, ws.me.id]);

  const groups: Group[] = useMemo(() => {
    if (groupBy === "status") {
      return statuses.map((s) => ({ id: s.key, name: s.name, depth: 0, tasks: tasks.filter((t) => t.status === s.key) })).filter((g) => g.tasks.length);
    }
    const out: Group[] = [];
    const bySection = new Map<string, TaskItem[]>();
    for (const t of tasks) bySection.set(t.sectionId ?? "", [...(bySection.get(t.sectionId ?? "") ?? []), t]);
    const walk = (parentId: string | null, depth: number) => {
      for (const s of board.sections.filter((x) => x.parentId === parentId).sort((a, b) => a.order - b.order)) {
        const own = bySection.get(s.id) ?? [];
        const before = out.length;
        out.push({ id: s.id, name: s.name, depth, tasks: own });
        walk(s.id, depth + 1);
        // Drop sections with nothing to show, here or below.
        if (!own.length && out.length === before + 1) out.pop();
      }
    };
    walk(null, 0);
    const loose = bySection.get("") ?? [];
    if (loose.length) out.push({ id: "none", name: "No section", depth: 0, tasks: loose });
    return out;
  }, [groupBy, tasks, statuses, board.sections]);

  const toggle = (id: string) => setCollapsed((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));

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
            { value: "done", label: "Done" },
            { value: "all", label: "All" },
            ...(board.source ? [{ value: "partners" as const, label: "Added here" }] : []),
          ]}
        />
        <button onClick={() => setMine(!mine)} className={cn("h-8 rounded-full px-3 text-[13px] font-medium", mine ? "bg-accent text-accent-fg" : "bg-muted text-fg-2 hover:text-fg")}>
          Mine
        </button>
        <div className="ml-auto flex items-center gap-2 text-[13px] text-fg-3">
          Group
          <Segmented
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "section", label: "Section" },
              { value: "status", label: "Status" },
            ]}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty title="No tasks match">Try another filter, or press C to add a task.</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.id}>
            <button
              onClick={() => toggle(g.id)}
              className="sticky top-[108px] z-10 flex h-10 w-full items-center gap-2 border-b border-line bg-sidebar/90 px-4 text-left text-[13px] font-medium backdrop-blur md:px-6"
              style={{ paddingLeft: `calc(${g.depth * 20}px + 1rem)` }}
            >
              <ChevronRight size={14} className={cn("text-fg-3 transition-transform", !collapsed.has(g.id) && "rotate-90")} />
              {groupBy === "status" && <StatusIcon category={cat(g.id)} />}
              {g.name}
              <span className="text-fg-3">{g.tasks.length || ""}</span>
            </button>
            {!collapsed.has(g.id) && g.tasks.map((t) => <Row key={t.id} task={t} statuses={statuses} />)}
          </section>
        ))
      )}
    </div>
  );
}

function Row({ task: t, statuses }: { task: TaskItem; statuses: StatusDef[] }) {
  const detail = useDetail();
  const update = useMutation(api.tasks.update);
  const editable = !t.managedBy;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => detail.open("task", t.id)}
      onKeyDown={(e) => e.key === "Enter" && detail.open("task", t.id)}
      className="group flex h-11 cursor-default items-center gap-3 border-b border-line/60 px-4 text-sm hover:bg-muted md:px-6"
    >
      <PriorityIcon priority={t.priority as Priority} />
      {editable ? (
        <StatusPicker
          compact
          statuses={statuses}
          value={t.status}
          onChange={(status) => update({ taskId: t.id as Id<"tasks">, patch: { status } }).catch((e) => toast.error(errorMessage(e)))}
        />
      ) : (
        <span className="flex w-6 justify-center">
          <StatusIcon category={categoryOf(statuses)(t.status)} />
        </span>
      )}
      <span className="w-[88px] shrink-0 truncate font-mono text-xs text-fg-3">{t.alias ?? t.key}</span>
      <span className="min-w-0 flex-1 truncate" dir={textDir(t.title)}>{t.title}</span>
      {t.openDeps > 0 && <Badge tone="amber" className="hidden sm:inline-flex">waits on {t.openDeps}</Badge>}
      {t.ingest.state === "done" && <Badge tone="green">→ {t.ingest.ref}</Badge>}
      {!t.managedBy && t.createdBy.kind === "user" && <Badge className="hidden md:inline-flex">by {t.createdBy.name.split(" ")[0]}</Badge>}
      {t.labels.slice(0, 2).map((l) => (
        <Badge key={l} className="hidden lg:inline-flex">
          {l}
        </Badge>
      ))}
      <span className="flex -space-x-1.5">
        {t.assignees.slice(0, 3).map((a) => (
          <Avatar key={a.id} name={a.name} kind={a.kind} size={20} className="ring-2 ring-bg" />
        ))}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-fg-3 sm:block">{ago(t.updatedAt)}</span>
    </div>
  );
}
