// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The documentation sections, in reading order.
 *
 * Lived in `app/docs/layout.tsx` until the section menu moved into the site
 * nav. It sits here now because the nav renders it on every route, while the
 * docs layout only wraps the ones under /docs. The same order drives the
 * previous/next pair at the foot of each page (`components/docs-page-nav.tsx`),
 * so the menu and the trail through the docs can never disagree.
 *
 * The groups were implicit until 2026-08-09 and are now named: understand it,
 * use it, build on it. The order inside each one is unchanged from the
 * 2026-08-03 pass, and the reasoning behind it still holds:
 *
 * "What BitGraph is Not" sits next to its definitional pair rather than
 * eleven slots away behind every integration doc. This product is heavily
 * defined by negation (not a blockchain, not a watermark, not DRM, not proof
 * of authorship), so that page does positioning work nobody was finding.
 *
 * "Self-Host TEE" closes BUILD. It is the rarest thing anyone will do, and it
 * used to sit mid-list splitting Trust Model from the integration docs.
 *
 * Whitepaper closes UNDERSTAND rather than leading it: high placement is a
 * credibility signal, but the third thing a curious reader meets should not be
 * the most demanding document.
 *
 * Proof Format opens BUILD (moved from just after Whitepaper, 2026-08-09).
 * The four ways to use it still run easiest-to-hardest within the group, but
 * the canonical schema now anchors the start of BUILD instead of the end of
 * the conceptual run, where it read as the last thing to understand rather
 * than the first thing to build against.
 *
 * FAQ sits outside the groups, and GitHub is appended in the menu itself,
 * always last, as the one external link. Only FAQ is part of the reading
 * sequence; GitHub is a destination, not a section.
 */
export type DocsSection = { href: string; label: string };

export const DOCS_GROUPS: { label: string; items: DocsSection[] }[] = [
  {
    label: "Understand",
    items: [
      { href: "/docs/overview", label: "Overview" },
      // Use cases moved in from the top nav (2026-08-05, Mike's call after the
      // label had already gone Subjects → Applications → Use cases that same
      // day). Second, right after Overview: orient first, then motivate, then
      // the definitional pair. The one entry here that lives outside /docs; the
      // route stays /subjects because /uses and /applications are both burned as
      // permanently cached redirects. Being outside /docs is also why the page
      // renders its own <DocsPageNav />: the docs layout does not wrap it.
      { href: "/subjects", label: "Use cases" },
      { href: "/docs/what-is-bitgraph", label: "What is BitGraph" },
      { href: "/docs/what-bitgraph-is-not", label: "What BitGraph is Not" },
      { href: "/docs/trust-model", label: "Trust Model" },
      { href: "/docs/whitepaper", label: "Whitepaper" },
    ],
  },
  {
    label: "Use",
    items: [
      { href: "/docs/verification", label: "Verification" },
      { href: "/docs/audit", label: "Audit a Bundle" },
      { href: "/docs/folder", label: "BitGraph Folder" },
    ],
  },
  {
    label: "Build",
    items: [
      // Just "Proof Format". The schema id was in the label for months, first
      // as "(bitgraph/1)" and then as ": bitgraph/1", and it was the longest
      // string in the menu either way: it set the menu's minimum width, and it
      // was the one label that wrapped to two lines in the foot-of-page trail
      // on a phone. The page's own h1 still reads "Proof Format: bitgraph/1",
      // which is where the version belongs. A menu names places.
      { href: "/docs/proof-format", label: "Proof Format" },
      { href: "/docs/automation", label: "Zapier and Make" },
      { href: "/docs/mcp", label: "MCP" },
      { href: "/docs/integration", label: "Integration Guide" },
      { href: "/docs/self-host-tee", label: "Self-Host TEE" },
    ],
  },
];

/** Below the groups in the menu, and the last stop in the reading sequence. */
export const DOCS_TAIL: DocsSection[] = [
  { href: "/docs/faq", label: "FAQ" },
];

/** Every section, flat, in reading order. The previous/next sequence. */
export const DOCS_SECTIONS: DocsSection[] = [
  ...DOCS_GROUPS.flatMap((g) => g.items),
  ...DOCS_TAIL,
];

export const DOCS_REPO = "https://github.com/mikeargento/bitgraph";
