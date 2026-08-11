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
 * Whitepaper moved out of UNDERSTAND and into REFERENCE (2026-08-09, Mike:
 * "maybe whitepaper should be under reference?"). It spent months closing the
 * conceptual run as a compromise between two things that were both true: high
 * placement is a credibility signal, and the most demanding document on the
 * site should not be the sixth thing a curious reader meets. Reference settles
 * it instead of splitting it. The whitepaper is not a step in an orientation,
 * it is a thing you consult, which is exactly what it now sits with.
 *
 * Proof Format left the conceptual run for BUILD (2026-08-09), where it sits
 * second: it read as the last thing to understand rather than as something you
 * build against, and inside BUILD the quickstart comes before the schema.
 *
 * TOOLS and BUILD divide on one question: does this require engineering. Every
 * no-code surface is in TOOLS, and BUILD is the guide, the spec and the
 * infrastructure. The four ways in still run easiest to hardest, they just no
 * longer run across a column boundary.
 *
 * REFERENCE is the fourth column: the whitepaper, the FAQ, the repo. The three
 * things you look something up in rather than read through. GitHub is appended
 * in the menu itself, always last; it is the only entry on this page that is
 * NOT in the reading sequence, being a destination rather than a section.
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
    ],
  },
  // TOOLS is everything with nothing to write: two CLIs, a Mac app, two
  // connectors, a server. It was called USE until 2026-08-09 and that was the
  // weakest of the four labels, being the only one that could sit above any
  // column on the page: you use BitGraph by building on it, and by
  // understanding it first. Tools names what is actually in the column. The set
  // reads Understand / Tools / Build / Reference, two things you do and two
  // things you reach for.
  //
  // Zapier/Make and MCP moved here from BUILD the same day (Mike: "zapier make
  // and MCP could be under USE right?"). They could and they should: BUILD was
  // holding a no-code connector next to running your own enclave, which meant
  // the line between the columns was not a line at all. It is one test now,
  // does this require engineering, and both of these fail it. Configuring a Zap
  // is not building any more than installing the Folder is.
  //
  // The order is two runs, not one: CHECK something you were handed
  // (Verification, Audit), then RECORD things yourself (Folder, Zapier, MCP).
  // That is a truer account than the rising-setup-effort story told at first,
  // and it happens to produce the same five.
  {
    label: "Tools",
    items: [
      { href: "/docs/verification", label: "Verification" },
      { href: "/docs/audit", label: "Audit a Bundle" },
      // Player extends the CHECK run rather than opening a third one: it
      // consumes the audit pipeline's output (a rule evaluated over a bundle),
      // so it reads Verification → Audit → Player, then the RECORD run. It is
      // a CLI over JSON files, not engineering, which is the column test.
      { href: "/docs/player", label: "BitGraph Player" },
      { href: "/docs/folder", label: "BitGraph Folder" },
      { href: "/docs/automation", label: "Zapier and Make" },
      { href: "/docs/mcp", label: "MCP" },
    ],
  },
  // BUILD is what is left once that test is applied: do it, look the details
  // up, then run your own.
  {
    label: "Build",
    items: [
      // Just "Proof Format". The schema id was in the label for months, first
      // as "(bitgraph/1)" and then as ": bitgraph/1", and it was the longest
      // string in the menu either way: it set the menu's minimum width, and it
      // was the one label that wrapped to two lines in the foot-of-page trail
      // on a phone. The page's own h1 still reads "Proof Format: bitgraph/1",
      // which is where the version belongs. A menu names places.
      //
      // It stays in BUILD rather than REFERENCE, which was the other candidate
      // once REFERENCE became a real category: a spec is consult-material, but
      // this one is NORMATIVE, and what it governs is what you build. REFERENCE
      // holds the things that explain.
      //
      // It sits SECOND, not first. Heading the column was right while BUILD was
      // five mixed items and the spec was the one thing anchoring them; once
      // the no-code surfaces left for TOOLS, BUILD became a three-page
      // engineering run that a developer reads top down, and the order for that
      // is the quickstart, then the schema, then the infrastructure. Nobody
      // arrives at a docs column wanting the wire format before they have seen
      // a request.
      { href: "/docs/integration", label: "Integration Guide" },
      { href: "/docs/proof-format", label: "Proof Format" },
      { href: "/docs/self-host-tee", label: "Self-Host TEE" },
    ],
  },
];

/**
 * REFERENCE, the fourth column, rendered by the menu after the three groups
 * above (it appends GitHub to these, which is external and stays out of the
 * sequence). These ARE in the sequence, and they close it: the trail runs
 * Self-Host TEE → Whitepaper → FAQ and stops.
 */
export const DOCS_TAIL: DocsSection[] = [
  { href: "/docs/whitepaper", label: "Whitepaper" },
  { href: "/docs/faq", label: "FAQ" },
];

/** Every section, flat, in reading order. The previous/next sequence. */
export const DOCS_SECTIONS: DocsSection[] = [
  ...DOCS_GROUPS.flatMap((g) => g.items),
  ...DOCS_TAIL,
];

export const DOCS_REPO = "https://github.com/mikeargento/bitgraph";
