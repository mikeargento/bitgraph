import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";
import { CopyCode } from "@/components/copy-code";

export const metadata: Metadata = {
  title: "Verification",
  description: "BitGraph six-step verification algorithm: structural validation, digest check, signature verification, Nitro attestation binding, policy enforcement, and the placement check for fused artifacts.",
};

export default function VerificationPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">Verification</h1>
      <p className="text-[#1f2937] mb-10">
        BitGraph verification is deterministic and runs offline. No network calls, no API keys, no accounts.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Six-step algorithm</h2>
      <p className="text-[#1f2937] mb-6">
        Input: a proof (<code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">BitGraphProof</code>), the artifact bytes (<code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">Uint8Array</code>), and an optional verification policy.
      </p>

      <div className="space-y-6 mb-12">
        {[
          {
            step: "1",
            title: "Structural validation",
            desc: "Check that all required fields are present with correct types. `version` must be `\"bitgraph/1\"`, `hashAlg` must be `\"sha256\"`, `enforcement` must be one of the valid tiers, all base64 fields must decode correctly.",
          },
          {
            step: "2",
            title: "Artifact digest verification",
            desc: "Compute SHA-256 of the provided bytes. Compare against `proof.artifact.digestB64` using constant-time comparison. If they don't match, the proof does not apply to these bytes.",
          },
          {
            step: "3",
            title: "Signed body reconstruction",
            desc: "Build the `SignedBody` object from the proof fields (including attribution and attestation format when present). Canonicalize to sorted-key JSON, encode as UTF-8 bytes. This is what the Ed25519 signature covers.",
          },
          {
            step: "4",
            title: "Ed25519 signature verification",
            desc: "Decode `publicKeyB64` (must be 32 bytes) and `signatureB64` (must be 64 bytes). Verify the Ed25519 signature against the canonical bytes. If invalid, the proof has been tampered with.",
          },
          {
            step: "5",
            title: "Attestation binding (measured-tee)",
            desc: "For `measured-tee` proofs, verify the AWS Nitro attestation in `environment.attestation`. Parse the COSE_Sign1 document (ES384) and validate the embedded certificate chain from the enclave leaf to the pinned AWS Nitro Enclaves root, verifying each certificate is signed by its parent. Confirm `PCR0` equals `environment.measurement`. Then confirm the binding to this exact proof: the attestation's `user_data` must equal `proofHash`. The `public_key` field is intentionally null, the binding runs through `user_data`, not `public_key`. Because `proofHash` is the SHA-256 of the canonical SignedBody, which commits to `signer.publicKeyB64`, this ties the genuine enclave to this proof and to the exact key that signed it. The chain is bundled in the proof and validates offline; only certificate revocation (CRL) status requires network and is outside this algorithm.",
          },
          {
            step: "6",
            title: "Policy checks",
            desc: "If a `VerificationPolicy` is provided, enforce its constraints: enforcement tier, allowed measurements, allowed public keys, attestation requirements, counter range, time range, epoch requirements.",
          },
        ].map((item) => (
          <div key={item.step}>
            <h3 className="text-base font-semibold mb-2">
              <span className="text-[#4b5563] mr-3 tabular-nums">{item.step}.</span>
              {item.title}
            </h3>
            <p className="text-base text-[#1f2937] leading-relaxed">{renderInline(item.desc)}</p>
          </div>
        ))}
      </div>

      <p className="text-base text-[#1f2937] leading-relaxed mt-6">
        Step 5 confirms PCR0 matches the measurement the proof claims, and the certificate chain proves that measurement came from genuine Nitro hardware. To confirm the measurement itself corresponds to the open enclave source, the build is bit-for-bit reproducible: rebuild it and re-derive the exact PCR0 yourself, trusting no one. See <a href="/docs/self-host-tee" className="text-[#0065A4] font-medium no-underline">reproducible builds</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Fused artifacts</h2>
      <p className="text-[#1f2937] mb-4">
        A fused artifact carries a commitment to its own slot record inside its bytes, written before the artifact was finished. Its proof is an ordinary <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">bitgraph/1</code> proof whose signed <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">attribution</code> names the placement and the origin, so the six steps above run unchanged. <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">verifyFuse({"{ proof, bytes, frame? }"})</code> in <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">@mikeargento/bitgraph-verify</code> then adds one comparison, chosen by what the bytes hash to. The commitment and the registered placements are defined in <a href="/docs/proof-format" className="text-[#0065A4] font-medium no-underline">Proof Format</a>.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Bytes hash to</th>
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Check</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Result</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">the artifact digest, no fused marker</td>
              <td className="py-2 pr-4">none beyond the six steps</td>
              <td className="py-2"><code className="text-xs font-mono">RECORDED</code></td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">the artifact digest, fused marker present</td>
              <td className="py-2 pr-4">locate the commitment in the bytes with the declared placement; compare with the commitment recomputed from the proof&apos;s slot record</td>
              <td className="py-2"><code className="text-xs font-mono">FUSED_DIRECT</code>; <code className="text-xs font-mono">INVALID_SLOT_COMMITMENT</code> on mismatch; <code className="text-xs font-mono">INVALID_ORIGIN_ATTRIBUTION</code> if an origin digest embedded in the bytes disagrees with the signed one</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">the signed origin digest</td>
              <td className="py-2 pr-4">rebuild the fused artifact from these bytes with the placement; compare its digest with the committed one</td>
              <td className="py-2"><code className="text-xs font-mono">FUSED_FROM_ORIGIN</code>; <code className="text-xs font-mono">RECONSTRUCTION_MISMATCH</code> otherwise</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">neither</td>
              <td className="py-2 pr-4">none</td>
              <td className="py-2"><code className="text-xs font-mono">NO_MATCH</code>: the proof says nothing about these bytes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[#1f2937] mb-4">The statements a verifier may print, verbatim:</p>
      <ul className="space-y-2 mb-6 text-sm text-[#1f2937]">
        <li>&ldquo;The supplied original rebuilds the committed fused artifact byte for byte, so these exact original bytes existed no later than commit position M.&rdquo;</li>
        <li>&ldquo;The fused bytes carry an origin digest that matches the signed marker; the original itself was not supplied and was not checked.&rdquo;</li>
        <li>&ldquo;The exact fused bytes could not feasibly have been finalized before their signed slot allocation at position N, and were committed no later than position M.&rdquo;</li>
      </ul>
      <p className="text-base text-[#1f2937] leading-relaxed mb-4">
        Ordering follows from the counters. When two proofs are comparable (same key, epoch and chain), <code className="text-xs font-mono">commitCounter(A) &lt; slotCounter(B)</code> means B was assembled after A was committed. A fused failure is never reported as a valid recording, and <code className="text-xs font-mono">bitgraph/1</code> verification (<code className="text-xs font-mono">verify</code>, <code className="text-xs font-mono">verifyProofIntegrity</code>) is unchanged.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Verification policy</h2>
      <div className="code-block mb-6">
        <div className="code-block-header"><span>VerificationPolicy</span><CopyCode /></div>
        <pre className="text-[#1f2937]">{`interface VerificationPolicy {
  requireEnforcement?: "stub" | "hw-key" | "measured-tee";
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
}`}</pre>
      </div>

      <h3 className="text-lg font-semibold mt-8 mb-4">Trust anchor hierarchy</h3>
      <div className="space-y-3 mb-8">
        <div className="border-l-2 border-l-[#d0d5dd] pl-4 py-1">
          <code className="text-xs font-mono text-[#d97706]">requireEnforcement</code>
          <span className="text-sm text-[#1f2937] ml-2">alone - prevents in-transit downgrade only</span>
        </div>
        <div className="border-l-2 border-l-[#d0d5dd] pl-4 py-1">
          <code className="text-xs font-mono text-[#0065A4]">requireEnforcement + allowedMeasurements</code>
          <span className="text-sm text-[#1f2937] ml-2">- pins to specific enclave image</span>
        </div>
        <div className="border-l-2 border-l-[#d0d5dd] pl-4 py-1">
          <code className="text-xs font-mono text-[#059669]">+ requireAttestation</code>
          <span className="text-sm text-[#1f2937] ml-2">- full trust (vendor-attested hardware boundary)</span>
        </div>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">What the verifier does NOT check</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Item</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Why</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Attestation revocation status</td>
              <td className="py-2">Offline verification validates the bundled certificate chain and attestation binding; network CRL checks are outside this algorithm.</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">prevB64 chain integrity</td>
              <td className="py-2">Chain traversal is application-layer logic</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Counter continuity</td>
              <td className="py-2">Gap detection is application-layer logic</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Slot allocation validity</td>
              <td className="py-2">Slot signature and hash binding are structural checks; application can verify slotHashB64 matches canonicalized slot body</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Key provenance</td>
              <td className="py-2">Requires attestation verification</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Batch context completeness</td>
              <td className="py-2">Verifying all proofs in a batch is application-layer logic</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Wall-clock floor of a fused artifact</td>
              <td className="py-2">The last anchored block before the slot needs Ethereum anchor evidence the proof does not carry; the Player computes it from a bundle</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
