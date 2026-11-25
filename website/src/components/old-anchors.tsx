"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Links made before 2026-11-25 point at sections of the home page (/#t-mech). Each is now a page of its own under
 *  How it works; an old link opens it. */
const OLD: Record<string, string> = {
  "t-intro": "/how", "t-mech": "/how/mechanism", "t-proves": "/how/establishes", "t-atomic": "/how/mechanism",
  "t-seq": "/how/sequence", "t-attest": "/how/trust", "t-time": "/how/time", "t-publish": "/how/time",
  "t-trees": "/how/collections", "t-redact": "/how/collections", "t-format": "/how/proof",
  "t-verify": "/how/proof", "t-threat": "/how/trust", "t-trust": "/how/trust", "t-compare": "/how/comparison",
};
export function OldAnchors() {
  const router = useRouter();
  useEffect(() => {
    const to = OLD[window.location.hash.slice(1)];
    if (to) router.replace(to);
  }, [router]);
  return null;
}
