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
 * changed. /subjects, /api-reference, /ceilings and /exam live outside /docs for
 * historical reasons (cached permanent redirects point at two of them) and
 * mount the previous/next pair themselves. "Floors" (/ledger, Ethereum anchors)
 * and "Ceilings" (/ceilings) became one item, "Base", when floors moved to Base
 * with enclave v10 (Mike, 2026-10-06); /ledger stays as the history of the
 * Ethereum anchors, out of the sequence.
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
      { href: "/docs/carrier", label: "The BitGraphed file" },
      { href: "/docs/sdk", label: "SDK" },
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
      { href: "/ceilings", label: "Base" },
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

/**
 * The Menu panel (2026-10-01 redesign proposal): demos first, then the docs,
 * each row with one line saying what is behind it, the long tail of Build in
 * a "More" line, and FAQ, Contact and GitHub in a strip along the bottom. The
 * reading order above (DOCS_GROUPS) still drives previous/next and the sitemap.
 */
export type MenuItem = { href: string; label: string; desc: string; external?: boolean };
export type MenuGroup = { label: string; question?: string; items: MenuItem[]; more?: DocsSection[]; feature?: boolean };

export const MENU_GROUPS: MenuGroup[] = [
  {
    label: "See it working",
    feature: true,
    items: [
      { href: "/painting", label: "Make a painting", desc: "One click, a painting that never existed." },
      { href: "/jev", label: "Ask Jev", desc: "Two questions no one could have seen before." },
      { href: "/exam", label: "The sealed exam", desc: "An exam sealed in BitGraph, and how to check it." },
      { href: "/docs/try", label: "Make a BitGraph", desc: "Drop in any file and get its proof." },
      { href: "/ceilings", label: "Base", desc: "The Base blocks around each BitGraph." },
    ],
  },
  {
    label: "Understand",
    question: "What is BitGraph?",
    items: [
      { href: "/docs/overview", label: "How it works", desc: "A position, a floor and a ceiling, in one picture." },
      { href: "/subjects", label: "Use cases", desc: "Where a record's position matters." },
      { href: "/docs/trust-model", label: "Trust model", desc: "What you rely on, and what you don't." },
      { href: "/docs/what-bitgraph-is-not", label: "Limits", desc: "What a BitGraph does not prove." },
      { href: "/docs/what-is-bitgraph", label: "The protocol", desc: "The full specification." },
      { href: "/docs/faq", label: "FAQ", desc: "Common questions, answered." },
    ],
  },
  {
    label: "Build",
    question: "How do I use it?",
    items: [
      { href: "/docs/integration", label: "Integration guide", desc: "Add BitGraph to your product." },
      { href: "/docs/sdk", label: "SDK", desc: "A library, a command line and a local server." },
      { href: "/docs/mcp", label: "MCP server", desc: "Give an AI agent BitGraph." },
      { href: "/api-reference", label: "API reference", desc: "Every request and response." },
      { href: "/docs/self-host-tee", label: "Self-host a TEE", desc: "Run your own BitGraph enclave." },
      { href: "https://github.com/mikeargento/bitgraph", label: "GitHub", desc: "The source code.", external: true },
    ],
  },
  {
    label: "Verify",
    question: "How do I check a proof?",
    items: [
      { href: "/docs/verification", label: "Verification", desc: "Check any proof yourself, offline." },
      { href: "/docs/audit", label: "Audit a bundle", desc: "Check a whole folder of proofs at once." },
      { href: "/docs/proof-format", label: "Proof format", desc: "What is inside a proof, field by field." },
      { href: "/docs/carrier", label: "The BitGraphed file", desc: "A file that carries its own proof." },
      { href: "/docs/player", label: "Player", desc: "Check a rule about the order of files, offline." },
    ],
  },
];
