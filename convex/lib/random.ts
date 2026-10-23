/** A URL-safe secret with 256 bits of entropy. Call from actions only. */
export function randomToken(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return prefix + b64;
}
