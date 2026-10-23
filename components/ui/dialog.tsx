"use client";

import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="animate-fade fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          "animate-pop fixed left-1/2 top-[12vh] z-50 max-h-[80vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 overflow-y-auto rounded-3xl border border-line bg-elevated p-6 shadow-pop focus:outline-none",
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <D.Title className="font-display text-lg font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-mr-2 -mt-1 rounded-full p-1.5 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close">
            <X size={18} />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** A right-hand panel over the page, for task and ticket details. */
export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-fade fixed inset-0 z-40 bg-overlay/40 md:bg-transparent" />
        <D.Content
          className="animate-slide fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-bg shadow-pop focus:outline-none md:w-[min(720px,calc(100vw-280px))]"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">{title}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
