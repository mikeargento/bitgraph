/* ── Proof page shell ── The page's outer frame. Its waits are the site's one wait (components/wait.tsx). */

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", color: "var(--c-text)" }}>{/* no background of its own: the grey ground shows (2026-10-15) */}
      {children}
    </div>
  );
}
