"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import { RichEditor } from "../ui/rich-editor";
import type { Priority, StatusDef } from "../ui/status";
import { useDetail } from "./detail";
import { AssigneePicker, PriorityPicker, StatusPicker } from "./pickers";
import { useMembers } from "./workspace";

type TaskType = "task" | "bug" | "feature" | "idea";

export function NewTaskDialog({
  projectId,
  projectName,
  statuses,
  defaultStatus,
  sectionId,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  projectName: string;
  statuses: StatusDef[];
  defaultStatus?: string;
  sectionId?: Id<"sections">;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const create = useMutation(api.tasks.create);
  const detail = useDetail();
  const members = useMembers();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState(defaultStatus ?? "todo");
  const [priority, setPriority] = useState<Priority>("none");
  const [type, setType] = useState<TaskType>("task");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const assignees = [
    ...(members?.people ?? []).filter((p) => assigneeIds.includes(p.userId)).map((p) => ({ kind: "user" as const, id: p.userId, name: p.name })),
    ...(members?.agents ?? []).filter((a) => assigneeIds.includes(a.id)).map((a) => ({ kind: "agent" as const, id: a.id, name: a.name })),
  ];

  const submit = async (another: boolean) => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await create({ projectId, title, description, status, priority, type, assigneeIds, sectionId });
      toast.success(`${res.key} created`, { action: { label: "Open", onClick: () => detail.open("task", res.id) } });
      setTitle("");
      setDescription("");
      setEditorKey((k) => k + 1);
      if (!another) setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent title={`New task in ${projectName}`} className="max-w-xl">
        <form
          onSubmit={(e) => (e.preventDefault(), submit(false))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), submit(false));
          }}
          className="space-y-3"
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus required maxLength={300} className="h-12 border-transparent bg-muted text-base font-medium focus:bg-bg" />
          <RichEditor key={editorKey} onChange={setDescription} placeholder="Add details…" className="rich-field min-h-28 bg-muted focus-within:bg-bg" />
          <div className="flex flex-wrap items-center gap-1">
            <StatusPicker statuses={statuses} value={status} onChange={setStatus} />
            <PriorityPicker value={priority} onChange={setPriority} />
            <AssigneePicker value={assignees} onChange={setAssigneeIds} />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
              className="h-8 rounded-full bg-transparent px-2.5 text-[13px] text-fg-2 hover:bg-hover"
              aria-label="Type"
            >
              <option value="task">Task</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="idea">Idea</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={() => submit(true)} disabled={!title.trim() || busy}>
              Create & add another
            </Button>
            <Button type="submit" loading={busy} disabled={!title.trim()}>
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
