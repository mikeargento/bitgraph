import type { Metadata } from "next";

// The roll page is a client component, so its tab title lives here.
export const metadata: Metadata = { title: "Roll" };

export default function RollLayout({ children }: { children: React.ReactNode }) {
  return children;
}
