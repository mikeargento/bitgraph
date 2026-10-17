"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the running ledger's "today" current without a reload, the Base page's
 * pattern: every 10 s while the tab is visible it asks /api/ledger/today for the
 * day's count, and a new BitGraph refreshes the server-rendered rows. At
 * midnight UTC the page follows the new day.
 */
export function LedgerLive({ day, count }: { day: string; count: number }) {
  const router = useRouter();
  const seen = useRef(count);
  useEffect(() => { seen.current = count; }, [count]);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/ledger/today", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { day: string; count: number };
        if (j.day !== day || j.count !== seen.current) { seen.current = j.count; router.refresh(); }
      } catch { /* a missed poll is not a verdict; the next one tries again */ }
    };
    const t = setInterval(check, 10_000);
    const onVis = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [day, router]);
  return null;
}
