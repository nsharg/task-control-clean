"use client";

import { useRef, useState } from "react";

/**
 * A field people never see and a minimum fill time. Form-filling bots trip one
 * or the other; the server-side rate limits handle scripted API calls.
 */
export function useHoneypot(minMs = 1200) {
  const [started] = useState(() => Date.now());
  const trap = useRef<HTMLInputElement>(null);
  const looksLikeBot = () => !!trap.current?.value || Date.now() - started < minMs;
  const field = (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input ref={trap} type="text" name="website" tabIndex={-1} autoComplete="off" />
      </label>
    </div>
  );
  return { field, looksLikeBot };
}
