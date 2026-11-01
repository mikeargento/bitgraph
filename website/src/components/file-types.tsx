// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The kinds of file a BitGraph takes (2026-11-01): the page's demos are all pictures, and this row shows the same proof
 * covers every other kind. Each kind is a small standalone line drawing in the figures' one stroke, with its name under
 * it. Static; its layout is .ft in globals.css.
 */
export type Glyph = "photo" | "video" | "music" | "design" | "ai" | "contract" | "scan" | "code";
export type FileKind = { label: string; glyph: Glyph };

/* Every drawing fits the 48 x 48 box with about 4 units to spare on each side. */
const GLYPHS: Record<Glyph, React.ReactNode> = {
  photo: <><rect x="5" y="10" width="38" height="28" rx="3" /><path d="M8 35l11-11 8 7 6-5 8 8" /><circle cx="33" cy="18" r="3" /></>,
  video: <><rect x="5" y="10" width="38" height="28" rx="3" /><path d="M20 18v12l10-6z" /></>,
  music: <><path d="M30 34V8c6 1 10 4 10 10" /><ellipse cx="23" cy="34" rx="7" ry="5.5" /></>,
  design: <><path d="M24 6l12 18-6 12H18l-6-12z" /><path d="M24 6v15" /><circle cx="24" cy="24" r="2.5" /><rect x="17" y="36" width="14" height="6" rx="1" /></>,
  ai: <><path d="M24 6v6" /><circle cx="24" cy="5" r="2" /><rect x="9" y="12" width="30" height="24" rx="5" /><circle cx="18" cy="23" r="2.5" /><circle cx="30" cy="23" r="2.5" /><path d="M19 30h10M5 20v8M43 20v8M16 36v6M32 36v6" /></>,
  contract: <><rect x="9" y="5" width="30" height="38" rx="2" /><path d="M15 13h18M15 19h18" /><path d="M14 34c3-8 6-8 5-3s4 3 6-3 4-1 4 2 3 1 6-2" /></>,
  scan: <path d="M4 25h10l4-10 6 20 5-15 3 5h12" />,
  code: <><path d="M17 8c-4 0-6 2-6 6v4c0 4-2 6-6 6 4 0 6 2 6 6v4c0 4 2 6 6 6" /><path d="M31 8c4 0 6 2 6 6v4c0 4 2 6 6 6-4 0-6 2-6 6v4c0 4-2 6-6 6" /></>,
};

export function FileTypes({ kinds }: { kinds: FileKind[] }) {
  return (
    <ul className="ft" aria-label={`Any file: ${kinds.map((k) => k.label.toLowerCase()).join(", ")}`}>
      {kinds.map((k) => (
        <li key={k.label} className="ft-item">
          <svg className="ft-icon" viewBox="0 0 48 48" aria-hidden="true">{GLYPHS[k.glyph]}</svg>
          <span className="ft-label">{k.label}</span>
        </li>
      ))}
    </ul>
  );
}
