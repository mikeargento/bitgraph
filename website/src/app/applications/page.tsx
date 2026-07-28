import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Applications",
  description:
    "Where causal ordering carries weight: periodic reporting, evidence and custody, issued documents, instrument data, drafts, and photography.",
  openGraph: {
    title: "BitGraph: Applications",
    description:
      "Where causal ordering carries weight: periodic reporting, evidence and custody, issued documents, instrument data, drafts, and photography.",
  },
};

/* Each entry answers three questions in the order a buyer actually asks them:
   who is protecting something, what specifically fails today, and what a
   BitGraph changes about it. The `changes` line is deliberately narrow. It
   states the new capability and stops, so no entry drifts into claiming truth,
   authorship or first creation, which the closing section then rules out
   explicitly. Ordered by institutional buyer first: reporting and custody are
   where someone already has a budget for this problem. Photography is last
   because it is the origin story rather than the commercial lead.

   Anchoring is stated once, in the intro. Naming it inside three separate
   case bodies made it read as a dependency of each one. */
const cases = [
  {
    title: "Periodic reporting and attestations",
    who: "Reserve reports, regulatory filings, compliance statements",
    body:
      "For a recurring report, the interesting question is rarely whether today's numbers are correct. It is whether the report existed in exactly this form before the events it is later measured against, and whether any report in the series was quietly replaced or omitted after the fact.",
    changes:
      "Each report consumes the next position in a sequence, and that position is fixed in a public timeline the issuer does not control. A missing period shows up as a gap, and a rewritten report will not match the position it claims.",
  },
  {
    title: "Evidence and chain of custody",
    who: "Investigators, legal teams, internal audit",
    body:
      "Custody disputes are usually about order rather than content: which file existed before which, and whether an item entered the record before or after a claim was made. A file's own timestamp is asserted by whoever holds the file, and system clocks are adjustable.",
    changes:
      "Ordering does not depend on any clock. A slot exists before the file that fills it, so a proof cannot be constructed backwards into the sequence, and each anchor seals everything committed before it. Time is subjective. The order is not.",
  },
  {
    title: "Issued documents and credentials",
    who: "Registrars, universities, licensing boards, certifying labs",
    body:
      "An authority's value rests on the artifacts it issues being distinguishable from artifacts that merely look like them. Today that distinction usually depends on calling the issuer back, which does not scale, or on visual security features, which are a manufacturing problem rather than a cryptographic one.",
    changes:
      "Every issued document takes a position in the issuer's own sequence at the moment it is issued. A holder presents the document, and anyone can check the position without contacting the issuer. This is the case where the buyer and the authority are the same party.",
  },
  {
    title: "Instrument and field data",
    who: "Laboratories, sensor networks, survey and inspection work",
    body:
      "Readings are trusted because of the process that produced them, and that trust is hard to carry outside the organization that ran the process. Once data leaves the instrument, a downstream reader cannot tell whether readings were dropped, reordered, or added later.",
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
  {
    title: "Photography and photojournalism",
    who: "Photographers, picture desks, wire agencies",
    body:
      "A photograph's origin cannot be established from the file. Metadata is editable, and a re-encode or a crop produces different bytes, so anything bound to the old bytes stops matching.",
    changes:
      "A BitGraph is external to the file. The exact bytes are bound to a position reserved before those bytes were known, so a photographer can show that this frame, in exactly this form, held that position. It sits alongside Content Credentials rather than replacing them: the manifest says how the image was made, the BitGraph says where it landed.",
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

export default function ApplicationsPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      {/* Page heading in the Roll's voice: 20px/800 title over a gray line,
          the site's settled convention for a page that is a list of things. */}
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
        Applications
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
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 14 }}>
        A BitGraph gives a file a position. The slot is reserved from hardware
        entropy before the file&apos;s hash is known, the hash is bound to that slot
        inside a measured boundary, and the sequence is anchored to Ethereum so
        positions are fixed in a timeline nobody involved controls.
      </p>
      {/* Placed after the mechanism, not before it. As a consequence of what
          was just described it needs no setup; ahead of it, it was a property
          of a mechanism the reader had not met yet. */}
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 40 }}>
        Only the hash of a file is committed. The file itself is never handed to
        the protocol, so material that cannot be disclosed can still be recorded.
      </p>

      {/* One diagram for the whole page, illustrating the single idea every
          case below depends on: the position is created before the thing that
          fills it. Static SVG, no script and no animation. Colors are explicit
          rather than themed because the site is light only. The viewBox is kept
          narrow (420) so that at a 342px mobile column the 15px type still
          renders near 12px instead of disappearing. */}
      <figure style={{ margin: "0 0 40px" }}>
        <svg
          viewBox="0 0 420 196"
          role="img"
          aria-labelledby="seqTitle seqDesc"
          style={{ width: "100%", maxWidth: 460, height: "auto", display: "block", margin: "0 auto" }}
        >
          <title id="seqTitle">A sequence of positions, one of them reserved and empty</title>
          <desc id="seqDesc">
            Positions 42 and 43 already hold a file hash. Position 44 is reserved
            and empty, with a file arriving into it. Position 45 is reserved and
            still untouched.
          </desc>

          {/* The strip running behind the cells, visible in the gaps, so the row
              reads as one continuing sequence rather than four separate boxes. */}
          <line x1="28" y1="111" x2="418" y2="111" stroke="#e5e7eb" strokeWidth="1" />
          <text x="14" y="116" textAnchor="middle" fontSize="15" fill="#9ca3af">…</text>

          {/* Filled positions */}
          <rect x="34" y="80" width="84" height="62" fill="#eef5fa" stroke="#0065A4" strokeWidth="1.5" />
          <text x="76" y="117" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="15" fontWeight="600" fill="#0065A4">#8a2f</text>
          <rect x="132" y="80" width="84" height="62" fill="#eef5fa" stroke="#0065A4" strokeWidth="1.5" />
          <text x="174" y="117" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="15" fontWeight="600" fill="#0065A4">#3f9c</text>

          {/* The reserved position, and the file on its way into it */}
          <rect x="230" y="80" width="84" height="62" fill="#ffffff" stroke="#0065A4" strokeWidth="1.5" strokeDasharray="5 4" />
          <path d="M258 4 H278 L286 12 V38 H258 Z" fill="#ffffff" stroke="#0065A4" strokeWidth="1.5" strokeLinejoin="miter" />
          <path d="M278 4 V12 H286" fill="none" stroke="#0065A4" strokeWidth="1.5" />
          <path d="M264 21 H280 M264 27 H280" stroke="#0065A4" strokeWidth="1.5" opacity="0.55" />
          <line x1="272" y1="44" x2="272" y2="66" stroke="#0065A4" strokeWidth="1.5" />
          <path d="M266 66 H278 L272 75 Z" fill="#0065A4" />

          {/* The next position, which exists but has nothing in it yet. Drawn in
              the label gray rather than a lighter tint: it is subordinate to the
              reserved position, but a reviewer reading a downscaled render
              missed it entirely and read the row as three boxes over four
              numbers, so it has to survive low-fidelity reproduction. */}
          <rect x="328" y="80" width="84" height="62" fill="#ffffff" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="5 4" />

          <text x="76" y="161" textAnchor="middle" fontSize="14" fill="#6b7280">42</text>
          <text x="174" y="161" textAnchor="middle" fontSize="14" fill="#6b7280">43</text>
          <text x="272" y="161" textAnchor="middle" fontSize="14" fill="#6b7280">44</text>
          <text x="370" y="161" textAnchor="middle" fontSize="14" fill="#6b7280">45</text>
          <text x="272" y="181" textAnchor="middle" fontSize="13" fontWeight="600" fill="#0065A4">reserved</text>
        </svg>
        <figcaption style={{ fontSize: 13, lineHeight: 1.55, color: "#6b7280", textAlign: "center", maxWidth: 460, margin: "14px auto 0" }}>
          Position 44 exists before the file that fills it. The file arrives
          second, and can only take a position that was already waiting.
        </figcaption>
      </figure>

      {/* The two conditions are the page's spine. The first is a selection
          test, and it is deliberately written to disqualify: a page that says
          everything qualifies is not saying anything. The second is what makes
          the six entries instances of one thing rather than a list. Both stop
          short of the truth claim on purpose: the authority's ability to go on
          asserting is preserved, the truth of what it asserts is not. */}
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 14px" }}>
        Two conditions usually hold where recording is worth the effort.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 14px" }}>
        <strong style={{ color: "#111827", fontWeight: 700 }}>The trust gap is frequent and expensive.</strong>{" "}
        Someone pays repeatedly, in staff time or in liability, to re-establish
        something that was settled once already. A gap that opens once a year and
        costs an email is not worth a protocol.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 40px" }}>
        <strong style={{ color: "#111827", fontWeight: 700 }}>There is an authority behind the artifact.</strong>{" "}
        A BitGraph preserves the exact bits that authority asserted, so what it
        issued stays distinguishable from what merely resembles it. That is what
        is protected in every case below: not the truth of the assertion, but the
        authority&apos;s ability to go on making assertions that hold.
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

      {/* Stating the neighboring claims and ruling them out is the point of
          this section: they are exactly what a reader assumes on their own. */}
      <div style={{ marginTop: 52 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: "0 0 12px" }}>
          The edge of the claim
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 16px" }}>
          Every case above rests on one narrow claim: these exact bytes occupied
          this position in this sequence, and the position was fixed before the
          anchor that follows it. Three neighboring claims are the ones a reader
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
          Recording a file needs no integration. The home page takes a file and
          returns a proof that is portable from that moment. Everything past
          that, issuing in volume or recording from inside your own systems, is
          the integration guide.
        </p>
        {/* "Record" was tried in the nav and removed, so this link is the only
            route from here into the product and has to carry that on its own.
            It gets scale and its own line rather than a button: the site has no
            buttons, so prominence comes from size and space. The two reference
            links stay at the default size underneath so the ranking is obvious. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <Link href="/" className="bg-action-link" style={{ fontSize: 18, paddingTop: 18, paddingBottom: 10 }}>
            Record a file <span className="arrow">&rarr;</span>
          </Link>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginTop: 6 }}>
            <Link href="/docs/integration" className="bg-action-link" style={{ paddingTop: 8, paddingBottom: 8 }}>
              Integration guide <span className="arrow">&rarr;</span>
            </Link>
            <Link href="/docs/trust-model" className="bg-action-link" style={{ paddingTop: 8, paddingBottom: 8 }}>
              Trust model <span className="arrow">&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
