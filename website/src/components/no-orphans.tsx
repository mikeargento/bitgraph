"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * No one-word last lines. After a page mounts, the last two words of every
 * prose block are joined with a no-break space, so a paragraph can never end
 * with a lone word on its own line. Deterministic in every browser, unlike
 * `text-wrap: pretty`, which Safari applies across whole paragraphs and
 * Chrome only to the last lines. Runs once per block (marked with data-tight)
 * and never touches code, pre or SVG text.
 *
 * ⚠️ HYDRATION. A page that streams (the ledger: its content arrives after
 * the shell) can have blocks in the DOM that React has not hydrated yet, and
 * editing their text made React find a text node it did not write (seen on
 * /ledger, 2026-09-17, two loads in three). So a block is touched only once
 * React owns it, which its fiber key on the element says, and the pass is
 * retried for a few seconds so blocks that hydrate later get their turn.
 */
const SELECTOR = ".prose p, .prose li, .prose dd, .prose dt, .prose blockquote, .lede, figcaption, .doors span, .facts span, .note, .receipt-row span";
const RETRY_MS = [0, 300, 1200, 3000, 6000];

const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));

function pass() {
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
    if (el.dataset.tight === "1" || !hydrated(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("pre, code, svg, kbd") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const t = nodes[i];
      const tail = nodes.slice(i + 1).map((x) => x.data).join("");
      const s = t.data;
      // Ignore trailing whitespace when nothing meaningful follows this node.
      const searchIn = tail.trim() ? s : s.replace(/\s+$/, "");
      const idx = searchIn.lastIndexOf(" ");
      if (idx === -1) continue;
      if (!/\S/.test(searchIn.slice(idx + 1) + tail)) continue;
      t.data = s.slice(0, idx) + " " + s.slice(idx + 1);
      break;
    }
    el.dataset.tight = "1";
  });
}

export function NoOrphans() {
  const pathname = usePathname();
  useEffect(() => {
    const timers = RETRY_MS.map((ms) => window.setTimeout(pass, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [pathname]);
  return null;
}
