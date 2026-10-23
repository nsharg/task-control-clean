"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/format";
import { Button } from "../../ui/button";
import { Dialog, DialogContent } from "../../ui/dialog";
import { Field, Input, Textarea } from "../../ui/input";
import type { BoardData } from "./types";

type Milestone = BoardData["milestones"][number];

/** Create or edit a milestone: an outcome that ships, with the lines that say it has. */
export function MilestoneDialog({ projectId, milestone: m, suggestedKey, open, onOpenChange }: { projectId: Id<"projects">; milestone?: Milestone; suggestedKey: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const upsert = useMutation(api.projects.upsertMilestone);
  const remove = useMutation(api.projects.removeMilestone);
  const [key, setKey] = useState(m?.key ?? suggestedKey);
  const [name, setName] = useState(m?.name ?? "");
  const [goal, setGoal] = useState(m?.goal ?? "");
  const [exitCriteria, setExitCriteria] = useState(m?.exitCriteria ?? "");
  const [track, setTrack] = useState(m?.track ?? "");
  const [hours, setHours] = useState(m?.agentHours != null ? String(m.agentHours) : "");
  const [unplanned, setUnplanned] = useState(m?.unplanned ?? false);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(
      () => upsert({ projectId, id: m?.id as Id<"milestones"> | undefined, key, name, goal, exitCriteria, track, agentHours: hours.trim() ? Number(hours) : null, unplanned }),
      m ? "Saved" : `${key} created`,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={m ? `Milestone ${m.key}` : "New milestone"} description="An outcome that ships: 5 to 15 features, weeks of work.">
        <form onSubmit={(e) => (e.preventDefault(), save())} className="space-y-4">
          <div className="grid grid-cols-[90px_1fr] gap-3">
            <Field label="Key">
              <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} className="font-mono" required />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Notes ready to use" required autoFocus={!m} maxLength={80} />
            </Field>
          </div>
          <Field label="Goal" hint="One to three sentences: who gets what.">
            <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} className="min-h-16" maxLength={2000} />
          </Field>
          <Field label="Exit criteria" hint="Three to seven lines a person can check.">
            <Textarea value={exitCriteria} onChange={(e) => setExitCriteria(e.target.value)} className="min-h-24" maxLength={2000} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent-hours" hint="Leave empty to size it from its features.">
              <Input type="number" min={0} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
            <Field label="Track" hint="Milestones on different tracks run side by side.">
              <Input value={track} onChange={(e) => setTrack(e.target.value)} maxLength={40} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" checked={unplanned} onChange={(e) => setUnplanned(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            A parking lot: listed, not scheduled on the roadmap
          </label>
          <div className="flex items-center gap-2 border-t border-line pt-4">
            {m && (
              <>
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => run(() => upsert({ projectId, id: m.id as Id<"milestones">, name: m.name, closed: !m.closedAt }), m.closedAt ? "Reopened" : `${m.key} closed`)}>
                  {m.closedAt ? "Reopen" : "Close milestone"}
                </Button>
                {m.progress.total === 0 && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => confirm(`Delete ${m.key}?`) && run(() => remove({ milestoneId: m.id as Id<"milestones"> }), "Deleted")}>
                    Delete
                  </Button>
                )}
              </>
            )}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim() || !key}>
              {m ? "Save" : "Create milestone"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
