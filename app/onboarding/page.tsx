"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, onSubmit } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/format";

export default function Onboarding() {
  const router = useRouter();
  const me = useQuery(api.admin.me);
  const create = useMutation(api.workspaces.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (me === undefined) return <PageLoading />;

  const submit = async () => {
    setBusy(true);
    try {
      const { slug } = await create({ name });
      router.replace(`/w/${slug}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        {me.isSuperAdmin ? (
          <AuthCard title="Name your workspace" subtitle="Usually your company or team. Then add people from the admin console.">
            <form onSubmit={onSubmit(submit)} className="space-y-3">
              <Input placeholder="e.g. Example Team" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={60} />
              {error && <p className="text-sm text-red">{error}</p>}
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Create workspace
              </Button>
            </form>
          </AuthCard>
        ) : (
          <AuthCard title="No workspace yet" subtitle="Your administrator hasn't added you to a workspace. Ask them to, then reload.">
            <Button variant="secondary" size="lg" className="w-full" onClick={async () => (await authClient.signOut(), window.location.assign("/sign-in"))}>
              Sign out
            </Button>
          </AuthCard>
        )}
      </div>
    </main>
  );
}
