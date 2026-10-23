import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";

const field =
  "w-full rounded-xl border border-line-strong bg-bg px-3.5 text-[15px] text-fg placeholder:text-fg-3 transition-colors focus:border-focus focus:outline-none focus:ring-3 focus:ring-focus/15 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} dir={typeof props.value === "string" ? textDir(props.value) : undefined} className={cn(field, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} dir={typeof props.value === "string" ? textDir(props.value) : undefined} className={cn(field, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...props} />;
});

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[13px] font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="block text-[13px] text-red">{error}</span> : hint ? <span className="block text-[13px] text-fg-3">{hint}</span> : null}
    </label>
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "h-11 appearance-none bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%238f8f8f' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
}
