"use client";

import { CalendarRange, Settings, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../page-header";
import { useWorkspace } from "../workspace";
import { MilestoneTasks } from "./milestones";
import { Badge, Empty } from "../../ui/misc";
import { Tip } from "../../ui/menu";
import type { StatusDef } from "../../ui/status";
import { childrenOf, planOf, type BoardData } from "./types";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";
import { fmtHours, longDate, shortDate } from "@/lib/format";
import { addDays, daysBetween, weekStart, type Slot } from "@/lib/roadmap";

type Zoom = "weeks" | "months";
type Milestone = BoardData["milestones"][number];

const PX_PER_DAY: Record<Zoom, number> = { weeks: 22, months: 6 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthLabel = (t: number, withYear: boolean) => new Date(t).toLocaleDateString(undefined, { month: "long", year: withYear ? "numeric" : undefined });

/** Milestones on a sprint calendar: one bar each, sized in agent-hours, in build order. */
export function Roadmap({ board }: { board: BoardData }) {
  const ws = useWorkspace();
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cap = board.project.roadmap;

  const plan = useMemo(() => planOf(board), [board]);
  const slotOf = new Map(plan.slots.map((s) => [s.id, s]));
  const px = PX_PER_DAY[zoom];
  const from = weekStart(Math.min(plan.today, ...plan.slots.map((s) => s.start)));
  const to = addDays(weekStart(Math.max(plan.today, ...plan.slots.map((s) => s.end))), 14);
  const days = daysBetween(from, to);
  const width = days * px;
  const x = (t: number) => daysBetween(from, t) * px;
  const columns = zoom === "weeks" ? weeks(from, to) : months(from, to);

  // Open on this week rather than on the oldest shipped milestone.
  const todayX = x(plan.today) - 7 * px;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX);
  }, [todayX]);

  useEffect(() => {
    if (selected) panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  if (!board.milestones.length) {
    return <Empty icon={<CalendarRange size={22} />} title="No milestones yet">The roadmap shows a project&apos;s milestones once it has some.{board.perms.manage && !board.source ? " Add the first one on the Overview." : ""}</Empty>;
  }
  const byId = new Map(board.tasks.map((t) => [t.id as string, t]));
  const current = board.milestones.find((m) => m.id === selected);
  const names = cap.workDays.map((d) => WEEKDAYS[d]);
  const workWeek = names.length > 2 && isRun(cap.workDays) ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-2xl font-semibold tracking-tight">
            {plan.finish ? <>Everything ships by {longDate(plan.finish)}</> : "Everything has shipped"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-2">
            <span className="tabular-nums">{plan.hoursLeft} agent-hours left</span>
            <span className="text-fg-3">·</span>
            <span>
              {cap.hoursPerDay} h/day, {workWeek}
            </span>
            {board.perms.manage && (
              <Link href={`/w/${ws.slug}/p/${board.project.key}/settings#roadmap`} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg" aria-label="Roadmap capacity settings">
                <Settings size={13} />
              </Link>
            )}
          </div>
        </div>
        <Segmented
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "weeks", label: "Sprints" },
            { value: "months", label: "Months" },
          ]}
        />
      </div>

      <div ref={scroller} className="overflow-x-auto rounded-3xl border border-line">
        <div className="relative [--label:76px] sm:[--label:264px]" style={{ width: `calc(var(--label) + ${width}px)`, minWidth: "100%" }}>
          {/* Grid lines and today, behind every row. */}
          <div className="pointer-events-none absolute inset-y-0 left-[var(--label)]" style={{ width }} aria-hidden>
            {columns.map((c) => (
              <div key={c.start} className={cn("absolute inset-y-0 border-l border-line/60", c.now && "bg-blue/[0.04]")} style={{ left: x(c.start), width: x(c.end) - x(c.start) }} />
            ))}
            <div className="absolute inset-y-0 w-px bg-red" style={{ left: x(plan.today) + px / 2 }} />
          </div>

          <div className="sticky top-0 flex h-10 border-b border-line text-[12px] text-fg-3">
            <div className="sticky left-0 z-20 flex w-[var(--label)] shrink-0 items-center border-r border-line bg-bg px-4 font-medium">
              <span className="hidden sm:inline">Milestone</span>
            </div>
            <div className="relative" style={{ width }}>
              {columns.map((c) => (
                <div key={c.start} className={cn("absolute inset-y-0 flex items-center truncate px-2", c.now && "font-medium text-blue")} style={{ left: x(c.start), width: x(c.end) - x(c.start) }}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>

          {board.milestones.map((m) => (
            <Row key={m.id} m={m} slot={slotOf.get(m.id)} x={x} px={px} selected={selected === m.id} onSelect={() => setSelected(selected === m.id ? null : m.id)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-fg-3">
        <Legend className="bg-green">Shipped</Legend>
        <Legend className="bg-blue">In progress</Legend>
        <Legend className="bg-fg-3/30">Not started</Legend>
        <Legend className="border border-dashed border-fg-3 bg-fg-3/10">Sized from its tasks, no estimate yet</Legend>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full bg-blue/40" /> Started, waiting on earlier work
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-red" /> Today
        </span>
      </div>

      {current && (
        <section ref={panel} className="rounded-3xl border border-line">
          <div className="flex items-start gap-3 border-b border-line/60 px-5 py-3.5">
            <span className="mt-0.5 font-mono text-xs text-fg-3">{current.key}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium" dir={textDir(current.name)}>
                {current.name}
              </div>
              {current.goal && (
                <p className="mt-0.5 text-[13px] text-fg-2" dir={textDir(current.goal)}>
                  {current.goal}
                </p>
              )}
              {current.estimateNote && (
                <p className="mt-1.5 text-[12.5px] text-fg-3" dir={textDir(current.estimateNote)}>
                  Estimate: {current.estimateNote}
                </p>
              )}
            </div>
            <button onClick={() => setSelected(null)} className="rounded-full p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">
              <X size={15} />
            </button>
          </div>
          <div className="px-3 py-2">
            <MilestoneTasks milestone={current} byId={byId} statuses={board.project.statuses as StatusDef[]} kids={board.project.contract ? childrenOf(board.tasks) : undefined} />
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ m, slot, x, px, selected, onSelect }: { m: Milestone; slot?: Slot; x: (t: number) => number; px: number; selected: boolean; onSelect: () => void }) {
  if (!slot) return <UnplannedRow m={m} selected={selected} onSelect={onSelect} />;
  const derived = m.agentHours === null && !slot.shipped;
  const started = !slot.shipped && m.startedAt !== null;
  // The bar is the work still to do; earlier work on it shows as a thin line back to when it began.
  const barStart = slot.from ?? slot.start;
  const left = x(barStart);
  const w = Math.max(x(addDays(slot.end, 1)) - left, px);
  const lead = slot.from !== null && slot.start < slot.from ? left - x(slot.start) : 0;
  const hours = `${fmtHours(m.remainingHours)} h`;
  const tip = slot.shipped
    ? `Shipped ${shortDate(slot.end)}`
    : `${derived ? "About " : ""}${hours} left${m.agentHours !== null ? ` of ${fmtHours(m.agentHours)}` : ""} · ${m.progress.percent}% done · ships ${shortDate(slot.end)}`;
  const solid = slot.shipped || (started && !derived);
  return (
    <button onClick={onSelect} aria-expanded={selected} className={cn("group flex h-14 w-full border-b border-line/60 text-left last:border-b-0", selected ? "bg-muted" : "hover:bg-muted/60")}>
      <div className={cn("sticky left-0 z-10 flex h-full w-[var(--label)] shrink-0 flex-col justify-center border-r border-line px-4", selected ? "bg-muted" : "bg-bg group-hover:bg-muted")}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[11.5px] text-fg-3">{m.key}</span>
          <span className="hidden truncate text-[13px] font-medium sm:inline" dir={textDir(m.name)}>
            {m.name}
          </span>
          {m.waitsOn.length > 0 && (
            <Badge tone="amber" className="hidden shrink-0 sm:inline-flex">
              waits on {m.waitsOn.join(", ")}
            </Badge>
          )}
        </div>
        <div className="hidden truncate text-[12px] tabular-nums text-fg-3 sm:block">
          {slot.shipped ? (
            <>Shipped {shortDate(slot.end)}</>
          ) : (
            <>
              {derived ? "~" : ""}
              {hours} left{m.progress.percent > 0 ? ` · ${m.progress.percent}% done` : ""} · ships {shortDate(slot.end)}
              {m.track ? ` · ${m.track}` : ""}
            </>
          )}
        </div>
      </div>
      <div className="relative h-full" style={{ width: 0, flex: 1 }}>
        {lead > 0 && <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-blue/40" style={{ left: left - lead, width: lead }} />}
        <Tip label={tip}>
          <div
            className={cn(
              "absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-full",
              slot.shipped && "bg-green",
              started && (derived ? "border border-dashed border-blue bg-blue/15" : "bg-blue"),
              !slot.shipped && !started && (derived ? "border border-dashed border-fg-3 bg-fg-3/10" : "bg-fg-3/30"),
            )}
            style={{ left, width: w }}
          >
            {w > 44 && (
              <span className={cn("truncate px-2.5 text-[11.5px] font-medium tabular-nums", solid ? "text-white" : "text-fg-2")}>{slot.shipped ? "Shipped" : hours}</span>
            )}
          </div>
        </Tip>
      </div>
    </button>
  );
}

/** A parking-lot milestone: listed so its tasks can be opened, but not sized or scheduled. */
function UnplannedRow({ m, selected, onSelect }: { m: Milestone; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-expanded={selected} className={cn("group flex h-14 w-full border-b border-line/60 text-left last:border-b-0", selected ? "bg-muted" : "hover:bg-muted/60")}>
      <div className={cn("sticky left-0 z-10 flex h-full w-[var(--label)] shrink-0 flex-col justify-center border-r border-line px-4", selected ? "bg-muted" : "bg-bg group-hover:bg-muted")}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[11.5px] text-fg-3">{m.key}</span>
          <span className="hidden truncate text-[13px] font-medium sm:inline" dir={textDir(m.name)}>
            {m.name}
          </span>
        </div>
        <div className="hidden truncate text-[12px] tabular-nums text-fg-3 sm:block">
          Not planned · {m.progress.counted - m.progress.done} open tasks
        </div>
      </div>
      <div className="relative flex h-full items-center" style={{ width: 0, flex: 1 }}>
        <span className="sticky left-[calc(var(--label)+12px)] px-3 text-[12px] text-fg-3">Not on the roadmap</span>
      </div>
    </button>
  );
}

function Legend({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-5 rounded-full", className)} /> {children}
    </span>
  );
}

function weeks(from: number, to: number) {
  const out = [];
  const now = weekStart(Date.now());
  for (let s = from; s < to; s = addDays(s, 7)) {
    const end = addDays(s, 7);
    out.push({ start: s, end, now: s === now, label: `${shortDate(s)} – ${new Date(addDays(s, 6)).getDate()}` });
  }
  return out;
}

function months(from: number, to: number) {
  const out = [];
  const d = new Date(from);
  d.setDate(1);
  const thisMonth = new Date().getMonth() + new Date().getFullYear() * 12;
  while (d.getTime() < to) {
    const s = Math.max(d.getTime(), from);
    const key = d.getMonth() + d.getFullYear() * 12;
    d.setMonth(d.getMonth() + 1);
    out.push({ start: s, end: Math.min(d.getTime(), to), now: key === thisMonth, label: monthLabel(s, !out.length || new Date(s).getMonth() === 0) });
  }
  return out;
}

const isRun = (d: number[]) => d.every((v, i) => i === 0 || v === d[i - 1] + 1);
