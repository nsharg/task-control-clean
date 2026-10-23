import { cn } from "@/lib/cn";

export type Category = "backlog" | "unstarted" | "started" | "blocked" | "review" | "completed" | "canceled";
export type StatusDef = { key: string; name: string; category: Category };

export const CATEGORY_COLOR: Record<Category, string> = {
  backlog: "color-mix(in srgb, var(--fg) 28%, transparent)",
  unstarted: "color-mix(in srgb, var(--fg) 45%, transparent)",
  started: "var(--amber)",
  blocked: "var(--red)",
  review: "var(--purple)",
  completed: "var(--green)",
  canceled: "color-mix(in srgb, var(--fg) 22%, transparent)",
};

/** A small ring that fills as work moves along, like a progress dial. */
export function StatusIcon({ category, size = 14, className }: { category: Category; size?: number; className?: string }) {
  const c = CATEGORY_COLOR[category];
  const r = 5.5;
  // A pie drawn as a thick stroke on a tiny circle: radius 1.5, stroke 3.
  const circ = 2 * Math.PI * 1.5;
  const fill = { started: 0.5, review: 0.75 }[category as "started" | "review"];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cn("shrink-0", className)} aria-hidden>
      {category === "completed" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" stroke="var(--bg)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : category === "canceled" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : category === "blocked" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <rect x="6.25" y="3.4" width="1.5" height="4.6" rx=".75" fill="var(--bg)" />
          <circle cx="7" cy="10" r=".9" fill="var(--bg)" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={category === "backlog" ? "1.6 1.6" : undefined} />
          {fill && (
            <circle
              cx="7"
              cy="7"
              r="1.5"
              fill="none"
              stroke={c}
              strokeWidth="3"
              strokeDasharray={`${circ * fill} ${circ}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </>
      )}
    </svg>
  );
}

export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];
export const PRIORITY_LABEL: Record<Priority, string> = { none: "No priority", low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === "urgent") {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <rect width="14" height="14" rx="3.5" fill="var(--red)" />
        <rect x="6.2" y="3" width="1.6" height="5" rx=".8" fill="#fff" />
        <circle cx="7" cy="10.4" r=".95" fill="#fff" />
      </svg>
    );
  }
  const n = { none: 0, low: 1, medium: 2, high: 3 }[priority];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {priority === "none" ? (
        <path d="M2.5 7h2M6 7h2M9.5 7h2" stroke="var(--fg-3)" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        [0, 1, 2].map((i) => <rect key={i} x={2 + i * 3.7} y={9 - i * 3} width="2.6" height={3 + i * 3} rx=".8" fill={i < n ? "var(--fg-2)" : "var(--border-strong)"} />)
      )}
    </svg>
  );
}

export const TICKET_STATUS: { key: string; name: string; category: Category }[] = [
  { key: "new", name: "New", category: "unstarted" },
  { key: "triaged", name: "Triaged", category: "backlog" },
  { key: "accepted", name: "Accepted", category: "unstarted" },
  { key: "in_progress", name: "In progress", category: "started" },
  { key: "resolved", name: "Resolved", category: "completed" },
  { key: "closed", name: "Closed", category: "completed" },
  { key: "rejected", name: "Rejected", category: "canceled" },
  { key: "duplicate", name: "Duplicate", category: "canceled" },
];
