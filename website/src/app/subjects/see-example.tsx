"use client";

import Link from "next/link";
import { useEffect } from "react";
import { warm, proofFeedKey, EXAMPLE_PROOF } from "@/lib/warm";

/**
 * "See an example BitGraph" for the Subjects page, which is a server component.
 *
 * Only the data warm is carried over from the home page's version. The artifact
 * caching is not needed here: the proof page self-seeds this one example,
 * fetching /example/preston.jpg itself when the digest matches (see
 * app/proof/[digest]/page.tsx), so arriving from anywhere still shows the photo.
 *
 * A <Link> gets route prefetch for free, unlike the home page's <button>, so
 * warming the proof's own response is all that is left to do.
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
      className="bg-action-link"
      onMouseEnter={prime}
      onFocus={prime}
      onTouchStart={prime}
    >
      See an example BitGraph <span className="arrow">&rarr;</span>
    </Link>
  );
}
