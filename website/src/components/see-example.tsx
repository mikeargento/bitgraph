"use client";

import Link from "next/link";
import { useEffect } from "react";
import { warm, proofFeedKey, EXAMPLE_PROOF } from "@/lib/warm";

/**
 * "See an example BitGraph" for the home page, directly under the Folder
 * download. It lived on /subjects for a day; both actions now sit together so
 * the home page offers one thing to install and one thing to look at.
 *
 * The proof page self-seeds this one example, fetching /example/preston.jpg
 * itself when the digest matches (see app/proof/[digest]/page.tsx), so arriving
 * from anywhere still shows the photo and no artifact caching is needed here.
 *
 * A <Link> gets route prefetch for free, so warming the proof's own response is
 * all that is left to do.
 */
export function SeeExample() {
  const { digest, counter, epoch } = EXAMPLE_PROOF;
  const prime = () => warm(proofFeedKey(digest, counter, epoch));

  // Idle warm covers the reader who lands and works down the page; hover and
  // focus cover the one who skims straight to it.
  useEffect(() => {
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      const id = ric(prime, { timeout: 2000 });
      return () => (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(prime, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Link
      href={`/proof/${digest}?counter=${counter}&epoch=${epoch}`}
      // The site's one link shape: .bg-arrow-link plus the arrow in its own
      // span, which is what earns the hover nudge. It wore a bespoke home-page
      // class until it moved to /docs/overview, where sitting beside ordinary
      // docs links made the difference obvious.
      className="bg-arrow-link"
      style={{ fontSize: 14, fontWeight: 600, color: "#0065A4", textDecoration: "none" }}
      onMouseEnter={prime}
      onFocus={prime}
      onTouchStart={prime}
    >
      See an example BitGraph <span className="arrow" aria-hidden="true">&rarr;</span>
    </Link>
  );
}
