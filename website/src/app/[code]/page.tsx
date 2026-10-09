import type { Metadata } from "next";
import { ShortLink } from "@/components/short-link";

/* Short links at the site root (Mike, 2026-10-09): bitgraph.ing/<the first characters of a record's digest>.
   Every real page and redirect wins over this route; a path that is not a recorded digest's prefix is the
   ordinary not-found page (components/short-link.tsx). */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Short link", robots: { index: false } };

export default async function ShortLinkRoot({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ShortLink code={code} bare />;
}
