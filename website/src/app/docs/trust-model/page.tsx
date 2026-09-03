import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "Trust Model",
  description: "BitGraph trust model: assumptions, threat model, enforcement tiers, non-goals.",
};

export default function TrustModelPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">Trust Model</h1>

      <div className="border-l-2 border-l-[#d0d5dd] pl-6 mb-8">
        <p className="text-sm text-[#111827] italic leading-relaxed">
          BitGraph guarantees single-successor semantics within the verifier-accepted
          measurement and monotonicity domain of the enforcing boundary.
        </p>
      </div>

      {/* The italic line above is the thesis and is scoped correctly, but on its
          own it reads as though a verifier enforces single-successor globally.
          It does not. The boundary enforces it inside an epoch: an epoch link is
          injected once and then cleared, so one epoch consumes its predecessor
          exactly once. Two boundaries handed the same predecessor is a fork the
          protocol DETECTS rather than prevents, and only in a verifier that has
          observed both branches (verifyEpochLink keeps its single-successor
          registry in memory, per process). Saying so here costs nothing and
          keeps the page from claiming more than the code does. */}
      <p className="text-base text-[#4b5563] leading-relaxed mb-8">
        Read precisely: the boundary <em>enforces</em> this within an epoch, and a
        fork across epochs is <em>detected</em> rather than prevented. Detection
        requires a verifier that has observed both branches, so an auditor holding
        the full ledger sees a fork that a verifier checking one proof cannot.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Assumptions</h2>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Assumption</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">If it fails</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Boundary isolation - TEE prevents external key access</td>
              <td className="py-2">All guarantees collapse</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Key secrecy - Ed25519 private key never leaves boundary</td>
              <td className="py-2">Proof forgery becomes possible</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Nonce freshness - ≥128 bits, never reused</td>
              <td className="py-2">Replay within a session</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Honest measurement - hardware correctly measures enclave</td>
              <td className="py-2">Delegated to TEE vendor</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Monotonic counter durability - survives restarts</td>
              <td className="py-2">Anti-rollback degrades to single session</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Causal slot integrity - slot allocated before the artifact hash reached the enclave</td>
              <td className="py-2">Without pre-allocation, commit order could be forged</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Strict verifier policy - caller pins measurements + counters</td>
              <td className="py-2">Weak policy accepts more than intended</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="border border-[#d0d5dd] p-4 mb-8 text-sm text-[#374151] leading-relaxed">
        <span className="font-semibold text-[#0065A4]">Honest measurement is verifiable, not just assumed.</span>{" "}
        The enclave build is bit-for-bit reproducible: rebuild it from source on any linux/amd64 host and you re-derive the exact PCR0 the production enclave reports. You confirm yourself that the measurement corresponds to the published source, trusting no one, so the only part delegated to the TEE vendor is the hardware honestly reporting that measurement (and AWS&apos;s signed kernel, which PCR1 measures independently).{" "}
        <a href="/docs/self-host-tee" className="text-[#0065A4] font-medium no-underline whitespace-nowrap">Rebuild and verify the PCR0 &rarr;</a>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Threat model</h2>
      <h3 className="text-base font-semibold mt-6 mb-3">In-scope threats</h3>
      <div className="space-y-3 mb-8">
        {[
          { threat: "Proof replay", mitigation: "`minCounter` in policy rejects old proofs" },
          { threat: "Measurement substitution", mitigation: "`allowedMeasurements` pins exact values" },
          { threat: "Signature forgery", mitigation: "Ed25519 signatures; the private key never leaves the boundary" },
          { threat: "Downgrade attack", mitigation: "Enforcement tier is signed; `requireEnforcement` rejects weaker tiers" },
          { threat: "Chain gap insertion", mitigation: "`prevB64` chaining: any removed link breaks hash continuity" },
          { threat: "Counter position forgery", mitigation: "Causal slot pre-allocation: `slotHashB64` binding + `slotCounter` < counter ordering proves pre-allocation" },
          { threat: "Slot commitment mismatch", mitigation: "A fused artifact carries a commitment derived from the signed slot record; the verifier recomputes it from the proof's own slot and rejects a mismatch (`INVALID_SLOT_COMMITMENT`). A claimed origin must rebuild the artifact byte for byte (`RECONSTRUCTION_MISMATCH` otherwise)" },
          { threat: "Retroactive forgery after compromise", mitigation: "Per-epoch keypair destroyed on restart + anchors hash-link prior history, fixing pre-anchor proofs against rewrite" },
          { threat: "Cross-epoch identity confusion", mitigation: "`epochId` binds every proof to a specific compartment; verifiers pin allowed epochs" },
        ].map((t) => (
          <div key={t.threat} className="flex gap-4 border-l-2 border-l-[#d0d5dd] pl-4 py-1">
            <div className="text-sm font-medium text-[#111827] shrink-0 w-44">{t.threat}</div>
            <div className="text-sm text-[#1f2937]">{renderInline(t.mitigation)}</div>
          </div>
        ))}
      </div>

      <h3 className="text-base font-semibold mt-6 mb-3">Out-of-scope threats</h3>
      <ul className="space-y-2 mb-8 text-sm text-[#1f2937]">
        <li>• Signing key exfiltration - assumes boundary is secure</li>
        <li>• TEE firmware vulnerability - delegated to hardware vendor</li>
        <li>• Weak verifier policy - caller responsibility</li>
        <li>• Physical access to enclave host - outside threat model</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">Ethereum anchors</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        BitGraph does not require a blockchain to operate, but it uses Ethereum
        as an external public timeline. The same TEE that signs user proofs
        periodically commits the hash of a recent Ethereum block into its own
        counter chain as an ordinary anchor proof. The anchor carries the
        enclave&apos;s public key, the epoch identifier, the current counter, and
        the block it references: nothing about any individual user or file.
        Nothing is written to Ethereum.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        Each anchor is itself a BitGraph proof signed by the enclave, so it
        participates in the same counter chain as the user proofs that came
        before it. Its artifact is the hash of a recent Ethereum block, a
        value that did not exist before that block was produced, so the
        anchor and everything chained after it provably follow that block&apos;s
        public date. Every proof committed before the anchor is fixed against
        retroactive rewrite: the anchor is hash-linked to the entire chain
        behind it, so any alternative earlier history breaks the chain that
        reaches an anchor already stored and observed, and once the epoch&apos;s
        key is destroyed no alternative can ever be signed.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        This is the mechanism behind the phrase &quot;everything before me already
        existed.&quot; An anchor fixes backward, not forward. It does not prove
        when individual proofs were created, only that they preceded the
        anchor in the chain, while the anchor itself provably followed its
        block. Combined with per-epoch keypairs, anchors give BitGraph a
        bounded breach window: between one anchor and the next, a compromise
        could in theory rewrite the live chain, but anything behind the most
        recent stored anchor cannot be rewritten without breaking the chain
        that reaches it. A fused artifact carries a commitment to its slot,
        so the same bound reaches its bytes: they could not have been
        finalized before the slot, and the slot follows the block named by
        the anchor before it.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-8">
        Anchors are public, but they reveal no user-identifying information.
        A verifier can confirm the block an anchor names on Ethereum and use
        its date to bound when everything chained after that anchor must have
        come into existence, without ever contacting BitGraph.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Epoch isolation: blast-radius containment</h2>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        BitGraph&apos;s strongest containment property is structural, not behavioral.
        Each restart of the enclave generates a new Ed25519 keypair inside the
        boundary, derives a new <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">epochId</code> from
        fresh hardware entropy, and resets the monotonic counter. This means
        every epoch is a closed compartment, identified by a key that exists
        nowhere else in the world.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        The consequence: a compromise can only forge proofs that carry the
        live epoch&apos;s public key. It cannot retroactively produce valid proofs
        under any prior epoch&apos;s key, because that key was destroyed when its
        enclave terminated and never existed outside the boundary in the first
        place. Past proofs remain verifiable because their signatures bind to
        a public key that no surviving system can sign with.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-4">
        Ethereum anchors tighten this further. The same TEE periodically
        commits the hash of a recent Ethereum block into the epoch&apos;s counter
        chain. Each anchor is hash-linked to every proof before it, so once an
        anchor exists, the history behind it is fixed: nothing earlier can be
        altered without breaking the chain that reaches the anchor, and
        everything after it provably follows that block&apos;s public date. A
        breach window is therefore bounded on one side by the epoch boundary
        and on the other side by the most recent anchor that preceded it.
      </p>
      <p className="text-[#1f2937] leading-relaxed mb-6">
        Restarting the TEE is not just operational hygiene. It is a deliberate
        containment action. Each restart closes one compartment and opens a
        fresh one, so any undetected compromise is quarantined to the bounded
        window of a single epoch. Verifiers can refuse to accept proofs from
        any epoch they have not pinned, narrowing trust to known-good
        compartments only.
      </p>

      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Containment property</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">What it bounds</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Per-epoch keypair</td>
              <td className="py-2">A compromise of one epoch cannot sign as another epoch</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Key destroyed on restart</td>
              <td className="py-2">No surviving artifact can produce a valid signature under a closed epoch</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Ethereum anchors</td>
              <td className="py-2">Pre-anchor proofs are hash-linked into the anchor, fixed against retroactive rewrite</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Verifier epoch pinning</td>
              <td className="py-2">Trust scope can be restricted to known-good compartments only</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Non-goals</h2>
      <ul className="space-y-2 mb-8 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Global ordering from the counter alone</strong> - every TEE instance and every new epoch resets the counter to 1, so the counter by itself only orders proofs within a single epoch. Ordering relative to the outside world is established by Ethereum anchors: each anchor records the hash of a recent finalized block, so everything chained after it provably follows that block&apos;s public date: across epochs, across TEE instances, and against any other event that can be placed on the same public timeline.</li>
        <li>• <strong className="text-text">Cross-boundary double-spend</strong> - same artifact can be submitted to separate boundaries</li>
        <li>• <strong className="text-text">Copy prevention</strong> - BitGraph does not prevent raw byte copying</li>
        <li>• <strong className="text-text">Consensus replacement</strong> - BitGraph constrains a single boundary, not distributed parties</li>
        <li>• <strong className="text-text">Metadata integrity</strong> - the metadata field is advisory and unsigned</li>
      </ul>
    </article>
  );
}
