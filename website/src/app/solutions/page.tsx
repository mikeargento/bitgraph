import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "Where causal ordering carries weight: photography, issued documents, periodic reporting, evidence, instrument data, and drafts.",
  openGraph: {
    title: "BitGraph: Solutions",
    description:
      "Where causal ordering carries weight: photography, issued documents, periodic reporting, evidence, instrument data, and drafts.",
  },
};

/* Each entry answers three questions in the order a buyer actually asks them:
   who is protecting something, what specifically fails today, and what a
   BitGraph changes about it. The `changes` line is deliberately narrow. It
   states the new capability and stops, so no entry drifts into claiming truth,
   authorship or first creation, which the closing section then rules out
   explicitly. Ordered by how close each one is to a real buyer today: photos
   first because that is the shipped product, issuing authorities second
   because that is the commercial lead. */
const cases = [
  {
    title: "Photography and photojournalism",
    who: "Photographers, picture desks, wire agencies",
    body:
      "A photograph's origin cannot be established from the file. Metadata is editable, and a re-encode or a crop produces different bytes, so anything bound to the old bytes stops matching. Content Credentials (C2PA) sign an editing history into the file itself, which is strong evidence of a signing chain, but it travels inside the same bytes it describes and is lost the moment a platform re-encodes the image.",
    changes:
      "A BitGraph is external to the file. The exact bytes are bound to a position reserved before those bytes were known, so a photographer can show that this frame, in exactly this form, held that position. It sits alongside C2PA rather than replacing it: the manifest says how the image was made, the BitGraph says where it landed.",
  },
  {
    title: "Issued documents and credentials",
    who: "Registrars, universities, licensing boards, certifying labs",
    body:
      "An authority's value rests on the artifacts it issues being distinguishable from artifacts that merely look like them. Today that distinction usually depends on calling the issuer back, which does not scale, or on visual security features, which are a manufacturing problem rather than a cryptographic one.",
    changes:
      "Every issued document takes a position in the issuer's own sequence at the moment it is issued. A holder presents the document, and anyone can check the position without contacting the issuer. What is being preserved is the authority's ability to issue, which is why the buyer here is the authority itself.",
  },
  {
    title: "Periodic reporting and attestations",
    who: "Reserve reports, regulatory filings, compliance statements",
    body:
      "For a recurring report, the interesting question is rarely whether today's numbers are correct. It is whether the report existed in exactly this form before the events it is later measured against, and whether any report in the series was quietly replaced or omitted after the fact.",
    changes:
      "Each report consumes the next position in a sequence, and the sequence is anchored to Ethereum, so positions are fixed in a public timeline the issuer does not control. A missing period shows up as a gap, and a rewritten report will not match the position it claims.",
  },
  {
    title: "Evidence and chain of custody",
    who: "Investigators, legal teams, internal audit",
    body:
      "Custody disputes are usually about order rather than content: which file existed before which, and whether an item entered the record before or after a claim was made. A file's own timestamp is asserted by whoever holds the file, and system clocks are adjustable.",
    changes:
      "Ordering does not depend on any clock. A slot exists before the file that fills it, so a proof cannot be constructed backwards into the sequence, and each Ethereum anchor seals everything committed before it. Time is subjective. The order is not.",
  },
  {
    title: "Instrument and field data",
    who: "Laboratories, sensor networks, survey and inspection work",
    body:
      "Readings are trusted because of the process that produced them, and that trust is hard to carry outside the organisation that ran the process. Once data leaves the instrument, a downstream reader cannot tell whether readings were dropped, reordered, or added later.",
    changes:
      "Each reading takes its own position, so the record has a shape that someone who was not present can check. An inserted reading has no position, and a removed one leaves a gap.",
  },
  {
    title: "Drafts, designs and prior art",
    who: "Inventors, studios, research teams",
    body:
      "Showing that you had something in a particular form at a particular stage normally means producing your own files and asking to be believed, which is precisely the evidence an opponent will dispute.",
    changes:
      "Recording a draft as it is made gives it a position that cannot be created after the fact. The same bytes can be recorded again later at a new position, so a working sequence of revisions becomes the evidence itself.",
  },
];

const limits = [
  {
    label: "Truth",
    text: "A recorded document can be wrong in exactly the form it was recorded.",
  },
  {
    label: "Authorship",
    text: "A BitGraph attests the boundary that committed the bytes, not the person who made them.",
  },
  {
    label: "First creation",
    text: "The same bytes may have existed elsewhere beforehand. What is fixed is the position they took here.",
  },
];

export default function SolutionsPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      {/* Page heading in the Roll's voice: 20px/800 title over a gray line,
          the site's settled convention for a page that is a list of things. */}
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
        Solutions
      </div>
      <div style={{ fontSize: 13, fontWeight: 400, color: "#6b7280", marginTop: 2, marginBottom: 28 }}>
        Where the order of things carries weight.
      </div>

      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 14 }}>
        BitGraph is useful wherever the question is <strong style={{ color: "#111827", fontWeight: 700 }}>which came
        first</strong>, and the answer currently depends on trusting whoever holds the
        file. A digital file has no inherent place in a sequence. Its metadata is
        editable, its timestamp is asserted, and a copy is indistinguishable from
        the original.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 40 }}>
        A BitGraph gives a file a position. The slot is reserved from hardware
        entropy before the file&apos;s hash is known, the hash is bound to that slot
        inside a measured boundary, and the sequence is anchored to Ethereum so
        positions are fixed in a timeline nobody involved controls.
      </p>

      {cases.map((c) => (
        <div
          key={c.title}
          style={{ borderLeft: "2px solid #d0d5dd", paddingLeft: 22, marginBottom: 34 }}
        >
          <h2 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.015em", color: "#111827", margin: 0 }}>
            {c.title}
          </h2>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#6b7280", margin: "6px 0 12px",
          }}>
            {c.who}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 12px" }}>{c.body}</p>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: 0 }}>
            <strong style={{ color: "#111827", fontWeight: 700 }}>What a BitGraph changes.</strong>{" "}
            {c.changes}
          </p>
        </div>
      ))}

      {/* Stating the neighbouring claims and ruling them out is the point of
          this section: they are exactly what a reader assumes on their own. */}
      <div style={{ marginTop: 52 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: "0 0 12px" }}>
          The edge of the claim
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 16px" }}>
          Every case above rests on one narrow claim: these exact bytes occupied
          this position in this sequence, and the position was fixed before the
          anchor that follows it. Three neighbouring claims are the ones a reader
          tends to assume, and none of them follow.
        </p>
        {limits.map((l) => (
          <p key={l.label} style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 10px" }}>
            <strong style={{ color: "#111827", fontWeight: 700 }}>{l.label}.</strong> {l.text}
          </p>
        ))}
        <Link href="/docs/what-bitgraph-is-not" className="bg-action-link">
          What BitGraph is not <span className="arrow">&rarr;</span>
        </Link>
      </div>

      <div style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: "0 0 12px" }}>
          Applying it
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 4px" }}>
          Recording a file needs no integration. Drop it on the home page and the
          proof is portable from that moment. Everything past that, issuing in
          volume or recording from inside your own systems, is the integration guide.
        </p>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <Link href="/" className="bg-action-link">
            Record a file <span className="arrow">&rarr;</span>
          </Link>
          <Link href="/docs/integration" className="bg-action-link">
            Integration guide <span className="arrow">&rarr;</span>
          </Link>
          <Link href="/docs/trust-model" className="bg-action-link">
            Trust model <span className="arrow">&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
