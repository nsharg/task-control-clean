/** Super admins are named by email in the SUPER_ADMIN_EMAILS deployment variable. */
export function isSuperAdminEmail(email: string) {
  const list = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
