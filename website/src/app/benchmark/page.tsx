import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Benchmark",
  description: "One million files in one BitGraph, measured live: 11.65 seconds from position open to proof, a 16-second window between two Base blocks, and $0.000367 in blockchain fees.",
};

/* The benchmark that shows its work (Mike, 2026-10-12: "a batch test that shows its work ... 1 million files ... measure
   the speed ... measure the price, and link to it all"). One real run, BitGraph #36, made from this Mac with
   ~/Code/bitgraph-1m.noindex/one-million-base.mts --real; its records are served from /benchmark/2026-10-12/. The fee is
   the ceiling transaction's own receipt (gas used x effective gas price + the L1 data fee) at the Coinbase ETH spot price
   read right after the run. The billion line is a projection and says so. */

const RUN = "/benchmark/2026-10-12";
const DIGEST = "jfRIwlnkhiOow8bIluA-ujwkk6JPh1P-2-FQ9og8DY0";
const EPOCH = "WxPRO89-YAjK3z1RzfPH5aG1bKmd2hIn-bRWv-OKeAs";
const PROOF = `/proof/${DIGEST}?counter=36&epoch=${EPOCH}`;
const FLOOR_BLOCK = 52494231;
const CEILING_BLOCK = 52494239;
const CEILING_TX = "0xe237caf1baa3f0c79e29f226d0c59b6f43be28a06290fe3bf0efea8bc89c637c";
const BASESCAN = "https://basescan.org";

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export default function BenchmarkPage() {
  return (
    <div className="frame prose bench-page" style={{ maxWidth: "var(--measure)" }}>{/* the 1040px column every record page reads at, the proof page's width (Mike, 2026-10-12) */}
      <h1>One million files, one&nbsp;BitGraph.</h1>
      <p className="lede">
        Measured live on bitgraph.ing on October 12, 2026, from an Apple M3 laptop with 8&nbsp;GB of memory. Every number
        below links to the public&nbsp;record.
      </p>

      <div className="home-cards demo-steps bench-stats">
        <div className="home-card">
          <div className="bench-stat">11.65 s</div>
          <p>From opening the position to the proof, for all 1,000,000 files. 16.05&nbsp;s including the hashing before&nbsp;it.</p>
        </div>
        <div className="home-card">
          <div className="bench-stat">16 s</div>
          <p>From the Base floor block to the Base ceiling block: the window every one of the files sits&nbsp;in.</p>
        </div>
        <div className="home-card">
          <div className="bench-stat">$0.000367</div>
          <p>The blockchain fee: one Base transaction for all one million&nbsp;files.</p>
        </div>
      </div>

      <h2>What happened</h2>
      <div className="table-scroll">
        <table className="bench-table">
          <tbody>
            <tr><td>0.00 s</td><td>One million text files are made in memory from one random seed. Nothing is written to&nbsp;disk.</td></tr>
            <tr><td>4.40 s</td><td>All one million are hashed on 8 threads. The position opens; its floor is Base block <a href={`${BASESCAN}/block/${FLOOR_BLOCK}`} {...ext}>{FLOOR_BLOCK.toLocaleString("en-US")}</a>, mined at 04:03:29&nbsp;UTC.</td></tr>
            <tr><td>15.53 s</td><td>Every file now carries the position&rsquo;s commitment and is hashed again, and all one million become one tree, each file with its own place in it (the tree took 6.02&nbsp;s). The commit is&nbsp;sent.</td></tr>
            <tr><td>16.05 s</td><td>The proof comes back: <Link href={PROOF}>BitGraph #36</Link>.</td></tr>
            <tr><td>04:03:45 UTC</td><td>The ceiling: Base block <a href={`${BASESCAN}/block/${CEILING_BLOCK}`} {...ext}>{CEILING_BLOCK.toLocaleString("en-US")}</a> holds the <a href={`${BASESCAN}/tx/${CEILING_TX}`} {...ext}>transaction</a> that fixes the record, 16&nbsp;seconds after the&nbsp;floor.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>The fee, worked out</h2>
      <p>
        The ceiling transaction used 23,940 gas at 0.006 gwei, which is 0.0000001436 ETH, plus an L1 data fee of 0.0000000008 ETH:
        0.0000001444 ETH in all. At $2,542.41 per ETH (Coinbase spot, read right after the run) that is <strong>$0.000367</strong>,
        for all one million files. It moves with Base&rsquo;s gas price and the price of
        ETH.
      </p>

      <h2>A billion files</h2>
      <p>
        A BitGraph holds up to one million files, so a billion is 1,000 BitGraphs. Projected from this run, not measured: about
        <strong> $0.37</strong> in fees (1,000 &times; $0.000367), and about 4.5 hours on this one laptop, one BitGraph after
        another (1,000 &times; 16.05&nbsp;s). Run side by side on more machines, it takes a fraction of&nbsp;that.
      </p>

      <h2>Check it yourself</h2>
      <ul>
        <li><Link href={PROOF}>The proof page for BitGraph #36</Link>, with the floor, the ceiling and every check</li>
        <li><a href={`${BASESCAN}/block/${FLOOR_BLOCK}`} {...ext}>The floor block</a> and <a href={`${BASESCAN}/tx/${CEILING_TX}`} {...ext}>the ceiling transaction</a> on Basescan</li>
        <li><a href={`${RUN}/seed.txt`} download>The seed and the rule for every file</a>: regenerate the million files, place the commitment from the proof in each, build the tree, and its root matches the one the proof&nbsp;commits</li>
      </ul>
    </div>
  );
}
