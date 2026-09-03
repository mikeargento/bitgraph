import { notFound } from "next/navigation";
import Harness from "./harness";

export const dynamic = "force-dynamic";
export const metadata = { title: "BitGraph harness", robots: { index: false, follow: false } };

/**
 * Internal harness for the producer profile (working name Fuse), spec 9.2.
 * 404 unless both FUSE_ENABLED and FUSE_HARNESS_ENABLED are "true"; the
 * route behind it also requires the shared token. Not a product surface.
 */
export default function Page() {
  if (process.env.FUSE_ENABLED !== "true" || process.env.FUSE_HARNESS_ENABLED !== "true") notFound();
  return <Harness />;
}
