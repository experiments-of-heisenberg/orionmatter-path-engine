import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orionmatter Path Engine",
  description:
    "A career route planner for engineers: three evidence-backed routes, a Skeptic that rejects claims the data does not support, and What-if that explains every change.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
