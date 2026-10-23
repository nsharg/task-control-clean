const HEBREW = /[֐-׿יִ-ﭏ]/gu;
const LETTER = /\p{L}/gu;

/**
 * Right-to-left when at least 70% of the letters are Hebrew. Digits, spaces,
 * punctuation and markdown syntax don't count, so "באג #12 ב-Safari" still reads RTL.
 */
export function textDir(text: string | null | undefined): "rtl" | "ltr" {
  if (!text) return "ltr";
  const letters = text.match(LETTER)?.length ?? 0;
  if (!letters) return "ltr";
  const hebrew = text.match(HEBREW)?.length ?? 0;
  return hebrew / letters >= 0.7 ? "rtl" : "ltr";
}
