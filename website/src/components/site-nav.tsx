"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GoArrow } from "@/components/go-arrow";
import { slideToId, slideToTop } from "@/components/smooth-anchors";
import { BAR, HOW_IT_WORKS_ID, SECTIONS, inSection, type SitePage, type SiteSection } from "@/lib/site-map";

/**
 * The bar: the wordmark at the left (it opens the home page), then every link in one row and one size (Drop a file,
 * How it works, Demos, Developers, Reference, Evaluate, Licensing, Use cases, Contact), and at the far right the one
 * button, Ledger, with the arrow. There is no second row. On narrower screens the links are in a sheet behind a menu
 * button, one to a line, over the same button. The pages are listed once, in lib/site-map.
 */
/** The ledger's entry in the list of sections: the bar shows it as a button, apart from the links. */
const LEDGER = SECTIONS.find((s) => s.href === "/ledger");
const DEMOS = SECTIONS.find((s) => s.href === "/examples");

export function SiteNav() {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = (s: SiteSection) => (inSection(pathname, s) ? "page" : undefined);
  // A link is marked on its own page. Demos is also marked on each demo, which has no link of its own in the bar.
  const isCurrent = (p: SitePage) => ((p.href === DEMOS?.href ? inSection(pathname, DEMOS) : on(p.href)) ? "page" : undefined);
  // The phone sheet: every link, opened by the round button; a new page or Esc closes it.
  const [menu, setMenu] = useState(false);
  // "How it works" is the home page's first section: on Home it slides there, as the contents links do.
  const toSection = (e: React.MouseEvent, s: SitePage) => {
    if (!s.href.startsWith("/#") || pathname !== "/" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (slideToId(HOW_IT_WORKS_ID)) { e.preventDefault(); setMenu(false); }
  };
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [menu]);
  // Home: the bar is clear over the hero video and solid once the page scrolls past it.
  const [overHero, setOverHero] = useState(false);
  useEffect(() => {
    if (pathname !== "/") { setOverHero(false); return; }
    const check = () => {
      const hero = document.querySelector<HTMLElement>("main .sx-hero");
      setOverHero(!!hero && window.scrollY < hero.offsetHeight - 64);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [pathname]);

  return (
    <>
      <div id="site-nav" className={overHero ? "is-clear" : undefined} style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          {/* The wordmark goes home; on home itself it slides back to the top. */}
          <Link href="/" className="nav-wordmark" onClick={(e) => { if (pathname !== "/" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); if (!slideToTop()) window.scrollTo(0, 0); }} style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
            BitGraph
          </Link>
          <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
            {/* The sections, as one group: on wide screens it stands in the middle of the bar. */}
            <div className="nav-mid">
              {BAR.map((p) => (
                <Link key={p.href} href={p.href} className="nav-btn nav-box nav-desk" aria-current={isCurrent(p)} onClick={(e) => toSection(e, p)} style={{ textDecoration: "none" }}>
                  {p.label}
                </Link>
              ))}
            </div>
            {/* The bar's one button: the ledger, the line itself, live. */}
            {LEDGER ? <Link href={LEDGER.href} className="nav-cta-sx" aria-current={current(LEDGER)}><span className="nav-cta-long">{LEDGER.label}</span><span className="nav-cta-short" aria-hidden="true">{LEDGER.label}</span><GoArrow /></Link> : null}
            <button type="button" className="nav-burger" style={{ borderRadius: "50%" }} aria-label={menu ? "Close menu" : "Menu"} aria-expanded={menu} aria-controls="nav-sheet" onClick={() => setMenu((m) => !m)}>
              {menu
                ? <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                : <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            </button>
          </nav>
        </div>
        {menu && (
          // The sheet: the bar's links, one to a line, then the one button.
          <div id="nav-sheet" className="nav-sheet nav-index">
            {BAR.map((p) => (
              <div key={p.href} className="nav-index-group">
                <Link href={p.href} className="nav-index-top" aria-current={isCurrent(p)} onClick={(e) => toSection(e, p)}>{p.label}</Link>
              </div>
            ))}
            {/* The one button, as in the bar: the ledger. */}
            {LEDGER ? <Link href={LEDGER.href} className="nav-sheet-cta nav-index-cta" aria-current={current(LEDGER)}><span>{LEDGER.label}</span><GoArrow /></Link> : null}
          </div>
        )}
      </div>
    </>
  );
}
