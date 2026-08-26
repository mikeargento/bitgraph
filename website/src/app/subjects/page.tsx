import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { DocsPageNav } from "@/components/docs-page-nav";

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

/* One declaration per text role, so the page carries a single body signature
   and the ladder stays visible in one place: h2 22, h3 18, body 16
   (project type ladder). Margins are per-use. */
const pStyle: CSSProperties = { fontSize: 16, lineHeight: 1.75, color: "#1f2937" };
const h2Style: CSSProperties = {
  fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: "0 0 12px",
};
const h3Style: CSSProperties = {
  fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", margin: 0,
};
const kickerStyle: CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
  color: "#4b5563", margin: "6px 0 12px",
};
const strongStyle: CSSProperties = { color: "#111827", fontWeight: 700 };
/* The seam: the same 1px #e5e7eb hairline .bg-page-nav draws above the trail,
   at the top of each section. 44 above the line, 36 below it. */
const sectionStyle: CSSProperties = { borderTop: "1px solid #e5e7eb", marginTop: 44, paddingTop: 36 };

/* Each entry answers three questions in the order a buyer actually asks them:
   who is protecting something, what specifically fails today, and what a
   BitGraph changes about it. Since 2026-08-26 that anatomy is also stated
   on the page, in the line under "The subjects", so the repeated bold label
   reads as the shape it is. The `changes` line is deliberately narrow. It
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
      "Nothing in a photograph's file says which version is the one the photographer delivered. Metadata is editable, and a crop or a re-encode produces different bytes, so anything bound to an earlier version stops matching the file in hand.",
    changes:
      "A BitGraph stays external to the image. The image's exact bytes are bound to a position reserved before those bytes were known, so a photographer can show that this version, exactly as delivered, held that position. It sits alongside Content Credentials rather than replacing them: the manifest describes the image's path, the BitGraph records the position this exact version took.",
  },
  {
    /* Body reshaped 2026-08-26: this was the one entry that opened on what
       BitGraph cannot do instead of on what fails today, which broke the
       who/fails/changes anatomy the other six follow. The truth carve-out it
       carried is not lost: the second condition states it, and "The edge of
       the claim" rules it out for every entry at once. The kicker joins the
       other six in naming people rather than documents; the document names
       moved into the body's first sentence. */
    title: "Periodic reporting and attestations",
    who: "Issuers, auditors, compliance teams",
    body:
      "A reserve report or a compliance statement is issued, then measured against events that come after it. When the two disagree, the question becomes whether the copy produced today is what was actually filed, and the only archive belongs to the party being questioned.",
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
      "Ordering does not depend on any clock. A position exists before the file that occupies it, so a later file cannot be inserted at an earlier point, and each anchor fixes the order of everything committed before it. Time is subjective. The order is not.",
  },
  {
    title: "Issued documents and credentials",
    who: "Registrars, universities, licensing boards, certifying labs",
    body:
      "What an authority issues is valuable only while it can be told apart from what merely looks like it. Today that distinction usually depends on calling the issuer back, which does not scale, or on visual security features, which are designed to frustrate reproduction rather than to be checked cryptographically.",
    changes:
      "Every issued document takes a position in the authority's own sequence at the moment it is issued. A holder presents the document with its proof, and the position can be checked without a fresh lookup against the issuer's records. The organization paying to record the document is the same one whose credibility the record protects.",
  },
  {
    title: "Instrument and field data",
    who: "Laboratories, sensor networks, survey and inspection work",
    body:
      "Readings are trusted because of the process that produced them, and that trust does not travel outside the organization that ran the process. Once data leaves the instrument, a downstream reader cannot tell whether readings were added later, removed, or reordered.",
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
          Deliberately NOT the home hero's up-to-54px: that scale belongs to
          "A camera for bits." and is locked to the /camera morph; matching it
          would set the two pages shouting.
          The docs h1 treatment AS RENDERED, not as declared (Mike, twice on
          2026-08-05: "should match boldness of other docs titles", then
          "needs to match text size"). Docs h1s carry text-3xl sm:text-4xl
          but the UNLAYERED .prose-doc h1 rule beats those utilities (the
          08-03 unlayering), so what a docs page actually renders is a fixed
          2rem/600/-0.03em at every width - measured, 32px against the 36px
          the classes suggest. Matching the truth, inline, with prose-doc
          h1's own line-height and margin. Supersedes the earlier never-wrap
          clamp; on phones the line breaks at the period, which stacks the
          reversal rather than reducing it to a subtitle. */}
      <h1 className="bg-page-title" style={{ marginBottom: "1.25rem" }}>
        Trust is expensive. Proof isn&rsquo;t.
      </h1>

      <p style={{ ...pStyle, marginBottom: 14 }}>
        {/* No comma before "but". With one, "but" attaches to "BitGraph is
            useful" and reads as though the problem undercuts BitGraph. Without
            it, "wherever" scopes both conditions and the contrast lands where
            it belongs: order matters, and yet the evidence of it sits with the
            interested party. No bold either: the sentence's own contrast is the
            emphasis.
            Sentence order (2026-08-26): thesis, then the file's missing place,
            then the hash's limit, so the paragraph hands off cleanly to "gives
            a file a position". The hash sentences used to sit second and split
            the thesis from its elaboration. The hash's limit is stated as
            "order", not as "which existed first": first existence is exactly
            what the closing section says does not follow. */}
        BitGraph is useful wherever order matters but the only evidence of that
        order belongs to whoever holds the files. A digital file has no inherent
        place in a sequence: its metadata is editable, its timestamp is asserted,
        and a copy is indistinguishable from the original. A hash can show that
        two files are identical. On its own it says nothing about order.
      </p>
      <p style={{ ...pStyle, marginBottom: 14 }}>
        A BitGraph gives a file a position. The slot is reserved from hardware
        entropy before the file&apos;s hash is known, the hash is bound to that slot
        inside a measured boundary, and the sequence is anchored to a public
        timeline nobody involved controls.
      </p>
      {/* Placed after the mechanism, not before it. As a consequence of what
          was just described it needs no setup; ahead of it, it was a property
          of a mechanism the reader had not met yet. */}
      <p style={{ ...pStyle, marginBottom: 0 }}>
        {/* Says what the public record reveals, not that recording is private.
            "BitGraphing is completely private" was considered and is false: the
            Roll publishes every digest, position and time, permanently on
            the public ledger, and anyone holding the file can hash it and find the
            record. Content is private, the record is public by design, and that
            is what makes it checkable by a third party. Getting this wrong would
            mislead exactly the regulated reader this page is written for. */}
        Only the hash of a file is committed. The file itself is never handed to
        the protocol, so material that cannot be disclosed can still be recorded.
        The record shows that some exact bits took a position, not what they were.
      </p>

      {/* ❄️ NOTHING GOES HERE. A diagram sat at this spot, then a link, then an
          inline expander, then a pointer to the /docs/three-images worked
          example, and all four came out. The pattern is real: this page answers
          whether BitGraph applies to you, and how it WORKS, or what proves it,
          is another page's question.

          Section seams carry a hairline rule (2026-08-26): the 1px #e5e7eb
          line .bg-page-nav already draws above the trail at the page's foot,
          so the trail's rule reads as the last of five rather than a one-off.
          White cells were built first and reverted the same day, Mike
          deferring the pick: the seven-case section made a card taller than
          five viewports, which stops reading as a card, and cells elsewhere
          mark discrete exhibits (proof cards, figures), not prose runs.
          Rhythm at every seam: 44 above the rule, 36 below it, uniform for
          all four sections. */}

      {/* The two conditions are the page's spine. The first is a selection
          test, and it is deliberately written to disqualify: a page that says
          everything qualifies is not saying anything. The second is what makes
          the seven entries instances of one thing rather than a list. Both stop
          short of the truth claim on purpose: the authority's ability to go on
          asserting is preserved, the truth of what it asserts is not.
          Headed since 2026-08-26: the front half of the page ran headingless
          into the cases while the back half had h2s, and the old one-sentence
          lead ("Two conditions usually hold where recording a BitGraph makes
          sense.") was a heading wearing a paragraph's clothes. The h2 carries
          the count, the line under it carries the scope. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Two conditions</h2>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          Recording a BitGraph makes sense where both hold.
        </p>
        <p style={{ ...pStyle, margin: "0 0 14px" }}>
          <strong style={strongStyle}>The trust gap is frequent and expensive.</strong>{" "}
          Someone pays repeatedly, in staff time or in liability, to re-establish
          something that was settled once already. A problem that comes up once a
          year and is closed by one email does not need a protocol.
        </p>
        <p style={{ ...pStyle, margin: 0 }}>
          <strong style={strongStyle}>Someone stands behind the artifact.</strong>{" "}
          Where an authority issues documents, a BitGraph keeps what it issued
          distinguishable from what merely resembles it. Where nobody issues
          anything, as with drafts and prior art, the same record defends a
          position against a later challenge. Neither protects the truth of what
          was recorded, only the ability to keep standing behind it.
        </p>
      </div>

      {/* "The subjects" is the camera's word for what it points at and the
          page's own name (route and title); the nav's "Use cases" is a menu
          label, not this page's vocabulary. Case titles are h3 as of
          2026-08-26: they rendered 18px while being h2 elements, which put two
          h2 sizes on one page; on the ladder 18 is h3, and the section heading
          above them is the real h2. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>The subjects</h2>
        <p style={{ ...pStyle, margin: "0 0 28px" }}>
          Every entry has the same shape: who is protecting something, what
          fails today, and what a BitGraph changes.
        </p>

        {cases.map((c, i) => (
          <div
            key={c.title}
            className="bg-case"
            style={{
              borderLeft: "2px solid #d0d5dd",
              paddingLeft: 22,
              /* The last case gives up its 38px run-out so the rule above
                 "The edge of the claim" sits 44 over content like every
                 other seam. */
              ...(i === cases.length - 1 ? { marginBottom: 0 } : {}),
            }}
          >
            <h3 style={h3Style}>{c.title}</h3>
            <div style={kickerStyle}>{c.who}</div>
            <p style={{ ...pStyle, margin: "0 0 12px" }}>{c.body}</p>
            <p style={{ ...pStyle, margin: 0 }}>
              <strong style={strongStyle}>What a BitGraph changes.</strong>{" "}
              {c.changes}
            </p>
          </div>
        ))}
      </div>

      {/* Stating the neighboring claims and ruling them out is the point of
          this section: they are exactly what a reader assumes on their own. */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>The edge of the claim</h2>
        <p style={{ ...pStyle, margin: "0 0 16px" }}>
          Every case above rests on one narrow claim: these exact bytes occupied
          this position in this sequence, and the position was fixed before the
          anchor that follows it. A reader tends to assume three neighboring
          claims. None of them follow.
        </p>
        {limits.map((l) => (
          <p key={l.label} style={{ ...pStyle, margin: "0 0 10px" }}>
            <strong style={strongStyle}>{l.label}.</strong> {l.text}
          </p>
        ))}
        <Link href="/docs/what-bitgraph-is-not" className="bg-action-link">
          What BitGraph is not <span className="arrow">&rarr;</span>
        </Link>
      </div>

      <div style={sectionStyle}>
        <h2 style={h2Style}>Applying it</h2>
        <p style={{ ...pStyle, margin: "0 0 4px" }}>
          Recording a file needs no integration. The home page hashes the file
          locally and returns a portable proof without uploading the file
          itself. Everything past that, issuing in volume or recording from
          inside your own systems, is covered in the integration guide.
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
      {/* This page is the second stop in the docs sequence but lives outside
          /docs, so the docs layout does not wrap it and it mounts the trail
          itself. Without this the sequence would break in the middle: Overview
          points here, and there would be nothing pointing on. */}
      <DocsPageNav />
    </div>
  );
}
