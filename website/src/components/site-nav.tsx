"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MENU_GROUPS, type MenuItem } from "@/lib/docs-sections";
import { MenuIcon } from "./menu-icons";

/**
 * 2026-10-02 (Mike, pointing at base.org): "maybe the menu should be more like base. each category
 * gets a dropdown including see it working? it can be right aligned to match my sites astetic ...
 * and notice the mobile menu". Wide screens: the four groups sit on the right of the bar beside
 * Make a BitGraph, each its own dropdown of rows (icon, title, one line). Narrower than 960px:
 * one Menu button opens a full-screen sheet whose groups open in place, Base's phone menu.
 * The history below is the bar this replaced.
 *
 * The bar: the wordmark, one Menu button, and the filled button that opens the page
 * where a BitGraph is made. The same at every width (Mike, 2026-09-18: "the menu should
 * be consolidated into one button again called menu on desktop", "keeping the + make a
 * bitgraph. basically the mobile version except different of course"). It replaced
 * four dropdowns, one per documentation group, that the bar carried from 2026-09-17.
 *
 * Menu opens one panel with all four groups: four columns on a wide screen, two on a
 * tablet, one list on a phone (the panel's grid rules in globals.css). The green
 * button reads "Make a BitGraph" and shortens to "New" where it has to. It says Menu,
 * not Docs: it holds everything, Use cases, Contact and GitHub included.
 *
 * The panel opens under the cursor on a device that has one (Mike, 2026-09-17: "should
 * you have to click menu items or should hover just work"), and on a click or Enter
 * everywhere, which is what a touch screen and a keyboard use. Opened by hover, it
 * closes a beat after the cursor leaves both the button and the panel, so the move
 * down to it does not drop it, and a click on the button never closes it under the
 * cursor. It closes on Escape, on a click outside, and on choosing a row; GitHub is the
 * one row that leaves the site and says so; /deck carries no chrome; on the home route
 * the wordmark forces a fresh load.
 */

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  // A group's label while its dropdown is open, "sheet" for the full-screen menu, or null.
  const [open, setOpen] = useState<string | null>(null);
  // Groups unfolded in the sheet.
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  // Base's dropdown: one panel that slides from one group to the next, centred under its button.
  const catsRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const shown = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ x: number; h: number; slide: boolean }>({ x: 0, h: 0, slide: false });

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
  /** Close whichever dropdown is open, a beat after the cursor leaves the bar's groups and the panel. */
  const hoverCloseAny = () => {
    if (!canHover()) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => { setOpen((o) => (o && o !== "sheet" ? null : o)); closeTimer.current = null; }, 160);
  };

  // Where the panel sits: centred under the open group's button, kept 16px inside the window; its
  // height is its rows'. Moving from one open group to another slides it; the first opening does not.
  const dropWidth = 410;
  useLayoutEffect(() => {
    const g = open && open !== "sheet" ? open : null;
    if (!g) { shown.current = null; return; }
    const t = triggers.current[g], cats = catsRef.current;
    if (!t || !cats) return;
    const cr = cats.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const left = Math.max(16, Math.min(window.innerWidth - 16 - dropWidth, tr.left + tr.width / 2 - dropWidth / 2));
    setDrop({ x: left - cr.left, h: innerRef.current?.offsetHeight ?? 0, slide: shown.current !== null });
    shown.current = g;
  }, [open]);

  // The bar lifts on Google's shadow once the page has scrolled (the postseason's bar).
  useEffect(() => {
    const lift = () => navRef.current?.classList.toggle("scrolled", window.scrollY > 4);
    lift();
    window.addEventListener("scroll", lift, { passive: true });
    return () => window.removeEventListener("scroll", lift);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (open !== "sheet" && !navRef.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  // The sheet covers the page: the page behind it does not scroll.
  useEffect(() => {
    if (open !== "sheet") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (pathname === "/deck") return null;

  const ext = <svg className="ext-arrow" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  /** One row of a dropdown (icon, title, one line) or of the sheet (icon, title). */
  const item = (s: MenuItem, index: number, withDesc: boolean) => {
    const body = (<><MenuIcon href={s.href} index={index} /><span className="nav2-text"><span className="nav2-label">{s.label}{s.external ? ext : null}</span>{withDesc ? <span className="nav2-desc">{s.desc}</span> : null}</span></>);
    return s.external
      ? <a key={s.href} href={s.href} target="_blank" rel="noopener" role="menuitem" className="nav2-item" onClick={() => setOpen(null)}>{body}<span className="sr-only">(opens in a new tab)</span></a>
      : <Link key={s.href} href={s.href} role="menuitem" className="nav2-item" aria-current={pathname === s.href ? "page" : undefined} onClick={() => setOpen(null)}>{body}</Link>;
  };

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

        <div className="bg-nav-links nav2-bar" style={{ display: "flex", alignItems: "center" }}>
          {/* Wide screens: one dropdown per group, on the right beside Make a BitGraph. */}
          <div className="nav2-cats" ref={catsRef} onMouseLeave={hoverCloseAny} onMouseEnter={cancelClose}>
            {MENU_GROUPS.map((g) => (
              <button
                key={g.label}
                ref={(el) => { triggers.current[g.label] = el; }}
                type="button"
                className="nav-btn nav2-trigger"
                aria-haspopup="menu"
                aria-expanded={open === g.label}
                onMouseEnter={() => hoverOpen(g.label)}
                // Under a cursor the dropdown is already open, so a click keeps it open; on touch and keyboard a click toggles.
                onClick={() => setOpen((o) => (canHover() ? g.label : o === g.label ? null : g.label))}
              >
                {g.label}
                <Chevron />
              </button>
            ))}
            {(() => {
              const g = MENU_GROUPS.find((x) => x.label === open);
              if (!g) return null;
              return (
                <div
                  role="menu"
                  aria-label={g.label}
                  className={`nav2-drop${drop.slide ? " slide" : ""}`}
                  style={{ width: dropWidth, transform: `translateX(${drop.x}px)`, height: drop.h || undefined }}
                >
                  <div ref={innerRef} key={g.label} className="nav2-drop-inner">
                    {g.items.map((it, k) => item(it, k, true))}
                  </div>
                </div>
              );
            })()}
          </div>
          {/* Narrower screens: one Menu button for the full-screen sheet. */}
          <button type="button" className="nav-btn nav2-menu" aria-haspopup="menu" aria-expanded={open === "sheet"} onClick={() => setOpen((o) => (o === "sheet" ? null : "sheet"))}>
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

      {open === "sheet" && (
        <div role="menu" aria-label="Menu" className="nav2-sheet">
          <div className="nav2-sheet-top">
            <Link href="/" className="nav2-sheet-mark" onClick={() => setOpen(null)}>BitGraph</Link>
            <button type="button" className="nav2-close" aria-label="Close the menu" onClick={() => setOpen(null)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="nav2-sheet-body">
            {MENU_GROUPS.map((g) => {
              const on = unfolded.has(g.label);
              return (
                <div key={g.label} role="group" aria-label={g.label} className="nav2-sgroup">
                  <button type="button" className="nav2-shead" aria-expanded={on} onClick={() => setUnfolded((u) => { const n = new Set(u); if (n.has(g.label)) n.delete(g.label); else n.add(g.label); return n; })}>
                    <span>{g.label}</span>
                    <Chevron />
                  </button>
                  {on ? <div className="nav2-sitems">{g.items.map((it, k) => item(it, k, false))}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
