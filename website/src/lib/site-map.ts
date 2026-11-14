// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The site's pages, once: the bar, the row of a section's pages under it, the phone menu and the footer's index all
 * read this list, so a page added here has a path from every page.
 *
 * A section is a page in the bar with the pages that belong to it. `first` names the section's own page where its
 * pages are listed side by side.
 */
export type SitePage = { href: string; label: string };
export type SiteSection = SitePage & { first?: string; pages?: SitePage[] };

/** The first section of the home page, where "How it works" leads: the short statement, then the mechanism. */
export const HOW_IT_WORKS_ID = "t-intro";

export const SECTIONS: SiteSection[] = [
  { href: `/#${HOW_IT_WORKS_ID}`, label: "How it works" },
  { href: "/ledger", label: "Ledger", pages: [{ href: "/ledger/calendar", label: "Calendar" }] },
  {
    href: "/examples", label: "Demos", first: "All demos",
    pages: [
      { href: "/jev", label: "Ask AI" },
      { href: "/generate", label: "Generate image" },
      { href: "/exam", label: "Sealed exam" },
      { href: "/pictures", label: "Copies" },
    ],
  },
  {
    href: "/integrate", label: "Developers", first: "API and SDK",
    pages: [
      { href: "/tools", label: "Reference" },
      { href: "/evaluate", label: "Evaluate" },
    ],
  },
  { href: "/licensing", label: "Licensing", first: "Licensing", pages: [{ href: "/applications", label: "Use cases" }] },
  { href: "/contact", label: "Contact" },
];

/** Where a BitGraph is made: the first of the bar's links. */
export const DROP: SitePage = { href: "/demos", label: "Drop a file" };

/**
 * The bar's links, in one row and one size: Drop a file, then each section and, right after it, the pages inside it.
 * The ledger is the bar's one button, not a link here, and the single demos are reached from Demos.
 */
export const BAR: SitePage[] = [DROP, ...SECTIONS.filter((s) => s.href !== "/ledger").flatMap((s) => [s, ...(s.href === "/examples" ? [] : s.pages ?? [])])];

const at = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** Whether the page at `pathname` is this section's own page or one of its pages. */
export function inSection(pathname: string, s: SiteSection): boolean {
  if (s.href.startsWith("/#")) return false;
  return at(pathname, s.href) || (s.pages ?? []).some((p) => at(pathname, p.href));
}

/** The section whose pages are listed in a row under the bar on this page: one with pages of its own to list. */
export function rowFor(pathname: string): SiteSection | null {
  return SECTIONS.find((s) => s.first && inSection(pathname, s)) ?? null;
}
