"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";
import { foundThumbnail, foundThumbnailAmong, type BoundThumbnail } from "@/lib/trustmark/bound-thumbnail";
import type { Original } from "@/lib/trustmark/check";

/** On a Check row for a copy: the reference thumbnail the original's tree bound, once it has matched the bound
 *  fingerprint. What was found, to look at; the proof page proves the original. Nothing while there is none, unless
 *  `among` names other BitGraphs of the same picture, whose reference then stands in. */
export function FoundThumb({ o, href, onOpen, among }: { o: Original; href: string; onOpen?: () => void; among?: Original[] }) {
  const [t, setT] = useState<BoundThumbnail | null>(null);
  useEffect(() => {
    let gone = false, url: string | null = null;
    (among ? foundThumbnailAmong(o, among) : foundThumbnail(o)).then((r) => {
      const got = r && typeof r === "object" ? r : null;
      if (gone) { if (got) URL.revokeObjectURL(got.url); return; }
      url = got?.url ?? null; setT(got);
    }).catch(() => {});
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [o, among]);
  if (!t) return null;
  return (
    <a className="db-thumb" href={href} onClick={onOpen ? (e) => { e.preventDefault(); onOpen(); } : undefined} title={t.from ? `The reference bound by BitGraph #${t.from.counter.toLocaleString("en-US")}, the same picture; the proof page proves the original` : "The reference this BitGraph bound; the proof page proves the original"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.url} alt="The reference thumbnail bound beside the original" />
    </a>
  );
}
