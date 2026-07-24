import type { Metadata } from "next";

// The maker page is a client component, so its tab title lives here.
export const metadata: Metadata = { title: "Maker" };

export default function MakerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
