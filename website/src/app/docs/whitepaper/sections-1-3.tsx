export default function Sections1Through3() {
  return (
    <>
      {/* ── Abstract ── */}
      <div
        id="abstract"
        className="border border-[#e5e7eb] bg-[#f9fafb] p-6 mb-10"
      >
        <div className="text-xs font-bold uppercase tracking-wider text-[#4b5563] mb-3">
          Abstract
        </div>
        <div className="space-y-4 text-sm text-[#1f2937] leading-relaxed">
          <p>
            Modern computing systems permit durable digital state to be created
            freely and attempt to establish trust only after that state already
            exists. This architecture introduces fundamental weaknesses in
            provenance, AI outputs, sensor data, logs, and media, because
            authenticity is optional and structurally bypassable. All existing
            approaches&mdash;signatures, metadata, watermarking, registries, and
            provenance standards&mdash;operate after content has been
            instantiated and therefore cannot constrain the creation path itself.
          </p>
          <p>
            This paper introduces a different enforcement model.{" "}
            <strong>BitGraph</strong> relocates trust to the
            commit path. Authenticated durable state is reachable only through
            enforced finalization via a protected commit interface. An artifact
            is authenticated if and only if cryptographic binding and
            authorization occur inside an atomic execution boundary at the moment
            durable state is created.
          </p>
          <p>
            We first present the{" "}
            <strong>Trusted Origin Token Architecture</strong>, in which
            authenticated creation requires consumption of a pre-existing
            single-use authorization unit at finalization. We then generalize
            this into BitGraph, in which equivalent origin
            control is achieved without pre-existing tokens by generating
            boundary-fresh cryptographic output inside the atomic execution
            boundary. The enforcement principle that links authorization,
            binding, and durable commit into a single indivisible event is
            called <strong>Atomic Causality</strong>.
          </p>
          <p>
            We provide a formal model based on labeled transition systems and
            their reachability structure, define a security game capturing the
            adversarial model, and systematically distinguish this architecture from existing
            approaches including attested execution, post-hoc provenance, and
            content credential systems. We show that BitGraph
            defines a new enforcement primitive: authentication as a{" "}
            <em>reachability property</em> of system structure, not a property
            attached to artifacts after creation.
          </p>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 1. INTRODUCTION                                                  */}
      {/* ================================================================ */}
      <section id="sec-introduction">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">1</span> Introduction
        </h2>

        <p>
          Digital systems increasingly mediate information relied upon for
          scientific, legal, medical, financial, and political decisions. At the
          same time, synthetic generation, automated manipulation, and
          adversarial pipelines have become routine. Despite this shift, most
          computing systems retain an architectural model in which creation is
          unrestricted and trust is applied only after the fact.
        </p>

        <p>
          Files are written, messages are emitted, and model outputs are exported
          without intrinsic authentication. Trust is later inferred through
          signatures, metadata, watermarking, or registry lookups. These
          mechanisms can indicate that an artifact has not been modified since
          some point in time, but they cannot prove that the artifact originated
          from an enforced creation process. Post-hoc trust systems permit
          syntactically indistinguishable artifacts to exist both with and
          without provenance guarantees. Downstream systems must therefore rely
          on voluntary compliance with provenance mechanisms.
        </p>

        <p>
          Several concurrent developments have made this structural gap acutely
          consequential. Generative AI systems now produce synthetic artifacts at
          scale that are indistinguishable from human-authored or
          sensor-captured content. Regulatory frameworks&mdash;including the EU
          AI Act and evolving compliance mandates&mdash;increasingly require that
          AI-generated and machine-mediated outputs be structurally
          identifiable, not merely voluntarily labeled. Automated decision
          pipelines in finance, healthcare, and public administration
          increasingly consume digital artifacts without human intermediation,
          removing the informal gatekeeping that previously compensated for weak
          provenance. These pressures converge on a single architectural
          deficiency: the absence of structural enforcement at the point where
          digital state is created.
        </p>

        <p>
          This paper proposes that the architectural response to this problem is
          not better verification of existing artifacts, but{" "}
          <em>
            structural enforcement at the point where digital state becomes
            durable or externally visible
          </em>
          . Trust must be enforced at creation, not inferred afterward.
        </p>

        <p>
          A corollary of this principle is that enforcement and verification are
          architecturally distinct: enforcement determines whether authenticated
          state exists; verification determines whether that status can be
          demonstrated to a third party. This separation is developed formally
          in Section&nbsp;9.4.
        </p>

        <p>
          BitGraph is not a replacement for attestation,
          provenance, or access control. It is a{" "}
          <em>lower-layer enforcement primitive</em> that existing systems can
          adopt to close the structural gap between trusted code execution and
          controlled state creation. Systems that already implement TEEs,
          content credentials, or hardware roots of trust can implement BitGraph to
          strengthen the enforcement guarantees those mechanisms provide.
        </p>

        <div className="my-5 border-l-[3px] border-[#e5e7eb] bg-[#f9fafb] p-5">
          <p>
            <strong>Non-Goal.</strong> This architecture does not attempt to
            establish the semantic truth, correctness, or factual validity of
            content. It enforces only whether content has been admitted into
            authenticated durable state through protected finalization semantics.
          </p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* 2. THE PROBLEM                                                   */}
      {/* ================================================================ */}
      <section id="sec-the-problem">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">2</span> The Problem:
          Uncontrolled Digital State Creation
        </h2>

        <p>
          In contemporary computing systems, any process capable of reaching
          commit paths&mdash;writes to persistent storage, publications to
          output channels, exports of artifacts&mdash;can create durable digital
          state. Authentication mechanisms are typically external to these
          creation paths and are applied only if the producing system elects to
          use them.
        </p>

        <p>
          This architectural pattern creates several failure modes that no
          amount of improved verification can resolve:
        </p>

        <h3 className="text-lg font-semibold mt-8 mb-2">
          No enforced origin point.
        </h3>
        <p>
          The first instance of an artifact has no cryptographically constrained
          birth event. Content enters the world without any structural evidence
          of how, where, or under what conditions it was created.
        </p>

        <h3 className="text-lg font-semibold mt-8 mb-2">
          Post-hoc wrapping is indistinguishable from legitimate origin.
        </h3>
        <p>
          Synthetic or replayed data can be introduced and later wrapped in
          authenticity claims&mdash;signatures, attestations,
          metadata&mdash;that are structurally indistinguishable from claims
          attached at genuine creation time.
        </p>

        <h3 className="text-lg font-semibold mt-8 mb-2">
          Trusted pipelines are bypassable.
        </h3>
        <p>
          Even when secure creation paths exist, alternative unauthenticated
          paths typically remain available. Untrusted components can bypass
          trusted capture or generation pipelines while still producing durable
          outputs that appear valid to downstream systems.
        </p>

        <h3 className="text-lg font-semibold mt-8 mb-2">
          Authenticity is optional.
        </h3>
        <p>
          Because creation is unrestricted, authenticity signals are voluntary.
          Systems degrade into environments where authenticated and
          unauthenticated artifacts coexist, and downstream consumers cannot
          reliably distinguish them by structural properties.
        </p>

        <p>
          The common thread across these failure modes is that{" "}
          <em>
            post-hoc provenance secures history but does not constrain birth
          </em>
          . The question is not whether we can build better verification after
          the fact, but whether we can enforce the conditions under which
          authenticated digital state is permitted to exist at all.
        </p>

        {/* 2.1 */}
        <section id="sec-concrete-example">
          <h3 className="text-lg font-semibold mt-10 mb-3">
            <span className="text-[#636a78] mr-2">2.1</span> A Concrete
            Example: Why Attestation Is Not Enough
          </h3>

          <p>
            To make these failure modes precise, consider a system that appears
            to solve the problem using current best practices but does not.
          </p>

          <p>
            A secure camera device contains a Trusted Execution Environment. The
            camera pipeline feeds sensor data into the TEE. Inside the TEE,
            trusted code hashes the image, signs the hash with a
            hardware-protected key, and emits a signed manifest alongside the
            image file. A verifier can confirm that the image was processed by
            trusted code running on authentic hardware. This is a well-designed
            attestation system.
          </p>

          <p>
            Now consider the attack. The adversary does not compromise the TEE.
            Instead, the adversary feeds synthetic frames into the camera
            pipeline&rsquo;s input buffer&mdash;upstream of the TEE, at the
            sensor interface. The TEE faithfully processes the synthetic data: it
            hashes the synthetic image, signs the hash, and emits a valid signed
            manifest. From the verifier&rsquo;s perspective, the attestation is
            correct. Trusted code did execute on authentic hardware. The
            signature is valid. But the image is synthetic.
          </p>

          <p>
            The attestation answered the question it was designed to answer:{" "}
            <em>
              &ldquo;Did trusted code produce this signed output?&rdquo;
            </em>{" "}
            Yes. But the system failed because attestation does not answer a
            different question:{" "}
            <em>
              &ldquo;Could signed output have been produced for content that did
              not originate from the intended source?&rdquo;
            </em>{" "}
            The attested pipeline was not bypassed&mdash;it was correctly
            traversed with adversarial input, because alternative input paths to
            the attested process were not closed.
          </p>

          <p>
            This is not a flaw in the TEE or in the attestation protocol. It is
            a structural gap in the system architecture. The commit
            path&mdash;the path by which authenticated state comes into
            existence&mdash;was not exclusively controlled. The TEE enforced the
            integrity of its own execution but did not enforce that the only way
            to reach authenticated output was through a creation path that
            included genuine sensor capture.
          </p>
        </section>

        {/* 2.2 */}
        <section id="sec-provenance-example">
          <h3 className="text-lg font-semibold mt-10 mb-3">
            <span className="text-[#636a78] mr-2">2.2</span> A Second
            Example: Provenance Without Enforcement
          </h3>

          <p>
            Consider a parallel failure in provenance systems. A photographer
            captures an image with a C2PA-enabled camera. The camera attaches a
            signed content credential manifest describing the capture device,
            timestamp, and edit history. A news platform verifies the manifest
            and publishes the image with provenance intact.
          </p>

          <p>
            A social media platform then ingests the published image, strips the
            C2PA manifest (as most platforms currently do), and redistributes it.
            A downstream consumer receives the image without provenance
            metadata. Under C2PA, the image is now indistinguishable from an
            unsigned image. The provenance was real but impermanent&mdash;it
            depended on the manifest traveling with the artifact through every
            intermediary. When the manifest was stripped, the provenance
            guarantee evaporated.
          </p>

          <p>
            The underlying issue is the same as the camera example: the system
            authenticated an artifact at one point in time but did not
            structurally constrain how authenticated state persists or is
            verified across distribution. Provenance was a property of the
            packaging, not a property of the artifact&rsquo;s relationship to
            its genesis event.
          </p>
        </section>

        {/* 2.3 */}
        <section id="sec-ledger-example">
          <h3 className="text-lg font-semibold mt-10 mb-3">
            <span className="text-[#636a78] mr-2">2.3</span> A Third
            Example: Ledger Registration Without Creation Constraint
          </h3>

          <p>
            Consider a document notarization service backed by a blockchain or
            append-only ledger. A user submits a document hash to the service.
            The service records the hash with a consensus-verified timestamp,
            producing an immutable ledger entry proving that the hash existed at
            a specific time. A verifier can later confirm that the
            document&rsquo;s hash was registered and has not been altered since
            registration.
          </p>

          <p>
            Now consider the gap. The adversary generates a synthetic
            document&mdash;fabricated financial records, a forged legal
            instrument, or AI-generated imagery&mdash;and submits its hash to
            the same notarization service. The ledger faithfully records the hash
            with an accurate timestamp. The notarization is genuine: the hash
            was indeed registered at the stated time. But the document is
            fabricated.
          </p>

          <p>
            The ledger answered the question it was designed to answer:{" "}
            <em>
              &ldquo;Did this hash exist at this time?&rdquo;
            </em>{" "}
            Yes. But it did not answer a different question:{" "}
            <em>
              &ldquo;Was this document produced through an authorized creation
              process?&rdquo;
            </em>{" "}
            The notarization system provides strong <em>history</em>{" "}
            guarantees&mdash;immutability, ordering, non-repudiation of
            registration&mdash;but imposes no constraint on how the artifact
            came into existence before registration. Any content, from any
            source, produced by any process, can be notarized. The creation path
            is uncontrolled.
          </p>

          <p>
            These three examples&mdash;in attestation, provenance, and
            ledger-based notarization&mdash;illustrate the same architectural
            gap from different angles. The security-relevant question is not
            whether a trusted process ran, whether a manifest was attached, or
            whether a hash was recorded. It is whether{" "}
            <em>
              authenticated state is structurally unreachable except through
              authorized creation paths
            </em>
            , and whether that relationship between artifact and genesis can
            survive distribution.
          </p>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 3. DEFINITIONS AND TERMINOLOGY                                   */}
      {/* ================================================================ */}
      <section id="sec-definitions">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">3</span> Definitions and
          Terminology
        </h2>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.1</strong> (Atomic Execution Boundary). A
            protected execution domain that enforces isolation and ordering
            constraints for finalization, such that cryptographic computation,
            authorization, and durable commit occur as one indivisible operation
            or not at all. If the operation fails, no authenticated durable
            artifact is produced.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.2</strong> (Protected Commit Interface). The
            sole interface permitted to finalize authenticated durable state.
            Untrusted code cannot produce authenticated durable state except by
            invoking this interface, which transfers control into the atomic
            execution boundary.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.3</strong> (Boundary-Held Capability). A
            capability available only inside the boundary and required to
            complete authenticated finalization. Possession of data outside the
            boundary is insufficient to reproduce or invoke it.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.4</strong> (Boundary-Fresh Cryptographic
            Computation). Cryptographic computation performed inside the
            boundary using one or more freshness sources (secure randomness,
            monotonic counters, protected clocks, or boundary-internal state),
            such that the resulting output was not available before the
            finalization event and cannot be feasibly reproduced outside the
            boundary. Freshness may be expressed using logical time (epochs or
            counters) or protected physical clocks. No global wall-clock
            synchronization is required.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.5</strong> (Candidate Digital State). Transient,
            internal, mutable representations of content prior to finalization.
            Candidate state may be created freely and may be adversarial.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.6</strong> (Authenticated Durable State).
            Externally visible or persistent digital state whose authenticated
            form includes verification material evidencing enforced finalization
            through a protected commit interface.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.7</strong> (Binding). A cryptographic
            construction that combines boundary-fresh output with a
            content-dependent value (e.g., a hash of the artifact bytes) to
            produce verification material.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.8</strong> (Verification Material). Data bound
            to content and to boundary-fresh output that enables a verifier to
            distinguish authenticated durable state from unauthenticated state
            using pre-distributed trust anchors, without querying an external
            registry of artifacts.
          </p>
        </div>

        <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
          <p>
            <strong>Definition 3.9</strong> (Authorization). Successful use of a
            boundary-held capability via the protected commit interface to
            complete authenticated finalization. Authorization here refers to
            enforced finalization capability, not to post-hoc policy claims
            attached to content.
          </p>
        </div>
      </section>
    </>
  );
}
