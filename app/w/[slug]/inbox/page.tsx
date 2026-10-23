"use client";

import { useMutation, useQuery } from "convex/react";
import { AtSign, Bell, CheckCheck, CircleDot, MessageCircle, Ticket, UserPlus, Workflow } from "lucide-react";
import { parseTargetKey, useDetail } from "@/components/app/detail";
import { PageHeader } from "@/components/app/page-header";
import { useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Avatar, Empty, PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/format";
import { textDir } from "@/lib/dir";

const ICON = {
  mention: <AtSign size={14} />,
  assigned: <UserPlus size={14} />,
  comment: <MessageCircle size={14} />,
  status: <CircleDot size={14} />,
  ticket: <Ticket size={14} />,
  ingested: <Workflow size={14} />,
};
const VERB = { mention: "mentioned you", assigned: "assigned you", comment: "commented", status: "updated", ticket: "opened a ticket", ingested: "picked up your item" };

export default function Inbox() {
  const ws = useWorkspace();
  const items = useQuery(api.notifications.list, { workspaceId: ws.id });
  const markRead = useMutation(api.notifications.markRead);
  const detail = useDetail();

  return (
    <>
      <PageHeader
        title="Inbox"
        actions={
          items?.some((n) => !n.read) && (
            <Button size="sm" variant="ghost" onClick={() => markRead({ workspaceId: ws.id })}>
              <CheckCheck size={15} /> Mark all read
            </Button>
          )
        }
      />
      {items === undefined ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <Empty icon={<Bell size={22} />} title="You're all caught up">
          Mentions, assignments and replies to your tickets show up here.
        </Empty>
      ) : (
        <ul className="mx-auto max-w-3xl p-2 md:p-4">
          {items.map((n) => {
            const target = parseTargetKey(n.targetKey);
            return (
              <li key={n.id}>
                <button
                  onClick={() => {
                    if (!n.read) markRead({ workspaceId: ws.id, ids: [n.id] });
                    if (target) detail.open(target.type, target.id);
                  }}
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left hover:bg-muted"
                >
                  <div className="relative">
                    <Avatar name={n.actor.name} kind={n.actor.kind} size={32} />
                    <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-bg bg-muted text-fg-2">{ICON[n.kind]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{n.actor.name}</span> <span className="text-fg-2">{VERB[n.kind]}</span>
                    </p>
                    <p className={cn("truncate text-sm", n.read ? "text-fg-2" : "font-medium")} dir={textDir(n.title)}>{n.title}</p>
                  </div>
                  <span className="shrink-0 text-xs text-fg-3">{ago(n.at)}</span>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
