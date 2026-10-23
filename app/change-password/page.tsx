"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { AuthCard, onSubmit } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/misc";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";

/** Where people land until they replace the password their admin gave them. */
export default function ChangePassword() {
  const me = useQuery(api.admin.me);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me === undefined) return <PageLoading />;

  const submit = async () => {
    if (next.length < 12) return setError("Use at least 12 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    if (next === current) return setError("Choose a password different from the one you were given.");
    setBusy(true);
    setError(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setError(error.status === 429 ? "Too many attempts. Wait a few minutes." : "The current password is wrong.");
    window.location.assign("/");
  };

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <AuthCard
          title={me.mustChangePassword ? "Choose your password" : "Change password"}
          subtitle={me.mustChangePassword ? `Welcome, ${me.name.split(" ")[0]}. Replace the password you were given with one only you know.` : undefined}
        >
          <form onSubmit={onSubmit(submit)} className="space-y-3">
            <input type="email" autoComplete="username" value={me.email} readOnly hidden />
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus maxLength={128} />
            </Field>
            <Field label="New password" hint="At least 12 characters. Use a password manager.">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} maxLength={128} />
            </Field>
            <Field label="Repeat new password">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} maxLength={128} />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-red">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              Save password
            </Button>
          </form>
        </AuthCard>
      </div>
    </main>
  );
}
