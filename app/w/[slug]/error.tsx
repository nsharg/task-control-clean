"use client";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /not found|not_found/i.test(error.message);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="font-display text-xl font-semibold">{notFound ? "Not found" : "Something went wrong"}</h2>
      <p className="max-w-sm text-sm text-fg-2">{notFound ? "It doesn't exist, or you don't have access to it." : "Try again. If it keeps happening, reload the page."}</p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
