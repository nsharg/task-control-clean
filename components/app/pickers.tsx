"use client";

import { UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../ui/menu";
import { Avatar } from "../ui/misc";
import { PRIORITIES, PRIORITY_LABEL, PriorityIcon, StatusIcon, type Priority, type StatusDef } from "../ui/status";
import { useMembers } from "./workspace";

const chip = "inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-[13px] text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none";

export function StatusPicker({ statuses, value, onChange, disabled, compact }: { statuses: StatusDef[]; value: string; onChange: (s: string) => void; disabled?: boolean; compact?: boolean }) {
  const cur = statuses.find((s) => s.key === value);
  return (
    <Menu>
      <MenuTrigger disabled={disabled} className={cn(chip, compact && "h-6 px-1")} onClick={(e) => e.stopPropagation()} aria-label="Status">
        <StatusIcon category={cur?.category ?? "backlog"} />
        {!compact && <span className="text-fg">{cur?.name ?? value}</span>}
      </MenuTrigger>
      <MenuContent>
        {statuses.map((s) => (
          <MenuItem key={s.key} checked={s.key === value} onSelect={() => onChange(s.key)}>
            <StatusIcon category={s.category} /> {s.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function PriorityPicker({ value, onChange, disabled, compact }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <Menu>
      <MenuTrigger disabled={disabled} className={cn(chip, compact && "h-6 px-1")} onClick={(e) => e.stopPropagation()} aria-label="Priority">
        <PriorityIcon priority={value} />
        {!compact && <span>{PRIORITY_LABEL[value]}</span>}
      </MenuTrigger>
      <MenuContent>
        {PRIORITIES.map((p) => (
          <MenuItem key={p} checked={p === value} onSelect={() => onChange(p)}>
            <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

type Assignee = { kind: "user" | "agent"; id: string; name: string };

export function AssigneePicker({ value, onChange, disabled, children }: { value: Assignee[]; onChange: (ids: string[]) => void; disabled?: boolean; children?: ReactNode }) {
  const members = useMembers();
  const ids = value.map((a) => a.id);
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <Menu>
      <MenuTrigger disabled={disabled} className={chip} onClick={(e) => e.stopPropagation()} aria-label="Assignees">
        {children ??
          (value.length ? (
            <>
              <span className="flex -space-x-1.5">
                {value.slice(0, 3).map((a) => (
                  <Avatar key={a.id} name={a.name} kind={a.kind} size={20} className="ring-2 ring-bg" />
                ))}
              </span>
              <span className="max-w-40 truncate text-fg">{value.map((a) => a.name).join(", ")}</span>
            </>
          ) : (
            <>
              <UserPlus size={15} /> Assign
            </>
          ))}
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>People</MenuLabel>
        {members?.people.map((m) => (
          <MenuItem key={m.userId} checked={ids.includes(m.userId)} onSelect={() => toggle(m.userId)}>
            <Avatar name={m.name} size={20} /> {m.name}
          </MenuItem>
        ))}
        {!!members?.agents.length && <MenuLabel>Agents</MenuLabel>}
        {members?.agents.map((a) => (
          <MenuItem key={a.id} checked={ids.includes(a.id)} onSelect={() => toggle(a.id)}>
            <Avatar name={a.name} kind="agent" size={20} /> {a.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
