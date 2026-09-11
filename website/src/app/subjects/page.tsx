import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { DocsPageNav } from "@/components/docs-page-nav";

export const metadata: Metadata = {
  title: "Use cases",
  description:
    "Where independently verifiable, hardware-attested evidence carries the most weight: regulated finance, government and sovereign AI, multi-party agent workflows, and clinical AI. Your system proves what happened. BitGraph proves where that proof stood.",
  openGraph: {
    title: "BitGraph: Use cases",
    description:
      "Where independently verifiable, hardware-attested evidence carries the most weight: regulated finance, government and sovereign AI, multi-party agent workflows, and clinical AI.",
  },
};

/* 2026-09-10: the page was rewritten around the environments where
   independently verifiable, hardware-backed evidence is worth the most
   (Mike's brief, with a conference slide's four categories as the prompt:
   regulated finance, government and sovereign AI, multi-party agents,
   clinical AI). It replaces the nine "subjects" (photography first) as the
   primary content; those survive as one-liners at the foot. The freeze of
   2026-08-28 is lifted by this rewrite.

   Cut with the rewrite, recoverable from git: the h1 "Trust is expensive.
   Proof isn't." (a sales line; this page now speaks to technical reviewers,
   security architects and regulators), the "Two conditions" selection test
   (superseded by the four environments), and "Proof that appreciates with
   time" (the option framing, investor register).

   One declaration per text role, so the page carries a single body signature
   and the ladder stays visible in one place: h2 22, h3 18, body 16
   (project type ladder). Margins are per-use. */
const pStyle: CSSProperties = { fontSize: 16, lineHeight: 1.75, color: "#1f2937" };
const h2Style: CSSProperties = {
  fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: "0 0 12px",
};
const h3Style: CSSProperties = {
  fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: 0,
};
/* The examples line under each environment: italic, sentence case, a step
   under body (Mike, 2026-09-10: "these type headings should be italic text
   to distinguish"). It read as a tracked uppercase kicker for one evening. */
const kickerStyle: CSSProperties = {
  fontSize: 15, fontStyle: "italic", lineHeight: 1.6,
  color: "#4b5563", margin: "6px 0 12px",
};
const strongStyle: CSSProperties = { color: "#111827", fontWeight: 700 };
/* The seam: the same 1px #e5e7eb hairline .bg-page-nav draws above the trail,
   at the top of each section. 44 above the line, 36 below it. */
const sectionStyle: CSSProperties = { borderTop: "1px solid #e5e7eb", marginTop: 44, paddingTop: 36 };
/* Figures: white, hairline, square, mono. Cards on this site hold data, not
   prose, and a figure is data. */
const figureStyle: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.7, color: "#1f2937",
  background: "#ffffff", border: "1px solid #d0d5dd", borderRadius: 0,
  padding: "14px 18px", margin: "18px 0 22px", overflowX: "auto",
};
const muted: CSSProperties = { color: "#4b5563" };
const faint: CSSProperties = { color: "#9ca3af" };

/* Widow control. The last two words of every paragraph are joined with a
   no-break space so no line can be a single word (Mike, 2026-09-10: "i see a
   bunch of one word orphans"). text-wrap: pretty is deliberately not used on
   long prose (project_type_scale: Safari under-fills early lines); a
   non-breaking space is deterministic in every browser. Inline JSX paragraphs
   carry the same join as &nbsp;. */
const tight = (s: string): string => {
  const i = s.lastIndexOf(" ");
  return i < 0 ? s : s.slice(0, i) + "\u00A0" + s.slice(i + 1);
};

/* Each environment answers the same questions in the same order: where the
   pressure to retain evidence comes from, what fails today, and what a
   BitGraph changes. The `fit` line is deliberately narrow. It says what the
   position adds and stops; "The edge of the claim" below rules out truth,
   identity and correctness for every entry at once. Regulatory regimes are
   named as the source of the pressure, never as something BitGraph satisfies. */
const environments = [
  {
    id: "regulated-finance",
    title: "Regulated finance",
    examples: "AI-assisted trading · loan approval · fraud detection · compliance decisions · cross-bank reconciliation · automated financial workflows",
    pressure:
      "Record-keeping regimes such as MiFID II and SEC Rule 17a-4 treat automated decisions and communications as records that must be retained and produced, and DORA and SR 11-7 ask the same of the systems and models behind them.",
    problem:
      "A signed log or an agent receipt shows what decision was made. The auditor or counterparty who relies on it still has to trust the institution's own infrastructure for the ordering and the history, and that is the party whose conduct is in question.",
    fit:
      "Financial systems already generate receipts, logs, signatures and audit records. BitGraph gives those records a position that cannot be selected after the fact. A completed decision record, receipt, model output, authorization or compliance artifact is hashed and given a position; an auditor or counterparty can then verify that this exact evidence occupied that position and was not inserted later into a more convenient place in the sequence, without relying on the institution that produced it.",
    callout: null as string | null,
  },
  {
    id: "government",
    title: "Government and sovereign AI",
    examples: "policy analysis · benefit determination · security review · administrative decisions · sovereign AI programmes · offline and jurisdiction-restricted environments",
    pressure:
      "Sovereign AI programmes and data-residency rules keep records inside a jurisdiction, and an administrative decision can be challenged long after the vendor contract behind it has ended.",
    problem:
      "Government evidence may need to be inspected years later by an auditor who does not trust, or cannot reach, the vendor or cloud service that produced it. It may also have to stay usable offline.",
    fit:
      "Government evidence may need to outlive the system that produced it. The system keeps its normal signed evidence and adds a BitGraph proof; the artifact never leaves the secure environment, only its digest is recorded. Later, an auditor verifies the artifact and its position independently, without asking BitGraph to validate anything and without the original application vendor. The record stays private or inside its jurisdiction while its proof remains verifiable offline.",
    callout: null as string | null,
  },
  {
    id: "multi-party-agents",
    title: "Multi-party agent workflows",
    examples: "one company's agent acting on another's delegation · agent-to-agent workflows · supply-chain automation · insurers and reinsurers · banks exchanging machine-made decisions",
    pressure:
      "Standard commercial reality: neither party trusts the other's logs, and a dispute is settled by whichever evidence both sides can check.",
    problem:
      "Company A signs a delegation. Company B signs an execution receipt. Both may attest the hardware that ran their agents. What neither record can show is where the two stood relative to each other, and the ordering evidence lives inside one company's infrastructure, which is exactly what the other company does not want to trust.",
    fit:
      "Each delegation, receipt, action manifest or agent trace is BitGraphed on its own, and related artifacts can be made into one BitGraph as a set while each keeps its own identifier. The receipts gain a shared causal coordinate system: either party, or a third-party auditor, can verify the other's evidence and its order without trusting the other's database, and the proof travels with the record. BitGraph verifies the artifact and its position. Whether the delegation was proper or the action correct stays with the systems that signed them.",
    callout: "DELEGATION → POSITION → ACTION → POSITION → RESULT" as string | null,
  },
  {
    id: "clinical-ai",
    title: "Healthcare and clinical AI",
    examples: "clinical decision support · radiology triage · prior authorization · algorithm-assisted review · model governance and change control",
    pressure:
      "Obligations on high-risk AI, HIPAA's audit-control requirement for systems holding patient data, and change-control expectations for AI-enabled medical software all expect a decision to be reconstructable: which model version, policy, authorization and input manifest were in force, and in what order.",
    problem:
      "Clinical AI decisions may have to be reconstructed long after the event. Ordinary logging can be strong, yet it stays under the control of the organization whose history is being audited.",
    fit:
      "Clinical systems keep their signed decision records and add BitGraph positions, which gives later reviewers independent evidence of the order between exact digital states. A decision record, model manifest, authorization or audit artifact gets a portable causal position. The medical data is never published or sent to BitGraph; the proof binds to the digest.",
    callout: null as string | null,
  },
];

/* What a high-assurance system already answers, and the one question it
   cannot answer about itself. */
const layers = [
  { name: "Identity", asks: "who signed or authorized this." },
  { name: "Policy", asks: "what rules governed the action." },
  { name: "Attestation", asks: "what hardware and software environment ran it." },
  { name: "Receipt", asks: "what action or decision occurred." },
  { name: "Transparency and audit", asks: "whether the record was retained or included." },
];

/* What a verifier checks from the copy in hand. Nothing here is fetched. */
const checks = [
  "the artifact digest against the bytes, or against the new file rebuilt from the original and the proof",
  "the signed slot record, and the commitment to it inside the proof",
  "the sequence relationship: the slot was issued before the commit that consumed it",
  "the enclave attestation, chained to the AWS Nitro root, bound to this exact proof",
  "the anchor relationship, where applicable: the Ethereum block the position was placed no earlier than",
];

/* The subjects the page used to lead with, kept as one line each. The
   property is the same wherever exact bytes have to be defended later. */
const others = [
  { title: "Photography and photojournalism", line: "which version the photographer delivered, fixed at a position beside Content Credentials rather than in place of them." },
  { title: "Periodic reporting and attestations", line: "each report takes the next position as it is issued, outside the issuer's control, and a rewritten report no longer matches the position the original held." },
  { title: "Clinical records and chart entries", line: "when a note entered the chart, fixed outside the provider's control; nothing in the chart is disclosed to record it." },
  { title: "Evidence and chain of custody", line: "which file existed before which, with no clock to dispute: a position exists before the file that occupies it." },
  { title: "Issued documents and credentials", line: "a holder presents the document with its proof, and the position is checked without a call back to the issuer." },
  { title: "Instrument and field data", line: "an order that someone who was not present can check; against an outside expectation of what should be there, a gap becomes visible." },
  { title: "Construction and site records", line: "a photo or daily report made on the day holds a position from that day, before any dispute exists." },
  { title: "Drafts, designs and prior art", line: "revisions take later positions, so the development history itself becomes the evidence." },
];

const limits = [
  {
    label: "Truth",
    text: "A recorded document can be wrong in exactly the form it was recorded.",
  },
  {
    label: "Authorship",
    text: "A BitGraph attests the boundary that committed the file's hash, not the person who made the file.",
  },
  {
    label: "First creation",
    text: "The same bytes may have existed elsewhere beforehand. What is fixed is the position they took here.",
  },
];

export default function SubjectsPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      {/* The docs h1 treatment as rendered (2rem/600), inline, matching the
          other docs titles (Mike, 2026-08-05: "should match boldness of other
          docs titles", "needs to match text size"). The route stays /subjects:
          /uses and /applications are burned as permanently cached redirects. */}
      <h1 className="bg-page-title" style={{ marginBottom: "1.25rem" }}>
        Where BitGraph fits
      </h1>

      <p style={{ ...pStyle, marginBottom: 14 }}>
        High-consequence systems already know how to produce evidence. They
        sign receipts, attest the hardware that ran a model, record the policy
        an action fell under, identify the model version, keep delegation
        chains, and build audit trails. Those records can show what happened,
        who authorized it, and what ran&nbsp;it.
      </p>
      <p style={{ ...pStyle, marginBottom: 14 }}>
        What none of them can supply about themselves is where they stood. A
        record&apos;s own timestamp is asserted by whoever wrote it, and its
        place in a log is kept by the party whose history is later in question.
        BitGraph adds that one property: a position issued before the enclave
        had seen the record&apos;s digest, consumed once, and placed no earlier
        than a public Ethereum block. The position cannot be chosen after the&nbsp;fact.
      </p>
      <p style={{ ...pStyle, marginBottom: 14 }}>
        <strong style={strongStyle}>Your system proves what happened. BitGraph proves where that proof&nbsp;stood.</strong>
      </p>
      <p style={{ ...pStyle, marginBottom: 0 }}>
        BitGraph does not replace the receipt, the audit log, the signature or
        the transparency log. It sits beneath them as a portable proof layer,
        and it records only a digest: the record itself never leaves the system that made&nbsp;it.
      </p>

      {/* The four environments. Single column, one anatomy, no grid: a
          left-ruled entry each, the idiom this page has used since 08-26. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Not every record needs a position. These four do.</h2>
        <p style={{ ...pStyle, margin: "0 0 28px" }}>
          Four environments where independently verifiable, hardware-attested
          evidence carries the most weight. Each entry has the same shape:
          where the pressure comes from, what fails today, and what a BitGraph&nbsp;changes.
        </p>

        {environments.map((c, i) => (
          <div
            key={c.id}
            id={c.id}
            className="bg-case"
            style={{
              borderLeft: "2px solid #d0d5dd",
              paddingLeft: 22,
              scrollMarginTop: 72,
              ...(i === environments.length - 1 ? { marginBottom: 0 } : {}),
            }}
          >
            <h3 style={h3Style}>{c.title}</h3>
            <div style={kickerStyle}>{tight(c.examples)}</div>
            <p style={{ ...pStyle, margin: "0 0 12px" }}>
              <strong style={strongStyle}>The pressure.</strong> {tight(c.pressure)}
            </p>
            <p style={{ ...pStyle, margin: "0 0 12px" }}>
              <strong style={strongStyle}>What fails today.</strong> {tight(c.problem)}
            </p>
            <p style={{ ...pStyle, margin: 0 }}>
              <strong style={strongStyle}>What a BitGraph changes.</strong> {tight(c.fit)}
            </p>
            {c.callout && (
              <div style={{ ...figureStyle, margin: "16px 0 0", textAlign: "center", letterSpacing: "0.04em" }}>
                {c.callout}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Where BitGraph sits in the stack. The list is what the reader's own
          system already answers; the figure is the one line BitGraph adds. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>BitGraph does not replace your evidence system</h2>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          A high-assurance system already answers most of the questions an auditor&nbsp;asks.
        </p>
        <ul style={{ margin: "0 0 14px", padding: 0, listStyle: "none" }}>
          {layers.map((l) => (
            <li key={l.name} style={{ ...pStyle, margin: "0 0 4px" }}>
              <strong style={strongStyle}>{l.name}:</strong> {tight(l.asks)}
            </li>
          ))}
        </ul>
        <p style={{ ...pStyle, margin: "0 0 4px" }}>BitGraph adds one:</p>
        <p style={{ ...pStyle, margin: 0 }}>
          <strong style={strongStyle}>Position:</strong> where this exact artifact stood relative to the&nbsp;others.
        </p>

        <div style={figureStyle}>
          <div style={{ fontWeight: 700 }}>YOUR SYSTEM</div>
          <div style={muted}>identity · policy · model · hardware · action · receipt</div>
          <div style={faint}>↓</div>
          <div>exact artifact <span style={muted}>(a SHA-256 digest; the record itself stays home)</span></div>
          <div style={faint}>↓</div>
          <div><span style={{ fontWeight: 700, color: "#0065A4" }}>BITGRAPH</span> <span style={muted}>causal position: slot issued first, digest bound into it, floored by a public block</span></div>
          <div style={faint}>↓</div>
          <div>portable proof <span style={muted}>(travels with the artifact)</span></div>
          <div style={faint}>↓</div>
          <div>independent verifier <span style={muted}>(checks it offline, contacts no one)</span></div>
        </div>

        <p style={{ ...pStyle, margin: 0 }}>
          BitGraph is deliberately narrow. It does not decide whether an action
          was correct. It does not identify the actor. It does not interpret the
          record. It proves that this exact digital state occupied this cryptographically constrained&nbsp;position.
        </p>
      </div>

      {/* Portability. This is the property the four environments rest on. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>The proof travels with the artifact</h2>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          Verification must not require trusting BitGraph as an online
          authority. A proof leaves with the evidence it is about, and a
          verifier checks it from the copy in&nbsp;hand:
        </p>
        <ul style={{ margin: "0 0 14px", paddingLeft: 22 }}>
          {checks.map((c) => (
            <li key={c} style={{ ...pStyle, margin: "0 0 4px" }}>{tight(c)}</li>
          ))}
        </ul>
        <p style={{ ...pStyle, margin: 0 }}>
          Nothing is submitted to BitGraph and nothing is fetched from it. The
          same check runs in <Link href="/docs/recorder">BitGraph Recorder</Link>,
          in <code>npx @mikeargento/bitgraph-audit</code>, and in any verifier
          built from the <Link href="/docs/proof-format">proof&nbsp;format</Link>.
        </p>
      </div>

      {/* Privacy. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Only the digest leaves</h2>
        <p style={{ ...pStyle, margin: 0 }}>
          BitGraph never receives the document, the medical record, the
          financial record, the agent transcript or the confidential evidence.
          It binds a SHA-256 digest. A system whose artifacts cannot leave
          their environment can still give them a position, and a verifier who
          is handed the artifact and its proof needs nothing&nbsp;else.
        </p>
      </div>

      {/* Batching, and the two ways a position reaches bytes. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Many artifacts, one position</h2>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          High-volume systems can make one BitGraph of many artifacts in a
          single operation. Thousands of agent receipts, model execution
          manifests, transaction records, clinical decisions or archival
          objects become one set at one position, and every member keeps its
          own identifier and its own row in the committed manifest, so any one of them can be checked on its&nbsp;own.
        </p>
        <p style={{ ...pStyle, margin: 0 }}>
          <strong style={strongStyle}>Two ways a position reaches bytes.</strong>{" "}
          Recording existing bytes gives them a position: the record existed,
          then it was placed. Making a new artifact around a fresh slot, the
          fused form the <Link href="/docs/what-is-bitgraph">protocol page</Link> describes,
          writes a commitment to that slot into the bytes before they are
          finished, so the final bytes carry a floor of their own. That form
          suits records generated on the spot: agent reports, machine-made
          audit receipts, model outputs, new manifests. The environments above
          need neither distinction; a recorded artifact and a fused one verify the same&nbsp;way.
        </p>
      </div>

      {/* Stating the neighboring claims and ruling them out is the point of
          this section: they are exactly what a reader assumes on their own. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>The edge of the claim</h2>
        <p style={{ ...pStyle, margin: "0 0 16px" }}>
          Every environment above rests on one narrow claim: these exact bytes
          occupied this position in this sequence, and the position was placed
          no earlier than its floor, the Ethereum block named by the anchor
          before it. A reader tends to assume three neighboring claims. None of them&nbsp;follow.
        </p>
        {limits.map((l) => (
          <p key={l.label} style={{ ...pStyle, margin: "0 0 10px" }}>
            <strong style={strongStyle}>{l.label}.</strong> {tight(l.text)}
          </p>
        ))}
        <Link href="/docs/what-bitgraph-is-not" className="bg-action-link">
          What BitGraph is not <span className="arrow">&rarr;</span>
        </Link>
      </div>

      {/* The subjects this page used to lead with, one line each. BitGraph is
          for any bits; the four environments above are where the buyer is. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Other subjects</h2>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          The property is the same wherever exact bytes have to be defended
          later by whoever holds&nbsp;them:
        </p>
        <ul style={{ margin: 0, paddingLeft: 22 }}>
          {others.map((o) => (
            <li key={o.title} style={{ ...pStyle, margin: "0 0 6px" }}>
              <strong style={strongStyle}>{o.title}:</strong> {tight(o.line)}
            </li>
          ))}
        </ul>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>Applying it</h2>
        <p style={{ ...pStyle, margin: "0 0 4px" }}>
          Recording a file needs no integration. BitGraph Recorder hashes the
          file on your Mac and writes the recording beside it, without
          uploading the file itself. Issuing in volume, or recording from
          inside your own systems, is covered in the integration guide; an AI
          agent connects over MCP with one&nbsp;URL.
        </p>
        {/* All at the default size. The primary action is marked by being
            first, which is the rule globals.css already states for
            .bg-action-link: every action is the same size, the primary one is
            marked by position, not by weight. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <Link href="/docs/recorder" className="bg-action-link">
            Record a file <span className="arrow">&rarr;</span>
          </Link>
          <Link href="/docs/integration" className="bg-action-link">
            Integration guide <span className="arrow">&rarr;</span>
          </Link>
          <Link href="/docs/mcp" className="bg-action-link">
            Connect an agent <span className="arrow">&rarr;</span>
          </Link>
          <Link href="/docs/trust-model" className="bg-action-link">
            Trust model <span className="arrow">&rarr;</span>
          </Link>
        </div>
      </div>
      {/* This page is the second stop in the docs sequence but lives outside
          /docs, so the docs layout does not wrap it and it mounts the trail
          itself. Without this the sequence would break in the middle: Overview
          points here, and there would be nothing pointing on. */}
      <DocsPageNav />
    </div>
  );
}
