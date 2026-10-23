"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowUp, MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ago, errorMessage } from "@/lib/format";
import { Markdown } from "../ui/markdown";
import { RichEditor, type RichEditorHandle } from "../ui/rich-editor";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { Avatar, Badge } from "../ui/misc";
import { useMembers, useWorkspace } from "./workspace";

type Target = { type: "task"; id: Id<"tasks"> } | { type: "ticket"; id: Id<"tickets"> };

export function Thread({ target }: { target: Target }) {
  const ws = useWorkspace();
  const comments = useQuery(api.comments.list, { target });
  const remove = useMutation(api.comments.remove);
  return (
    <div className="space-y-5">
      {comments?.map((c) => (
        <div key={c.id} className="group flex gap-3">
          <Avatar name={c.author.name} kind={c.author.kind} size={28} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-medium">{c.author.name}</span>
              {c.author.kind === "agent" && <Badge tone="amber">Agent</Badge>}
              <span className="text-fg-3">{ago(c.createdAt)}</span>
              {c.editedAt && <span className="text-fg-3">· edited</span>}
              {c.ingest.state === "done" && <Badge tone="green">Ingested → {c.ingest.ref}</Badge>}
              {c.author.id === ws.me.id && !c.deleted && (
                <Menu>
                  <MenuTrigger className="ml-auto rounded-full p-1 text-fg-3 opacity-0 hover:bg-hover group-hover:opacity-100 focus:opacity-100" aria-label="Comment actions">
                    <MoreHorizontal size={15} />
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem danger onSelect={() => remove({ commentId: c.id }).catch((e) => toast.error(errorMessage(e)))}>
                      Delete
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </div>
            {c.deleted ? <p className="mt-1 text-sm italic text-fg-3">Comment deleted.</p> : <Markdown className="mt-1 text-[14.5px]">{c.body}</Markdown>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A ChatGPT-style composer: grows with the text, ⌘↵ sends, @ mentions people. */
export function Composer({ target, placeholder = "Write a comment…" }: { target: Target; placeholder?: string }) {
  const add = useMutation(api.comments.add);
  const members = useMembers();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const ref = useRef<RichEditorHandle>(null);

  const people = members?.people ?? [];
  const suggestions = mentionQ === null ? [] : people.filter((p) => p.name.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 6);

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const mentions = people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.userId);
    try {
      await add({ target, body: text, mentions });
      ref.current?.clear();
      setBody("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  return (
    <div className="relative">
      {suggestions.length > 0 && (
        <div className="animate-pop absolute bottom-full left-0 z-10 mb-2 w-64 rounded-2xl border border-line bg-elevated p-1.5 shadow-pop">
          {suggestions.map((p) => (
            <button key={p.userId} onMouseDown={(e) => (e.preventDefault(), ref.current?.insertMention(p.name))} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm hover:bg-hover">
              <Avatar name={p.name} size={20} /> {p.name}
            </button>
          ))}
        </div>
      )}
      <RichEditor
        ref={ref}
        onChange={setBody}
        onSubmit={send}
        onEscape={() => setMentionQ(null)}
        onMentionQuery={setMentionQ}
        placeholder={placeholder}
        className="composer rounded-[22px] border border-line-strong bg-bg px-4 pb-2 pt-2.5 shadow-[0_1px_6px_rgba(0,0,0,0.04)] transition-colors focus-within:border-fg-3"
      >
        <button
          onClick={send}
          disabled={!body.trim() || busy}
          aria-label="Send comment"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-25"
        >
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </RichEditor>
      <p className="mt-1.5 px-4 text-[11.5px] text-fg-3">⌘↵ to send · @ to mention</p>
    </div>
  );
}
