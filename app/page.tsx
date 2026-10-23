"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";

/** Sends you to your last workspace, the password screen, or onboarding. */
export default function Home() {
  const router = useRouter();
  const me = useQuery(api.admin.me);
  const workspaces = useQuery(api.workspaces.mine, me && !me.mustChangePassword ? {} : "skip");
  useEffect(() => {
    if (me?.mustChangePassword) return router.replace("/change-password");
    if (!workspaces) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem("tc:workspace");
    } catch {}
    const pick = workspaces.find((w) => w.slug === last) ?? workspaces[0];
    router.replace(pick ? `/w/${pick.slug}` : "/onboarding");
  }, [me, workspaces, router]);
  return <PageLoading />;
}
