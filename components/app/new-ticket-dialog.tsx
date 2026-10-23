"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { Field, Input, Select } from "../ui/input";
import { RichEditor } from "../ui/rich-editor";
import { useDetail } from "./detail";
import { useWorkspace } from "./workspace";

type Kind = "bug" | "feature" | "question" | "support";

export function NewTicketDialog({ children, projectId }: { children: ReactNode; projectId?: Id<"projects"> }) {
  const ws = useWorkspace();
  const create = useMutation(api.tickets.create);
  const projects = useQuery(api.projects.list, { workspaceId: ws.id });
  const detail = useDetail();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [project, setProject] = useState<string>(projectId ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await create({ workspaceId: ws.id, projectId: (project || undefined) as Id<"projects"> | undefined, kind, title, body, severity });
      toast.success(`${res.key} opened`, { action: { label: "Open", onClick: () => detail.open("ticket", res.id) } });
      setOpen(false);
      setTitle("");
      setBody("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const kinds: { k: Kind; label: string }[] = [
    { k: "bug", label: "Bug" },
    { k: "feature", label: "Feature request" },
    { k: "question", label: "Question" },
    { k: "support", label: "Support" },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Open a ticket" description="Report a bug, ask for a feature or ask a question." className="max-w-xl">
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
          <div className="flex rounded-full bg-muted p-1" role="radiogroup" aria-label="Kind">
            {kinds.map(({ k, label }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`h-8 flex-1 rounded-full text-[13px] font-medium transition-all ${kind === k ? "bg-bg text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={300} placeholder={kind === "bug" ? "What went wrong?" : "What do you need?"} />
          </Field>
          {/* Not a <label>: a label forwards clicks inside the editor to the first toolbar button. */}
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-fg-2">Details</span>
            <RichEditor onChange={setBody} className="rich-field min-h-32 border border-line-strong" />
            {kind === "bug" && <span className="block text-[13px] text-fg-3">Steps to reproduce, what you expected, what happened.</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">No project</option>
                {projects?.filter((p) => !p.archived).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity">
              <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!title.trim()}>
              Open ticket
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
