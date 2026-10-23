"use client";

import { useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { CommandMenu } from "@/components/app/command-menu";
import { DetailSheets } from "@/components/app/detail-sheets";
import { Sidebar } from "@/components/app/sidebar";
import { WorkspaceProvider } from "@/components/app/workspace";
import { PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/cn";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const me = useQuery(api.admin.me);
  const ws = useQuery(api.workspaces.bySlug, me && !me.mustChangePassword ? { slug } : "skip");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (me?.mustChangePassword) return router.replace("/change-password");
    if (ws === null) router.replace("/");
    if (ws) {
      try {
        localStorage.setItem("tc:workspace", ws.slug);
      } catch {}
    }
  }, [me, ws, router]);

  if (!ws) return <PageLoading />;
  return (
    <WorkspaceProvider value={ws}>
      <div className="flex h-full">
        <div
          className={cn("fixed inset-0 z-30 bg-overlay md:hidden", mobileOpen ? "block" : "hidden")}
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
        <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
        <main className="flex min-w-0 flex-1 flex-col">
          <MobileBar onMenu={() => setMobileOpen(true)} />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
      </div>
      <Suspense>
        <DetailSheets />
        <CommandMenu />
      </Suspense>
    </WorkspaceProvider>
  );
}

function MobileBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="flex h-12 items-center border-b border-line px-2 md:hidden">
      <button onClick={onMenu} className="rounded-full p-2 text-fg-2 hover:bg-hover" aria-label="Open menu">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
