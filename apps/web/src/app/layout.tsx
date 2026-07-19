import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "IHL",
  description: "IT Hercules Laboratory",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        {/* design-home-round.md §③: theme.js must run before first paint (its
            own FOUC contract). ponytail: next/script strategy="beforeInteractive"
            does NOT emit a real blocking <script src> here — verified via raw
            SSR HTML fetch, it only pushes into Next's `__next_s` queue, which
            the async main-app.js bundle drains during hydration bootstrap —
            i.e. well after DOMContentLoaded (confirmed empirically: data-theme
            was still null at domcontentloaded with that strategy). A literal
            <script src> JSX element is not run through next/script at all —
            the browser's own HTML parser hits it during initial parse and
            blocks synchronously (no async/defer), exactly like theme.js's own
            documented contract asks for. As the first child of <body>, it
            runs before any of our visible content is even parsed. */}
        <script src="/assets/theme.js" />
        {children}
      </body>
    </html>
  );
}
