"use client";

import { useQuery } from "convex/react";
import { SquareCheck } from "lucide-react";
import { useDetail } from "@/components/app/detail";
import { PageHeader } from "@/components/app/page-header";
import { useWorkspace } from "@/components/app/workspace";
import { Empty, PageLoading } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon, type Category, type Priority } from "@/components/ui/status";
import { api } from "@/convex/_generated/api";
import { shortDate } from "@/lib/format";
import { textDir } from "@/lib/dir";

const ORDER: Category[] = ["blocked", "started", "review", "unstarted", "backlog"];
const LABEL: Record<string, string> = { blocked: "Blocked", started: "In progress", review: "In review", unstarted: "To do", backlog: "Backlog" };

export default function MyWork() {
  const ws = useWorkspace();
  const tasks = useQuery(api.tasks.mine, { workspaceId: ws.id });
  const detail = useDetail();
  const first = ws.me.name.split(" ")[0];

  return (
    <>
      <PageHeader title="My work" subtitle={tasks ? `${tasks.length} open task${tasks.length === 1 ? "" : "s"} assigned to you` : undefined} />
      {tasks === undefined ? (
        <PageLoading />
      ) : tasks.length === 0 ? (
        <Empty icon={<SquareCheck size={22} />} title={`Nothing on your plate, ${first}`}>
          Tasks assigned to you across every project land here.
        </Empty>
      ) : (
        <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
          {ORDER.map((cat) => {
            const group = tasks.filter((t) => t.category === cat);
            if (!group.length) return null;
            return (
              <section key={cat}>
                <h2 className="mb-2 flex items-center gap-2 px-3 text-[13px] font-medium text-fg-2">
                  <StatusIcon category={cat} /> {LABEL[cat]} <span className="text-fg-3">{group.length}</span>
                </h2>
                <ul>
                  {group.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => detail.open("task", t.id)} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-muted">
                        <PriorityIcon priority={t.priority as Priority} />
                        <span className="w-20 shrink-0 font-mono text-xs text-fg-3">{t.alias ?? t.key}</span>
                        <span className="flex-1 truncate" dir={textDir(t.title)}>{t.title}</span>
                        <span className="hidden items-center gap-1.5 text-xs text-fg-3 sm:flex">
                          <span className="h-2 w-2 rounded-[3px]" style={{ background: t.project.color }} /> {t.project.name}
                        </span>
                        {t.dueAt && <span className="text-xs text-fg-3">{shortDate(t.dueAt)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
