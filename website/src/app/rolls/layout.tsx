import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rolls" };

export default function RollsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
