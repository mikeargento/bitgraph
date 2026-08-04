// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The documentation sections, in reading order.
 *
 * Lived in `app/docs/layout.tsx` until the section menu moved into the site
 * nav. It sits here now because the nav renders it on every route, while the
 * docs layout only wraps the ones under /docs.
 *
 * Four groups, deliberately not labelled: understand it, check it, use it,
 * run your own. Reordered 2026-08-03; the previous order had accumulated
 * rather than been chosen.
 *
 * Three things it fixes:
 *
 * "What BitGraph is Not" was at 13, eleven slots from its definitional pair
 * at 2 and buried behind every integration doc. This product is heavily
 * defined by negation (not a blockchain, not a watermark, not DRM, not proof
 * of authorship), so that page does positioning work nobody was finding.
 *
 * "Self-Host TEE" was at 8, the rarest thing anyone will do sitting mid-list
 * and splitting Trust Model from the integration docs. It now closes the
 * how-to run, where someone who actually wants it will still look.
 *
 * The four ways to use it ran hardest-to-easiest: write code, then agents,
 * then no-code, then download-and-drop. Reversed, so the surface with the
 * largest audience leads and the canonical API anchors the end. The
 * connectors are conveniences over that API, so it reads as a progression
 * rather than a demotion.
 *
 * Whitepaper moved 3 → 5 on the same reasoning: high placement is a
 * credibility signal, but the third thing a curious reader meets should not
 * be the most demanding document. It still sits inside the conceptual run.
 *
 * GitHub is appended in the menu itself, always last, as the one external
 * link.
 */
export const DOCS_SECTIONS: { href: string; label: string }[] = [
  { href: "/docs/overview", label: "Overview" },
  { href: "/docs/what-is-bitgraph", label: "What is BitGraph" },
  { href: "/docs/what-bitgraph-is-not", label: "What BitGraph is Not" },
  { href: "/docs/trust-model", label: "Trust Model" },
  { href: "/docs/whitepaper", label: "Whitepaper" },
  { href: "/docs/proof-format", label: "Proof Format (bitgraph/1)" },
  { href: "/docs/verification", label: "Verification" },
  { href: "/docs/audit", label: "Audit a Bundle" },
  { href: "/docs/folder", label: "BitGraph Folder" },
  { href: "/docs/automation", label: "Zapier and Make" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/docs/integration", label: "Integration Guide" },
  { href: "/docs/self-host-tee", label: "Self-Host TEE" },
  { href: "/docs/faq", label: "FAQ" },
];

export const DOCS_REPO = "https://github.com/mikeargento/bitgraph";
