"use client";

import { useQuery } from "convex/react";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { useDetail } from "@/components/app/detail";
import { NewTicketDialog } from "@/components/app/new-ticket-dialog";
import { PageHeader, Segmented } from "@/components/app/page-header";
import { useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Empty, PageLoading } from "@/components/ui/misc";
import { StatusIcon, TICKET_STATUS } from "@/components/ui/status";
import { api } from "@/convex/_generated/api";
import { ago } from "@/lib/format";
import { textDir } from "@/lib/dir";

const KIND_TONE = { bug: "red", feature: "purple", question: "blue", support: "neutral" } as const;
const SEV_TONE = { low: "neutral", medium: "neutral", high: "amber", critical: "red" } as const;

export default function Tickets() {
  const ws = useWorkspace();
  const [view, setView] = useState<"open" | "all" | "mine">("open");
  const tickets = useQuery(api.tickets.list, { workspaceId: ws.id, open: view === "open" ? true : undefined });
  const detail = useDetail();
  const shown = view === "mine" ? tickets?.filter((t) => t.reporter.id === ws.me.id) : tickets;

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Bug reports, feature requests and questions"
        actions={
          <NewTicketDialog>
            <Button size="sm">
              <Plus size={15} /> New ticket
            </Button>
          </NewTicketDialog>
        }
      >
        <div className="px-4 pb-2.5 md:px-6">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Open" },
              { value: "mine", label: "Reported by me" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
      </PageHeader>
      {shown === undefined ? (
        <PageLoading />
      ) : shown.length === 0 ? (
        <Empty icon={<Ticket size={22} />} title="No tickets here">
          Open a ticket to report a bug or ask for something. The team gets notified.
        </Empty>
      ) : (
        <ul className="mx-auto max-w-5xl p-2 md:p-4">
          {shown.map((t) => {
            const st = TICKET_STATUS.find((s) => s.key === t.status)!;
            return (
              <li key={t.id}>
                <button onClick={() => detail.open("ticket", t.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted">
                  <StatusIcon category={st.category} />
                  <span className="w-12 shrink-0 font-mono text-xs text-fg-3">{t.key}</span>
                  <Badge tone={KIND_TONE[t.kind]} className="hidden capitalize sm:inline-flex">
                    {t.kind}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate" dir={textDir(t.title)}>{t.title}</span>
                  {t.ingest.state === "done" && <Badge tone="green">→ {t.ingest.ref}</Badge>}
                  {(t.severity === "high" || t.severity === "critical") && (
                    <Badge tone={SEV_TONE[t.severity]} className="capitalize">
                      {t.severity}
                    </Badge>
                  )}
                  {t.project && <span className="hidden text-xs text-fg-3 md:inline">{t.project.name}</span>}
                  <Avatar name={t.reporter.name} kind={t.reporter.kind} size={20} />
                  <span className="w-20 shrink-0 text-right text-xs text-fg-3">{ago(t.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
