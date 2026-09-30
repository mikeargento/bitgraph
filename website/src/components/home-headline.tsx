"use client";

import { useEffect, useRef, useState } from "react";

const LINE1 = "Position commitment";

/**
 * The home headline types itself (Mike, 2026-09-30): a caret types the whole headline
 * from nothing, then backspaces the line after "for" and types through what a position
 * commitment is for, once through, and rests on the last. Backspacing stops at what the
 * next phrase shares, as a typist would: "any bytes." back to "any b", then "its.".
 *
 * The server sends the full sentence, so search, a page without script and reduced motion
 * all read "Position commitment for <first phrase>". The layout's head script marks the
 * page `data-js`, and globals.css keeps the text hidden (its space held) until this
 * component clears it and starts typing, so the sentence never flashes first. The
 * animated text is hidden from screen readers; the heading carries the sentence as its
 * label.
 */
export function HomeHeadline({ phrases }: { phrases: string[] }) {
  const first = `for ${phrases[0] ?? ""}`;
  const [l1, setL1] = useState(LINE1);
  const [l2, setL2] = useState(first);
  const [onLine1, setOnLine1] = useState(false);
  const [moving, setMoving] = useState(false);
  const [phase, setPhase] = useState<"pending" | "typing" | "static">("pending");
  const h1 = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase("static"); return; }
    // Hold the two-line height while the lines are empty, so nothing under it moves.
    if (h1.current) h1.current.style.minHeight = `${h1.current.offsetHeight}px`;
    setL1(""); setL2(""); setOnLine1(true); setMoving(true); setPhase("typing");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const wait = (ms: number) => new Promise<void>((r) => { timer = setTimeout(r, ms); });
    const type = async (s: string, set: (v: string) => void, from = 0) => {
      for (let n = from + 1; n <= s.length && !cancelled; n++) { set(s.slice(0, n)); await wait(72); }
    };
    (async () => {
      await wait(500);
      await type(LINE1, setL1);
      await wait(220);
      if (cancelled) return;
      setOnLine1(false);
      await type(first, setL2);
      await wait(2400);
      for (let i = 0; i + 1 < phrases.length && !cancelled; i++) {
        const current = `for ${phrases[i]}`;
        const next = `for ${phrases[i + 1]}`;
        let keep = 0;
        while (keep < current.length && keep < next.length && current[keep] === next[keep]) keep++;
        for (let n = current.length; n >= keep && !cancelled; n--) { setL2(current.slice(0, n)); await wait(38); }
        await wait(260);
        await type(next, setL2, keep);
        // The last three are one thought (any file, any bytes, any bits), so they hold briefly.
        if (i + 2 < phrases.length) await wait(i + 4 >= phrases.length ? 900 : 2400);
      }
      if (cancelled) return;
      await wait(1600);
      if (!cancelled) setMoving(false);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phrases, first]);

  const caret = <span className={`typed-caret${moving ? " on" : ""}`} />;
  return (
    <h1 ref={h1} data-typing={phase} aria-label={`${LINE1} ${first}`}>
      <span aria-hidden="true" style={{ whiteSpace: "nowrap" }}>{l1}{onLine1 && caret}</span><br />
      <span aria-hidden="true" style={{ whiteSpace: "nowrap" }}>{l2}{!onLine1 && caret}</span>
    </h1>
  );
}
