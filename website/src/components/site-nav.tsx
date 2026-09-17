"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DOCS_GROUPS, DOCS_TAIL, DOCS_REPO, type DocsSection } from "@/lib/docs-sections";

/**
 * The bar. Wordmark, the four documentation groups each as its own dropdown,
 * and one filled button that opens the page where a BitGraph is made (Mike,
 * 2026-09-17, with GitHub's green Code button beside the old panel's four
 * headings: "the +New or 'make a bitgraph' button should be like this and the
 * menu items should be these as each dropdown menus each containing their
 * links").
 *
 * Below 900px four labels and a button do not fit, so the groups fold into one
 * Menu button whose panel lists all four, and the green button's label shortens
 * to New. It says Menu, not Docs (Mike, 2026-09-17): on a phone it holds
 * everything, Use cases, Contact and GitHub included.
 *
 * Menus open under the cursor on a device that has one (Mike, 2026-09-17:
 * "should you have to click menu items or should hover just work"), and on a
 * click or Enter everywhere, which is what a touch screen and a keyboard use.
 * The production bar was click-only because a hover-ONLY menu has no touch
 * equivalent; hover added to click does not have that problem. A menu opened
 * by hover closes a beat after the cursor leaves it, so a diagonal move to the
 * panel does not drop it, and a click on its button never closes it under the
 * cursor. Menus close on Escape, on a click outside, and on choosing a row; GitHub is the one row that leaves the site and says so; /deck carries
 * no chrome; on the home route the wordmark forces a fresh load.
 */
type Group = { label: string; items: DocsSection[]; external?: boolean };
const GROUPS: Group[] = [...DOCS_GROUPS, { label: "Reference", items: DOCS_TAIL, external: true }];

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  // A group's label while its dropdown is open, "all" for the folded panel, or null.
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  // A real cursor, not a finger: the only case in which hover means anything.
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const hoverOpen = (label: string) => { if (!canHover()) return; cancelClose(); setOpen(label); };
  const hoverClose = (label: string) => {
    if (!canHover()) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => { setOpen((o) => (o === label ? null : o)); closeTimer.current = null; }, 160);
  };
  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!navRef.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (pathname === "/deck") return null;

  const row = (s: DocsSection) => (
    <Link
      key={s.href}
      href={s.href}
      role="menuitem"
      className="docs-menu-item"
      aria-current={pathname === s.href ? "page" : undefined}
      onClick={() => setOpen(null)}
    >
      {s.label}
    </Link>
  );
  const github = (
    <a href={DOCS_REPO} target="_blank" rel="noopener" role="menuitem" className="docs-menu-item" onClick={() => setOpen(null)}>
      GitHub <span aria-hidden="true" style={{ fontSize: 10 }}>&#8599;</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
  const holdsCurrent = (g: Group) => g.items.some((s) => s.href === pathname);

  return (
    <div id="site-nav" ref={navRef} style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link
          href="/"
          onClick={(e) => {
            // A same-route click would not reset a results view; force a fresh load.
            if (typeof window !== "undefined" && window.location.pathname === "/") { e.preventDefault(); window.location.assign("/"); }
          }}
          style={{ fontSize: 19, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}
        >
          BitGraph
        </Link>

        <div className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          <nav className="nav-groups" aria-label="Documentation">
            {GROUPS.map((g) => (
              <div key={g.label} className="nav-group" onMouseEnter={() => hoverOpen(g.label)} onMouseLeave={() => hoverClose(g.label)}>
                <button
                  type="button"
                  className="nav-btn"
                  aria-haspopup="menu"
                  aria-expanded={open === g.label}
                  aria-current={holdsCurrent(g) ? "page" : undefined}
                  // Under a cursor the menu is already open, so a click keeps it open rather than
                  // toggling it shut; on touch and keyboard a click toggles.
                  onClick={() => setOpen((o) => (canHover() ? g.label : o === g.label ? null : g.label))}
                >
                  {g.label}
                  <Chevron />
                </button>
                {open === g.label && (
                  <div role="menu" aria-label={g.label} className="nav-menu">
                    {g.items.map(row)}
                    {g.external && github}
                  </div>
                )}
              </div>
            ))}
          </nav>

          <button
            type="button"
            className="nav-btn nav-docs"
            aria-haspopup="menu"
            aria-expanded={open === "all"}
            onClick={() => setOpen((o) => (o === "all" ? null : "all"))}
          >
            Menu
            <Chevron />
          </button>

          <Link href="/docs/try" className="nav-cta" aria-label="Make a BitGraph" aria-current={pathname === "/docs/try" ? "page" : undefined}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 2.5v11M2.5 8h11" />
            </svg>
            <span className="bg-long">Make a BitGraph</span>
            <span className="bg-short">New</span>
          </Link>
        </div>
      </div>

      {open === "all" && (
        <div role="menu" aria-label="Menu" className="nav-panel">
          <div className="docs-panel-cols">
            {GROUPS.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="docs-panel-group">
                <div aria-hidden="true" className="nav-panel-title">{g.label}</div>
                {g.items.map(row)}
                {g.external && github}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
