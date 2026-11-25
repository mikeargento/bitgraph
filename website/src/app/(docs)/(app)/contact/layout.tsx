import type { Metadata } from "next";

/* The page is a client component (form state), so its metadata lives here. */
export const metadata: Metadata = {
  title: "Contact",
  description: "Write to Argento Computing Inc., the company behind BitGraph.",
  alternates: { canonical: "https://bitgraph.ing/contact" },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
