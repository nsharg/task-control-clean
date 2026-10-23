"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A six-digit code field. One real input sits over six drawn boxes, so typing,
 * pasting and password-manager autofill all behave like a normal text field.
 */
export function OtpInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative mx-auto w-fit">
      <input
        value={value}
        onChange={(e) => {
          const clean = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(clean);
          if (clean.length === 6) onComplete?.(clean);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        aria-label="6-digit code"
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0"
      />
      <div className="flex gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex h-14 w-12 items-center justify-center rounded-xl border bg-bg font-display text-2xl font-semibold transition-colors",
              focused && i === Math.min(value.length, 5) ? "border-focus ring-3 ring-focus/15" : "border-line-strong",
            )}
          >
            {value[i] ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
