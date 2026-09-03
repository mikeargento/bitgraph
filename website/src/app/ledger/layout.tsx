import type { Metadata } from "next";

// The day page is a client component, so its tab title lives here.
export const metadata: Metadata = { title: "Ledger" };

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
