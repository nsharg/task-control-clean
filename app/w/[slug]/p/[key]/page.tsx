"use client";

import { useQuery } from "convex/react";
import { FolderX, Lock, Plus, Settings, Ticket } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { NewFeatureDialog } from "@/components/app/new-feature-dialog";
import { NewTaskDialog } from "@/components/app/new-task-dialog";
import { NewTicketDialog } from "@/components/app/new-ticket-dialog";
import { PageHeader, Segmented } from "@/components/app/page-header";
import { Board } from "@/components/app/project/board";
import { ListView } from "@/components/app/project/list";
import { Overview } from "@/components/app/project/overview";
import { Roadmap } from "@/components/app/project/roadmap";
import { useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Badge, Empty, PageLoading } from "@/components/ui/misc";
import { Tip } from "@/components/ui/menu";
import type { StatusDef } from "@/components/ui/status";
import { api } from "@/convex/_generated/api";
import { ago } from "@/lib/format";

const VIEWS = ["overview", "list", "board", "roadmap"] as const;
type View = (typeof VIEWS)[number];

function ProjectPage() {
  const ws = useWorkspace();
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = VIEWS.find((v) => v === params.get("view")) ?? "overview";
  const board = useQuery(api.projects.board, { workspaceId: ws.id, key });
  const [newTask, setNewTask] = useState(false);

  const setView = (v: View) => {
    const q = new URLSearchParams(params.toString());
    q.set("view", v);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  // "c" creates a task, like most trackers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable && board?.perms.write) {
        e.preventDefault();
        setNewTask(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board?.perms.write]);

  if (board === undefined) return <PageLoading />;
  if (board === null) return <Empty icon={<FolderX size={22} />} title="Project not found" />;
  const p = board.project;
  const statuses = p.statuses as StatusDef[];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-[4px]" style={{ background: p.color }} />
            {p.name}
            <span className="font-mono text-[13px] font-normal text-fg-3">{p.key}</span>
            {p.visibility === "members" && (
              <Tip label="Only project members can see this">
                <Lock size={13} className="text-fg-3" />
              </Tip>
            )}
          </span>
        }
        subtitle={
          board.source ? (
            <span>
              Synced from <span className="text-fg-2">{board.source.label}</span>
              {board.source.lastPushAt && ` · ${ago(board.source.lastPushAt)}`} · {board.progress.percent}% done
            </span>
          ) : (
            `${board.progress.done} of ${board.progress.counted} ${p.contract ? "features " : ""}done · ${board.progress.percent}%`
          )
        }
        actions={
          <>
            {board.perms.comment && (
              <NewTicketDialog projectId={p.id}>
                <Button size="sm" variant="secondary">
                  <Ticket size={15} /> <span className="hidden sm:inline">Ticket</span>
                </Button>
              </NewTicketDialog>
            )}
            {board.perms.write && (
              <Button size="sm" onClick={() => setNewTask(true)}>
                <Plus size={15} /> <span className="hidden sm:inline">{p.contract ? "Feature" : "Task"}</span>
              </Button>
            )}
            {board.perms.manage && (
              <Button asChild size="icon-sm" variant="ghost" aria-label="Project settings">
                <Link href={`/w/${ws.slug}/p/${p.key}/settings`}>
                  <Settings size={16} />
                </Link>
              </Button>
            )}
          </>
        }
      >
        <div className="flex items-center gap-3 px-4 pb-2.5 md:px-6">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "overview", label: "Overview" },
              { value: "list", label: "List" },
              { value: "board", label: "Board" },
              { value: "roadmap", label: "Roadmap" },
            ]}
          />
          {board.source && <Badge className="hidden sm:inline-flex">Read-only mirror · comments and new tasks welcome</Badge>}
          {p.archived && <Badge className="hidden sm:inline-flex">Archived · read-only</Badge>}
        </div>
      </PageHeader>

      {view === "overview" && <Overview board={board} />}
      {view === "list" && <ListView board={board} />}
      {view === "board" && <Board board={board} />}
      {view === "roadmap" && <Roadmap board={board} />}

      {board.perms.write &&
        (p.contract ? (
          <NewFeatureDialog open={newTask} onOpenChange={setNewTask} projectId={p.id} projectName={p.name} milestones={board.milestones} />
        ) : (
          <NewTaskDialog open={newTask} onOpenChange={setNewTask} projectId={p.id} projectName={p.name} statuses={statuses} />
        ))}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProjectPage />
    </Suspense>
  );
}
