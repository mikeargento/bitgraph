"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GoArrow } from "@/components/go-arrow";
import { slideToId } from "@/components/smooth-anchors";
import { DROP, HOW_IT_WORKS_ID, SECTIONS, inSection, rowFor, type SiteSection } from "@/lib/site-map";

/**
 * The bar: the wordmark at the left (it opens the home page), the site's sections in the middle of the bar, and at the
 * far right the one button, Drop a file, on every page. Under the bar, on a page that belongs to a section with pages
 * of its own (Demos, Developers, Licensing), one row lists that section's pages side by side, the open one marked: it is
 * how a visitor moves between them without going back. On narrower screens the sections fold into a sheet behind a menu
 * button, and the sheet lists every page, each section's pages under it. The pages are listed once, in lib/site-map.
 */
export function SiteNav() {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = (s: SiteSection) => (inSection(pathname, s) ? "page" : undefined);
  const row = rowFor(pathname);
  // The phone sheet: every link, opened by the round button; a new page or Esc closes it.
  const [menu, setMenu] = useState(false);
  // "How it works" is the home page's first section: on Home it slides there, as the contents links do.
  const toSection = (e: React.MouseEvent, s: SiteSection) => {
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
          {/* The wordmark goes home; on home itself it returns to the top. */}
          <Link href="/" className="nav-wordmark" onClick={() => { if (pathname === "/") window.scrollTo(0, 0); }} style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
            BitGraph
          </Link>
          <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
            {/* The sections, as one group: on wide screens it stands in the middle of the bar. */}
            <div className="nav-mid">
              {SECTIONS.map((s) => (
                <Link key={s.href} href={s.href} className="nav-btn nav-box nav-desk" aria-current={current(s)} onClick={(e) => toSection(e, s)} style={{ textDecoration: "none" }}>
                  {s.label}
                </Link>
              ))}
            </div>
            <Link href={DROP.href} className="nav-cta-sx" aria-current={on(DROP.href) ? "page" : undefined}><span className="nav-cta-long">{DROP.label}</span><span className="nav-cta-short" aria-hidden="true">{DROP.label}</span><GoArrow /></Link>
            <button type="button" className="nav-burger" style={{ borderRadius: "50%" }} aria-label={menu ? "Close menu" : "Menu"} aria-expanded={menu} aria-controls="nav-sheet" onClick={() => setMenu((m) => !m)}>
              {menu
                ? <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                : <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            </button>
          </nav>
        </div>
        {menu && (
          // The sheet: every page. Each section is a line, and its pages are listed under it.
          <div id="nav-sheet" className="nav-sheet nav-index">
            {SECTIONS.map((s) => (
              <div key={s.href} className="nav-index-group">
                <Link href={s.href} className="nav-index-top" aria-current={pathname === s.href ? "page" : undefined} onClick={(e) => toSection(e, s)}>{s.label}</Link>
                {s.pages ? (
                  <div className="nav-index-pages">
                    {s.pages.map((p) => (
                      <Link key={p.href} href={p.href} className="nav-index-page" aria-current={on(p.href) ? "page" : undefined}>{p.label}</Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <Link href={DROP.href} className="nav-sheet-cta nav-index-cta" aria-current={on(DROP.href) ? "page" : undefined}><span>{DROP.label}</span><GoArrow /></Link>
          </div>
        )}
      </div>
      {row ? (
        // The open section's pages, side by side under the bar's own links, in the bar's shade. The bar's ink line names the
        // section, so the row carries no label. It scrolls away with the page; the bar stays.
        <nav className="bg-subnav" aria-label={`${row.label} pages`}>
          <div className="bg-subnav-inner">
            <div className="bg-subnav-pages">
              {[{ href: row.href, label: row.first ?? row.label }, ...(row.pages ?? [])].map((p) => (
                <Link key={p.href} href={p.href} aria-current={pathname === p.href || (p.href !== row.href && on(p.href)) ? "page" : undefined}>{p.label}</Link>
              ))}
            </div>
          </div>
        </nav>
      ) : null}
    </>
  );
}
