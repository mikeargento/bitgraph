"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * Day or night: a sun and moon toggle in the footer. The site is dark until someone presses this
 * (2026-11-02); the choice is saved and set on <html> as data-theme before the first paint (the head
 * script in layout.tsx). The button shows where it would take you: a sun at night, a moon by day.
 */
function currentMode(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setMode(currentMode());
  }, []);

  const flip = () => {
    const next = currentMode() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("bg-theme", next); } catch {}
    setMode(next);
  };

  const toLight = mode !== "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={flip}
      aria-label={toLight ? "Day mode" : "Night mode"}
      title={toLight ? "Day mode" : "Night mode"}
      style={{ visibility: mode === null ? "hidden" : "visible" }}
    >
      {toLight ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
