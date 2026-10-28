"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileOf, galleryOf, hrefOf, openItem, thumbOf, type Gallery } from "@/lib/gallery";

/** One tile: the photo's thumbnail once it is in view and its file is held, else its name. */
function Tile({ g, i, current, onOpen }: { g: Gallery; i: number; current: boolean; onOpen: (i: number) => void }) {
  const it = g.items[i]!;
  const ref = useRef<HTMLAnchorElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const f = fileOf(g, it.digest), el = ref.current;
    if (!f || !el) return;
    let gone = false;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void thumbOf(f).then((u) => { if (!gone) setSrc(u); });
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => { gone = true; io.disconnect(); };
  }, [g, it.digest]);
  return (
    <a ref={ref} href={hrefOf(g, i)} className={`gal-tile${current ? " is-current" : ""}`} title={it.name} aria-current={current ? "page" : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpen(i); }}>
      {src ? <img src={src} alt={it.name} /> : <span className="gal-tile-name">{it.name}</span>}
    </a>
  );
}

export function GalleryGrid({ g, current, onOpen }: { g: Gallery; current?: number; onOpen: (i: number) => void }) {
  return (
    <div className="gal-grid">
      {g.items.map((it, i) => <Tile key={`${i}-${it.digest}`} g={g} i={i} current={i === current} onOpen={onOpen} />)}
    </div>
  );
}

/** A drop's photos from the Make page: the grid, each tile opening its photo's proof. */
export function DropGallery({ g }: { g: Gallery }) {
  const router = useRouter();
  return (
    <div className="gal-drop">
      <div className="plug-sub">{`${g.items.length.toLocaleString("en-US")} photos. Open one to step through their proofs.`}</div>
      <GalleryGrid g={g} onOpen={(i) => void openItem(g, i, router.push)} />
    </div>
  );
}

/** On a photo's proof page, when the photo came in a drop of several: previous, next and the grid of them all. The
 *  arrow keys step too. */
let gridOpen = false;
export function GalleryBar({ digest, top }: { digest: string; top?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<{ g: Gallery; index: number } | null>(null);
  // the grid stays open from page to page while stepping through
  const [grid, setGridState] = useState(gridOpen);
  const setGrid = (f: (v: boolean) => boolean) => setGridState((v) => (gridOpen = f(v)));
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setAt(galleryOf(digest, q.get("counter"), q.get("epoch")));
  }, [digest]);
  const go = (i: number) => { if (at && i >= 0 && i < at.g.items.length) void openItem(at.g, i, router.push); };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!at) return;
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".pv-lightbox")) return;
      if (e.key === "ArrowLeft") goRef.current(at.index - 1);
      else if (e.key === "ArrowRight") goRef.current(at.index + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at]);
  if (!at || at.g.items.length < 2) return null;
  const { g, index } = at, n = g.items.length;
  return (
    <div className="gal-bar" style={top ? { marginTop: top } : undefined}>
      <div className="gal-bar-row">
        <div className="gal-bar-where">
          <span className="gal-bar-count">{`Photo ${(index + 1).toLocaleString("en-US")} of ${n.toLocaleString("en-US")}`}</span>
          <span className="gal-bar-name">{g.items[index]!.name}</span>
        </div>
        <div className="gal-bar-go">
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous photo">Previous</button>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={index === n - 1} onClick={() => go(index + 1)} aria-label="Next photo">Next</button>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} aria-expanded={grid} onClick={() => setGrid((v) => !v)}>{grid ? "Hide all" : `All ${n.toLocaleString("en-US")}`}</button>
        </div>
      </div>
      {grid && <GalleryGrid g={g} current={index} onOpen={go} />}
    </div>
  );
}
