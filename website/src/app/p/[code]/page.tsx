import type { Metadata } from "next";
import { ShortLink } from "@/components/short-link";

/* The first short links (2026-10-08) were /p/<code>; they keep working forever. New ones are /<code>
   (app/[code]); both resolve the same way (components/short-link.tsx). */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Short link", robots: { index: false } };

export default async function ShortLinkP({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ShortLink code={code} />;
}
