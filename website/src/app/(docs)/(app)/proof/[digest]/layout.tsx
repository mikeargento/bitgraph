import type { Metadata } from "next";

// The proof page is a client component, so its tab title lives here.
export const metadata: Metadata = { title: "Proof" };

export default function ProofLayout({ children }: { children: React.ReactNode }) {
  return children;
}
