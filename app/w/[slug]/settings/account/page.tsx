"use client";

import { Laptop } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/app/card";
import { useWorkspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";
import { ago } from "@/lib/format";

export default function Account() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader title="Account & security" subtitle={ws.me.email} />
      <div className="mx-auto max-w-2xl space-y-12 p-4 md:p-8">
        <Password />
        <Sessions />
      </div>
    </>
  );
}

function Password() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (next.length < 12) return toast.error("Use at least 12 characters.");
    setBusy(true);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Couldn't change the password.");
    setCurrent("");
    setNext("");
    toast.success("Password changed. Other devices were signed out.");
  };
  return (
    <Card title="Password">
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="grid gap-3 sm:grid-cols-2">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} maxLength={128} />
        </Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; updatedAt: Date | string };

function Sessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  const current = authClient.useSession().data?.session.token;
  useEffect(() => {
    let live = true;
    authClient.listSessions().then(({ data }) => live && setSessions((data as Session[] | null) ?? []));
    return () => {
      live = false;
    };
  }, [version]);
  const device = (ua?: string | null) => {
    if (!ua) return "Unknown device";
    const os = /Mac OS X/.test(ua) ? "Mac" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
    const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
    return `${br} on ${os}`;
  };
  return (
    <Card title="Signed-in devices" subtitle="Sign out anywhere you don't recognise.">
      <ul className="-my-2 divide-y divide-line">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
            <Laptop size={18} className="text-fg-3" />
            <div className="flex-1">
              <div className="font-medium">
                {device(s.userAgent)} {s.token === current && <Badge tone="green">This device</Badge>}
              </div>
              <div className="text-[13px] text-fg-3">
                {s.ipAddress ?? "unknown IP"} · active {ago(new Date(s.updatedAt).getTime())}
              </div>
            </div>
            {s.token !== current && (
              <Button size="sm" variant="ghost" onClick={async () => (await authClient.revokeSession({ token: s.token }), load())}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions && sessions.length > 1 && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={async () => (await authClient.revokeOtherSessions(), load(), toast.success("Signed out other devices."))}>
            Sign out all other devices
          </Button>
        </div>
      )}
    </Card>
  );
}
