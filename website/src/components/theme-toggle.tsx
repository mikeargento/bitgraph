"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * The light and dark switch, a small track with a knob. The mode is data-theme on <html>, set before the first paint
 * by the script in the layout: light, unless this visitor chose dark here before. The system's setting is not read. A
 * click saves the choice. Which drawing shows comes from data-theme in CSS, so every copy of the button agrees.
 */
const KEY = "theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme === "dark");
    read();
    const seen = new MutationObserver(read);
    seen.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => seen.disconnect();
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* the choice lasts for this page only */ }
  };
  // A small sliding switch: off is light, on is dark. Where the knob sits comes from data-theme in CSS, so every copy agrees.
  return (
    <button type="button" className="theme-switch" role="switch" aria-checked={dark} aria-label="Dark mode" onClick={flip}>
      <span className="theme-track" aria-hidden="true"><span className="theme-knob" /></span>
    </button>
  );
}
