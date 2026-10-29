"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";
import { foundThumbnail, type BoundThumbnail } from "@/lib/trustmark/bound-thumbnail";
import type { Original } from "@/lib/trustmark/check";

/** On a Check row for a copy: the reference thumbnail the original's tree bound, once it has matched the bound
 *  fingerprint. What was found, to look at; the proof page proves the original. Nothing while there is none. */
export function FoundThumb({ o, href }: { o: Original; href: string }) {
  const [t, setT] = useState<BoundThumbnail | null>(null);
  useEffect(() => {
    let gone = false, url: string | null = null;
    foundThumbnail(o).then((r) => { if (gone) { if (r) URL.revokeObjectURL(r.url); return; } url = r?.url ?? null; setT(r); }).catch(() => {});
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [o]);
  if (!t) return null;
  return (
    <a className="db-thumb" href={href} title="The reference this BitGraph bound; the proof page proves the original">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.url} alt="The reference thumbnail bound beside the original" />
    </a>
  );
}
