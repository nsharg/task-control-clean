"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useMutation } from "convex/react";
import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/format";
import { useDetail } from "../detail";
import { Avatar, Badge } from "../../ui/misc";
import { PriorityIcon, StatusIcon, type Priority, type StatusDef } from "../../ui/status";
import { categoryOf, childrenOf, isFeatureItem, isNoteType, type BoardData, type TaskItem } from "./types";
import { textDir } from "@/lib/dir";

const PAGE = 60;

export function Board({ board }: { board: BoardData }) {
  const statuses = board.project.statuses as StatusDef[];
  const update = useMutation(api.tasks.update);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const statusOf = (t: TaskItem) => optimistic[t.id] ?? t.status;
  // A contract project's board holds features; their tasks show as a count on the card.
  const contract = board.project.contract;
  const cards = contract ? board.tasks.filter(isFeatureItem) : board.tasks;
  const kids = contract ? childrenOf(board.tasks) : undefined;
  const cat = categoryOf(statuses);
  const tally = (t: TaskItem) => {
    const work = (kids?.get(t.id) ?? []).filter((k) => !isNoteType(k.type) && cat(k.status) !== "canceled");
    return work.length ? `${work.filter((k) => cat(k.status) === "completed").length}/${work.length}` : undefined;
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const id = e.active.id as string;
    const to = e.over?.id as string | undefined;
    const task = board.tasks.find((t) => t.id === id);
    if (!task || !to || statusOf(task) === to) return;
    setOptimistic((o) => ({ ...o, [id]: to }));
    try {
      await update({ taskId: id as Id<"tasks">, patch: { status: to } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOptimistic((o) => {
        const rest = { ...o };
        delete rest[id];
        return rest;
      });
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-[calc(100vh-108px)] gap-3 overflow-x-auto p-4 md:px-6">
        {statuses.map((s) => (
          <Column key={s.key} status={s} tasks={cards.filter((t) => statusOf(t) === s.key).sort((a, b) => a.rank - b.rank)} canWrite={board.perms.write} tally={tally} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ status, tasks, canWrite, tally }: { status: StatusDef; tasks: TaskItem[]; canWrite: boolean; tally: (t: TaskItem) => string | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key });
  const [limit, setLimit] = useState(PAGE);
  return (
    <div ref={setNodeRef} className={cn("flex w-72 shrink-0 flex-col rounded-3xl bg-sidebar transition-colors", isOver && "bg-hover")}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5 text-[13px] font-medium">
        <StatusIcon category={status.category} /> {status.name} <span className="text-fg-3">{tasks.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {tasks.slice(0, limit).map((t) => (
          <Card key={t.id} task={t} draggable={canWrite && !t.managedBy} tally={tally(t)} />
        ))}
        {tasks.length > limit && (
          <button onClick={() => setLimit(limit + PAGE)} className="w-full rounded-xl py-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
            Show {Math.min(PAGE, tasks.length - limit)} more
          </button>
        )}
      </div>
    </div>
  );
}

function Card({ task: t, draggable, tally }: { task: TaskItem; draggable: boolean; tally?: string }) {
  const detail = useDetail();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => detail.open("task", t.id)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "cursor-default rounded-2xl border border-line bg-bg p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:border-line-strong",
        isDragging && "z-50 rotate-1 shadow-pop",
      )}
    >
      <div className="flex items-center gap-2 text-[11.5px] text-fg-3">
        <span className="font-mono">{t.alias ?? t.key}</span>
        {t.managedBy && <Lock size={11} aria-label="Synced, read-only" />}
        <span className="ml-auto">
          <PriorityIcon priority={t.priority as Priority} size={12} />
        </span>
      </div>
      <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-snug" dir={textDir(t.title)}>{t.title}</p>
      {(t.assignees.length > 0 || t.openDeps > 0 || t.ingest.state === "done" || tally || t.sentBack || t.blockedOn) && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {tally && <Badge>{tally} tasks</Badge>}
          {t.sentBack && <Badge tone="purple">sent back</Badge>}
          {t.blockedOn && <Badge tone="red">waits on {t.blockedOn}</Badge>}
          {t.openDeps > 0 && <Badge tone="amber">waits on {t.openDeps}</Badge>}
          {t.ingest.state === "done" && <Badge tone="green">→ {t.ingest.ref}</Badge>}
          <span className="ml-auto flex -space-x-1.5">
            {t.assignees.slice(0, 3).map((a) => (
              <Avatar key={a.id} name={a.name} kind={a.kind} size={20} className="ring-2 ring-bg" />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
