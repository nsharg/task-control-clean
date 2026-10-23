"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Task and ticket details open in a sheet driven by `?task=` / `?ticket=`, so links are shareable. */
export function useDetail() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = useCallback(
    (type: "task" | "ticket", id: string) => {
      const q = new URLSearchParams(params.toString());
      q.delete("task");
      q.delete("ticket");
      q.set(type, id);
      router.push(`${pathname}?${q}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const close = useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete("task");
    q.delete("ticket");
    router.push(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  return { open, close, taskId: params.get("task"), ticketId: params.get("ticket") };
}

/** `task:<id>` / `ticket:<id>` from notifications and activity. */
export function parseTargetKey(key: string) {
  const [type, id] = key.split(":");
  return type === "task" || type === "ticket" ? { type: type as "task" | "ticket", id } : null;
}
