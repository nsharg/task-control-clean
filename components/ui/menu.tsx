"use client";

import { Check } from "lucide-react";
import { DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

const panel = "animate-pop z-50 min-w-48 rounded-2xl border border-line bg-elevated p-1.5 shadow-pop";

export function MenuContent({ children, align = "start", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className={cn(panel, "max-h-[60vh] overflow-y-auto", className)}>
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ children, onSelect, checked, danger, disabled }: { children: ReactNode; onSelect?: () => void; checked?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover",
        danger && "text-red",
      )}
    >
      {children}
      {checked !== undefined && <Check size={15} className={cn("ml-auto", !checked && "invisible")} />}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-fg-3">{children}</M.Label>;

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={6} className={cn(panel, className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}

export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="animate-fade z-50 rounded-lg bg-accent px-2 py-1 text-xs font-medium text-accent-fg">
            {label}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
