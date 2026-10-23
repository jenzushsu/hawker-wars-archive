import type { Metadata } from "next";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Hawker Wars — Offline arena",
  description:
    "Three chicken rice stalls. One shared challenge. Explore a deterministic offline rules replay.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
