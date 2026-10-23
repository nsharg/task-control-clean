"use client";

import type { FormEvent, ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="animate-pop">
      <h1 className="text-center font-display text-[28px] font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-center text-[15px] text-fg-2">{subtitle}</p>}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-fg-2">{footer}</div>}
    </div>
  );
}

export const onSubmit = (fn: () => void) => (e: FormEvent) => {
  e.preventDefault();
  fn();
};

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
