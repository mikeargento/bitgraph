import { M, MBlock } from "@/components/math";
import { Figure6, Figure7 } from "./figures";

export default function Sections10to19() {
  return (
    <>
      {/* ================================================================ */}
      {/* 10. RELATED WORK */}
      {/* ================================================================ */}
      <section id="sec-related">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">10</span> Related Work
        </h2>

        {/* 10.1 Trusted Execution and Remote Attestation */}
        <section id="sec-tee-attestation">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.1</span> Trusted Execution and Remote Attestation
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Trusted Execution Environments (Intel SGX, ARM TrustZone, AMD SEV, RISC-V Keystone)
            and remote attestation protocols (DICE, RATS/RFC 9334) provide hardware-enforced
            isolation and cryptographic proof that specific code executed in a measured environment.
            These mechanisms establish that a particular software image ran on genuine hardware and
            that its outputs were produced by attested code.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            These systems answer the question: <em>&ldquo;Did specific trusted code execute?&rdquo;</em>{" "}
            BitGraph asks a different question: <em>&ldquo;Is authenticated durable state reachable only
            through enforced commit paths?&rdquo;</em> Attestation authenticates a pipeline. BitGraph
            constrains the commit architecture so that alternative pipelines cannot produce
            authenticated state. TEEs are one possible implementation substrate for BitGraph boundaries,
            but attestation alone does not close unprotected commit paths that exist alongside the
            attested process.
          </p>
        </section>

        {/* 10.2 Content Provenance and Credential Systems */}
        <section id="sec-provenance-systems">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.2</span> Content Provenance and Credential Systems
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            The Coalition for Content Provenance and Authenticity (C2PA) and related provenance
            standards define how to represent claims about an artifact&apos;s origin, edits, and
            attribution, and how to transport that information across tools and platforms. When a
            signed artifact is present, these standards make integrity and lineage verifiable and
            interoperable.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            BitGraph targets a different architectural layer. Provenance standards are a{" "}
            <em>packaging and disclosure layer</em>: they define what claims look like and how to
            verify them. BitGraph is an <em>enforcement layer</em>: it determines whether authenticated
            durable state can be finalized at all unless creation-time conditions were met. The
            distinction matters because provenance ecosystems are voluntary at the edges. A signed
            artifact can be verified, but an unsigned artifact can still be created, circulated, and
            injected into downstream systems that do not strictly require provenance at every
            boundary. Provenance improves traceability without guaranteeing exclusion.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            BitGraph and provenance are complementary. BitGraph strengthens provenance by making provenance
            verifiability a prerequisite for admission into protected domains. Provenance remains the
            interoperability layer that carries claims across ecosystems; BitGraph supplies the mechanism
            by which systems enforce that only authenticated artifacts become trusted durable state.
            Under BitGraph with reference-based verification, provenance survives even when manifests are
            stripped during distribution (see the provenance example in{" "}
            <a href="#sec-provenance-example" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
              Section 2.2
            </a>{" "}
            and the verification model in{" "}
            <a href="#sec-verification-independence" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
              Section 9.5
            </a>).
          </p>
        </section>

        {/* 10.3 Reference Monitors and Access Control */}
        <section id="sec-reference-monitors">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.3</span> Reference Monitors and Access Control
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            The classical reference monitor concept (Anderson, 1972) mediates all operations on
            existing objects: every access is checked against a policy before it is permitted. BitGraph is strictly stronger in one dimension: it controls not merely which{" "}
            <em>operations</em> on objects are permitted, but which{" "}
            <em>objects are permitted to exist</em> in authenticated form. Classical access control
            assumes object creation is uncontrolled and focuses on subsequent access. BitGraph constrains
            creation itself.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            Formally, a reference monitor enforces:
          </p>
          <MBlock c={"\\forall\\, \\mathit{op} \\in \\mathit{Operations},\\; \\forall\\, \\mathit{obj} \\in \\mathit{Objects} : \\mathit{execute}(\\mathit{op}, \\mathit{obj}) \\Rightarrow \\mathit{authorized}(\\mathit{subject}, \\mathit{op}, \\mathit{obj})"} />
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            A genesis monitor (BitGraph) enforces:
          </p>
          <MBlock c={"\\forall\\, s' \\in \\Sigma_{\\text{auth}} : \\exists\\, s \\in \\Sigma,\\; e \\in E_{\\text{auth}} : (s, e, s') \\in \\mathcal{C}"} />
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            The key difference: a reference monitor assumes objects exist and mediates access. A
            genesis monitor constrains which authenticated objects can exist at all. This is{" "}
            <em>mandatory constructor security</em>, analogous to mandatory access control but
            applied to object generation rather than object access.
          </p>
        </section>

        {/* 10.4 Capability-Based Security */}
        <section id="sec-capability">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.4</span> Capability-Based Security
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Object-capability models (Dennis &amp; Van Horn, 1966; Miller, 2006) enforce that access
            to objects requires possession of an unforgeable capability. Membrane patterns in
            capability systems create revocable boundaries around object graphs.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            BitGraph shares the emphasis on structural enforcement through unforgeable references but
            applies it at a different layer. Capabilities control{" "}
            <em>reachability of existing objects</em>. BitGraph controls{" "}
            <em>constructibility of new authenticated state</em>. The boundary-held capability in BitGraph
            is a capability-security mechanism, but the enforcement target&mdash;preventing existence
            rather than preventing access&mdash;distinguishes BitGraph from classical capability models.
          </p>
        </section>

        {/* 10.5 Information Flow Control */}
        <section id="sec-ifc">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.5</span> Information Flow Control
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Mandatory information flow control (Goguen &amp; Meseguer, 1982; Myers &amp; Liskov,
            1997) constrains how information propagates through a system. BitGraph enforces a related but
            distinct property: it constrains how authenticated state is <em>generated</em>, not how
            information flows between existing states. In information flow terms, BitGraph enforces a
            mandatory creation policy: authenticated state can only be generated through specific
            channels (the protected commit interface), analogous to noninterference applied to
            creation rather than observation.
          </p>
        </section>

        {/* 10.6 Blockchain and Distributed Consensus */}
        <section id="sec-blockchain">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.6</span> Blockchain and Distributed Consensus
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Blockchain systems enforce that state changes require consensus among distributed
            participants. The architectural parallel to BitGraph is real: both create structural
            bottlenecks through which state transitions must pass. However, blockchain achieves
            consensus through economic coordination among mutually distrustful parties, while BitGraph
            achieves origin enforcement through boundary isolation and cryptographic causality at a
            single enforcement point. BitGraph generalizes the structural bottleneck principle to
            arbitrary protected boundaries without requiring distributed consensus, economic
            incentives, or global coordination.
          </p>
        </section>

        {/* 10.7 Delay-Tolerant Networking */}
        <section id="sec-dtn">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.7</span> Delay-Tolerant Networking and Interplanetary Protocols
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            The Bundle Protocol (RFC 9171) and DTN architecture provide store-and-forward transport
            for environments with extreme latency and intermittent connectivity. Bundle security
            (BPSec, RFC 9172) provides integrity and confidentiality at the bundle layer but does not
            constrain how authenticated payloads are created&mdash;it secures transport, not genesis.
            BitGraph complements DTN by enforcing that bundle payloads finalized through a protected
            commit interface carry portable verification material validatable offline against
            pre-distributed trust anchors, with no return path to the origin required. BitGraph proofs
            map onto BP extension blocks, enabling authenticated bundles to traverse existing DTN
            infrastructure without routing modifications.
          </p>
        </section>

        {/* 10.8 Summary of Structural Distinctions */}
        <section id="sec-structural-distinctions">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">10.8</span> Summary of Structural Distinctions
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Table 1 summarizes the structural properties that distinguish BitGraph from related
            approaches. Each property is defined by the system invariants and falsifiability tests in{" "}
            <a href="#sec-invariants" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
              Sections 4
            </a>{" "}
            and{" "}
            <a href="#sec-falsifiers" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
              8.3</a>. Entries reflect architectural constraints, not implementation quality.
          </p>

          <div className="overflow-x-auto mb-4">
            <p className="text-xs text-[#636a78] italic mb-2">
              Table 1: Structural property comparison across enforcement paradigms.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e7eb]">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Property</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Digital Signing</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">TEE / Attested Exec.</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Provenance (C2PA)</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Blockchain / Ledger</th>
                  <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">BitGraph</th>
                </tr>
              </thead>
              <tbody className="text-[#1f2937]">
                <tr className="border-b border-[#e5e7eb]">
                  <td className="py-2 pr-4">Enforces creation-path exclusivity</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No<sup>a</sup></td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 font-semibold text-text">Yes</td>
                </tr>
                <tr className="border-b border-[#e5e7eb]">
                  <td className="py-2 pr-4">Prevents post-hoc auth. wrapping</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 font-semibold text-text">Yes</td>
                </tr>
                <tr className="border-b border-[#e5e7eb]">
                  <td className="py-2 pr-4">Binds authorization to commit atomically</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">Partial<sup>b</sup></td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">Partial<sup>c</sup></td>
                  <td className="py-2 font-semibold text-text">Yes</td>
                </tr>
                <tr className="border-b border-[#e5e7eb]">
                  <td className="py-2 pr-4">Proof survives metadata stripping</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">Yes<sup>d</sup></td>
                  <td className="py-2 font-semibold text-text">Yes<sup>e</sup></td>
                </tr>
                <tr className="border-b border-[#e5e7eb]">
                  <td className="py-2 pr-4">Requires registry or ledger infrastructure</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">Yes</td>
                  <td className="py-2 font-semibold text-text">No</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Enforces admission control (not traceability)</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 pr-4">No</td>
                  <td className="py-2 font-semibold text-text">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-xs text-[#636a78] leading-relaxed mb-8 space-y-1">
            <p>
              <sup>a</sup>&thinsp;TEEs attest that trusted code executed but do not close alternative
              commit paths to durable state (
              <a href="#sec-concrete-example" className="underline decoration-border-subtle underline-offset-2">Section 2.1</a>).
            </p>
            <p>
              <sup>b</sup>&thinsp;Authorization and execution are attested, but binding and durable
              commit are typically separate operations.
            </p>
            <p>
              <sup>c</sup>&thinsp;Consensus binds state transitions but does not constrain artifact
              genesis prior to ledger submission.
            </p>
            <p>
              <sup>d</sup>&thinsp;Ledger entries persist independently, but the artifact-to-ledger
              binding is established post-creation.
            </p>
            <p>
              <sup>e</sup>&thinsp;Under reference-based verification (
              <a href="#sec-verification-independence" className="underline decoration-border-subtle underline-offset-2">Section 9.5</a>).
            </p>
          </div>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 11. WORKED EXAMPLES */}
      {/* ================================================================ */}
      <section id="sec-examples">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">11</span> Worked Examples
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          We present two worked examples demonstrating BitGraph in distinct
          domains. In each case, the same architectural pattern applies: candidate data is prepared
          freely; authenticated durable state is produced only through the protected commit interface;
          and any artifact not finalized through the boundary is rejected as unauthenticated.
        </p>

        {/* 11.1 Secure Media Capture */}
        <section id="sec-media-capture">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">11.1</span> Secure Media Capture
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Consider a device capturing photos or video for evidentiary or provenance-sensitive use.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Candidate image or video data is produced by the camera sensor and image processing
            pipeline. This data may exist in memory or temporary buffers. It is not authenticated.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            When a capture is to be finalized, the device invokes the protected commit interface for
            media output. Inside the atomic execution boundary:
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1 mb-4 text-sm text-[#1f2937]">
            <li>A boundary-fresh value <M c="N" /> is generated.</li>
            <li>A hash <M c="H" /> of the media content is computed.</li>
            <li>Verification material is produced by signing over <M c="(H, N)" /> together with device identity and capture metadata.</li>
            <li>Authorization is performed using a boundary-held capability.</li>
            <li>The media file and verification material are committed to durable storage.</li>
          </ol>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Downstream verifiers validate the content hash against the received media, check
            verification material under approved device or platform trust anchors, and enforce any
            applicable policy constraints on capture devices or environments.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Any media not finalized through this boundary cannot produce valid verification material
            and is rejected as unauthenticated&mdash;even if it is visually or byte-identical to an
            authenticated capture. Critically, the system architecture ensures that no other code
            path&mdash;including the application layer, the operating system, or the storage
            subsystem&mdash;can produce artifacts that satisfy verification. The boundary is not
            merely the preferred creation path; it is the only creation path for authenticated media.
          </p>
        </section>

        {/* 11.2 AI Output Export Pipeline */}
        <section id="sec-ai-pipeline">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">11.2</span> AI Output Export Pipeline
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Consider an AI inference service exporting model outputs to downstream consumers.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Candidate outputs are produced by model execution and may exist in memory or temporary
            buffers. They are not authenticated.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            When an output is to be released, the system invokes the protected commit interface for
            output export. Inside the atomic execution boundary:
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1 mb-4 text-sm text-[#1f2937]">
            <li>A boundary-fresh value <M c="N" /> is generated.</li>
            <li>A hash <M c="H" /> of the output is computed.</li>
            <li>Verification material is produced by signing over <M c="(H, N)" /> together with model identity and policy metadata.</li>
            <li>Authorization is performed using a boundary-held capability.</li>
            <li>The output and verification material are committed.</li>
          </ol>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Downstream verifiers validate the content hash, check verification material under
            approved trust anchors, and enforce policy constraints on acceptable model identities
            and metadata.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Any AI output not finalized through this boundary cannot produce valid verification
            material and is rejected as unauthenticated&mdash;even if it is byte-identical to an
            authenticated output. The system architecture ensures that no alternative export
            path&mdash;including direct database writes, API bypasses, or file system
            access&mdash;can produce outputs that satisfy verification. This is particularly
            relevant for regulatory compliance frameworks such as the EU AI Act, which require
            AI-generated content to be identifiable. BitGraph provides an enforcement mechanism rather
            than a voluntary labeling scheme.
          </p>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 12. INSTANTIATIONS */}
      {/* ================================================================ */}
      <section id="sec-instantiations">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">12</span> Instantiations of the Atomic Boundary
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The atomic execution boundary is an architectural abstraction. Concrete implementations
          vary by platform, deployment environment, and assurance requirements. Possible
          instantiations include:
        </p>
        <ul className="space-y-2 mb-4 text-sm text-[#1f2937]">
          <li>&#8226; <strong className="text-text">Device-level TEEs or secure enclaves</strong> gating camera output, sensor release, or local file creation.</li>
          <li>&#8226; <strong className="text-text">Kernel-mediated commit paths</strong> controlling writes to protected namespaces.</li>
          <li>&#8226; <strong className="text-text">HSM-backed services</strong> finalizing logs, media, or datasets in backend systems.</li>
          <li>&#8226; <strong className="text-text">Operating system services</strong> that mediate all protected commit paths, centralizing admission policy and proof generation.</li>
          <li>&#8226; <strong className="text-text">Gateway or pipeline enforcement</strong> at ingestion points where data enters trusted domains.</li>
          <li>&#8226; <strong className="text-text">Secure pipeline stages</strong> in CI/CD or regulated data ingestion workflows.</li>
        </ul>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          These mechanisms differ in construction, but the enforcement invariant is the same:
          authenticated durable state can be finalized only through a protected commit interface that
          performs boundary-fresh cryptographic binding and authorization inside an atomic execution
          boundary.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          What is required is not a particular trust anchor or hardware feature, but structural
          enforcement of finalization ordering and exclusivity. The architecture does not prescribe
          implementations&mdash;it defines the invariant that implementations must satisfy.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          In practical terms, the protected commit interface presents a narrow surface: the caller
          submits candidate content and policy metadata; the boundary performs hashing, binding,
          authorization, and signing internally; and the caller receives the authenticated artifact
          and its verification material (or a confirmation that verification material has been stored
          at a reference point keyed by content hash). The caller never handles signing keys, never
          observes intermediate cryptographic state, and cannot influence the boundary-fresh value.
          Whether this interface is realized as a system call, a hardware enclave entry point, an HSM
          API, or a cloud service endpoint, the enforcement properties are identical.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph does not prevent the construction of unauthorized boundaries. Any party can build a
          boundary and produce verification material. However, artifacts produced by unauthorized
          boundaries fail verification under accepted trust anchors, because those boundaries&apos;
          identities are not in the approved set. Trust is mediated by trust anchor policy, not by
          preventing the existence of alternative boundaries.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          In practice, layered deployment is common. A device may generate creation-time verification
          material, while a gateway enforces admission policy and rejects unauthenticated artifacts.
          Both layers implement the same enforcement principle at different points in the system.
        </p>

        {/* 12.1 Enforcement Tier Semantics */}
        <section id="sec-enforcement-tiers">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">12.1</span> Enforcement Tier Semantics
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Concrete instantiations of the atomic execution boundary differ in the strength of the
            enforcement guarantee they provide. Not all boundaries are equivalent: a software
            boundary running in process memory and a hardware enclave with remote attestation both
            produce cryptographically valid verification material, but they provide fundamentally
            different assurance that the enforcement invariants actually held. This distinction must
            be made explicit in the proof structure itself.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            BitGraph proofs carry two orthogonal attestations. The first is a{" "}
            <em>cryptographic attestation</em>: the signature and public key establish who signed and
            that the signed content was unaltered. This is machine-checkable by any party with the
            public key and is unconditionally verifiable offline. The second is an{" "}
            <em>enforcement attestation</em>: the boundary&apos;s identity measurement and optional
            platform attestation report establish <em>under what conditions</em> signing was
            permitted&mdash;whether the commit gate, key management, nonce generation, and signing
            occurred inside a verified hardware boundary or merely inside a software process. Atomic
            causality lives in the second attestation, not the first. A signature proves who signed;
            the enforcement context proves whether the creation-time constraints of BitGraph actually
            held.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Three enforcement tiers capture the practically relevant points in this assurance space:
          </p>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-[#111827] leading-relaxed mb-3">
              <strong>Definition 12.1</strong> (Enforcement Tiers). Let <M c="B" /> be a boundary
              implementation. The <em>enforcement tier</em> of <M c="B" /> is a declaration of the
              structural properties of its atomic execution boundary:
            </p>
            <ul className="space-y-3 text-sm text-[#1f2937]">
              <li>
                <strong className="text-text">Software-only</strong> (<M c={"\\tau_{\\text{sw}}"} />).
                The commit gate, signing key, nonce source, and counter are all held in ordinary
                process memory. No hardware isolation separates them from application code. The
                signing key may be extractable by any code with sufficient privilege. Verification
                material is cryptographically valid but provides no hardware boundary guarantee.
                Suitable for development and integration testing; does not satisfy the Boundary
                Isolation invariant (Definition 4.1) against a privileged-process adversary.
              </li>
              <li>
                <strong className="text-text">Hardware-bound key</strong> (<M c={"\\tau_{\\text{hw}}"} />).
                The signing key is held in a hardware security boundary (Secure Enclave, TPM, HSM)
                and is non-exportable. However, the commit gate&mdash;the logic that decides which
                candidate data is eligible for signing&mdash;runs outside the measured boundary. The
                host process feeds content digests to the hardware for signing; the hardware signs
                whatever it is asked. This provides hardware-bound identity: the signing key cannot be
                extracted, so signatures are unforgeable. But it does not provide causal enforcement:
                a compromised host can submit arbitrary digests and receive valid signatures without
                passing through the protected commit interface. The enforcement invariant holds for
                key security but not for commit-path exclusivity.
              </li>
              <li>
                <strong className="text-text">Measured TEE</strong> (<M c={"\\tau_{\\text{tee}}"} />).
                The commit gate, key management, nonce generation, monotonic counter, and signing all
                execute inside the attested enclave boundary. The host is treated as untrusted and
                cannot influence the commit decision or observe intermediate cryptographic state. The
                enclave&apos;s identity is a hardware-measured value&mdash;a cryptographic hash of the
                enclave binary computed by the hardware boot chain&mdash;that cannot be forged by
                user-space code or produced by a different binary. A verifier who pins acceptable
                measurements to a known-good enclave image and validates the attestation report is
                guaranteed, under the hardware trust model, that the enforcement invariants held at
                genesis.
              </li>
            </ul>
          </div>

          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            A critical subtlety distinguishes tamper-evidence from self-authentication. The
            enforcement tier is included in the signed body of every BitGraph proof, making it
            tamper-evident in transit: an adversary who intercepts a proof and attempts to substitute
            a higher-assurance tier will break the signature. However, the tier field is{" "}
            <em>self-reported</em> by the boundary adapter. A malicious or misconfigured adapter can
            declare any tier. The signed field prevents downgrade attacks during transmission; it
            does not prevent a lying producer.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Actual trust in a declared tier therefore requires independent corroboration.
            For <M c={"\\tau_{\\text{tee}}"} />, this means: (1) pinning acceptable measurements to
            a known-good enclave image hash published by the boundary operator or auditor, and (2)
            validating a hardware attestation report&mdash;a vendor-signed document generated by the
            hardware itself, bound to the specific commit, that certifies the enclave measurement
            matches a known image. Signature verification establishes cryptographic integrity.
            Measurement pinning establishes identity. Attestation report validation establishes that
            the identity was produced by real hardware under the declared conditions. All three are
            necessary; any two leave a gap. A verifier who checks the signature and trusts the
            self-reported tier without verifying measurement and attestation has verified fact
            (A)&mdash;who signed&mdash;but not fact (B)&mdash;whether the BitGraph invariants actually
            held.
          </p>

          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-[#1f2937] leading-relaxed">
              <strong className="text-text">Remark 12.2</strong> (Hardware-Bound Key is Not Causal
              Enforcement). The <M c={"\\tau_{\\text{hw}}"} /> tier corresponds to devices such as
              mobile Secure Enclaves, TPMs, or HSMs where the signing key is hardware-protected but
              the commit gate runs in application code. Such systems provide meaningful security
              against key extraction&mdash;an adversary cannot steal the private key&mdash;but do not
              satisfy commit-path exclusivity. Application code feeding arbitrary digests to the
              hardware signer can produce valid signatures for any content without traversal of the
              protected commit interface. This is useful as an identity anchor and may be sufficient
              for some deployment contexts, but it is architecturally distinct
              from <M c={"\\tau_{\\text{tee}}"} /> and does not satisfy BitGraph&apos;s Atomic Causality
              invariant (Definition 6.1) against a compromised-host adversary.
            </p>
          </div>

          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            This taxonomy is not a quality ranking among implementations&mdash;a{" "}
            <M c={"\\tau_{\\text{sw}}"} /> boundary is fully correct for development environments
            where the adversary model does not include privileged process access. It is a structural
            classification that makes the adversary model explicit in the proof itself. Verifiers
            select the tier they require based on their own threat model. A local development tool
            may accept <M c={"\\tau_{\\text{sw}}"} />. A regulated ingestion gateway may
            require <M c={"\\tau_{\\text{tee}}"} /> with measurement pinning and attestation
            validation. The same proof format and verification protocol supports all three, with
            enforcement strength determined by verifier policy rather than proof format version.
          </p>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 13. ADMISSION OF PRE-EXISTING DATA */}
      {/* ================================================================ */}
      <section id="sec-admission">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">13</span> Admission of Pre-Existing Data
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph defines authenticity in terms of enforced finalization events,
          not in terms of historical existence of content bytes.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Candidate data may exist prior to authenticated finalization and may be externally sourced,
          duplicated, replayed, or synthesized. Such prior existence is outside the trust model and
          carries no authenticity semantics.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Authenticated durable state is created only when candidate data is finalized through the
          protected commit interface and bound to boundary-fresh cryptographic output produced inside
          the atomic execution boundary. Without this enforced finalization event, no artifact can
          enter authenticated state, regardless of its prior history or method of creation.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The same content may be finalized multiple times in separate authorization events, each
          producing distinct verification material. Each such event constitutes an independent
          origin&mdash;a distinct enforced admission into authenticated durable state.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Authenticity therefore reflects structural reachability through enforced commit paths, not
          claims about when or how content bytes first came into existence.
        </p>

        {/* 13.1 Enforced Provenance Chains */}
        <section id="sec-provenance-chains">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">13.1</span> Enforced Provenance Chains
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            When content traverses multiple BitGraph-enforced boundaries, each boundary produces
            independent verification material for the same content. The result is a structurally
            enforced provenance chain: an ordered sequence of admission events, each
            cryptographically bound to the content at its respective boundary. Unlike voluntary
            provenance annotations, each link in this chain is the product of an enforced
            finalization event and could not have been produced without traversing the corresponding
            boundary.
          </p>

          {/* Figure 6: Enforced Provenance Chains */}
          <div className="my-6 border border-[#e5e7eb] bg-[#f9fafb] p-5">
            <Figure6 />
            <p className="text-xs text-[#636a78] italic text-center mt-3">
              <strong>Figure 6.</strong> Enforced provenance chains. Pre-existing content traverses
              multiple BitGraph boundaries, each producing independent verification material. Each
              admission is a separate enforced finalization event. The resulting chain is structurally
              guaranteed&mdash;not voluntarily annotated&mdash;because each link requires traversal of
              a protected commit interface.
            </p>
          </div>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 14. IMPLEMENTATION CONSIDERATIONS */}
      {/* ================================================================ */}
      <section id="sec-implementation">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">14</span> Implementation Considerations
        </h2>

        <h3 className="text-base font-semibold mt-6 mb-2">Latency.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Creation-time enforcement must be fast enough to run on capture and export paths without
          degrading user experience or pipeline throughput. Efficient proof generation and
          verification are engineering constraints, not architectural limitations. Modern signing
          operations (Ed25519, ECDSA P-256) complete in microseconds on current hardware.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Offline operation.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Environments requiring offline creation can generate proofs locally and defer admission
          into trusted domains until connectivity is available. Trusted domains then enforce
          verification at ingestion. This provides bounded issuance guarantees rather than continuous
          supervision&mdash;analogous to how physical secure instruments (e.g., pre-signed checks)
          operate with deferred clearing. In extreme cases&mdash;interplanetary missions, remote
          sensor networks, or disconnected autonomous systems&mdash;offline operation may span hours
          to days, with proofs verified only upon eventual receipt at a ground station or gateway
          operating under the same trust anchors.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Failure handling.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Systems must define failure behavior. For high-assurance domains, fail-closed behavior is
          required: if proof generation fails, finalization is blocked. For consumer deployments,
          staged enforcement may begin with fail-open at selected boundaries and evolve toward
          fail-closed as operational confidence increases.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Verification material formats and transport.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Verification material may be embedded within the artifact, carried in a sidecar file,
          included in a bundle manifest, transmitted as an authenticated envelope, or held at a
          reference point for query-based verification (see{" "}
          <a href="#sec-verification-independence" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
            Section 9.5
          </a>). The key requirement is that verification material is bound to the artifact in a way
          that can be validated independently and cannot be retroactively attached without detection.
          The choice of transport mechanism is a deployment decision; the enforcement invariant is
          the same regardless of how verification material reaches the verifier.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Key rotation and revocation.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Operational deployments require key rotation policies and revocation mechanisms. When a
          boundary is compromised, trust anchors can be revoked or rotated, new boundary identities
          introduced, and epoch constraints enforced on acceptable verification material. No artifact
          registry is required for rotation or recovery.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Interoperability with provenance systems.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph coexists with provenance and credentialing systems that focus on post-creation
          traceability. Provenance chains can be attached to artifacts finalized under BitGraph, providing
          richer downstream traceability. The admission decision remains anchored in enforced
          finalization, while provenance provides the interoperability layer for distribution and
          audit.
        </p>
      </section>

      {/* ================================================================ */}
      {/* 15. DEPLOYMENT AND ADOPTION */}
      {/* ================================================================ */}
      <section id="sec-deployment">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">15</span> Deployment and Adoption
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph is best understood as an enforcement primitive that can be
          introduced incrementally. Most environments cannot transition from fully permissive
          creation to strict admissibility in a single step.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Phased rollout.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          A practical deployment begins with visibility: attaching verification material when
          available and surfacing authenticated versus unauthenticated status. The next phase
          requires authenticated finalization for selected high-assurance workflows while allowing
          unauthenticated outputs in a separate untrusted lane. Over time, enforcement expands to
          additional repositories, export paths, and regulated domains. Each phase requires
          engineering integration with existing commit paths, and the phased model is designed to
          contain this cost by limiting initial enforcement to high-value boundaries.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Policy-driven boundaries.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The decisive question in most deployments is not whether an artifact can be produced, but
          whether it can be admitted into a domain that confers legitimacy, downstream impact, or
          compliance standing. BitGraph can be applied selectively at these boundaries: ingestion into
          training corpora, publication to official channels, archival in compliance systems, or
          persistence into audit-grade logs.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">Institutional adoption incentives.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Adoption is accelerated when benefits are concrete: reduced downstream moderation burden,
          improved auditability, clearer liability boundaries, and the ability to define and enforce
          admissible content policies. In high-volume environments, the ability to reject
          unauthenticated artifacts at ingestion is more valuable than attempting to detect or
          classify them after the fact. Organizations already subject to compliance
          mandates&mdash;regulated data processors, evidentiary systems, and entities operating under
          frameworks such as the EU AI Act&mdash;are natural early adopters, as they face the
          strongest immediate demand for structural authenticity guarantees.
        </p>

        <h3 className="text-base font-semibold mt-6 mb-2">End state.</h3>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The end state is not universal prevention of unauthenticated creation, but reliable
          exclusion of unauthenticated durable state from the systems and pipelines where legitimacy,
          compliance, and downstream impact are determined.
        </p>
      </section>

      {/* ================================================================ */}
      {/* 16. APPLICATIONS */}
      {/* ================================================================ */}
      <section id="sec-applications">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">16</span> Applications
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph applies wherever systems must distinguish admissible durable
          outputs from arbitrary durable outputs produced outside trusted pipelines. The common
          architectural pattern is a protected commit path that gates admission into authenticated
          durable state. The pattern arises across domains:
        </p>
        <ol className="list-decimal list-outside ml-5 space-y-2 mb-4 text-sm text-[#1f2937]">
          <li><strong className="text-text">AI training and inference pipelines</strong>, where only authenticated outputs may be admitted into datasets or downstream automation.</li>
          <li><strong className="text-text">Media capture and evidentiary systems</strong>, where admissibility depends on verified creation conditions.</li>
          <li><strong className="text-text">Compliance logging and telemetry</strong>, where audit records must resist post-hoc fabrication.</li>
          <li><strong className="text-text">Scientific instruments and simulations</strong>, where experimental results must be traceable to controlled execution environments.</li>
          <li><strong className="text-text">Regulated data processing</strong> in finance, healthcare, safety monitoring, and government systems.</li>
          <li><strong className="text-text">Digital identity and credential issuance</strong>, where credentials must be structurally unforgeable.</li>
          <li><strong className="text-text">Supply chain verification</strong>, where provenance must be enforced at each handoff rather than reconstructed afterward.</li>
          <li>
            <strong className="text-text">Authorization transfer and ledger-independent scarcity</strong>,
            where transfer of digital value or authority is enforced by a single atomic transition
            that both irreversibly de-authorizes the sender capability and generates the receiver
            capability within a protected execution boundary. This is a direct application of the
            birth&ndash;death semantics described in{" "}
            <a href="#sec-birth-death" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
              Section 17
            </a>: the prior authority undergoes verifiable death, and the successor undergoes
            verifiable birth, within a single atomic event. This preserves scarcity invariants
            structurally and implies double-spend resistance without global ledgers, distributed
            consensus, or registry-based settlement infrastructure. The settlement and monetary
            implications are substantial and are explored separately.
          </li>
          <li>
            <strong className="text-text">Interplanetary and delay-tolerant systems</strong>, where
            authentication must be non-interactive, verification must occur offline, and proofs must
            travel with data across store-and-forward networks with minutes-to-hours latency.
            BitGraph&apos;s non-interactive finalization, compact portable proofs, and hardware-rooted
            trust align with the operational constraints of DTN/Bundle Protocol environments, where
            real-time protocols, centralized registries, and consensus mechanisms are infeasible.
          </li>
        </ol>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Across these domains, trust derives from enforced admission into authenticated state at
          commit time, not from retrospective provenance reconstruction. When admissibility matters,
          origin enforcement necessarily moves into the creation and finalization paths of the system.
        </p>
      </section>

      {/* ================================================================ */}
      {/* 17. BIRTH-DEATH SEMANTICS */}
      {/* ================================================================ */}
      <section id="sec-birth-death">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">17</span> Birth&ndash;Death Semantics
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph enforces what we term <em>birth&ndash;death
          semantics</em> for digital state. Under this model, every authoritative state transition
          has exactly one verifiable moment of creation (birth), and every transfer or succession
          requires cryptographic evidence that the prior authority has been irreversibly consumed
          (death).
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Traditional provenance systems operate in a <em>detect-after</em> model: artifacts are
          produced freely, and conflicts such as replay, duplication, or double-spend are identified
          retrospectively through logs, ledgers, or consensus. BitGraph instead constrains the execution
          path such that invalid successor states are structurally unreachable within the enforcing
          boundary.
        </p>

        {/* Figure 7: Birth-Death Semantics */}
        <div className="my-6 border border-[#e5e7eb] bg-[#f9fafb] p-5">
          <Figure7 />
          <p className="text-xs text-[#636a78] italic text-center mt-3">
            <strong>Figure 7.</strong> Detect-after vs. birth&ndash;death enforcement. Traditional
            systems (left) permit both successor states to be produced and detect conflicts
            retrospectively. Under birth&ndash;death semantics (right), the prior authority is
            irreversibly consumed within the atomic boundary, and exactly one successor is committed.
            The alternative fork is not merely unlikely&mdash;it is structurally unreachable within
            the enforcing boundary.
          </p>
        </div>

        {/* 17.1 Construction */}
        <section id="sec-bd-construction">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">17.1</span> Construction
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Within a verifier-accepted measured boundary (e.g., a Trusted Execution Environment or
            equivalent protected constructor), a valid BitGraph commit requires the atomic execution of
            the following steps:
          </p>
          <ul className="space-y-2 mb-4 text-sm text-[#1f2937]">
            <li>&#8226; Policy authorization of the requested operation</li>
            <li>&#8226; Generation and atomic consumption of a fresh, non-replayable commitment value (either an unpredictable nonce or a strictly monotonic counter)</li>
            <li>&#8226; Collision-resistant binding of the artifact digest to the consumed value</li>
            <li>&#8226; Durable commit of the resulting signed proof</li>
          </ul>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            No intermediate state is externally observable, and partial completion yields no valid
            proof. The consumed value establishes a forward-only lineage: any valid successor must
            reference a strictly later state within the boundary&apos;s monotonic domain.
          </p>
        </section>

        {/* 17.2 Single-Successor Property */}
        <section id="sec-bd-single-successor">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">17.2</span> Single-Successor Property
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Given correct enforcement of measurement and monotonicity within the boundary, BitGraph
            guarantees:
          </p>
          <div className="my-5 border-l-[3px] border-text-tertiary bg-[#f9fafb] p-5">
            <p className="text-sm text-[#111827] leading-relaxed">
              <strong>Property (Single-Successor).</strong> At most one valid successor can be
              produced from any given parent authority within the verifier-accepted measurement and
              monotonicity domain of the enforcing boundary.
            </p>
          </div>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            If two purported successors are observed downstream, at least one of the following must
            hold:
          </p>
          <ul className="space-y-2 mb-4 text-sm text-[#1f2937]">
            <li>&#8226; The enforcing boundary was compromised or misconfigured</li>
            <li>&#8226; Monotonic state or anti-rollback guarantees were violated</li>
            <li>&#8226; The verifier accepted an out-of-policy measurement</li>
            <li>&#8226; The usage context exceeded the declared trust model</li>
          </ul>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            This reframes failure analysis from probabilistic conflict resolution to deterministic
            boundary integrity verification.
          </p>
        </section>

        {/* 17.3 Relationship to Double-Spend */}
        <section id="sec-bd-double-spend">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">17.3</span> Relationship to Double-Spend
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Birth&ndash;death semantics targets the core primitive underlying double-spend failures:
            the ability to produce multiple valid successor states from a single authority. By making
            such forks structurally unreachable at commit time within the stated trust envelope, BitGraph
            reduces reliance on global ordering for single-holder and provenance-sensitive workflows.
          </p>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            BitGraph does not claim global uniqueness across mutually distrustful, permissionless
            environments without additional coordination. Instead, it provides strong local authority
            guarantees that higher-level systems may compose with federation or consensus where global
            agreement is required.
          </p>
        </section>

        {/* 17.4 Trust Envelope */}
        <section id="sec-bd-trust-envelope">
          <h3 className="text-lg font-semibold mt-8 mb-3">
            <span className="text-[#636a78] mr-2">17.4</span> Trust Envelope
          </h3>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-2">
            The guarantees above hold only within the verifier-accepted measurement and monotonicity
            domain of the enforcing boundary. In particular:
          </p>
          <ul className="space-y-2 mb-4 text-sm text-[#1f2937]">
            <li>&#8226; A protected execution boundary is required for enforcement</li>
            <li>&#8226; Monotonic state must be resistant to rollback within that boundary</li>
            <li>&#8226; Verifiers must enforce measurement policy and counter monotonicity</li>
            <li>&#8226; BitGraph does not prevent byte-level copying of artifacts outside the authority model</li>
          </ul>
          <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
            Within this envelope, birth&ndash;death semantics converts post-facto detection problems
            into construction-time exclusion properties.
          </p>
        </section>
      </section>

      {/* ================================================================ */}
      {/* 18. SINGLE-TRANSFER VALUE WITHOUT CONSENSUS */}
      {/* ================================================================ */}
      <section id="sec-value-transfer">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">18</span> Single-Transfer Value Without Consensus
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          BitGraph enables single-transfer digital value by binding
          authority to a consumptive, cryptographically enforced state transition rather than to a
          ledger entry. This is a concrete instantiation of the birth&ndash;death semantics
          described in{" "}
          <a href="#sec-birth-death" className="text-[#111827] underline decoration-border-subtle underline-offset-2">
            Section 17
          </a>: each transfer atomically consumes (kills) the prior holder&apos;s authority and
          produces (births) a new verifiable successor. Each artifact carries a proof that can only
          be produced through a protected commit path, where authorization, binding, and durable
          commit occur atomically inside a trusted execution boundary. When value is transferred, the
          prior holder&apos;s permission is provably consumed and the new state is independently
          verifiable offline using public keys and hash lineage. The bytes themselves may be copied,
          but the authoritative right cannot be duplicated, because the single-successor property
          guarantees that only one unspent lineage can exist at a time within the enforcing boundary.
          In this model, uniqueness and transfer integrity come from enforced execution semantics
          instead of global consensus, allowing blockchain-free, verifiable digital handoff.
        </p>
      </section>

      {/* ================================================================ */}
      {/* 19. CONCLUSION */}
      {/* ================================================================ */}
      <section id="sec-conclusion">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          <span className="text-[#636a78] mr-2">19</span> Conclusion
        </h2>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The Trusted Origin Token Architecture demonstrates that origin control can be enforced by
          consuming authorization units at finalization. BitGraph generalizes
          this result by showing that equivalent enforcement is achieved using boundary-fresh
          cryptographic computation and protected commit paths, without requiring tracked tokens.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          Atomic Causality links authorization, cryptographic binding, and durable commit into a
          single indivisible event. Authenticated durable state is defined by structural
          reachability&mdash;by the state transitions that produced it&mdash;not by historical
          claims, metadata, or post-hoc annotation.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          The formal model presented here shows that BitGraph defines a new enforcement primitive: a{" "}
          <em>genesis access control mechanism</em> that constrains which authenticated objects are
          permitted to exist, rather than mediating operations on objects that already exist. This is
          strictly stronger than classical reference monitors and formally distinct from attested
          execution, information flow control, and capability-based security.
        </p>
        <p className="text-sm text-[#1f2937] leading-relaxed mb-4">
          By securing creation rather than history, BitGraph establishes an
          architectural primitive for trustworthy digital systems. It does not replace provenance,
          verification, or access control. It provides the structural foundation that makes those
          mechanisms enforceable at the boundaries where legitimacy is conferred.
        </p>
      </section>

      {/* ================================================================ */}
      {/* REFERENCES */}
      {/* ================================================================ */}
      <section id="sec-references">
        <h2 className="text-xl font-semibold mt-12 mb-4">
          References
        </h2>
        <div className="space-y-2.5 text-sm text-[#1f2937] leading-relaxed">
          <p className="pl-7 -indent-7">
            [1] J.&thinsp;P. Anderson, &ldquo;Computer security technology planning study,&rdquo;
            Tech. Rep. ESD-TR-73-51, Electronic Systems Division, AFSC, 1972.
          </p>
          <p className="pl-7 -indent-7">
            [2] W.&thinsp;Y. Arms, &ldquo;Digital libraries,&rdquo; MIT Press, 2000.
          </p>
          <p className="pl-7 -indent-7">
            [3] Coalition for Content Provenance and Authenticity (C2PA), &ldquo;C2PA Technical
            Specification v2.1,&rdquo; 2024.
          </p>
          <p className="pl-7 -indent-7">
            [4] V. Costan and S. Devadas, &ldquo;Intel SGX explained,&rdquo; IACR Cryptology ePrint
            Archive, Report 2016/086, 2016.
          </p>
          <p className="pl-7 -indent-7">
            [5] J.&thinsp;B. Dennis and E.&thinsp;C. Van Horn, &ldquo;Programming semantics for
            multiprogrammed computations,&rdquo; <em>Communications of the ACM</em>,
            vol.&thinsp;9, no.&thinsp;3, pp.&thinsp;143&ndash;155, 1966.
          </p>
          <p className="pl-7 -indent-7">
            [6] Trusted Computing Group, &ldquo;DICE Layered Architecture,&rdquo; 2020.
          </p>
          <p className="pl-7 -indent-7">
            [7] J.&thinsp;A. Goguen and J. Meseguer, &ldquo;Security policies and security
            models,&rdquo; in <em>Proc. IEEE Symposium on Security and Privacy</em>,
            pp.&thinsp;11&ndash;20, 1982.
          </p>
          <p className="pl-7 -indent-7">
            [8] T.&thinsp;J. Green, G. Karvounarakis, and V. Tannen, &ldquo;Provenance
            semirings,&rdquo; in <em>Proc. ACM SIGMOD-SIGACT-SIGART Symposium on Principles of
            Database Systems (PODS)</em>, pp.&thinsp;31&ndash;40, 2007.
          </p>
          <p className="pl-7 -indent-7">
            [9] IETF, &ldquo;Remote ATtestation procedureS (RATS) Architecture,&rdquo; RFC 9334,
            2023.</p>
          <p className="pl-7 -indent-7">
            [10] C.&thinsp;B. Jones, &ldquo;Tentative steps toward a development method for
            interfering programs,&rdquo; <em>ACM Transactions on Programming Languages and
            Systems</em>, vol.&thinsp;5, no.&thinsp;4, pp.&thinsp;596&ndash;619, 1983.
          </p>
          <p className="pl-7 -indent-7">
            [11] B.&thinsp;W. Lampson, &ldquo;Protection,&rdquo; in <em>Proc. 5th Princeton
            Symposium on Information Sciences and Systems</em>, pp.&thinsp;437&ndash;443, 1971.
          </p>
          <p className="pl-7 -indent-7">
            [12] M.&thinsp;S. Miller, &ldquo;Robust composition: Towards a unified approach to
            access control and concurrency control,&rdquo; Ph.D. dissertation, Johns Hopkins
            University, 2006.
          </p>
          <p className="pl-7 -indent-7">
            [13] A.&thinsp;C. Myers and B. Liskov, &ldquo;A decentralized model for information flow
            control,&rdquo; in <em>Proc. 16th ACM Symposium on Operating Systems Principles
            (SOSP)</em>, pp.&thinsp;129&ndash;142, 1997.
          </p>
          <p className="pl-7 -indent-7">
            [14] G.&thinsp;C. Necula, &ldquo;Proof-carrying code,&rdquo; in <em>Proc. 24th ACM
            SIGPLAN-SIGACT Symposium on Principles of Programming Languages (POPL)</em>,
            pp.&thinsp;106&ndash;119, 1997.
          </p>
          <p className="pl-7 -indent-7">
            [15] S. Burleigh, K. Fall, and V. Cerf, &ldquo;Delay-Tolerant Networking
            Architecture,&rdquo; RFC 4838, 2007.
          </p>
          <p className="pl-7 -indent-7">
            [16] K. Scott, S. Burleigh, et&thinsp;al., &ldquo;Bundle Protocol Version 7,&rdquo;
            RFC 9171, 2022.
          </p>
          <p className="pl-7 -indent-7">
            [17] E. Birrane III and K. McKeever, &ldquo;Bundle Protocol Security (BPSec),&rdquo;
            RFC 9172, 2022.
          </p>
        </div>
      </section>
    </>
  );
}
