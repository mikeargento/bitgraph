// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The site's one wait: a quiet label over the moving bar the drop box uses. Every page load, route change and in-page
 * wait shows this, in the same place, so a wait never changes shape on the way to its page. It fades in after a short
 * delay (globals.css, .bg-wait), so a fast load shows nothing at all. No hooks: it serves in loading.tsx files as a
 * server component and in client pages alike.
 *
 * `inline` sits inside a card (a photo preview being made) instead of holding the page's height.
 */
export function Wait({ label = "Loading…", inline = false }: { label?: string; inline?: boolean }) {
  return (
    <div className={`bg-wait${inline ? " is-inline" : ""}`} role="status" aria-live="polite">
      <p className="bg-wait-label">{label}</p>
      <div className="bg-working" aria-hidden />
    </div>
  );
}
