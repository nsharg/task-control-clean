"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/input";
import { useDetail } from "./detail";
import { Segmented } from "./page-header";
import { AssigneePicker } from "./pickers";
import { useMembers } from "./workspace";

type Kind = "feature" | "bug" | "note";

const COPY: Record<Kind, { title: string; why: string; whyHint: string; submit: string }> = {
  feature: { title: "What a person will be able to do", why: "Why", whyHint: "The problem today, who asked and when, links to the plan or decision.", submit: "Create feature" },
  bug: { title: "What is wrong, as a person sees it", why: "Steps, expected and actual", whyHint: "How to see it, what should happen, what happens instead.", submit: "Create bug" },
  note: { title: "One line: what was noticed", why: "Details", whyHint: "Optional.", submit: "Add note" },
};

/** The entry form of a contract project: a feature or a bug with what makes it ready, or a one-line note. */
export function NewFeatureDialog({ projectId, projectName, milestones, open, onOpenChange }: { projectId: Id<"projects">; projectName: string; milestones: { id: string; key: string; name: string; closedAt: number | null }[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useMutation(api.tasks.create);
  const detail = useDetail();
  const members = useMembers();
  const live = milestones.filter((m) => !m.closedAt);
  const [kind, setKind] = useState<Kind>("feature");
  const [noteType, setNoteType] = useState<"finding" | "idea">("finding");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const copy = COPY[kind];
  const lines = acceptance.split("\n").filter((l) => l.trim()).length;
  const min = kind === "feature" ? 2 : 1;
  const ready = kind === "note" || (lines >= min && lines <= 5 && (kind === "bug" || !!milestoneId));

  const assignees = [
    ...(members?.people ?? []).filter((p) => assigneeIds.includes(p.userId)).map((p) => ({ kind: "user" as const, id: p.userId, name: p.name })),
    ...(members?.agents ?? []).filter((a) => assigneeIds.includes(a.id)).map((a) => ({ kind: "agent" as const, id: a.id, name: a.name })),
  ];

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await create({
        projectId,
        title,
        description,
        type: kind === "note" ? noteType : kind,
        ...(kind === "note" ? {} : { acceptance, milestoneId: (milestoneId || undefined) as Id<"milestones"> | undefined, priority: urgent ? ("urgent" as const) : undefined, assigneeIds }),
      });
      const where = kind === "note" ? "noted" : res.status === "backlog" ? "created in the backlog" : "created, ready to start";
      toast.success(`${res.key} ${where}`, { action: { label: "Open", onClick: () => detail.open("task", res.id) } });
      setTitle("");
      setDescription("");
      setAcceptance("");
      setUrgent(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`New in ${projectName}`} className="max-w-xl">
        <form
          onSubmit={(e) => (e.preventDefault(), submit())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="space-y-4"
        >
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "feature", label: "Feature" },
              { value: "bug", label: "Bug" },
              { value: "note", label: "Note" },
            ]}
          />
          <Field label={copy.title} hint={kind === "note" ? undefined : `${title.trim().length}/80. The outcome only: no dates, no "follow-up of".`}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={kind === "note" ? 200 : 120} />
          </Field>
          {kind === "note" ? (
            <Field label="Kind">
              <Select value={noteType} onChange={(e) => setNoteType(e.target.value as "finding" | "idea")}>
                <option value="finding">Finding: something is wrong or risky</option>
                <option value="idea">Idea: something could be better</option>
              </Select>
            </Field>
          ) : (
            <>
              {kind === "feature" && (
                <Field label="Milestone" hint={live.length ? undefined : "This project has no open milestone yet. Add one on the Overview."}>
                  <Select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                    <option value="">None yet: keep it in the backlog</option>
                    {live.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.key} · {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={copy.why} hint={copy.whyHint}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" maxLength={5000} />
              </Field>
              <Field label="Acceptance" hint={`${min === 2 ? "2 to 5" : "1 to 5"} lines, each: where → action → expected result. ${lines ? `${lines} so far.` : ""}`}>
                <Textarea
                  value={acceptance}
                  onChange={(e) => setAcceptance(e.target.value)}
                  className="min-h-24"
                  maxLength={5000}
                  placeholder={kind === "feature" ? "1. On the notebook page, Add note opens an editor.\n2. Saving adds exactly one note." : "1. The note count matches the visible notes."}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-1">
                <AssigneePicker value={assignees} onChange={setAssigneeIds} />
                <button type="button" aria-pressed={urgent} onClick={() => setUrgent(!urgent)} className={urgent ? "h-8 rounded-full bg-red px-3 text-[13px] font-medium text-white" : "h-8 rounded-full px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"}>
                  Urgent
                </button>
              </div>
            </>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[13px] text-fg-3">{ready ? (kind === "note" ? "Notes are recorded, not scheduled." : "Ready: it will start in To do.") : "Not ready yet: it will wait in the backlog."}</p>
            <Button type="submit" loading={busy} disabled={!title.trim()}>
              {copy.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
