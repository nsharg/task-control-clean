"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { Field, Input, Select, Textarea } from "../ui/input";
import { useWorkspace } from "./workspace";

export function NewProjectDialog({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const router = useRouter();
  const create = useMutation(api.projects.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"workspace" | "members">("workspace");
  const [contract, setContract] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initials, topped up from the last word: "Example Project" → EPR, "Website" → WEB.
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  let suggested = words.map((w) => w[0]).join("");
  if (suggested.length < 3 && words.length) suggested += words[words.length - 1].slice(1, 1 + 3 - suggested.length);
  suggested = suggested.toUpperCase().replace(/^[^A-Z]+/, "").slice(0, 4);
  const effectiveKey = keyTouched ? key : suggested;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await create({ workspaceId: ws.id, name, key: effectiveKey, description, visibility, contract });
      setOpen(false);
      setName("");
      setKey("");
      setKeyTouched(false);
      setDescription("");
      router.push(`/w/${ws.slug}/p/${res.key}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="New project">
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Example Project" required autoFocus maxLength={80} />
            </Field>
            <Field label="Key">
              <Input
                value={effectiveKey}
                onChange={(e) => (setKeyTouched(true), setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)))}
                className="font-mono"
                required
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" maxLength={2000} />
          </Field>
          <Field label="Who can see it" hint={visibility === "workspace" ? "Every member of the workspace. Guests only if added." : "Only people you add to the project."}>
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as "workspace" | "members")}>
              <option value="workspace">Everyone in the workspace</option>
              <option value="members">Project members only</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={contract} onChange={(e) => setContract(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span>
              Milestones, features and tasks
              <span className="block text-[13px] text-fg-3">Features sit in milestones with tasks under them; you accept each feature. Turn off for a plain task list or a mirror of another tracker.</span>
            </span>
          </label>
          {error && <p className="text-sm text-red">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim() || effectiveKey.length < 2}>
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
