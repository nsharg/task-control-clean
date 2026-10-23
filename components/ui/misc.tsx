import { Bot } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const HUES = [210, 160, 280, 30, 340, 190, 120, 0];

export function Avatar({ name, kind = "user", size = 24, className }: { name: string; kind?: "user" | "agent"; size?: number; className?: string }) {
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: kind === "agent" ? "#d97757" : `hsl(${hue} 45% 48%)` }}
    >
      {kind === "agent" ? <Bot size={size * 0.6} /> : initials}
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "green" | "blue" | "amber" | "red" | "purple"; className?: string }) {
  const tones = {
    neutral: "bg-muted text-fg-2",
    green: "bg-green/12 text-green",
    blue: "bg-blue/12 text-blue",
    amber: "bg-amber/14 text-amber",
    red: "bg-red/12 text-red",
    purple: "bg-purple/12 text-purple",
  };
  return <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium", tones[tone], className)}>{children}</span>;
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-md border border-line-strong bg-bg px-1.5 py-px font-sans text-[11px] font-medium text-fg-3">{children}</kbd>
);

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hover", className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color ?? "var(--green)" }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-fg-3">{icon}</div>}
      <h3 className="font-display text-[17px] font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-sm text-fg-2">{children}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <span className={cn("inline-block h-5 w-5 animate-spin rounded-full border-2 border-fg-3 border-t-transparent", className)} />
);

export function PageLoading() {
  return (
    <div className="flex h-full min-h-60 items-center justify-center">
      <Spinner />
    </div>
  );
}
