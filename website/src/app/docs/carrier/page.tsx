import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "The BitGraphed file",
  description:
    "The bitgraph-carrier/1 format: the committed bytes followed by one structural block holding the proof, the floor anchor and its block header, and, once it exists, the closing anchor. One file, verifiable offline.",
};

/* The carrier page: what the downloaded file is, the envelope rule, and the
   ceiling rule, in that order. Format details live at the end for people
   writing readers; the format itself is normative in packages/verify
   (carrier.ts), from which this page is derived. */
export default function CarrierPage() {
  return (
    <article className="prose">
      <h1>The BitGraphed file</h1>
      <p className="lede">
        The file is its own proof. A BitGraphed file is the committed bytes followed by one structural block that holds the <code>bitgraph/1</code> proof, the floor anchor it names and that anchor&rsquo;s raw Ethereum block header. Everything a verifier needs travels in the one file, offline, with nothing resolved from this site.
      </p>

      <h2 id="envelope">The envelope rule</h2>
      <p>
        The outer file is an envelope. Its own hash is committed nowhere and proves nothing: anyone can repackage the same committed bytes with the same block and get a different outer hash, and that is fine. The envelope is never the recorded thing; <strong>the bytes inside it are.</strong> A verifier strips the block by structure, hashes what remains, and checks that digest against the proof. Change one byte of the committed bytes and the pair is detectably invalid.
      </p>
      <p>
        Dropping a BitGraphed file on this site does the same thing: the block is stripped and the bytes inside are checked. If you want the envelope itself to hold a position, record it like any other file; the recursion is allowed and unremarkable.
      </p>

      <h2 id="window">The time window</h2>
      <p>
        The floor is always inside: the anchor the enclave signed into the slot, matched by identity, with the block header beside it so <em>placed no earlier than this block</em> is checked by recomputing the header&rsquo;s hash locally. The ceiling cannot be inside at the moment the file is made, because the anchor that follows the commit has not landed yet. So the block states one of exactly two things:
      </p>
      <ul>
        <li><strong>Closing anchor inside.</strong> The window is complete: no earlier than the floor block, committed before the closing anchor. Each proof inside also carries the enclave platform&apos;s signed clock, so the file states the instant it was committed and proves the window around it.</li>
        <li><strong>Closing anchor not fetched.</strong> Stated in those words. The floor stands on its own; nothing about the ceiling is implied, invented or downgraded.</li>
      </ul>
      <p>
        Completion is a one-step patch from public data: drop the file back on the site and fetch the anchor that followed, and the file comes back with the closing anchor inside. The committed bytes never change, so the proof is unaffected. A file that already holds a ceiling is never overwritten.
      </p>

      <h2 id="survival">What survives, what does not</h2>
      <p>
        The block rides after the file&rsquo;s own end, in formats whose readers stop at an internal end marker, so a BitGraphed photo still opens as a photo. Copying preserves it byte for byte. Re-encoding does not: export from an editor, and the block is gone the way any trailing data is. The original recording is unaffected either way, and the proof can be re-downloaded from its position page.
      </p>

      <h2 id="format">The block, for people writing readers</h2>
      <p>
        The block is found from the end of the file only, never by scanning: the last eight bytes are the magic, the four before them the payload length, and the leading magic and length must agree.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>bitgraph-carrier/1</span><CopyCode /></div>
        <Code lang="text">{`<committed bytes>                       exactly what was hashed and committed
"BGPROOF" 0x01                          8 bytes  magic + block version
<uint32 BE>                             payload length
<payload>                               UTF-8 JSON, the object below
<uint32 BE>                             payload length again
"BGPROOF" 0x01                          8 bytes  magic again`}</Code>
      </div>
      <div className="code-block">
        <div className="code-block-header"><span>payload</span><CopyCode /></div>
        <Code lang="jsonc">{`{
  "carrier": "bitgraph-carrier/1",
  "proof":   { ... },                   // the bitgraph/1 proof, unchanged
  "floor": {
    "status":  "present",               // always; a floorless file is not made
    "anchor":  { ... },                 // the anchor named by commit.slotAnchor
    "witness": { "headerRlpHex": "...", "blockNumber": 0, "blockHash": "0x..." }
  },
  "ceiling": { "status": "unfetched" }  // or: { "status": "present",
                                        //       "basis": "counter-order",
                                        //       "anchor": { ... }, "witness": { ... } }
}`}</Code>
      </div>
      <p>
        An ordinary reader never needs to know the block is there: it sees the file it always saw. An older verifier that does not know it reports the placement undetermined, exactly as it does for a placement it has not met. The reference implementation, including <code>verifyCarrier</code>, is <code>carrier.ts</code> in the <Link href="/docs/verification">verify package</Link>.
      </p>
    </article>
  );
}
