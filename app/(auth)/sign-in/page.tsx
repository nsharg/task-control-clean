"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, onSubmit, safeNext } from "@/components/auth/auth-form";
import { useHoneypot } from "@/components/auth/honeypot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function SignIn() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { field, looksLikeBot } = useHoneypot();

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (looksLikeBot()) {
      // Same answer a wrong password gets, after a similar delay.
      await new Promise((r) => setTimeout(r, 900));
      setBusy(false);
      return setError("Email or password is incorrect.");
    }
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : error.status === 403
            ? "This account is disabled. Ask your administrator."
            : "Email or password is incorrect.",
      );
      return;
    }
    // A full load, so the server sees the new session cookie.
    window.location.assign(next);
  };

  return (
    <AuthCard title="Welcome back" footer={<span className="text-fg-3">Accounts are created by your administrator. Forgot your password? Ask them to reset it.</span>}>
      <form onSubmit={onSubmit(submit)} className="relative space-y-3">
        {field}
        <Input type="email" autoComplete="username" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus maxLength={254} />
        <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} />
        {error && (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
