/* The site's one legal marking, everywhere: a quiet in-flow line at the foot
 * of every page, on the standard column, left rail. It was a FIXED bar
 * pinned over the viewport once, which is why it sat unmounted for months
 * (a sticky legal banner is the exact idiom this site refuses); it became
 * the page's last line instead when the overview's page-local copy was
 * retired (2026-08-06) and the site was left with no marking at all.
 * The em dash is the tagline's official form. */

export function Footer() {
  return (
    <footer style={{ width: "90%", maxWidth: 800, margin: "64px auto 0", padding: "20px 0 32px", borderTop: "1px solid #e2e5e9" }}>
      <span style={{ fontSize: 12.5, color: "#6b7280" }}>
        BitGraph &mdash; Patent Pending
      </span>
    </footer>
  );
}
