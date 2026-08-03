import type { Metadata } from "next";
import Link from "next/link";
import { SeeExample } from "./see-example";

export const metadata: Metadata = {
  title: "Subjects",
  description:
    "Where causal ordering carries weight: photography, periodic reporting, clinical records, evidence and custody, issued documents, instrument data, and drafts.",
  openGraph: {
    title: "BitGraph: Subjects",
    description:
      "Where causal ordering carries weight: photography, periodic reporting, clinical records, evidence and custody, issued documents, instrument data, and drafts.",
  },
};

/* Each entry answers three questions in the order a buyer actually asks them:
   who is protecting something, what specifically fails today, and what a
   BitGraph changes about it. The `changes` line is deliberately narrow. It
   states the new capability and stops, so no entry drifts into claiming truth,
   authorship or first creation, which the closing section then rules out
   explicitly. Photography leads (moved from last, 2026-07-29): it is the case
   the reader can picture without being told, and the live product is a camera,
   so the page opens on the thing the site already is. The institutional
   entries follow, in buyer order, because that is where the budget is.

   Anchoring is stated once, in the intro. Naming it inside three separate
   case bodies made it read as a dependency of each one.

   Substitution and backdating are detectable from the sequence alone.
   OMISSION IS NOT: a monotonic counter shared with other traffic says nothing
   about an entry that was never made. Wherever a case claims a missing item
   becomes visible, the claim is conditional on an external expectation of what
   the sequence should contain (a per-period filing rule, an instrument counter,
   a batch manifest). Do not restore the unconditional phrasing. */
const cases = [
  {
    title: "Photography and photojournalism",
    who: "Photographers, picture desks, wire agencies",
    body:
      "A photograph's file cannot by itself establish where it came from. Metadata is editable, and a crop or a re-encode produces different bytes, so anything bound to the earlier version stops matching.",
    changes:
      "A BitGraph stays external to the image. The image's exact bytes are bound to a position reserved before those bytes were known, so a photographer can show that this version, in exactly this form, held that position. It sits alongside Content Credentials rather than replacing them: the manifest describes the image's path, the BitGraph records where that exact version landed.",
  },
  {
    title: "Periodic reporting and attestations",
    who: "Reserve reports, regulatory filings, compliance statements",
    body:
      "BitGraph cannot establish whether the numbers in a report are correct. It can establish whether the report existed in exactly this form before the events it is later measured against, and whether a report in the series was replaced after the fact.",
    changes:
      "Each report takes the next position in a sequence, and that position is fixed in a public timeline the issuer does not control. A rewritten report no longer matches the position the original occupied. Where the workflow requires one recorded entry per reporting period, an omitted report becomes visible too.",
  },
  {
    title: "Clinical records and chart entries",
    who: "Hospitals, practices, medical-legal teams",
    body:
      "Malpractice and consent disputes often turn on when a note entered the chart rather than on what it says. Record systems do keep audit trails, but they are maintained by the same organization whose care is in question, which is the position a provider is least able to argue from.",
    changes:
      "A note takes a position in a sequence when it is written, and that position is fixed in a public timeline the provider does not control. An entry added or revised after an event cannot occupy the earlier position. Only the hash is committed, so nothing in the chart is disclosed in order to record it.",
  },
  {
    title: "Evidence and chain of custody",
    who: "Investigators, legal teams, internal audit",
    body:
      "Custody disputes are usually about order rather than content: which file existed before which, and whether an item entered the record before or after a claim was made. A file's own timestamp is asserted by whoever holds the file, and system clocks are adjustable.",
    changes:
      "Ordering does not depend on any clock. A position exists before the file that occupies it, so a later file cannot be inserted at an earlier point, and each anchor seals the order of everything committed before it. Time is subjective. The order is not.",
  },
  {
    title: "Issued documents and credentials",
    who: "Registrars, universities, licensing boards, certifying labs",
    body:
      "An authority's value rests on the artifacts it issues being distinguishable from artifacts that merely look like them. Today that distinction usually depends on calling the issuer back, which does not scale, or on visual security features, which are designed to frustrate reproduction rather than to be checked cryptographically.",
    changes:
      "Every issued document takes a position in the authority's own sequence at the moment it is issued. A holder presents the document with its proof, and the position can be checked without a fresh lookup against the issuer's records. The organization paying to record the document is the same one whose credibility the record protects.",
  },
  {
    title: "Instrument and field data",
    who: "Laboratories, sensor networks, survey and inspection work",
    body:
      "Readings are trusted because of the process that produced them, and that trust is hard to carry outside the organization that ran the process. Once data leaves the instrument, a downstream reader cannot tell whether readings were added later, removed, or put in a different order.",
    changes:
      "Each reading, batch, or acquisition session takes a position in the instrument's sequence. A later insertion cannot occupy an earlier position, so the record has an order that someone who was not present can check. Where the expected readings are defined by an instrument counter, a schedule, or a batch manifest, an omitted reading becomes visible too.",
  },
  {
    title: "Drafts, designs and prior art",
    who: "Inventors, studios, research teams",
    body:
      "Showing that you had something in a particular form at a particular stage normally means producing your own files and asking to be believed, which is precisely the evidence an opponent will dispute.",
    changes:
      "Recording a draft as it is made gives those exact bytes a position that cannot be created later. Revisions take later positions, so the development history itself becomes the evidence.",
  },
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
      {/* The one commercial line in the product, and this is the page it
          belongs to: /subjects is the buyer's room, so the heading speaks in the
          buyer's register (Mike's line, 2026-07-31). It was proposed for the
          home page and deliberately kept off it, and re-proposed and refused
          again on 2026-08-02: the home page describes, this page sells, and
          "A camera for bits." is also a door that morphs into /camera's
          headline, which a demotion to subtitle would break.
          The nav label and route were "Uses" until 2026-08-02; once this
          heading became the page's opener, the label promised a list of
          applications while the page delivered an argument. No subtitle: the
          first paragraph scopes the page.
          Caps at the DOCS h1 size (36px), not the Roll's 20px: /subjects is a prose
          page like the docs, not a stream page with search chrome, and the
          line's turn ("Proof isn't") needs air to land while carrying the top
          of the page alone. Deliberately NOT the home hero's up-to-54px: that
          scale belongs to "A camera for bits." and is locked to the /camera
          morph; matching it would set the two pages shouting.
          The line must NEVER wrap: split across two lines the turn reads as a
          subtitle instead of a reversal. So the middle term is sized the way
          home's tagline is, from the line's own measure: in Acumin Pro 800 at
          -0.03em it needs 13.48x the font size and the column gives 0.9vw, so
          6.68vw is the wrap point and 6.4vw leaves margin for font-load
          variance. The 18px floor cannot bind above a ~281px viewport, below
          any real device. Re-measure if the words, weight, or tracking change. */}
      <h1 style={{ fontSize: "clamp(18px, 6.4vw, 36px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#111827", marginBottom: 24 }}>
        Trust is expensive. Proof isn&rsquo;t.
      </h1>

      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 14 }}>
        {/* No comma before "but". With one, "but" attaches to "BitGraph is
            useful" and reads as though the problem undercuts BitGraph. Without
            it, "wherever" scopes both conditions and the contrast lands where
            it belongs: order matters, and yet the evidence of it sits with the
            interested party. No bold either: the sentence's own contrast is the
            emphasis, and a bolded phrase was a leftover from when the opener
            named a question instead of stating a tension. */}
        BitGraph is useful wherever order matters but the only evidence of that
        order belongs to whoever holds the files. A hash can show that two files
        are identical. On its own it cannot
        show which of them existed first. A digital file has no inherent place in a
        sequence: its metadata is editable, its timestamp is asserted, and a copy
        is indistinguishable from the original.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 14 }}>
        A BitGraph gives a file a position. The slot is reserved from hardware
        entropy before the file&apos;s hash is known, the hash is bound to that slot
        inside a measured boundary, and the sequence is anchored to a public
        timeline nobody involved controls.
      </p>
      {/* Placed after the mechanism, not before it. As a consequence of what
          was just described it needs no setup; ahead of it, it was a property
          of a mechanism the reader had not met yet. */}
      {/* Nothing pointing at /camera here on purpose. A diagram sat here, then
          a link, then an inline expander, and all three were the same mistake:
          this page answers whether BitGraph applies to you, and how it works is
          another page's question. The two paragraphs above give a buyer the
          operative fact, that the slot is reserved before the hash is known.
          /camera remains the place for the analogy. */}
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", marginBottom: 40 }}>
        {/* Says what the public record reveals, not that recording is private.
            "BitGraphing is completely private" was considered and is false: the
            Roll publishes every digest, position and time, permanently and
            on-chain, and anyone holding the file can hash it and find the
            record. Content is private, the record is public by design, and that
            is what makes it checkable by a third party. Getting this wrong would
            mislead exactly the regulated reader this page is written for. */}
        Only the hash of a file is committed. The file itself is never handed to
        the protocol, so material that cannot be disclosed can still be recorded.
        The record shows that some exact bits took a position, not what they were.
      </p>

      {/* The two conditions are the page's spine. The first is a selection
          test, and it is deliberately written to disqualify: a page that says
          everything qualifies is not saying anything. The second is what makes
          the seven entries instances of one thing rather than a list. Both stop
          short of the truth claim on purpose: the authority's ability to go on
          asserting is preserved, the truth of what it asserts is not. */}
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 14px" }}>
        Two conditions usually hold where recording a BitGraph makes sense.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 14px" }}>
        <strong style={{ color: "#111827", fontWeight: 700 }}>The trust gap is frequent and expensive.</strong>{" "}
        Someone pays repeatedly, in staff time or in liability, to re-establish
        something that was settled once already. A problem that comes up once a
        year and is settled by one email does not need a protocol.
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#1f2937", margin: "0 0 40px" }}>
        <strong style={{ color: "#111827", fontWeight: 700 }}>There is an authority behind the artifact, or a position to defend.</strong>{" "}
        Where an authority issues something, a BitGraph preserves a verifiable
        record of the exact bits it asserted, so what it issued stays
        distinguishable from what merely resembles it. Where nobody is issuing,
        as with drafts and prior art, the same record protects one party&apos;s
        position against a later challenge. Neither protects the truth of what
        was recorded, only the ability to keep standing behind it.
      </p>

      {/* The abstract claim has just landed, so this is where a real one is
          worth seeing. Closes the two-conditions section the way "The edge of
          the claim" closes with its own link, rather than interrupting. */}
      <div style={{ margin: "-26px 0 34px" }}>
        <SeeExample />
      </div>

      {cases.map((c) => (
        <div
          key={c.title}
          className="bg-case"
          style={{ borderLeft: "2px solid #d0d5dd", paddingLeft: 22 }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: 0 }}>
            {c.title}
          </h2>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#4b5563", margin: "6px 0 12px",
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
          Recording a file needs no integration. The home page hashes the file
          locally and returns a portable proof without uploading the file itself.
          Everything past that, issuing in volume or recording from inside your
          own systems, is the integration guide.
        </p>
        {/* All three at the default size. "Record" is the primary action and is
            marked by being first, which is the rule globals.css already states
            for .bg-action-link: every action is the same size, the primary one
            is marked by position, not by weight. An 18px Record was tried and
            was the only size-varied action link on the site. */}
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
