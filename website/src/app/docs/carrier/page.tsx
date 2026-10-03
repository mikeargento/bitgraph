import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "The BitGraphed file",
  description:
    "The bitgraph-carrier/2 format: the committed bytes followed by one structural block holding the proof, the floor anchor and its Ethereum header, the closing anchor, the Base block the record existed by, its settlement on Ethereum when known, and the AWS attestation laid out as openssl-checkable evidence. One file, verifiable offline, with one line per claim.",
};

/* The carrier page: what the downloaded file is, the envelope rule, the
   window, what a verifier says about it, and the format for people writing
   readers. The format itself is normative in packages/verify (carrier.ts),
   from which this page is derived. */
export default function CarrierPage() {
  return (
    <article className="prose">
      <h1>The BitGraphed file</h1>
      <p className="lede">
        The file is its own proof. A BitGraphed file is the committed bytes followed by one structural block that holds the <code>bitgraph/1</code> proof and everything a reader needs to check it with no URL, no operator, and no trust beyond mathematics, the AWS Nitro root and two public block hashes: the floor anchor and its Ethereum header, the closing anchor, the Base block the record existed by, its settlement on Ethereum when known, and the enclave&rsquo;s attestation laid out as evidence anyone can check with openssl. Everything travels in the one file, offline, with nothing resolved from this site.
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
        The floor is always inside. It is the anchor the enclave fixed when the position was allocated and signed into the proof, matched to the signed block number and hash, with that block&rsquo;s raw header beside it. Recomputing the header&rsquo;s hash offline shows it is the header the enclave signed, so the time read from it belongs to that block; one lookup on any Ethereum node or explorer, at any time, shows the block is on Ethereum. Together they say the record was placed after this block. A file made with <code>bitgraph-fuse/2</code> says more: its commitment binds that block&rsquo;s hash, so the bytes themselves could not have been finished before the block existed.
      </p>
      <p>
        Two ceilings follow the commit, and both are carried once they exist:
      </p>
      <ul>
        <li><strong>The ceiling in position.</strong> The next Ethereum anchor in the sequence: the record was committed before the anchoring of that block, a bound in position, not a clock time. Every record ever made has one.</li>
        <li><strong>The ceiling in time.</strong> A Base block that includes a Merkle root over the record&rsquo;s proof hash: the record existed by that block&rsquo;s time. It lands seconds after the commit, and it is carried as the same <code>bitgraph-ceiling/1</code> file the proof page serves, whole, so the raw Base transaction, its inclusion proof and the Base header are inside. Records made before 2026-09-29 have none, and the file says so.</li>
        <li><strong>Settlement.</strong> When known, the Ethereum block that committed the Base batch data holding the ceiling transaction: an Ethereum header, the batcher transaction&rsquo;s inclusion proof, and the blob commitments. The blob bytes themselves are kept beside a download package (in <code>base-ceiling/blobs/</code>), not in the file, because Ethereum prunes them after about 18 days; BitGraph also archives them, at <code>bitgraph.ing/api/ceilings/blobs/&lt;versioned hash&gt;.bin</code>. This says the ceiling transaction&rsquo;s bytes existed by that Ethereum block, whatever Base&rsquo;s own state says.</li>
      </ul>
      <p>
        Neither ceiling can be inside at the moment of the commit, so each is either present or stated as not fetched, in those words. Completion is a one-step patch from public data: drop the file back on the site, or run <code>bitgraph complete</code>, and what has landed since is fetched in. The committed bytes never change, so the proof is unaffected. Nothing already inside is ever overwritten; a file offered a different ceiling than the one it holds refuses it, because a conflicting embedded ceiling is evidence worth keeping.
      </p>
      <p>
        Every proof inside also carries its Nitro attestation, whose timestamp is the enclave platform&rsquo;s signed clock. It states the instant of the commit, and the blocks bound that instant from outside.
      </p>

      <h2 id="attestation">The attestation, checkable with openssl</h2>
      <p>
        The one thing a reader with no BitGraph code used to be unable to check was the AWS attestation: a COSE-signed CBOR document whose certificate chain reaches the AWS Nitro root, with certificates that live about three hours. A <code>bitgraph-carrier/2</code> block carries the same document laid out as evidence, so the check is five openssl commands and three greps, with no CBOR knowledge:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell (files written from the block&rsquo;s attestation witness)</span><CopyCode /></div>
        <Code lang="bash">{`openssl x509 -in root.pem -outform DER | openssl dgst -sha256     # 641a0321…9bb5b: the AWS Nitro Enclaves Root CA G1
openssl verify -attime <atTimeUnix> -CAfile root.pem -untrusted chain.pem leaf.pem   # leaf.pem: OK
openssl x509 -in leaf.pem -pubkey -noout > leaf.pub
openssl dgst -sha384 -verify leaf.pub -signature sig.der sigstructure.bin      # Verified OK
xxd -p sigstructure.bin | tr -d '\\n' | grep -c <pcr0>        # 1: PCR0 is inside the signed bytes
xxd -p sigstructure.bin | tr -d '\\n' | grep -c <user_data>   # 1: user_data is inside the signed bytes`}</Code>
      </div>
      <p>
        <code>-attime</code> is the document&rsquo;s own timestamp: the certificates are evaluated at the instant AWS signed, which is the only instant that means anything, and a check at &ldquo;now&rdquo; fails on every attestation older than a few hours. Then PCR0 must equal the proof&rsquo;s <code>environment.measurement</code>, and <code>user_data</code> must equal the SHA-256 of the proof&rsquo;s canonical signed body (its <code>proofHash</code> on an ordinary proof). The witness carries each decoded value beside the value it must equal, and the procedure with its expected output. A verifier never trusts the witness: it recomputes it from the attestation document inside the proof and refuses a witness that differs.
      </p>

      <h2 id="claims">What a verifier says</h2>
      <p>
        <code>verifyCarrier</code> answers one line per claim, each with what it rests on, at two levels. <strong>Offline</strong>, every claim holds by mathematics and the AWS root, with the block headers taken as the ones matching their hashes. <strong>Confirmed</strong> needs one question answered by any node the caller names: is that header the chain&rsquo;s own block? The lookups are supplied by the caller; the verifier never fetches. The verdict is FALSE the moment any evidence contradicts a claim, TRUE when every carried claim holds, and UNDETERMINED when the block is unreadable, which is a damaged or newer block, never a verdict on the file. The reading is written from the results, never read from the file.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>bitgraph verify bitgraph-demonstration.bitgraph.txt --eth-rpc … --base-rpc …</span><CopyCode /></div>
        <Code lang="text">{`TRUE
  ok  The committed bytes are the ones the proof names [SHA-256]
  ok  The proof is signed and its position record is bound to it [Ed25519]
  ok  The bytes carry the position commitment [SHA-256 over the signed position record and its nonce]
  ok  AWS hardware signed the attestation [ES384 (P-384)]
  ok  The chain reaches the AWS Nitro root [the AWS Nitro Enclaves Root CA G1 (641A0321…)]
  ok  Every certificate was valid at the document's own instant [the document's signed timestamp]
  ok  The attestation is bound to this proof [user_data inside the signed document]
  ok  The floor is the anchor the enclave fixed for this position [the proof's signed commit.slotAnchor]
  ok  The floor block's header is the one with that hash [Ethereum block 26088457, header as given]
  ok  The record was committed before the closing anchor [the enclave's counter order]
  ok  The transaction is in the Base block [Merkle-Patricia proof; Base block 51979918, header as given]
  ??  How far Base had settled the block: reported by BitGraph's Base node, not proven by the file
  ok  The floor block is Ethereum's own [the Ethereum node the caller named]
  ok  The ceiling block is Base's own [the Base node the caller named]

  These exact bytes were finished after their position was opened: made after Ethereum block 26088457
  (2026-09-30T06:19:23Z), and existed by Base block 51979918 (2026-09-30T06:19:43Z); committed before the
  anchoring of Ethereum block 26088459, a bound in position. Position 4546 of epoch UX8Vhg+L…. Rests on:
  SHA-256, Ed25519, the AWS Nitro root (641A0321…), Ethereum block 26088457, Base block 51979918. Every
  block was confirmed against a node, so nothing here rests on a header taken as given.`}</Code>
      </div>
      <p>
        The file also declares the pins it was made under: the enclave&rsquo;s PCR0, the ceiling writer&rsquo;s address, the chains. A verifier compares them with its own list and reports a difference; it never reads them as authority. Without a PCR0 list of its own it reports the measurement and says to compare it with the ones BitGraph <Link href="/docs/self-host-tee">publishes and reproduces</Link>.
      </p>

      <h2 id="survival">What survives, what does not</h2>
      <p>
        The block rides after the file&rsquo;s own end. Most formats never read past their own data, so a BitGraphed photo still opens as a photo. PDF and ZIP-based files (docx, xlsx, pptx) are read from the end, and tested readers still open them because they search back for their own end marker; a ZIP-based file stops opening once the block passes 65,535 bytes (its end record must sit within the last 64 KiB; measured 2026-09-30: Spotlight and Python fail at 65,536, and QuickLook hangs), so the builder keeps every block under 60,000 bytes for them, leaving the openssl witness out first (the attestation itself is still inside the proof) and keeping the proof beside the file rather than inside it when even that is too large. MP4 and MOV have no such limit: every reader tested ignored a trailing block up to the format&rsquo;s own 8 MiB cap. A block is about 50 KB with the witness and 35 KB without. Copying preserves it byte for byte. Re-encoding does not: export from an editor, and the block is gone the way any trailing data is. The original recording is unaffected either way, and the file can be rebuilt from its position page.
      </p>

      <h2 id="format">The block, for people writing readers</h2>
      <p>
        The block is found from the end of the file only, never by scanning: the last eight bytes are the magic, the four before them the payload length, and the leading magic and length must agree.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>bitgraph-carrier/2</span><CopyCode /></div>
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
  "carrier": "bitgraph-carrier/2",      // a reader that knows only /1 reports an unknown version, never a verdict
  "proof":   { ... },                   // the bitgraph/1 proof, unchanged
  "floor": {
    "status":  "present",               // always; a floorless file is not made
    "anchor":  { ... },                 // the anchor named by commit.slotAnchor
    "witness": { "headerRlpHex": "...", "blockNumber": 0, "blockHash": "0x..." }
  },
  "ceiling": { "status": "unfetched" }, // the ceiling in POSITION; or: { "status": "present",
                                        //   "basis": "counter-order", "anchor": { ... }, "witness": { ... } }
  "ceilingInTime": { "status": "present", "sidecar": { "version": "bitgraph-ceiling/1", ... } },
                                        // or { "status": "unfetched", "searched": { "at": "<ISO>" } }
  "settlement": { "status": "present", "pointer": { "version": "bitgraph-settlement/1", ... } },   // optional
  "pins": { "pcr0": "<hex>", "ceilingWriter": "0x...", "chains": { "ethereum": 1, "base": 8453 } },  // declared, never trusted
  "attestation": { "format": "aws-nitro-witness/1", "sigStructureB64": "...", "signatureDerHex": "...",
                   "chainPem": [ ... ], "rootPem": "...", "rootSha256": "641A0321...", "atTimeUnix": 0,
                   "decoded": { "pcr0": "...", "userDataB64": "...", "timestampMs": 0, ... },
                   "expected": { "pcr0": "...", "signedBodyHashB64": "..." }, "procedure": [ ... ] }   // optional
}`}</Code>
      </div>
      <p>
        <code>bitgraph-carrier/1</code> files, made before 2026-09-30, carry the first three fields only and verify exactly as before. An ordinary reader never needs to know the block is there: it sees the file it always saw. The formats inside are specified with the <Link href="/docs/proof-format">proof</Link>: the position record and its commitment, the <Link href="/docs/proof-format#ceiling">ceiling file</Link>, and settlement.
      </p>
    </article>
  );
}
