import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Verification",
  description:
    "What a BitGraph verifier needs, the seven checks it runs in order, what valid, incomplete, invalid and unverifiable mean, what no result can say, and three ways to run it: a folder offline, in code, or over HTTP.",
};

/* The published enclave measurement (enclave-v10). PINS.md in the repository
   holds it; the build is reproducible, so anyone can derive it again. */
const PCR0 = "5a947cc66095adcceefa9e5ece5d1416dfe08c3470df1bcaa5b2bc5267b0480e6cdc172fe077cd06b0afb07614307973";

export default function VerificationPage() {
  return (
    <article className="prose">
      <h1>Verification</h1>
      <p className="lede">
        Someone handed you a proof. This page says what evidence you need beside it, what a verifier checks and in what order, what each result means, what no result can say, and three ways to run the check. Verification is deterministic and runs offline: no network call, no account, no key.
      </p>

      <h2 id="evidence">What you need</h2>
      <p>
        A proof establishes where a file&rsquo;s fingerprint (SHA-256 digest) was placed in a sequence. Checking it needs the evidence below, and one decision of yours: which enclave images you trust.
      </p>
      <ul className="facts">
        <li><b>The export</b><span>The <code>bitgraph-export/1</code> JSON the holder keeps beside the file, with <code>SPEC.md</code>, the exact text the proof pins. The export carries the <code>bitgraph/1</code> proof (the digest, the position record, both counters, the signature, the enclave&rsquo;s measurement and its attestation) and the tree evidence: the 84-byte root document and, for one file, its leaf and path, or, for the owner, every leaf and name. A proof handed over on its own still verifies as a proof; the member check needs the export.</span></li>
        <li><b>The file</b><span>The exact bytes. For a fused file, either the fused bytes or the original they were built from; the proof rebuilds one from the other. An export holds no copy of any file.</span></li>
        <li><b>The time evidence</b><span>In the export, when they exist: <code>floor</code>, the header of the block the enclave&rsquo;s signed floor names (a Base block; an Ethereum block on earlier proofs); <code>ceiling</code>, the Base block that carries a Merkle root over the record; <code>settlement</code>, Ethereum&rsquo;s own record of that Base block. An export holds no anchor proofs. A Base floor carries its block&rsquo;s time in the signed proof; on an earlier proof, without the header the floor is a block number, not a time. <code>bitgraph export complete</code> fills in a ceiling and settlement that had not landed when the export was written.</span></li>
        <li><b>A trust policy</b><span>The list of PCR0 measurements you accept. The published one is <code className="break">{PCR0}</code> (enclave-v10, from 2026-10-07 23:59 UTC; earlier images in PINS.md), reproducible from source. A proof from any other image should fail your check, whatever else it passes.</span></li>
      </ul>

      <h2 id="gets">What a verifier gets</h2>
      <div>
        <p>From the record and its proof alone, offline:</p>
        <ul className="facts">
          <li><b>Integrity</b><span>The record in hand is exactly the one that was committed. Change one byte and it no longer matches.</span></li>
          <li><b>Position</b><span>The commitment inside the record points to a position that existed before the record was signed, and the proof commits this record. A commitment copied from another record fails, because its proof commits a different one.</span></li>
          <li><b>Floor</b><span>The proof names a Base block that the enclave bound into the position when it opened (an Ethereum block on earlier proofs). A record carrying the position commitment could not have been finished before that block.</span></li>
          <li><b>Origin of the proof</b><span>The signature verifies, and a hardware attestation ties the signing key to a published, reproducible enclave image the verifier chooses to accept.</span></li>
        </ul>
        <p>Those are the conclusions. The checks that produce them, in the order the verifier runs them, are below.</p>
      </div>

      <h2 id="checks">What is checked, in order</h2>
      <p>
        Input: the proof, the file bytes, and an optional policy. The checks stop at the first failure and name it.
      </p>
      <ol className="steps">
        <li>
          <strong>Structure.</strong>{" "}
          Every required field is present with the right type. <code>version</code> is <code>&quot;bitgraph/1&quot;</code>, <code>hashAlg</code> is <code>&quot;sha256&quot;</code>, <code>enforcement</code> is one of the known tiers, and every base64 field decodes.
        </li>
        <li>
          <strong>Digest.</strong>{" "}
          SHA-256 of the bytes in hand, compared with <code>proof.artifact.digestB64</code> in constant time. A mismatch means the proof is not about these bytes.
        </li>
        <li>
          <strong>Signed body.</strong>{" "}
          The <code>SignedBody</code> is rebuilt from the proof&rsquo;s fields, including the attribution and the attestation format when present, canonicalized to sorted-key JSON and encoded as UTF-8. Those bytes are what the signature covers.
        </li>
        <li>
          <strong>Signature.</strong>{" "}
          <code>publicKeyB64</code> must decode to 32 bytes and <code>signatureB64</code> to 64. The Ed25519 signature is checked against the canonical bytes. If it fails, the body was changed after signing or was never signed by this key.
        </li>
        <li>
          <strong>Position binding and floor.</strong>{" "}
          When <code>slotAllocation</code> is present: the position record&rsquo;s own Ed25519 signature over its canonical body; <code>commit.slotHashB64</code> equal to the SHA-256 of that body; <code>commit.nonceB64</code> equal to the position&rsquo;s nonce; <code>slotCounter</code> smaller than <code>counter</code>, under the same key and the same epoch. The signed commit also names the block the enclave fixed at allocation, the proof&rsquo;s floor: since enclave v10 a Base block whose header the enclave hashed and checked itself (<code>commit.slotFloor</code>); on proofs from enclave v8 and v9, the Ethereum anchor the enclave had authenticated (<code>commit.slotAnchor</code>). A proof carrying both is refused as ambiguous.
        </li>
        <li>
          <strong>Attestation binding.</strong>{" "}
          For <code>measured-tee</code> proofs, the AWS Nitro attestation in <code>environment.attestation</code> is a COSE_Sign1 document signed with ES384. Its certificate chain is walked from the enclave leaf to the pinned AWS Nitro Enclaves root, each certificate signed by its parent. <code>PCR0</code> inside the document must equal <code>environment.measurement</code>. Then the binding to this exact proof: the document&rsquo;s <code>user_data</code> must equal the SHA-256 of the canonical signed body, which equals <code>proofHash</code> on an ordinary proof and diverges from it on an actor or policy proof. The <code>public_key</code> field is null on purpose; the binding runs through <code>user_data</code>. Because the signed body names <code>signer.publicKeyB64</code>, this ties the genuine enclave to this proof and to the key that signed it. The chain travels inside the proof and validates offline; only certificate revocation status needs the network and is outside these checks. The full chain check runs in the audit tool and in this site&rsquo;s own verifier; <code>verify</code> in the npm package confirms the attestation is present and its format is signed into the body, and leaves the certificate chain to them.
        </li>
        <li>
          <strong>Policy.</strong>{" "}
          If a <code>VerificationPolicy</code> is supplied, its constraints are enforced: enforcement tier, allowed measurements, allowed public keys, attestation requirements, counter range, time range, epoch requirements.
        </li>
      </ol>
      <p>
        Step 6 confirms that PCR0 matches the measurement the proof claims, and the certificate chain shows that the measurement came from genuine Nitro hardware. Whether that measurement is the published source is a separate question, answered by rebuilding: the enclave build is reproducible bit for bit, so you can rebuild it and derive the same PCR0 yourself. See <Link href="/docs/self-host-tee">reproducible builds</Link>.
      </p>

      <h2 id="results">What the results mean</h2>
      <p>
        <code>verify</code> answers <code>{"{ valid: true }"}</code> or <code>{"{ valid: false, reason }"}</code>. Read a result as one of four outcomes.
      </p>
      <ul className="facts">
        <li><b>Valid</b><span>Every check passed against the bytes in hand. These exact bytes were committed at the position the proof names, under the key and the enclave image the proof names. The commit names the block that is the position&rsquo;s floor, fixed when the position opened, before any digest reached the enclave: a Base block since enclave v10, an Ethereum anchor on proofs from v8 and v9.</span></li>
        <li><b>Incomplete</b><span><code>verifyProofIntegrity</code> runs every check except the digest comparison and answers with <code>artifactBinding: &quot;not-checked&quot;</code>. The proof is sound, but nothing has said which file it belongs to. The audit tool reports this as <code>artifact-unavailable</code>; it is never reported as verified.</span></li>
        <li><b>Invalid</b><span>One check failed, and <code>reason</code> names it: a digest that does not match the bytes, a signature that does not verify, a position record that does not bind, a policy the proof does not meet. An invalid result says nothing about the bytes beyond this: this proof does not stand for them.</span></li>
        <li><b className="break">Unverifiable</b><span>Evidence is missing, so no verdict is possible on that point. Without the bytes, identity is unchecked. On an earlier proof, without the floor block header, the floor stays a block number and cannot be read as a time. A tree/1 proof that pins a spec hash the verifier does not know is answered <code>undetermined</code>, never <code>TRUE</code>. Without a measurement you recognize, the proof may be internally sound and still come from an image you have no reason to trust; a policy with <code>allowedMeasurements</code> turns that into a failure.</span></li>
      </ul>

      <h3 id="fused">Fused files</h3>
      <p>
        A fused file carries its position commitment inside its bytes, written before the file was finished. Its proof is an ordinary <code>bitgraph/1</code> proof whose signed <code>attribution</code> names the placement and the origin, so the seven checks run unchanged. <code>verifyFuse({"{ proof, bytes, frame? }"})</code> in <code>@mikeargento/bitgraph-verify</code> then adds one comparison, chosen by what the bytes hash to. The commitment and the registered placements are defined in the <Link href="/docs/proof-format#fused">proof format</Link>.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Bytes hash to</th><th>Check</th><th>Result</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>the artifact digest, no fused marker</td>
              <td>none beyond the checks above</td>
              <td><code>RECORDED</code></td>
            </tr>
            <tr>
              <td>the artifact digest, fused marker present</td>
              <td>locate the commitment in the bytes with the declared placement; compare with the commitment recomputed from the proof&rsquo;s position record</td>
              <td><code>FUSED_DIRECT</code>; <code>INVALID_SLOT_COMMITMENT</code> on mismatch; <code>INVALID_ORIGIN_ATTRIBUTION</code> if an origin digest embedded in the bytes disagrees with the signed one</td>
            </tr>
            <tr>
              <td>the signed origin digest</td>
              <td>rebuild the fused file from these bytes with the placement; compare its digest with the committed one</td>
              <td><code>FUSED_FROM_ORIGIN</code>; <code>RECONSTRUCTION_MISMATCH</code> otherwise</td>
            </tr>
            <tr>
              <td>neither</td>
              <td>none</td>
              <td><code>NO_MATCH</code>: the proof says nothing about these bytes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>The statements a verifier prints, verbatim, with N the reserved position and M the commit position:</p>
      <ul>
        <li>&ldquo;These exact bytes existed no later than commit position M.&rdquo;</li>
        <li>&ldquo;The supplied original rebuilds the committed fused artifact byte for byte, so these exact original bytes existed no later than commit position M.&rdquo;</li>
        <li>&ldquo;The fused bytes carry an origin digest that matches the signed marker; the original itself was not supplied and was not checked.&rdquo;</li>
        <li>&ldquo;The exact fused bytes could not feasibly have been finalized before position N was reserved and signed for them, and were committed no later than position M.&rdquo;</li>
      </ul>
      <p>
        Ordering follows from the counters. When two proofs are comparable (same key, epoch and chain), <code>commitCounter(A) &lt; slotCounter(B)</code> means B was assembled after A was committed. A fused failure is never reported as a valid recording, and <code>bitgraph/1</code> verification (<code>verify</code>, <code>verifyProofIntegrity</code>) is unchanged.
      </p>

      <h3 id="tree">Members of a tree</h3>
      <p>
        Every BitGraph made since 2026-10-04 is a <code>tree/1</code>: one position for one or more files, each file a leaf, one file a tree of one. Earlier recordings placed a single fused file directly, or two or more files as a set; they still verify by the rules above. For a tree the committed artifact is not the file but an 84-byte root document, so the seven checks run on the proof and four more run on the member. The rules are <a href="/spec">SPEC.md</a>, section 8; the verifier states one line per claim.
      </p>
      <ol className="steps">
        <li>
          <strong>Marker.</strong>{" "}
          The signed <code>attribution</code> is <code>{"{ name: \"bitgraph-fuse/3\", title: \"tree/1\", message }"}</code> (<code>bitgraph-fuse/2</code> on earlier proofs, whose floor is an Ethereum anchor), where <code>message</code> is the base64 SHA-256 of the <code>SPEC.md</code> the proof was made under. The verifier must know that hash. A proof that pins a hash it does not know is answered <code>undetermined</code> on every tree claim, never <code>TRUE</code> and never <code>FALSE</code>.
        </li>
        <li>
          <strong>Root document.</strong>{" "}
          Taken from the export (the proof&rsquo;s unsigned <code>metadata[&quot;bitgraph-tree/1&quot;]</code> echo is never used in its place): 84 bytes, the domain, a count from 1 to 1,000,000, a SHA-256 equal to the signed <code>artifact.digestB64</code>, and a commitment equal to the one recomputed from the position record and the signed floor block.
        </li>
        <li>
          <strong>Leaf and path.</strong>{" "}
          The member&rsquo;s leaf names the file&rsquo;s digest and its placement; its path must reach the root inside the root document. An owner&rsquo;s export carries every leaf instead, and the list must rebuild the same root.
        </li>
        <li>
          <strong>Bytes.</strong>{" "}
          With the file in hand, its digest must be the leaf&rsquo;s, and for a placed member the committed bytes rebuild from it. Without the file this claim is stated as not carried.
        </li>
      </ol>
      <p>
        A member states two floors apart: the record floor (the root document was signed after the floor block, so every leaf inherits it) and the content floor (the member&rsquo;s committed bytes carry the commitment, so they were finished after that block). A file kept as is has the record floor only; its bytes are not dated.
      </p>

      <h2 id="limits">What the checks cannot conclude</h2>
      <p>
        A valid result is a statement about placement. It does not say the file is true, who made it, that these bytes did not exist somewhere earlier, or at what time the commit happened. The floor is a time: the block the proof names had been made before the position existed. Order after the record is a position, not a time: the next BitGraph in the chain carries this proof&rsquo;s hash. No field in a proof is a trusted clock, and the proof verifier makes no upper bound claim in time. That claim comes from the ceiling file, checked on its own: the record's hash under a Merkle root, the root in a Base transaction from the published writer, the transaction in a block, and the block's time.
      </p>
      <div className="table-scroll">
        <table className="table-k">
          <thead>
            <tr><th>Not checked</th><th>Why</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Attestation revocation status</td>
              <td>Offline verification validates the bundled certificate chain and the attestation binding; network revocation checks are outside these checks.</td>
            </tr>
            <tr>
              <td>prevB64 chain integrity</td>
              <td>Chain traversal is application-layer logic. The audit tool does it across a bundle.</td>
            </tr>
            <tr>
              <td>Counter continuity</td>
              <td>Gap detection is application-layer logic. The audit tool reports unexplained positions.</td>
            </tr>
            <tr>
              <td>Key origin for non-attested tiers</td>
              <td>Only a measured-tee proof with a verified attestation ties the signing key to a measured enclave; for stub and hw-key proofs the key&rsquo;s origin is not established.</td>
            </tr>
            <tr>
              <td>Batch context completeness</td>
              <td>Verifying all proofs in a batch is application-layer logic.</td>
            </tr>
            <tr>
              <td>Wall-clock floor of a fused file</td>
              <td>The proof names its floor in its signed commit (commit.slotFloor): a Base block&rsquo;s number, hash and time, the time checked by the enclave against Base mainnet&rsquo;s schedule for that number. That the block is Base&rsquo;s own is one lookup on Base, which the verifier does not make by itself. On an earlier proof (commit.slotAnchor), turning the floor into a clock time needs the Ethereum block header, which an export carries as <code>floor.header</code>; the verifier does not fetch it.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="attestation-yourself">Checking the attestation yourself</h2>
      <p>
        The attestation is the one check that used to need BitGraph&rsquo;s own code, because it is a COSE-signed CBOR document whose certificates live about three hours. A <Link href="/docs/carrier">BitGraphed file</Link> carries the same document laid out as evidence (<code>aws-nitro-witness/1</code>): the bytes the signature covers, the signature in DER, the certificate chain and the AWS root as PEM, the instant to evaluate at, and each decoded value beside the value it must equal. With those written to files, the check is openssl alone, and the expected output of each line is in the witness itself:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`openssl x509 -in root.pem -outform DER | openssl dgst -sha256                       # the AWS Nitro root: 641a0321…9bb5b
openssl verify -attime <atTimeUnix> -CAfile root.pem -untrusted chain.pem leaf.pem   # leaf.pem: OK
openssl x509 -in leaf.pem -pubkey -noout > leaf.pub
openssl dgst -sha384 -verify leaf.pub -signature sig.der sigstructure.bin            # Verified OK
xxd -p sigstructure.bin | tr -d '\n' | grep -c <pcr0>                                # 1
xxd -p sigstructure.bin | tr -d '\n' | grep -c <user_data>                           # 1`}</Code>
      </div>
      <p>
        Then PCR0 must equal the proof&rsquo;s <code>environment.measurement</code>, <code>user_data</code> must equal the SHA-256 of the canonical signed body (<code>proofHash</code> on an ordinary proof), and the timestamp must fall between the floor block&rsquo;s time and the Base block&rsquo;s time. A verifier never trusts the witness: it recomputes it from the document inside the proof and refuses one that differs. The same checks run in code in <code>verifyNitroAttestation</code>, which also evaluates every certificate at the document&rsquo;s own instant.
      </p>

      <h2 id="levels">One line per claim, two levels</h2>
      <p>
        <code>verifyExport</code> answers a file and its export with one result per claim, each naming what it rests on: SHA-256, Ed25519, the AWS Nitro root, the pinned spec, an Ethereum block, a Base block. <code>verifyCarrier</code> does the same for a <Link href="/docs/carrier">BitGraphed file</Link>, a single file carrying its proof inside (<code>bitgraph-carrier/2</code>), verified with nothing but itself; carriers hold one file only and are an earlier form that still verifies. <strong>Offline</strong>, every claim holds by mathematics and the AWS root, with the block headers taken as the ones matching their hashes. <strong>Confirmed</strong> asks any node the caller names one question per chain, whether that header is the chain&rsquo;s own block; the lookups are injected and the package never fetches. A claim the export does not carry yet (a ceiling not landed, no settlement) is stated as not carried, never as failure. A settlement says the Base block&rsquo;s data existed by the Ethereum block that records it, and no more. The reading at the end is written from the results.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-sdk verify photo.jpg photo.export.json --eth-rpc https://ethereum-rpc.publicnode.com --base-rpc https://mainnet.base.org --pcr0 ${PCR0}
npx @mikeargento/bitgraph-sdk verify photo.bitgraph.jpg --eth-rpc https://ethereum-rpc.publicnode.com --base-rpc https://mainnet.base.org --pcr0 ${PCR0}`}</Code>
      </div>

      <h2 id="run">Three ways to run it</h2>
      <h3>A folder, offline</h3>
      <p>
        Everything you were handed, checked at once: an export with its file, or a folder of them, every proof, the floor headers, the ceilings and settlements, and the order between positions. The report says what the evidence supports and what it does not. The <Link href="/docs/audit">audit page</Link> is the walkthrough.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-audit <folder or export.json>`}</Code>
      </div>

      <h3>In code</h3>
      <p>
        <code>@mikeargento/bitgraph-verify</code> (1.16.0) is MIT and has no network dependency. <code>parseExport</code> reads an export from JSON text or an object and answers <code>null</code> when it is not <code>export/1</code>; <code>verifyExport</code> takes the export and the bytes and answers one line per claim; <code>verifyTreeMember</code> runs the member checks alone, given the proof, the member evidence, the bytes and, when it is not in the proof&rsquo;s metadata, the root document. <code>verify</code> takes a proof and bytes; <code>verifyFuse</code> takes the same and adds the fused-file comparison for the earlier single-file form.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { parseExport, verifyExport, verifyTreeMember, verify, verifyFuse } from "@mikeargento/bitgraph-verify";

const policy = {
  requireEnforcement: "measured-tee",
  allowedMeasurements: ["${PCR0}"],
  requireAttestation: true,
};

const exp = parseExport(exportJsonText);
// the export, or null when the document is not bitgraph-export/1

const report = await verifyExport(exp, {
  bytes,
  pins: { pcr0: policy.allowedMeasurements },
  lookups: { ethereumBlockHash: async (n) => hashFromYourNode(n), baseBlockHash: async (n) => hashFromYourBaseNode(n) },
});
// report.verdict: TRUE | FALSE | UNDETERMINED
// report.claims: [{ id, name, result, restsOn, detail, level }], report.times, report.reading

const member = await verifyTreeMember({ proof: exp.proof, member: exp.tree.member, bytes, trustAnchors: policy });
// member.category: TREE_MEMBER_DIRECT | TREE_MEMBER_FROM_ORIGIN | TREE_MEMBER_AS_IS | NO_MATCH | ...
// member.reason: one sentence; member.specHashB64: the SPEC.md the proof pins

const result = await verify({ proof, bytes, trustAnchors: policy });
// { valid: true }  or  { valid: false, reason }

const fused = await verifyFuse({ proof, bytes, trustAnchors: policy });
// fused.category: RECORDED | FUSED_DIRECT | FUSED_FROM_ORIGIN | NO_MATCH | ...
// fused.statements: the sentences above, with the real positions filled in

import { verifyCarrier } from "@mikeargento/bitgraph-verify";
const file = await verifyCarrier(bitgraphedFileBytes, {
  pins: { pcr0: policy.allowedMeasurements },
  lookups: { ethereumBlockHash: async (n) => hashFromYourNode(n), baseBlockHash: async (n) => hashFromYourBaseNode(n) },
});
// file.verdict, file.claims: [{ id, name, result, restsOn, detail, level }], file.reading`}</Code>
      </div>

      <h3>Over HTTP</h3>
      <p>
        For callers that cannot run code, such as an automation built from HTTP modules. Send the proof, the digest, or both. The service runs the same package&rsquo;s <code>verifyProofIntegrity</code> and compares the digest you sent with the one inside the proof. It never sees the file.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>HTTP</span><CopyCode /></div>
        <Code lang="http">{`POST https://bitgraph.ing/api/verify
Content-Type: application/json

{
  "proof": { ... },
  "digest": "<sha256 of the file, hex or base64>",
  "allowedMeasurements": ["${PCR0}"]
}`}</Code>
      </div>
      <p>
        The answer&rsquo;s <code>status</code> is one of <code>valid</code>, <code>valid, artifact not checked</code>, <code>invalid</code>, <code>mismatch</code> or <code>not on record</code>, with <code>reason</code> when it is not valid and <code>artifactBinding</code> saying whether the digest was compared. The <Link href="/api-reference">API reference</Link> has the full response.
      </p>
      <div className="callout is-limit">
        <span className="kicker">Which check counts</span>
        <p>
          A verdict from the service that issued the proof is a convenience. The check that counts is the offline one, run by you, against the proof and the bytes you hold.
        </p>
      </div>

      <h2 id="policy">The trust policy</h2>
      <p>
        A policy is the verifier&rsquo;s statement of what it will accept. Without one, a proof that is internally sound passes, whichever enclave image made it.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>VerificationPolicy</span><CopyCode /></div>
        <Code lang="typescript">{`interface VerificationPolicy {
  requireEnforcement?: "stub" | "hw-key" | "measured-tee";
  requireSlot?: boolean;              // the proof must carry a slotAllocation
  allowedActorKeyIds?: string[];      // legacy
  allowedMeasurements?: string[];     // exact match
  allowedPublicKeys?: string[];       // exact match
  requireAttestation?: boolean;
  requireAttestationFormat?: string[];
  minCounter?: string;                // BigInt-safe
  maxCounter?: string;
  minTime?: number;                   // Unix ms
  maxTime?: number;
  requireEpochId?: boolean;
  requireActor?: boolean;             // legacy
}`}</Code>
      </div>

      <h3>Trust anchor hierarchy</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Policy</th><th>What it gives</th></tr>
          </thead>
          <tbody>
            <tr><td><code>requireEnforcement</code> alone</td><td>Prevents an in-transit downgrade of the tier, and nothing more. The tier is signed but self-reported.</td></tr>
            <tr><td><code>requireEnforcement</code> + <code>allowedMeasurements</code></td><td>Pins the proof to a specific enclave image.</td></tr>
            <tr><td>+ <code>requireAttestation</code></td><td>Full trust: the hardware boundary is attested by the vendor, and the attestation is bound to this proof.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/audit">Audit a bundle</Link><span>Many proofs, their order and their floors and ceilings, checked offline with one command.</span></li>
        <li><Link href="/docs/player">Player</Link><span>Evaluate ordering rules over a set of proofs and get a verdict anyone can reproduce.</span></li>
        <li><Link href="/docs/proof-format">Proof format</Link><span>Every field, its encoding, and what is and is not signed.</span></li>
        <li><a href="/spec">SPEC.md</a><span>The normative text: tree/1, the export, recovery entries and every verification rule, byte for byte the file a proof pins.</span></li>
        <li><Link href="/docs/what-bitgraph-is-not">Limits</Link><span>Truth, authorship, first creation, exact time, a universal order.</span></li>
      </ul>
    </article>
  );
}
