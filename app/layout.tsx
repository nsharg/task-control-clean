import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/convex-provider";
import { getToken } from "@/lib/auth-server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Task Control", template: "%s · Task Control" },
  description: "Projects, tasks and tickets for small teams and their agents.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#212121" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const token = await getToken();
  // Set per request in proxy.ts; lets next-themes' inline script pass the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="h-full antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <ConvexClientProvider initialToken={token}>{children}</ConvexClientProvider>
          <Toaster position="bottom-center" toastOptions={{ className: "!rounded-2xl !border-line !bg-elevated !text-fg !shadow-pop" }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
