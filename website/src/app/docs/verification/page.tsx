import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Verification",
  description:
    "What a BitGraph verifier needs, the seven checks it runs in order, what valid, incomplete, invalid and unverifiable mean, what no result can say, and three ways to run it: a folder offline, in code, or over HTTP.",
};

/* The published enclave measurement (enclave-v8). PINS.md in the repository
   holds it; the build is reproducible, so anyone can derive it again. */
const PCR0 = "eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b";

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
        <li><b>The proof</b><span>The <code>bitgraph/1</code> JSON the holder keeps. It carries the digest, the slot record, both counters, the signature, the enclave&rsquo;s measurement and its attestation.</span></li>
        <li><b>The file</b><span>The exact bytes. For a fused file, either the fused bytes or the original they were built from; the proof rebuilds one from the other.</span></li>
        <li><b>The anchors</b><span>For the floor: the anchor proofs that bracket the position and the Ethereum block header witnesses. An export includes them. Without them the floor is a block number in the proof, not a time.</span></li>
        <li><b>A trust policy</b><span>The list of PCR0 measurements you accept. The published one is <code className="break">{PCR0}</code> (enclave-v8), reproducible from source. A proof from any other image should fail your check, whatever else it passes.</span></li>
      </ul>

      <h2 id="checks">What is checked, in order</h2>
      <p>
        Input: the proof, the file bytes, and an optional policy. The checks stop at the first failure and name it.
      </p>
      <ol className="steps">
        <li>
          <strong>Structure</strong>
          Every required field is present with the right type. <code>version</code> is <code>&quot;bitgraph/1&quot;</code>, <code>hashAlg</code> is <code>&quot;sha256&quot;</code>, <code>enforcement</code> is one of the known tiers, and every base64 field decodes.
        </li>
        <li>
          <strong>Digest</strong>
          SHA-256 of the bytes in hand, compared with <code>proof.artifact.digestB64</code> in constant time. A mismatch means the proof is not about these bytes.
        </li>
        <li>
          <strong>Signed body</strong>
          The <code>SignedBody</code> is rebuilt from the proof&rsquo;s fields, including the attribution and the attestation format when present, canonicalized to sorted-key JSON and encoded as UTF-8. Those bytes are what the signature covers.
        </li>
        <li>
          <strong>Signature</strong>
          <code>publicKeyB64</code> must decode to 32 bytes and <code>signatureB64</code> to 64. The Ed25519 signature is checked against the canonical bytes. If it fails, the body was changed after signing or was never signed by this key.
        </li>
        <li>
          <strong>Slot binding and floor</strong>
          When <code>slotAllocation</code> is present: the slot record&rsquo;s own Ed25519 signature over its canonical body; <code>commit.slotHashB64</code> equal to the SHA-256 of that body; <code>commit.nonceB64</code> equal to the slot&rsquo;s nonce; <code>slotCounter</code> smaller than <code>counter</code>, under the same key and the same epoch. Since enclave v8 the slot record also names the Ethereum anchor the enclave had authenticated at allocation (<code>commit.slotAnchor</code>): the proof&rsquo;s floor.
        </li>
        <li>
          <strong>Attestation binding</strong>
          For <code>measured-tee</code> proofs, the AWS Nitro attestation in <code>environment.attestation</code> is a COSE_Sign1 document signed with ES384. Its certificate chain is walked from the enclave leaf to the pinned AWS Nitro Enclaves root, each certificate signed by its parent. <code>PCR0</code> inside the document must equal <code>environment.measurement</code>. Then the binding to this exact proof: the document&rsquo;s <code>user_data</code> must equal the SHA-256 of the canonical signed body, which equals <code>proofHash</code> on an ordinary proof and diverges from it on an actor or policy proof. The <code>public_key</code> field is null on purpose; the binding runs through <code>user_data</code>. Because the signed body names <code>signer.publicKeyB64</code>, this ties the genuine enclave to this proof and to the key that signed it. The chain travels inside the proof and validates offline; only certificate revocation status needs the network and is outside these checks. The full chain check runs in the audit tool and in this site&rsquo;s own verifier; <code>verify</code> in the npm package confirms the attestation is present and its format is signed into the body, and leaves the certificate chain to them.
        </li>
        <li>
          <strong>Policy</strong>
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
        <li><b>Valid</b><span>Every check passed against the bytes in hand. These exact bytes were committed at the position the proof names, under the key and the enclave image the proof names. On a proof from enclave v8, the slot record, signed before any digest reached the enclave, names the anchor that is the position&rsquo;s floor.</span></li>
        <li><b>Incomplete</b><span><code>verifyProofIntegrity</code> runs every check except the digest comparison and answers with <code>artifactBinding: &quot;not-checked&quot;</code>. The proof is sound, but nothing has said which file it belongs to. The audit tool reports this as <code>artifact-unavailable</code>; it is never reported as verified.</span></li>
        <li><b>Invalid</b><span>One check failed, and <code>reason</code> names it: a digest that does not match the bytes, a signature that does not verify, a slot record that does not bind, a policy the proof does not meet. An invalid result says nothing about the bytes beyond this: this proof does not stand for them.</span></li>
        <li><b className="break">Unverifiable</b><span>Evidence is missing, so no verdict is possible on that point. Without the bytes, identity is unchecked. Without the anchor proofs and their witnesses, the floor stays a block number and cannot be read as a time. Without a measurement you recognize, the proof may be internally sound and still come from an image you have no reason to trust; a policy with <code>allowedMeasurements</code> turns that into a failure.</span></li>
      </ul>

      <h3 id="fused">Fused files</h3>
      <p>
        A fused file carries a commitment to its own slot record inside its bytes, written before the file was finished. Its proof is an ordinary <code>bitgraph/1</code> proof whose signed <code>attribution</code> names the placement and the origin, so the seven checks run unchanged. <code>verifyFuse({"{ proof, bytes, frame? }"})</code> in <code>@mikeargento/bitgraph-verify</code> then adds one comparison, chosen by what the bytes hash to. The commitment and the registered placements are defined in the <Link href="/docs/proof-format#fused">proof format</Link>.
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
              <td>locate the commitment in the bytes with the declared placement; compare with the commitment recomputed from the proof&rsquo;s slot record</td>
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
      <p>The statements a verifier prints, verbatim, with N the slot position and M the commit position:</p>
      <ul>
        <li>&ldquo;These exact bytes existed no later than commit position M.&rdquo;</li>
        <li>&ldquo;The supplied original rebuilds the committed fused artifact byte for byte, so these exact original bytes existed no later than commit position M.&rdquo;</li>
        <li>&ldquo;The fused bytes carry an origin digest that matches the signed marker; the original itself was not supplied and was not checked.&rdquo;</li>
        <li>&ldquo;The exact fused bytes could not feasibly have been finalized before their signed slot allocation at position N, and were committed no later than position M.&rdquo;</li>
      </ul>
      <p>
        Ordering follows from the counters. When two proofs are comparable (same key, epoch and chain), <code>commitCounter(A) &lt; slotCounter(B)</code> means B was assembled after A was committed. A fused failure is never reported as a valid recording, and <code>bitgraph/1</code> verification (<code>verify</code>, <code>verifyProofIntegrity</code>) is unchanged.
      </p>

      <h2 id="limits">What the checks cannot conclude</h2>
      <p>
        A valid result is a statement about placement. It does not say the file is true, who made it, that these bytes did not exist somewhere earlier, or at what time the commit happened. The floor is a time: the block the proof names had been mined before the slot existed. The ceiling is a position: the next anchor in the sequence, which does not convert to a clock reading. No field in a proof is a trusted clock, and the verifier makes no upper bound claim in time.
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
              <td>The proof names its floor in the signed slot record (commit.slotAnchor). Turning that into a clock time needs the Ethereum block header, which the export package ships as a witness; the verifier does not fetch it.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="run">Three ways to run it</h2>
      <h3>A folder, offline</h3>
      <p>
        Everything you were handed, checked at once: every proof, the files beside them, the anchors and their witnesses, and the order between positions. The report says what the evidence supports and what it does not. The <Link href="/docs/audit">audit page</Link> is the walkthrough.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-audit <folder>`}</Code>
      </div>

      <h3>In code</h3>
      <p>
        <code>@mikeargento/bitgraph-verify</code> is MIT and has no network dependency. <code>verify</code> takes the proof and the bytes; <code>verifyFuse</code> takes the same and adds the fused-file comparison.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { verify, verifyFuse } from "@mikeargento/bitgraph-verify";

const policy = {
  requireEnforcement: "measured-tee",
  allowedMeasurements: ["${PCR0}"],
  requireAttestation: true,
};

const result = await verify({ proof, bytes, trustAnchors: policy });
// { valid: true }  or  { valid: false, reason }

const fused = await verifyFuse({ proof, bytes, trustAnchors: policy });
// fused.category: RECORDED | FUSED_DIRECT | FUSED_FROM_ORIGIN | NO_MATCH | ...
// fused.statements: the sentences above, with the real positions filled in`}</Code>
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
        <li><Link href="/docs/audit">Audit a bundle</Link><span>Many proofs, their order and their anchors, checked offline with one command.</span></li>
        <li><Link href="/docs/player">Player</Link><span>Evaluate ordering rules over a set of proofs and get a verdict anyone can reproduce.</span></li>
        <li><Link href="/docs/proof-format">Proof format</Link><span>Every field, its encoding, and what is and is not signed.</span></li>
        <li><Link href="/docs/what-bitgraph-is-not">Limits</Link><span>Truth, authorship, first creation, exact time, a universal order.</span></li>
      </ul>
    </article>
  );
}
