"use client";

/* Is your BitGraphs folder connected? — in the corner, on every page.
 *
 * Mike asked for this after making a BitGraph and not being able to tell:
 * "there should be a clear indicator if your local folder was connected or not
 * in upper corner with a red or green light."
 *
 * ⚠️ IT IS NOT A RED/GREEN LIGHT, and that is a deliberate departure from the
 * literal ask. Two standing rules stand against one:
 *   - Green was RETIRED site-wide on 2026-07-19; the trust colour is the brand
 *     blue #0065A4. A green light here would be the only green on the site.
 *   - "Nothing red." Not-connected is the NORMAL first state — every
 *     first-time visitor is in it, and nothing is broken — so a red light
 *     reports a fault where there is none, which is the thing this whole
 *     product is about not doing.
 * What Mike actually needed is to be able to TELL AT A GLANCE, from anywhere,
 * and that is what this gives: a dot for glanceability plus the count, since
 * "a count, never a dot" was his own ruling the same day and the count says
 * strictly more. Blue when connected, hollow grey when not.
 *
 * ⚠️ It reads the same IndexedDB the camera writes, and re-reads on focus and
 * on the camera's own event, because connecting happens on the home page while
 * this sits in the nav on every page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadLedger } from "@/lib/local-ledger";

/** Fired by the camera whenever the connected ledger changes, so the nav does
 *  not have to poll or wait for a navigation to catch up. */
export const LEDGER_CHANGED = "bitgraph:ledger-changed";

export function LedgerLight() {
  // null = not read yet. Distinct from 0, so the first paint says nothing
  // rather than flashing "not connected" at someone who is.
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    const read = () => {
      void loadLedger().then((l) => { if (!dead) setCount(l.proofs.length); });
    };
    read();
    window.addEventListener(LEDGER_CHANGED, read);
    window.addEventListener("focus", read);
    return () => {
      dead = true;
      window.removeEventListener(LEDGER_CHANGED, read);
      window.removeEventListener("focus", read);
    };
  }, []);

  if (count === null) return null;
  const on = count > 0;

  return (
    <Link
      href="/"
      title={on
        ? `${count.toLocaleString()} BitGraph${count === 1 ? "" : "s"} connected from your folder`
        : "No BitGraphs folder connected — drag yours onto the box to connect it"}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 700, textDecoration: "none",
        color: on ? "#0065A4" : "#6b7280", whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8, height: 8, borderRadius: "50%",
          // Filled when connected, hollow when not: the shape carries the
          // state as well as the colour, so it survives being glanced at and
          // does not rely on colour alone.
          background: on ? "#0065A4" : "transparent",
          border: on ? "none" : "1.5px solid #9ca3af",
          flex: "none",
        }}
      />
      {on ? count.toLocaleString() : "Not connected"}
    </Link>
  );
}
