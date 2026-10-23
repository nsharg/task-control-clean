const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: abs > 86400 * 300 ? "numeric" : undefined });
}

export const shortDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
/** Agent-hours: whole numbers from 10 up, one decimal below. */
export const fmtHours = (h: number) => (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10).toString();

/** The message inside a Convex error, for a toast. */
export function errorMessage(e: unknown) {
  const data = (e as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^[\s\S]*Uncaught (ConvexError|Error): /, "").split("\n")[0].slice(0, 200) || "Something went wrong.";
}
