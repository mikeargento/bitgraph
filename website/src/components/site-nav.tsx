"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The bar: the wordmark, then the Info menu and the Roll, Make a BitGraph at the right. It fits on every screen; on
 * phones the button reads Make.
 */
type NavLink = { href: string; label: string; also?: string[] };
// The bar is for people taking photos: the Roll, an Info menu holding everything technical, and the one button.
const LINKS: NavLink[] = [
  { href: "/ledger", label: "The Roll" },
];
// Info: how it works, how to build on it and license it, the demos, and how to reach us.
// Applications is reached from Technology and the home page; the reference from Developers; Evaluate from Licensing.
const INFO: NavLink[] = [
  { href: "/technology", label: "Technology", also: ["/applications"] },
  { href: "/integrate", label: "Developers", also: ["/tools"] },
  { href: "/licensing", label: "Licensing", also: ["/evaluate"] },
  { href: "/examples", label: "Demos", also: ["/jev", "/generate", "/exam"] },
  { href: "/contact", label: "Contact" },
];
// The button is the one action a visitor should take: a drop proves the product in a minute.
const CTA = { href: "/demos", label: "Make a BitGraph", also: ["/make"] };

export function SiteNav() {
  const pathname = usePathname();
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = (href: string, also: string[] = []) => (on(href) || also.some(on) ? "page" : undefined);
  // Info opens a small menu under its button: on hover with a mouse, on tap on a phone. Leaving it, a new page, a
  // click elsewhere or Esc closes it.
  const [info, setInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setInfo(false); }, [pathname]);
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
  useEffect(() => {
    if (!info) return;
    const away = (e: MouseEvent) => { if (!infoRef.current?.contains(e.target as Node)) setInfo(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setInfo(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [info]);

  return (
    <div id="site-nav" className={overHero ? "is-clear" : undefined} style={{ background: "var(--bar)", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", boxSizing: "border-box", position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* The wordmark goes home; on home itself it returns to the top. */}
        <Link href="/" className="nav-wordmark" onClick={() => { if (pathname === "/") window.scrollTo(0, 0); }} style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", textDecoration: "none", letterSpacing: "-0.01em" }}>
          BitGraph
        </Link>
        <nav aria-label="Site" className="bg-nav-links" style={{ display: "flex", alignItems: "center" }}>
          <div ref={infoRef} className="nav-info nav-desk" onMouseEnter={() => setInfo(true)} onMouseLeave={() => setInfo(false)}>
            <button type="button" className="nav-btn nav-box nav-info-btn" aria-expanded={info} aria-controls="nav-info-menu" onClick={(e) => { if ((e.nativeEvent as PointerEvent).pointerType !== "mouse") setInfo((o) => !o); }}>
              Info
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {info && (
              <div id="nav-info-menu" className="nav-info-menu">
                {INFO.map((l) => (
                  <Link key={l.href} href={l.href} className="nav-info-link" aria-current={current(l.href, l.also)} onClick={() => setInfo(false)}>{l.label}</Link>
                ))}
              </div>
            )}
          </div>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-btn nav-box nav-desk" aria-current={current(l.href, l.also)} style={{ textDecoration: "none" }}>
              {l.label}
            </Link>
          ))}
          {/* The bar is the links and the one button; the sun/moon lives in the footer, on every screen (2026-10-28). */}
          <Link href={CTA.href} className="nav-cta-sx" aria-current={current(CTA.href)}><span className="nav-cta-long">{CTA.label}</span><span className="nav-cta-short" aria-hidden="true">Make</span></Link>
        </nav>
      </div>
    </div>
  );
}
