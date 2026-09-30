"use client";

import { useEffect, useState } from "react";

const LINE1 = "Position commitment";

/**
 * The home headline types through what a position commitment is for (Mike, 2026-09-30):
 * it loads as the first phrase, real text, then after a pause backspaces and types the
 * next, with a blinking caret, once through, and rests on the last.
 * Reduced motion keeps the first phrase and never moves. The animated text is hidden
 * from screen readers; the heading carries the full sentence once as its label.
 */
export function HomeHeadline({ phrases }: { phrases: string[] }) {
  const [text, setText] = useState(phrases[0] ?? "");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (phrases.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const wait = (ms: number) => new Promise<void>((r) => { timer = setTimeout(r, ms); });
    (async () => {
      await wait(2600);
      setMoving(true);
      // Once through, ending on the last phrase; then the caret goes and it rests there.
      for (let i = 0; i + 1 < phrases.length && !cancelled; i++) {
        const current = phrases[i]!;
        const next = phrases[i + 1]!;
        // Backspace only to what the two share, as a typist would: "any bytes." back to "any b", then "its."
        let keep = 0;
        while (keep < current.length && keep < next.length && current[keep] === next[keep]) keep++;
        for (let n = current.length; n >= keep && !cancelled; n--) { setText(current.slice(0, n)); await wait(38); }
        await wait(260);
        for (let n = keep + 1; n <= next.length && !cancelled; n++) { setText(next.slice(0, n)); await wait(72); }
        // The last three are one thought (any file, any bytes, any bits), so they hold briefly.
        if (i + 2 < phrases.length) await wait(i + 4 >= phrases.length ? 900 : 2400);
      }
      if (cancelled) return;
      await wait(1600);
      if (!cancelled) setMoving(false);
    })();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phrases]);

  return (
    <h1 aria-label={`${LINE1} for ${phrases[0] ?? ""}`}>
      <span aria-hidden="true" style={{ whiteSpace: "nowrap" }}>{LINE1}</span><br />
      <span aria-hidden="true" style={{ whiteSpace: "nowrap" }}>for {text}<span className={`typed-caret${moving ? " on" : ""}`} /></span>
    </h1>
  );
}
