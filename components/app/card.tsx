import type { ReactNode } from "react";

export function Card({ title, subtitle, children, badge }: { title: string; subtitle?: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="font-display text-[17px] font-semibold tracking-tight">{title}</h2>
        {badge}
      </div>
      {subtitle && <p className="mt-1 text-sm text-fg-2">{subtitle}</p>}
      <div className="mt-4 rounded-3xl border border-line p-5">{children}</div>
    </section>
  );
}
