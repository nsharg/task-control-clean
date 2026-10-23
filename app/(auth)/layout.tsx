export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 py-16">
      <div className="mb-8 flex items-center gap-2.5">
        <Logo />
        <span className="font-display text-[17px] font-semibold tracking-tight">Task Control</span>
      </div>
      <div className="w-full max-w-[380px]">{children}</div>
    </main>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--accent)" />
      <path d="M8.5 14.5l3.5 3.5 7.5-8" stroke="var(--accent-fg)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
