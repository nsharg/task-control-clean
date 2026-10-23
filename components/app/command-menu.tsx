"use client";

import { Command } from "cmdk";
import { useQuery } from "convex/react";
import { FolderKanban, Inbox, SquareCheck, Ticket } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useDetail } from "./detail";
import { useWorkspace } from "./workspace";
import { textDir } from "@/lib/dir";

export function CommandMenu() {
  const ws = useWorkspace();
  const router = useRouter();
  const detail = useDetail();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const projects = useQuery(api.projects.list, open ? { workspaceId: ws.id } : "skip");
  const results = useQuery(api.search.run, open && debounced.trim() ? { workspaceId: ws.id, q: debounced } : "skip");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("tc:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("tc:command", onOpen);
    };
  }, []);

  const go = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };
  const item = "flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-hover";

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="animate-fade fixed inset-0 z-50 bg-overlay" />
        <D.Content className="animate-pop fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-3xl border border-line bg-elevated shadow-pop" aria-describedby={undefined}>
          <D.Title className="sr-only">Search</D.Title>
          <Command shouldFilter={!debounced.trim()} loop>
            <Command.Input
              value={q}
              onValueChange={setQ}
              placeholder="Search tasks, tickets, projects… or type a key like DEMO-12"
              className="h-14 w-full border-b border-line bg-transparent px-5 text-[15px] outline-none placeholder:text-fg-3"
            />
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-fg-3">{results === undefined && debounced ? "Searching…" : "No results."}</Command.Empty>
              {results && results.length > 0 && (
                <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                  {results.map((r) => (
                    <Command.Item key={r.id} value={`${r.key} ${r.title} ${r.id}`} className={item} onSelect={() => go(() => detail.open(r.type, r.id))}>
                      {r.type === "task" ? <SquareCheck size={16} className="text-fg-3" /> : <Ticket size={16} className="text-fg-3" />}
                      <span className="w-16 shrink-0 font-mono text-xs text-fg-3">{r.key}</span>
                      <span className="truncate" dir={textDir(r.title)}>{r.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!debounced.trim() && (
                <>
                  <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                    <Command.Item className={item} onSelect={() => go(() => router.push(`/w/${ws.slug}/inbox`))}>
                      <Inbox size={16} className="text-fg-3" /> Inbox
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => go(() => router.push(`/w/${ws.slug}/my-work`))}>
                      <SquareCheck size={16} className="text-fg-3" /> My work
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => go(() => router.push(`/w/${ws.slug}/tickets`))}>
                      <Ticket size={16} className="text-fg-3" /> Tickets
                    </Command.Item>
                  </Command.Group>
                  <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                    {projects?.map((p) => (
                      <Command.Item key={p.id} value={`${p.key} ${p.name}`} className={item} onSelect={() => go(() => router.push(`/w/${ws.slug}/p/${p.key}`))}>
                        <FolderKanban size={16} style={{ color: p.color }} />
                        {p.name}
                        <span className="ml-auto font-mono text-xs text-fg-3">{p.key}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
