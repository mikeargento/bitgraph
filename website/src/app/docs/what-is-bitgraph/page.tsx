import type { Metadata } from "next";
import { CommitPathDiagram } from "@/components/commit-path-diagram";

export const metadata: Metadata = {
  title: "What is BitGraph",
  description: "BitGraph is a protocol for portable cryptographic proof of place, not time: one position in a sequence, reserved before the file's hash was known.",
};

export default function WhatIsBitGraphPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">What is BitGraph</h1>

      <p className="text-[#1f2937] leading-relaxed mb-10">
        BitGraph is a protocol that produces portable cryptographic proof when
        a file is committed through an authorized execution boundary. The proof
        does not assert a time. It asserts a place: this exact file, in this
        exact form, at one position in a sequence, reserved before the
        file&apos;s hash was known and never occupied by anything else.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">The core idea</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        Most systems produce artifacts first and try to prove things about
        them later, attaching signatures, metadata, timestamps, or ledger
        entries after the fact.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        BitGraph inverts this. Valid proof can only exist if the file was
        committed through the authorized commit path. The proof is not added to
        the file. It is caused by the act of committing through that path.
      </p>

      <div className="border-l-2 border-l-[#d0d5dd] pl-6 my-8">
        <p className="text-sm text-[#111827] italic">
          If proof exists, the authorized commit path was traversed.
        </p>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">How it works</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        Authorization, cryptographic binding, and commit happen as one
        indivisible operation:
      </p>
      <ol className="space-y-3 mb-6">
        <li className="text-[#1f2937] leading-relaxed">
          <strong className="text-text">1. Allocate</strong> - The enclave pre-allocates a
          causal slot (nonce + counter) before the artifact hash is known. The
          place exists before the file that will occupy it.
        </li>
        <li className="text-[#1f2937] leading-relaxed">
          <strong className="text-text">2. Bind</strong> - The artifact&apos;s SHA-256 digest is
          bound to the pre-allocated slot, combined with the monotonic counter,
          and signed with Ed25519 inside the TEE.
        </li>
        <li className="text-[#1f2937] leading-relaxed">
          <strong className="text-text">3. Commit</strong> - The slot is consumed and the
          proof is produced. Fail-closed: if any step fails, no proof exists.
          The proof includes the signed slot record as causal evidence.
        </li>
      </ol>

      <h2 className="text-xl font-semibold mt-12 mb-4">What you get</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        A BitGraph proof is a JSON object (schema version <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">bitgraph/1</code>) containing:
      </p>
      <ul className="space-y-2 mb-6">
        <li className="text-[#1f2937]"><strong className="text-text">artifact</strong> - SHA-256 digest of the committed bytes</li>
        <li className="text-[#1f2937]"><strong className="text-text">commit</strong> - fresh nonce, monotonic counter, slot binding (slotCounter, slotHashB64), epoch identity, optional chain link</li>
        <li className="text-[#1f2937]"><strong className="text-text">signer</strong> - Ed25519 public key and signature over the canonical signed body</li>
        <li className="text-[#1f2937]"><strong className="text-text">environment</strong> - enforcement tier, platform measurement (PCR0), hardware attestation</li>
        <li className="text-[#1f2937]"><strong className="text-text">slotAllocation</strong> - the pre-allocated causal slot record, independently signed by the enclave</li>
        <li className="text-[#1f2937]"><strong className="text-text">agency</strong> - optional actor-bound proof via device biometrics (passkey/WebAuthn)</li>
        <li className="text-[#1f2937]"><strong className="text-text">attribution</strong> - optional signed creator metadata (name, title, message)</li>
        <li className="text-[#1f2937]"><strong className="text-text">timestamps</strong> - optional and advisory only. A proof&apos;s place comes from its slot and counter. External time bounds come from periodic Ethereum anchors of the counter chain, never from this field.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Key properties</h2>
      <ul className="space-y-2 mb-6">
        <li className="text-[#1f2937]"><strong className="text-text">Portable</strong> — a self-contained JSON object. Any verifier can check it offline with only the public key and the original bytes.</li>
        <li className="text-[#1f2937]"><strong className="text-text">Atomic</strong> — fail-closed. Either a complete, valid proof is produced, or nothing is.</li>
        <li className="text-[#1f2937]"><strong className="text-text">Causal</strong> — every proof is bound to a pre-allocated slot created before the artifact hash was known.</li>
        <li className="text-[#1f2937]"><strong className="text-text">Ordered</strong> — one place in a sequence, fixed by a monotonic counter within its epoch. Counter, epoch, and chain link establish sequencing.</li>
        <li className="text-[#1f2937]"><strong className="text-text">Measured</strong> — binds to a specific execution environment via its platform measurement. Production is AWS Nitro, where that measurement is PCR0; the schema names no platform, so another TEE&rsquo;s would fit it.</li>
        <li className="text-[#1f2937]"><strong className="text-text">Verifiable</strong> — Ed25519 signature, SHA-256 digest, canonical serialization. Standard cryptographic primitives.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Enforcement tiers</h2>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Tier</th>
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Key Location</th>
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Boundary</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Use Case</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">measured-tee</code></td>
              <td className="py-2 pr-4">TEE memory</td>
              <td className="py-2 pr-4">Hardware enclave</td>
              <td className="py-2">Production, highest assurance</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">hw-key</code></td>
              <td className="py-2 pr-4">HSM / Secure Enclave</td>
              <td className="py-2 pr-4">Software</td>
              <td className="py-2">Key custody</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="text-xs font-mono">stub</code></td>
              <td className="py-2 pr-4">Process memory</td>
              <td className="py-2 pr-4">Software</td>
              <td className="py-2">Development, testing</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[#1f2937] leading-relaxed mb-4">
        bitgraph.ing issues <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">measured-tee</code> proofs
        only. If the enclave is unreachable, no proof is produced. The other
        tiers exist for local development and for integrations that keep keys
        in an HSM.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">enforcement</code> is signed, but it is
        self-reported. A verifier that needs enclave guarantees pins <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">measurement</code> to
        a known enclave image and validates the attestation, which a software
        tier cannot produce. See <a href="/docs/verification" className="text-[#0065A4] underline underline-offset-2">Verification</a> for
        the algorithm.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Structural properties</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        The commit path satisfies these structural properties:
      </p>
      <CommitPathDiagram />
    </article>
  );
}
