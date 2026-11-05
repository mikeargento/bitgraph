"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * The light and dark button, a sun and a moon (2026-11-05). The mode is data-theme on <html>, set before the first paint
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
  // Both drawings are in the page and CSS shows one by data-theme: the moon in the light, the sun in the dark, each
  // naming the mode a click brings.
  return (
    <button type="button" className="theme-switch" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={flip}>
      <svg className="theme-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" />
      </svg>
      <svg className="theme-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
      </svg>
    </button>
  );
}
