"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { useMembers, useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Avatar, Empty, PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/format";

type Role = "lead" | "member" | "viewer";

export default function ProjectSettings() {
  const ws = useWorkspace();
  const { key } = useParams<{ key: string }>();
  const board = useQuery(api.projects.board, { workspaceId: ws.id, key });
  const members = useMembers();
  const update = useMutation(api.projects.update);
  const setMember = useMutation(api.projects.setMember);
  if (board === undefined) return <PageLoading />;
  if (!board.perms.manage) return <Empty title="Project leads only" />;
  const p = board.project;
  const roleOf = (id: string) => board.members.find((m) => m.principalId === id)?.role;
  const run = (x: Promise<unknown>, ok?: string) => x.then(() => ok && toast.success(ok)).catch((e) => toast.error(errorMessage(e)));

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link href={`/w/${ws.slug}/p/${p.key}`} className="rounded-full p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Back">
              <ArrowLeft size={16} />
            </Link>
            {p.name} settings
          </span>
        }
      />
      <div className="mx-auto max-w-2xl space-y-12 p-4 md:p-8">
        <DetailsForm key={p.id} project={p} onSave={(patch) => run(update({ projectId: p.id, ...patch }), "Saved")} />

        <RoadmapForm key={`${p.id}-roadmap`} roadmap={p.roadmap} onSave={(roadmap) => run(update({ projectId: p.id, roadmap }), "Saved")} />

        <section>
          <h2 className="font-display text-[17px] font-semibold tracking-tight">Access</h2>
          <p className="mt-1 text-sm text-fg-2">Guests see a project only once they are added here. Viewers can read and comment.</p>
          <ul className="mt-4 divide-y divide-line rounded-3xl border border-line">
            {members?.people.map((m) => {
              const r = roleOf(m.userId);
              const implicit = m.role === "owner" || m.role === "admin";
              return (
                <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.name}</div>
                    <div className="text-[13px] capitalize text-fg-3">{m.role}</div>
                  </div>
                  {implicit ? (
                    <span className="text-[13px] text-fg-3">Full access</span>
                  ) : (
                    <select
                      value={r ?? ""}
                      onChange={(e) => run(setMember({ projectId: p.id, kind: "user", principalId: m.userId, role: (e.target.value || null) as Role | null }))}
                      className="h-8 rounded-full bg-muted px-3 text-[13px]"
                    >
                      <option value="">{m.role === "guest" || p.visibility === "members" ? "No access" : "Member (via workspace)"}</option>
                      <option value="viewer">Viewer</option>
                      <option value="member">Member</option>
                      <option value="lead">Lead</option>
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {!board.source && (
          <section className="rounded-3xl border border-line p-5">
            <h2 className="font-medium">Milestones, features and tasks</h2>
            <p className="mt-1 text-sm text-fg-2">
              {p.contract
                ? "On. Features sit in milestones with tasks under them, a feature needs a milestone and acceptance lines to start, and a person accepts it. Progress counts features."
                : "Off. Every row is a task of the same level, and progress counts tasks."}
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => run(update({ projectId: p.id, contract: !p.contract }), p.contract ? "Turned off" : "Turned on")}>
              {p.contract ? "Turn off" : "Turn on"}
            </Button>
          </section>
        )}

        <section className="rounded-3xl border border-red/30 p-5">
          <h2 className="font-medium">{p.archived ? "Restore project" : "Archive project"}</h2>
          <p className="mt-1 text-sm text-fg-2">An archived project is read-only and moves to the bottom of the sidebar. Nothing is deleted, and its keys still open.</p>
          <Button className="mt-3" variant={p.archived ? "secondary" : "danger"} size="sm" onClick={() => run(update({ projectId: p.id, archived: !p.archived }), p.archived ? "Restored" : "Archived")}>
            {p.archived ? "Restore" : "Archive"}
          </Button>
        </section>
      </div>
    </>
  );
}

type Capacity = { hoursPerDay: number; workDays: number[] };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How fast the roadmap assumes work goes: coding-agent hours per working day. */
function RoadmapForm({ roadmap, onSave }: { roadmap: Capacity; onSave: (r: Capacity) => void }) {
  const [hours, setHours] = useState(String(roadmap.hoursPerDay));
  const [days, setDays] = useState(new Set(roadmap.workDays));
  const toggle = (d: number) => setDays((s) => {
    const n = new Set(s);
    if (n.has(d)) n.delete(d);
    else n.add(d);
    return n;
  });
  return (
    <form id="roadmap" onSubmit={(e) => (e.preventDefault(), onSave({ hoursPerDay: Number(hours), workDays: [...days].sort((a, b) => a - b) }))} className="space-y-4">
      <div>
        <h2 className="font-display text-[17px] font-semibold tracking-tight">Roadmap capacity</h2>
        <p className="mt-1 text-sm text-fg-2">The roadmap turns each milestone&apos;s agent-hours into dates at this pace.</p>
      </div>
      <Field label="Agent-hours per working day">
        <Input type="number" min={0.5} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} required className="w-32" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-fg-2">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((name, d) => (
            <button
              key={name}
              type="button"
              aria-pressed={days.has(d)}
              onClick={() => toggle(d)}
              className={days.has(d) ? "h-8 rounded-full bg-accent px-3 text-[13px] text-accent-fg" : "h-8 rounded-full bg-muted px-3 text-[13px] text-fg-2 hover:text-fg"}
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={!days.size}>
          Save
        </Button>
      </div>
    </form>
  );
}

type Visibility = "workspace" | "members";

function DetailsForm({ project, onSave }: { project: { name: string; description: string; visibility: Visibility }; onSave: (p: { name: string; description: string; visibility: Visibility }) => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [visibility, setVisibility] = useState<Visibility>(project.visibility);
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSave({ name, description, visibility }))} className="space-y-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </Field>
      <Field label="Visibility">
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
          <option value="workspace">Everyone in the workspace</option>
          <option value="members">Project members only</option>
        </Select>
      </Field>
      <div className="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
