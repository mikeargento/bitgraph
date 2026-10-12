import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Benchmark",
  description: "One million files in one BitGraph, measured live: 6.35 seconds from position open to proof, a 10-second window between two Base blocks, and $0.000374 in blockchain fees.",
};

/* The benchmark that shows its work (Mike, 2026-10-12: "a batch test that shows its work ... 1 million files ... measure
   the speed ... measure the price, and link to it all"). One real, live run, BitGraph #40 (it replaced #36, 11.65 s, after the tree went multi-core and container headers were cached), made from this Mac with
   ~/Code/bitgraph-1m.noindex/one-million-base.mts --real; its records are served from /benchmark/2026-10-12/. The fee is
   the ceiling transaction's own receipt (gas used x effective gas price + the L1 data fee) at the Coinbase ETH spot price
   read right after the run. The five-billion line (a day of the world's photos) is a projection and says so. */

const RUN = "/benchmark/2026-10-12-40";
const DIGEST = "WPyiS1eEvGOehhG_lGs1qmpAqW4gzLZY-0ka8d7oIxU";
const EPOCH = "WxPRO89-YAjK3z1RzfPH5aG1bKmd2hIn-bRWv-OKeAs";
const PROOF = `/proof/${DIGEST}?counter=40&epoch=${EPOCH}`;
const FLOOR_BLOCK = 52495475;
const CEILING_BLOCK = 52495480;
const CEILING_TX = "0x72756d987184b2b4cf2b7e2a2bc470810cb4ca2482b9fe49db52bd4fa592f757";
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
          <div className="bench-stat">6.35 s</div>
          <p>From opening the position to the proof, for all 1,000,000 files. 10.50&nbsp;s including the hashing before&nbsp;it.</p>
        </div>
        <div className="home-card">
          <div className="bench-stat">10 s</div>
          <p>From the Base floor block to the Base ceiling block: the window every one of the files sits&nbsp;in.</p>
        </div>
        <div className="home-card">
          <div className="bench-stat">$0.000374</div>
          <p>The blockchain fee: one Base transaction for all one million&nbsp;files.</p>
        </div>
      </div>

      <h2>What happened</h2>
      <div className="table-scroll">
        <table className="bench-table">
          <tbody>
            <tr><td>0.00 s</td><td>One million text files are made in memory from one random seed. Nothing is written to&nbsp;disk.</td></tr>
            <tr><td>4.16 s</td><td>All one million are hashed on 8 threads. The position opens; its floor is Base block <a href={`${BASESCAN}/block/${FLOOR_BLOCK}`} {...ext}>{FLOOR_BLOCK.toLocaleString("en-US")}</a>, mined at 04:44:57&nbsp;UTC.</td></tr>
            <tr><td>9.46 s</td><td>Every file now carries the position&rsquo;s commitment and is hashed again (2.80&nbsp;s), and all one million become one tree on 8 threads, each file with its own place in it (2.49&nbsp;s). The commit is&nbsp;sent.</td></tr>
            <tr><td>10.50 s</td><td>The proof comes back: <Link href={PROOF}>BitGraph #40</Link>.</td></tr>
            <tr><td>04:45:07 UTC</td><td>The ceiling: Base block <a href={`${BASESCAN}/block/${CEILING_BLOCK}`} {...ext}>{CEILING_BLOCK.toLocaleString("en-US")}</a> holds the <a href={`${BASESCAN}/tx/${CEILING_TX}`} {...ext}>transaction</a> that fixes the record, 10&nbsp;seconds after the&nbsp;floor.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Every file has its own place</h2>
      <p>
        A million files can share one BitGraph position. Each has its own member number, fingerprint, and path linking it to
        that position. Any file can be verified independently, without needing the&nbsp;others.
      </p>

      <h2>The fee, worked out</h2>
      <p>
        The ceiling transaction used 23,940 gas at 0.006075 gwei, which is 0.0000001454 ETH, plus an L1 data fee of 0.0000000007 ETH:
        0.0000001462 ETH in all. At $2,560.87 per ETH (Coinbase spot, read right after the run) that is <strong>$0.000374</strong>,
        for all one million files. It moves with Base&rsquo;s gas price and the price of
        ETH.
      </p>

      <h2>Five billion files</h2>
      <p>
        About 5 billion photos are taken on Earth every day. A BitGraph holds up to one million files, so a day of them is
        5,000 BitGraphs. Projected from this run, not measured: about <strong>$1.87</strong> in fees (5,000 &times; $0.000374),
        and about 14.6 hours on this one laptop, one BitGraph after another (5,000 &times; 10.50&nbsp;s). That is less than a
        day: one laptop keeps pace with every photo taken on Earth. Run side by side on more machines, it takes a fraction
        of&nbsp;that.
      </p>

      <h2>Check it yourself</h2>
      <ul>
        <li><Link href={PROOF}>The proof page for BitGraph #40</Link>, with the floor, the ceiling and every check</li>
        <li><a href={`${BASESCAN}/block/${FLOOR_BLOCK}`} {...ext}>The floor block</a> and <a href={`${BASESCAN}/tx/${CEILING_TX}`} {...ext}>the ceiling transaction</a> on Basescan</li>
      </ul>
      {/* The seed on the page, not a download (Mike, 2026-10-12: "its small why not just on page?"). Same text as seed.txt. */}
      <p>
        The million files themselves were never stored. Each one is made from this seed by the rule below, so anyone can
        regenerate all of them, place the commitment from the proof in each, build the tree, and get the root the proof&nbsp;commits.
      </p>
      <pre className="bench-seed"><code>{`seed: 4fe52546cc714029ae3fce38813dcb2a

file i, for i = 0 to 999,999 (three lines, each ending in a newline):
BitGraph one-million test <seed>
file <i+1> of 1000000
<SHA-256 hex of "<seed>:<i>">`}</code></pre>
    </div>
  );
}
