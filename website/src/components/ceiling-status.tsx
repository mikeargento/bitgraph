import type { CeilingWrite } from "@/lib/ceilings";

/** Included (sequencer only), Posted (data on Ethereum), Final (that Ethereum block is final), or Dropped
 *  (reorged away and written again). Each is what BitGraph's Base node last reported, not a proof. */
export function StatusChip({ status }: { status: CeilingWrite["status"] }) {
  const settled = status === "safe" || status === "finalized";
  const label = status === "dropped" ? "Dropped" : status === "finalized" ? "Final" : status === "safe" ? "Posted" : "Included";
  const title = status === "dropped"
    ? "Base reorganized this block away. Its records were written again in a later transaction."
    : status === "finalized"
      ? "Base has posted this block's data to Ethereum, and that Ethereum block is final, as BitGraph's Base node last reported."
      : settled
        ? "Base has posted this block's data to Ethereum, as BitGraph's Base node last reported."
        : "Included by Base's sequencer. It relies on the sequencer until Base posts it to Ethereum.";
  return (
    <span className={`cl-status cl-${settled ? "settled" : status === "dropped" ? "dropped" : "settling"}`} title={title}>
      {label}
    </span>
  );
}
