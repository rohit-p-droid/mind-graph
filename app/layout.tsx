import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mind Graph — Knowledge Graph QA",
  description: "Mind Graph POC — upload PDFs and query your knowledge graph",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
