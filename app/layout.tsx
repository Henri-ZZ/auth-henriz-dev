import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Henri Z · Secure Access", description: "Private administrator authentication" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><main className="shell">{children}</main></body></html>;
}

