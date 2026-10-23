import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Sticky, translucent page header in the Apple style. */
export function PageHeader({ title, subtitle, actions, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-20 border-b border-line bg-[var(--header)] backdrop-blur-xl", className)}>
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 md:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="truncate text-[13px] text-fg-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-full px-3 text-[13px] font-medium transition-all",
            value === o.value ? "bg-bg text-fg shadow-[0_1px_3px_rgba(0,0,0,0.1)]" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
