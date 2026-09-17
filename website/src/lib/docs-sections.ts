// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.

/**
 * The documentation map (2026-09-17 rewrite): three groups, one per question
 * a reader arrives with, then a short Reference tail.
 *
 *   Understand  What is this, and why would I need it?
 *   Build       What do I send, what do I get back, how do I integrate it?
 *   Verify      What exactly is established, and how do I check it myself?
 *   Reference   The FAQ and Contact, then GitHub (appended by the menu).
 *
 * The same list drives the Docs menu in the bar (components/site-nav.tsx),
 * the previous/next pair at the foot of each page (components/docs-page-nav.tsx)
 * and the sitemap, so none of them can disagree.
 *
 * Every URL predates the rewrite and is preserved. Only labels and grouping
 * changed. /subjects, /api-reference, /ledger and /exam live outside /docs for
 * historical reasons (cached permanent redirects point at two of them) and
 * mount the previous/next pair themselves.
 */
export type DocsSection = { href: string; label: string };

export const DOCS_GROUPS: { label: string; items: DocsSection[] }[] = [
  {
    label: "Understand",
    items: [
      { href: "/docs/overview", label: "How it works" },
      { href: "/docs/what-is-bitgraph", label: "The protocol" },
      { href: "/docs/trust-model", label: "Trust model" },
      { href: "/docs/what-bitgraph-is-not", label: "Limits" },
      { href: "/subjects", label: "Use cases" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/docs/integration", label: "Integration guide" },
      { href: "/api-reference", label: "API reference" },
      { href: "/docs/proof-format", label: "Proof format" },
      { href: "/docs/mcp", label: "MCP server" },
      { href: "/docs/player", label: "Player" },
      { href: "/docs/self-host-tee", label: "Self-host a TEE" },
    ],
  },
  {
    label: "Verify",
    items: [
      { href: "/docs/verification", label: "Verification" },
      { href: "/docs/audit", label: "Audit a bundle" },
      { href: "/docs/try", label: "Make a BitGraph" },
      { href: "/ledger", label: "Ethereum anchors" },
      { href: "/exam", label: "The sealed exam" },
    ],
  },
];

/** The Reference column: in the reading sequence, and closing it. */
export const DOCS_TAIL: DocsSection[] = [
  { href: "/docs/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

/** Every section, flat, in reading order: the previous/next sequence. */
export const DOCS_SECTIONS: DocsSection[] = [...DOCS_GROUPS.flatMap((g) => g.items), ...DOCS_TAIL];

export const DOCS_REPO = "https://github.com/mikeargento/bitgraph";
