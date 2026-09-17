import type { ReactNode } from "react";

/**
 * What every drop box says inside: the two-sheets mark, one sentence naming both
 * gestures, and at most one quiet line under it (Mike, 2026-09-18, with a reference:
 * "inside box should be [an icon and 'Drag files or a folder here, or browse files']
 * but obviously with correct color"). The mark and the browse words wear the link blue;
 * the sentence is ink.
 *
 * "browse files" is lettering, not a control: the whole box opens the picker on a click
 * and takes the keyboard as one button, so a second target inside it would only split
 * the hit area. It says FILES on purpose. A click can only ever pick files; a folder
 * arrives by dragging, because every browser's click path to a folder raises an
 * upload warning on a page whose claim is that nothing is uploaded.
 */
export function DropPrompt({ children, quiet }: { children: ReactNode; quiet?: ReactNode }) {
  return (
    <div className="drop-prompt">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        {/* the sheet behind, up and to the right */}
        <path d="M16 12V8a3 3 0 0 1 3-3h11l8 8v17a3 3 0 0 1-3 3h-4" />
        <path d="M30 5v8h8" />
        {/* the sheet in front */}
        <path d="M9 12h12l7 7v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3Z" />
        <path d="M21 12v7h7" />
      </svg>
      <div>
        <div className="drop-prompt-line">{children}</div>
        {quiet && <div className="drop-prompt-quiet">{quiet}</div>}
      </div>
    </div>
  );
}

export function Browse({ children = "browse files" }: { children?: ReactNode }) {
  return <span className="drop-browse">{children}</span>;
}
