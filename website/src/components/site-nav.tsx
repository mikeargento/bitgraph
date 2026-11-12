"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The bar: the wordmark at the left, five links in a light weight in the middle of the bar, Contact the last of
 * them, and at the far right the one button, Drop a file, in the main button's color. On narrower screens the links
 * and the button fold into a sheet behind a menu button.
 */
type NavLink = { href: string; label: string; also?: string[] };
// Four across: how it works, how to build on it and license it, and the demos.
// Applications is reached from Technology and the home page; the reference from Developers; Evaluate from Licensing.
const LINKS: NavLink[] = [
  { href: "/technology", label: "Technology", also: ["/applications"] },
  { href: "/integrate", label: "Developers", also: ["/tools"] },
  { href: "/licensing", label: "Licensing", also: ["/evaluate"] },
  { href: "/examples", label: "Demos", also: ["/jev", "/generate", "/exam", "/pictures"] },
];
// Contact is the grey pill beside the white one.
const CONTACT: NavLink = { href: "/contact", label: "Contact" };
// The button is the one action a visitor should take: a drop proves the product in a minute.
const CTA = { href: "/demos", label: "Drop a file", also: ["/make"] };

export function SiteNav() {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = (href: string, also: string[] = []) => (on(href) || also.some(on) ? "page" : undefined);
  // The phone sheet: every link, opened by the round button; a new page or Esc closes it.
  const [menu, setMenu] = useState(false);
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
    <div id="site-nav" className={overHero ? "is-clear" : undefined} style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* The wordmark goes home; on home itself it returns to the top. */}
        <Link href="/" className="nav-wordmark" onClick={() => { if (pathname === "/") window.scrollTo(0, 0); }} style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          {/* The links and Contact, as one group: on wide screens it stands in the middle of the bar. */}
          <div className="nav-mid">
            {[...LINKS, CONTACT].map((l) => (
              <Link key={l.href} href={l.href} className="nav-btn nav-box nav-desk" aria-current={current(l.href, l.also)} style={{ textDecoration: "none" }}>
                {l.label}
              </Link>
            ))}
          </div>
          <Link href={CTA.href} className="nav-cta-sx" aria-current={current(CTA.href)}><span className="nav-cta-long">{CTA.label}</span><span className="nav-cta-short" aria-hidden="true">Drop a file</span></Link>
          <button type="button" className="nav-burger" style={{ borderRadius: "50%" }} aria-label={menu ? "Close menu" : "Menu"} aria-expanded={menu} aria-controls="nav-sheet" onClick={() => setMenu((m) => !m)}>
            {menu
              ? <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              : <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
          </button>
        </nav>
      </div>
      {menu && (
        <div id="nav-sheet" className="nav-sheet">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-sheet-link" aria-current={current(l.href, l.also)}>{l.label}</Link>
          ))}
          <Link href={CONTACT.href} className="nav-sheet-link" aria-current={current(CONTACT.href)}>{CONTACT.label}</Link>
          <Link href={CTA.href} className="nav-sheet-cta" aria-current={current(CTA.href)}>{CTA.label}</Link>
        </div>
      )}
    </div>
  );
}
