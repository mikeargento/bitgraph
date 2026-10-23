/* What shows while the ledger is read on the server (Mike, 2026-10-18: "if there is a wait, like when loading the
   ledger, maybe there should be a progress indicator"): the page's own frame, its label, and a moving bar. */
export default function LedgerLoading() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <p className="home-kicker" style={{ margin: 0 }}>Ledger</p>
      <p style={{ color: "var(--dim)", margin: "8px 0 0" }}>Reading the ledger…</p>
      <div className="bg-working is-left" role="progressbar" aria-label="Reading the ledger" />
    </div>
  );
}
