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
        Dropping a BitGraphed file on this site does the same thing: the block is stripped and the bytes inside are checked, and the MCP server and the SDK likewise never record the envelope in place of what it carries. An envelope can still be given a position of its own through any path that hashes it as it is. A reader of that file then strips one block and finds the envelope, which is why a reader strips exactly one.
      </p>

      <h2 id="window">The time window</h2>
      <p>
        The floor is always inside. It is the anchor the enclave fixed when the position was allocated and signed into the proof, matched to the signed block number and hash, with that block&rsquo;s raw header beside it. Recomputing the header&rsquo;s hash offline shows it is the header the enclave signed, so the time read from it belongs to that block; one lookup on any Ethereum node or explorer, at any time, shows the block is on Ethereum. Together they say the record was placed after this block. The ceiling in position cannot be inside at the moment of the commit, because the anchor that follows it has not landed yet; the site waits a few seconds for it before building the file, and usually has it. So the block states one of exactly two things:
      </p>
      <ul>
        <li><strong>Closing anchor inside.</strong> The window is complete: placed after the floor block, and committed before the anchoring of the closing block, a bound in position, not a clock time.</li>
        <li><strong>Closing anchor not fetched.</strong> Stated in those words. The floor stands on its own; nothing about the ceiling is implied, invented or downgraded.</li>
      </ul>
      <p>
        Every proof inside also carries its Nitro attestation, whose timestamp is the enclave platform&rsquo;s signed clock. It states the instant of the commit, and the anchors bound that instant from outside. The carrier check does not read the attestation; <code>bitgraph-audit</code> verifies it. The ceiling in time, the Base block, is not in the block: it travels in its own file beside the proof, in the proof page&rsquo;s download.
      </p>
      <p>
        Completion is a one-step patch from public data: drop the file back on the site and fetch the anchor that followed, and the file comes back with the closing anchor inside. The committed bytes never change, so the proof is unaffected. A file that already holds a ceiling is never overwritten.
      </p>

      <h2 id="survival">What survives, what does not</h2>
      <p>
        The block rides after the file&rsquo;s own end. Most formats never read past their own data, so a BitGraphed photo still opens as a photo. PDF and ZIP-based files (docx, xlsx, pptx) are read from the end, and tested readers still open them because they search back for their own end marker; a ZIP-based file stops opening if the block passes 64 KiB, far above the roughly 29 KB a block is today. Copying preserves it byte for byte. Re-encoding does not: export from an editor, and the block is gone the way any trailing data is. The original recording is unaffected either way, and the proof can be re-downloaded from its position page.
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
      <p>
        Strip exactly one block. The committed bytes can themselves end in a block, when an envelope was given a position and then carried, so a reader must never repeat the strip.
      </p>
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
