import { M } from "@/components/math";
import { MBlock } from "@/components/math";
import { Figure1, Figure2 } from "./figures";

export default function Sections4Through6() {
  return (
    <div className="prose-doc">
      {/* ================================================================ */}
      {/* 4. SYSTEM INVARIANTS                                             */}
      {/* ================================================================ */}
      <section id="sec-invariants">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">4</span>
          System Invariants
        </h2>

        <p className="text-[#1f2937] mb-4">
          If BitGraph is correctly implemented, the following
          invariants hold:
        </p>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p className="text-sm text-text">
            <strong>Invariant 4.1</strong> (Authenticated Reachability).
            Authenticated durable state exists if and only if a successful
            finalization event occurred inside an approved atomic execution
            boundary.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p className="text-sm text-text">
            <strong>Invariant 4.2</strong> (Binding Evidence). Every
            authenticated artifact has associated verification
            material&mdash;produced at genesis&mdash;that binds its content to
            boundary-fresh cryptographic output and to a specific boundary
            identity. This material may be co-located with the artifact, held at
            a reference point, or both. (A reference point stores verification
            evidence produced at genesis; it does not confer authenticated status
            and plays no role in enforcement. See{" "}
            <a href="#sec-verification-independence" className="text-[#111827] underline">
              Section 9.5
            </a>
            .)
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p className="text-sm text-text">
            <strong>Invariant 4.3</strong> (Policy-Anchored Verification). An
            artifact verifies if and only if its verification material validates
            under accepted trust anchors and applicable policy constraints.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p className="text-sm text-text">
            <strong>Invariant 4.4</strong> (Distinguishability). Durable state
            not produced via boundary finalization cannot satisfy verification
            and is therefore distinguishable from authenticated durable state.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p className="text-sm text-text">
            <strong>Invariant 4.5</strong> (Authenticity as Reachability).
            Authenticated durable state is defined by enforced state transitions,
            not by post-hoc claims, metadata, or byte-level identity.
          </p>
        </div>

        <p className="text-[#1f2937] mb-4">
          The significance of Invariant 4.5 deserves emphasis. In conventional
          systems, authenticity is a <em>label</em>: a property that can be
          attached to, claimed about, or inferred from an artifact after it
          exists. Under BitGraph, authenticity is a <em>reachability property</em>: a
          consequence of the state transitions that produced the artifact. An
          artifact does not become authenticated by having the right metadata. It
          is authenticated because it could only have come into existence through
          a path that enforced authorization, cryptographic binding, and durable
          commit as a single indivisible event. The authenticated state space is
          closed under authorized genesis&mdash;nothing else can produce it.
        </p>

        <p className="text-[#1f2937] mb-4">
          This is the central claim of the paper: if authenticated digital state
          can only come into existence through a controlled creation path, then
          the existence of an authenticated artifact is itself proof that the
          creation path was traversed. Authentication becomes a reachability
          property of system architecture&mdash;a consequence of how state
          transitions are structured&mdash;rather than a label applied to
          artifacts after the fact.
        </p>

        <p className="text-[#1f2937] mb-4">
          Returning to the camera example from{" "}
          <a href="#sec-concrete-example" className="text-[#111827] underline">
            Section 2.1
          </a>
          : under BitGraph, the system would not merely attest that trusted code ran.
          It would enforce that authenticated image output is{" "}
          <em>structurally unreachable</em> except through a commit path that
          includes sensor capture within the atomic execution boundary. The
          adversary&rsquo;s synthetic frames would not produce authenticated
          output, because the commit path would require that sensor acquisition,
          hashing, binding, and durable commit all occur within the same
          indivisible boundary event. Feeding synthetic data to the input buffer
          would bypass the authorized creation path entirely, and the protected
          commit interface would never be invoked through the sensor-capture path
          for that data. The result: no authenticated artifact is produced.
        </p>

        <p className="text-[#1f2937] mb-4">
          Returning to the provenance example from{" "}
          <a href="#sec-provenance-example" className="text-[#111827] underline">
            Section 2.2
          </a>
          : under BitGraph with reference-based verification (described in{" "}
          <a href="#sec-verification-independence" className="text-[#111827] underline">
            Section 9.5
          </a>
          ), the downstream consumer could still verify the stripped image by
          computing its content hash and querying a reference point for the
          verification material produced at genesis. Authentication would survive
          distribution because it was established by the artifact&rsquo;s
          structural relationship to its creation event, not by metadata
          co-traveling with the artifact.
        </p>
      </section>

      {/* ================================================================ */}
      {/* 5. TRUSTED ORIGIN TOKEN ARCHITECTURE                             */}
      {/* ================================================================ */}
      <section id="sec-tota">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">5</span>
          Trusted Origin Token Architecture
        </h2>

        <p className="text-[#1f2937] mb-4">
          We begin with a concrete model that makes the enforcement principle
          tangible before generalizing.
        </p>

        <p className="text-[#1f2937] mb-4">
          The Trusted Origin Token Architecture addresses uncontrolled digital
          state creation by introducing a pre-creation authorization requirement.
          Authenticated creation requires consumption of a pre-existing
          single-use authorization unit&mdash;a{" "}
          <em>Trusted Origin Token</em>&mdash;at the moment of finalization.
          Tokens are generated in advance, tracked as unused or consumed, and
          cannot be reused.
        </p>

        <p className="text-[#1f2937] mb-4">
          Under this model, a system may prepare candidate data freely, but
          finalization into authenticated durable form is permitted only if a
          valid unused token is consumed during the same atomic operation that
          commits the artifact.
        </p>

        <p className="text-[#1f2937] mb-4">
          The key insight is best understood through analogy. Before digital
          cameras, a photograph could only exist if film existed first. The film
          did not merely record the image&mdash;it <em>enforced</em> whether the
          image could exist at all. No film, no photograph, regardless of the
          camera, the scene, or the photographer&rsquo;s intent. The Trusted
          Origin Token Architecture enforces the same constraint digitally: no
          token, no authenticated artifact.
        </p>

        {/* 5.1 Functional Properties */}
        <section id="sec-functional-properties">
          <h3 className="text-lg font-semibold mt-8 mb-4">
            <span className="text-[#636a78] mr-2">5.1</span>
            Functional Properties
          </h3>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-text">
              <strong>Property 5.1</strong> (Scarcity). Each authenticated
              artifact corresponds to exactly one token that existed prior to
              creation.
            </p>
          </div>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-text">
              <strong>Property 5.2</strong> (Non-Replay). Tokens cannot be
              reused. Each token authorizes exactly one finalization event.
            </p>
          </div>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-text">
              <strong>Property 5.3</strong> (Non-Retroactivity). Tokens cannot be
              applied after durable state already exists. Authorization must
              occur at the moment of finalization, not afterward.
            </p>
          </div>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-text">
              <strong>Property 5.4</strong> (Commit-Path Enforcement). Token
              consumption and finalization occur within the same indivisible
              operation.
            </p>
          </div>

          <p className="text-[#1f2937] mb-4">
            The Trusted Origin Token Architecture ensures that authenticated
            durable state cannot exist unless a pre-authorized unit is
            irreversibly consumed at birth.
          </p>
        </section>

        {/* 5.2 Limits of Token-Based Enforcement */}
        <section id="sec-limits-token">
          <h3 className="text-lg font-semibold mt-8 mb-4">
            <span className="text-[#636a78] mr-2">5.2</span>
            Limits of Token-Based Enforcement
          </h3>

          <p className="text-[#1f2937] mb-4">
            While the token model provides a clear and intuitive model of origin
            control, it introduces operational complexity. Tokens must be
            generated, stored, distributed, tracked, and reconciled across
            systems. Registries or equivalent state-tracking mechanisms must
            exist to enforce single-use guarantees. Offline operation requires
            reconciliation logic, and token provisioning becomes
            infrastructure-coupled to production systems.
          </p>

          <p className="text-[#1f2937] mb-4">
            More importantly, <em>tokens are not the fundamental source of trust</em>.
            What matters is not the consumption of a specific pre-existing
            object, but that an irreversible, non-repeatable authorization event
            occurred at the moment of finalization and could not be replayed or
            forged. This observation motivates a more general enforcement
            principle.
          </p>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 6. BitGraph AND ATOMIC CAUSALITY                                      */}
      {/* ================================================================ */}
      <section id="sec-bitgraph">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">6</span>
          BitGraph and Atomic Causality
        </h2>

        <p className="text-[#1f2937] mb-4">
          The Trusted Origin Token Architecture reveals a structural principle
          that is more general than tokens. What enforced origin control in TOTA
          was not the token itself&mdash;it was the fact that authenticated state
          was structurally unreachable without traversing a protected commit path
          that combined authorization, binding, and commit into a single
          indivisible event. Tokens enforced this by requiring consumption of a
          pre-existing resource. But any mechanism that makes authenticated state
          unreachable without an irreversible authorization event at the commit
          boundary achieves the same enforcement.
        </p>

        <p className="text-[#1f2937] mb-4">
          BitGraph generalizes this principle. Instead of
          consuming a pre-generated token, the enforcement component generates a{" "}
          <em>boundary-fresh cryptographic value</em> <M c="N" /> during the
          atomic finalization event. Cryptographic unpredictability and
          negligible collision probability prevent precomputation, reuse, or
          accidental duplication.
        </p>

        <p className="text-[#1f2937] mb-4">
          The reader should note what changed and what did not. What changed is
          the mechanism: tokens are replaced by boundary-fresh generation. What
          did <em>not</em> change is the enforcement invariant: authenticated
          durable state remains structurally unreachable without an irreversible
          authorization event inside the atomic execution boundary. The invariant
          is the primitive. The mechanism is an implementation detail.
        </p>

        <p className="text-[#1f2937] mb-4">
          This value serves the same functional role as a consumed authorization
          unit:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-sm text-[#1f2937] mb-6">
          <li>It could not have existed prior to the finalization event.</li>
          <li>It could not have been predicted or precomputed.</li>
          <li>It cannot be recreated after the event.</li>
          <li>
            Its existence constitutes cryptographic evidence that a specific,
            irreversible finalization event occurred.
          </li>
        </ul>

        {/* Figure 1: Token-Nonce Duality */}
        <div className="my-8 border border-[#e5e7eb] bg-[#f9fafb] p-6">
          <Figure1 />
          <p className="text-xs text-[#636a78] mt-4 leading-relaxed">
            <strong className="text-[#1f2937]">Figure 1.</strong>{" "}
            Token&ndash;Nonce duality. TOTA (left) consumes a pre-existing token
            from a finite pool. BitGraph (right) generates a boundary-fresh value
            from a cryptographic source. Both enforce the same invariant: each
            authenticated artifact corresponds to exactly one irreversible
            authorization event (injective genesis). Collision resistance makes
            boundary-fresh generation operationally equivalent to token
            consumption.
          </p>
        </div>

        <p className="text-[#1f2937] mb-4">
          The equivalence shown in Figure 1 is structural, not operational. The
          reader should resist the interpretation that BitGraph merely replaces
          physical tokens with virtual ones. The insight is the reverse: TOTA is
          a special case of BitGraph in which the authorization event happens to be
          reified as a consumable object. BitGraph reveals that the underlying
          enforcement primitive is not the token but the structural
          constraint&mdash;that authenticated state is unreachable without an
          irreversible authorization event at the commit boundary. Tokens enforce
          this by depletion; boundary-fresh generation enforces it by
          cryptographic causality. The primitive is the constraint, not the
          mechanism.
        </p>

        <p className="text-[#1f2937] mb-4">
          Similarly, the boundary-fresh value <M c="N" /> should not be
          understood as merely a &ldquo;nonce for replay protection.&rdquo; In
          conventional protocols, nonces prevent message replay. In BitGraph, the
          boundary-fresh value is <em>the authorization event itself</em>&mdash;its
          generation inside the boundary constitutes the irreversible act that
          gates the creation of authenticated state. Producing valid verification
          material is proof that this act occurred, not merely that a unique
          value was included.
        </p>

        {/* 6.1 Atomic Causality */}
        <section id="sec-atomic-causality">
          <h3 className="text-lg font-semibold mt-8 mb-4">
            <span className="text-[#636a78] mr-2">6.1</span>
            Atomic Causality
          </h3>

          <p className="text-[#1f2937] mb-4">
            Under Atomic Causality, three operations are linked into a single
            indivisible event inside an atomic execution boundary, completed only
            through a protected commit interface requiring a boundary-held
            capability:
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-sm text-[#1f2937] mb-6">
            <li>
              <strong className="text-text">Authorization</strong>: A
              boundary-held capability is exercised.
            </li>
            <li>
              <strong className="text-text">Cryptographic binding</strong>:
              Boundary-fresh output is bound to a content-dependent value.
            </li>
            <li>
              <strong className="text-text">Durable commit</strong>: The
              authenticated artifact is committed to persistent storage or an
              output channel.
            </li>
          </ol>

          <p className="text-[#1f2937] mb-4">
            Authenticated durable state is reachable only if these operations
            occur together, in order, within the same atomic execution boundary.
            If any step fails, no authenticated artifact is produced.
          </p>

          {/* Figure 2: Atomic Causality */}
          <div className="my-8 border border-[#e5e7eb] bg-[#f9fafb] p-6">
            <Figure2 />
            <p className="text-xs text-[#636a78] mt-4 leading-relaxed">
              <strong className="text-[#1f2937]">Figure 2.</strong> Atomic
              Causality versus separated operations. In BitGraph (left),
              authorization, binding, and commit occur as a single indivisible
              event inside the boundary with no externally observable
              intermediate states. In non-BitGraph systems (right), these are
              separate operations with observable gaps exploitable by
              adversaries.
            </p>
          </div>
        </section>

        {/* 6.2 Why This Is Not Attested Execution */}
        <section id="sec-not-attestation">
          <h3 className="text-lg font-semibold mt-8 mb-4">
            <span className="text-[#636a78] mr-2">6.2</span>
            Why This Is Not Attested Execution
          </h3>

          <p className="text-[#1f2937] mb-4">
            This enforcement model is not equivalent to conventional attested
            execution followed by signing. The distinction is precise and
            consequential.
          </p>

          <p className="text-[#1f2937] mb-4">
            Attestation-based systems can demonstrate that particular trusted
            code executed and produced particular signed outputs. This answers
            the question: <em>&ldquo;Was this artifact produced by trusted
            code?&rdquo;</em> But attestation does not answer a different and
            more fundamental question: <em>&ldquo;Could an artifact not produced
            by trusted code have entered this trust domain through any available
            commit path?&rdquo;</em>
          </p>

          <p className="text-[#1f2937] mb-4">
            In most attestation-based systems, enforcement is advisory. Trusted
            processes may produce signed outputs, while untrusted processes may
            still produce durable state that enters downstream systems through
            alternative commit paths. The enforcement gap is not in the attested
            path&mdash;it is in the unattested paths that remain open.
          </p>

          <p className="text-[#1f2937] mb-4">
            BitGraph closes this gap. Authenticated durable
            state is reachable <em>only</em> through protected commit paths that
            enforce atomic binding, authorization, and durable commit at the
            moment of finalization. Valid verification material implies not
            merely that trusted code ran, but that{" "}
            <em>no alternative path to authenticated state exists</em>. This is
            a structural property of the commit architecture, not a property of
            any single attested process.
          </p>
        </section>

        {/* 6.3 Token-Equivalence of Boundary-Fresh Generation */}
        <section id="sec-token-equivalence">
          <h3 className="text-lg font-semibold mt-8 mb-4">
            <span className="text-[#636a78] mr-2">6.3</span>
            Token-Equivalence of Boundary-Fresh Generation
          </h3>

          <p className="text-[#1f2937] mb-4">
            Token-equivalence does not arise from uniqueness alone. It arises
            from atomic, attested finalization that combines several properties:
            boundary isolation ensures the fresh output is generated only inside
            the atomic execution boundary; unpredictability prevents adversaries
            from predicting or precomputing valid values; binding ties the fresh
            output to a content-dependent value before commit; a boundary-held
            authorization capability gates finalization; and attestation or
            signing produces verification material validatable under accepted
            trust anchors.
          </p>

          <p className="text-[#1f2937] mb-4">
            Together, these properties ensure that producing valid verification
            material implies that a specific authorization event occurred inside
            the boundary at finalization time. The fresh value <M c="N" />{" "}
            functions as a consumed authorization unit whose existence is
            cryptographic evidence of an irreversible finalization
            event&mdash;not merely a unique identifier. To be precise: the fresh
            value alone does not constitute authorization. Authorization arises
            from the indivisible combination of boundary isolation,
            capability-gated access, atomic binding, and freshness&mdash;no
            single property is sufficient, and removing any one breaks the
            enforcement guarantee.
          </p>

          <p className="text-[#1f2937] mb-4">
            Functionally, the space of possible boundary-fresh outputs acts as
            an effectively inexhaustible universe of unused authorization units,
            and generating one during finalization constitutes irreversible
            consumption. Each accepted artifact necessarily corresponds to
            exactly one irreducible authorization event, making boundary-fresh
            outputs operationally equivalent to single-use tokens even without
            explicit allocation or tracking.
          </p>
        </section>
      </section>
    </div>
  );
}
