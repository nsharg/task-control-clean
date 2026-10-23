"use client";

import { useState } from "react";
import { AuthCard, onSubmit } from "@/components/auth/auth-form";
import { useHoneypot } from "@/components/auth/honeypot";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/**
 * First-run only: creates the super admin's own account. The server refuses
 * every other email, and this one too once it exists. Not linked anywhere.
 */
export default function SetUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { field, looksLikeBot } = useHoneypot();

  const submit = async () => {
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (looksLikeBot()) return setError("Accounts are created by an administrator.");
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (error) return setError(error.status === 429 ? "Too many attempts. Try again later." : "Accounts are created by an administrator.");
    window.location.assign("/");
  };

  return (
    <AuthCard title="Set up the admin account" subtitle="Only the configured administrator can do this, once.">
      <form onSubmit={onSubmit(submit)} className="relative space-y-3">
        {field}
        <Input autoComplete="name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
        <Input type="email" autoComplete="username" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        <Field label="Password" hint="At least 12 characters. Use a password manager.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create admin account
        </Button>
      </form>
    </AuthCard>
  );
}
