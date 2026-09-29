import type { CeilingWrite } from "@/lib/ceilings";

/** Settling (sequencer only), Settled (posted to Ethereum), or Dropped (reorged away and written again). */
export function StatusChip({ status }: { status: CeilingWrite["status"] }) {
  const settled = status === "safe" || status === "finalized";
  const label = status === "dropped" ? "Dropped" : settled ? "Settled" : "Settling";
  const title = status === "dropped"
    ? "Base reorganized this block away. Its records were written again in a later transaction."
    : settled
      ? "Base has posted this block's data to Ethereum."
      : "Included by Base's sequencer. It relies on the sequencer until Base settles it on Ethereum.";
  return (
    <span className={`cl-status cl-${settled ? "settled" : status === "dropped" ? "dropped" : "settling"}`} title={title}>
      {label}
    </span>
  );
}
