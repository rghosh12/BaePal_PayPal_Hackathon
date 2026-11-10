import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BaePal · A little spark. A real connection.",
  description:
    "Intentional connections and thoughtful first dates. A fictional hackathon demo.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
