import type { Metadata } from "next";

export const metadata: Metadata = { title: "Anchor calendar" };

export default function ArchiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
