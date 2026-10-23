"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the Base page's "today" view current without a reload (Mike, 2026-10-08). Every 15 s, while the tab is
 * visible, it asks /api/ceilings/today how many writes the day has; a new write refreshes the server-rendered
 * rows at once, and a quiet two minutes refreshes them anyway so "Settling" turns to "Settled" by itself. A tab
 * coming back into view checks immediately. At midnight UTC the page follows the new day.
 */
export function CeilingsLive({ day, count }: { day: string; count: number }) {
  const router = useRouter();
  const seen = useRef(count);
  const lastRefresh = useRef(0);
  useEffect(() => { seen.current = count; lastRefresh.current = Date.now(); }, [count]);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/ceilings/today", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { day: string; count: number };
        const stale = Date.now() - lastRefresh.current > 120_000;
        if (j.day !== day || j.count !== seen.current || stale) {
          seen.current = j.count;
          lastRefresh.current = Date.now();
          router.refresh();
        }
      } catch { /* a missed poll is not a verdict; the next one tries again */ }
    };
    const t = setInterval(check, 15_000);
    const onVis = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [day, router]);
  return null;
}
