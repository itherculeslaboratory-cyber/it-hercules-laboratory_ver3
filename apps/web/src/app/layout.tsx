import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "IHL",
  description: "IT Hercules Laboratory",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
