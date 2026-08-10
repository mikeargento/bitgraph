import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Where, not when",
  description:
    "Three AI images, one copied from another, and what their Content Credentials can and cannot establish. A worked example with live proofs.",
  openGraph: {
    title: "Where, not when.",
    description:
      "Three AI images, one copied from another, and what their Content Credentials can and cannot establish.",
  },
};

/* One sentence to a paragraph, for most of the page. That is the shape the copy
   was written in and it is load-bearing rather than decorative: nearly every
   line here is a separate claim a reader can check on their own, and running
   three of them together invites the eye to accept the third because it
   accepted the first. The 14px gap is the page's own, tighter than the 20px
   `.prose-doc p` default, because at this paragraph length the default reads as
   a list of unrelated fragments. */
const BODY: CSSProperties = {
  fontSize: 16,
  lineHeight: 1.75,
  color: "#1f2937",
  margin: "0 0 14px",
};

/* The number sequences are the argument rendered rather than described, so they
   are set apart from the prose by size and weight, not by a box or a rule.
   Tabular figures so 8,034 / 8,038 / 8,146 align as a sequence instead of
   drifting. Deliberately NOT brand blue: every other blue number on this page
   is a link to a proof, and these are not. */
const SEQ: CSSProperties = {
  fontSize: 19,
  lineHeight: 1.7,
  fontWeight: 600,
  color: "#111827",
  fontVariantNumeric: "tabular-nums",
  margin: "0 0 14px",
};

const LINK: CSSProperties = { color: "#0065A4", textDecoration: "none", fontWeight: 600 };

/* A WORKED EXAMPLE, and everything on it was read out of the files rather than
   asserted. The three manifests were decoded with the same toolkit the proof
   pages use; the block numbers, block times and positions come from the exports.
   If any line here is ever edited, re-read the files first: the whole value of
   this page is that a reader can reproduce every number on it.

   It lived as a section on /subjects for a few hours and outgrew it. Four
   images and five paragraphs sat between that page's opening claim and the
   seven use cases that are its spine, and this is a citable artifact that
   deserves its own URL. /subjects keeps a two sentence pointer, because the
   sentence this proves ("a copy is indistinguishable from the original") is
   made there. */
export default function ThreeImagesPage() {
  return (
    <article className="prose-doc">
      {/* The settled doctrine, near-verbatim: a proof asserts a PLACE, not a
          time (2026-08-08). This page is the evidence for it, so the title
          reinforces language the product already uses rather than inventing a
          frame for one page. The earlier draft ran nineteen words across two
          clauses of equal weight and had no turn in it. */}
      <h1 className="mb-6">Where, not when.</h1>

      {/* "from nothing" was the first draft and came out. It is vivid and it
          hands a reader an argument about training data that has nothing to do
          with this demo. "No parent image" is the claim actually being made,
          and it is the same claim the manifests make in c2pa terms. */}
      <p style={BODY}>
        On 10 August 2026, an image was generated with ChatGPT from a prompt,
        with no parent image. A copy was made with Grok. Then Gemini made a copy
        of the Grok copy.
      </p>

      <p style={BODY}>
        Three files. Three different sets of bits. Three Content Credentials
        manifests written by three different companies.
      </p>

      {/* The hinge of the opening. The reader has just been given a history and
          is about to be given a sequence that does not match it, and without
          this line the four positions below read as a mistake. */}
      <p style={BODY}>But they were not BitGraphed in that order.</p>

      {/* Numerals, not words, and only in this one sentence. It is the only
          place on the page where the three are enumerated as a sequence, and
          set as figures they pre-echo the 8,034 / 8,038 / 8,146 line the whole
          argument turns on. Every other "first" here is comparative ("which
          came first", "recorded first"), where a numeral would be wrong.

          "BitGraphed", not "recorded", and only here. The reader has just been
          told how these images were made, so "recorded 1st" three lines later
          can be read as "made first", which is the exact confusion the
          paragraph exists to dispel. "BitGraphed" cannot be misread, and it
          picks up the verb from the line immediately above. The demo sentence
          further down keeps "recorded" deliberately: by that point the contrast
          it draws is explicit and the word is doing no ambiguous work. */}
      <p style={BODY}>
        The Grok copy was BitGraphed 1st. The ChatGPT original was BitGraphed
        2nd. The Gemini copy was BitGraphed 3rd.
      </p>

      <p style={BODY}>
        An hour later, the exact same ChatGPT original was recorded again.
      </p>

      {/* Exact recorded bytes, not previews. A resized copy would have a
          different hash, the proof pages would stop showing the picture, and
          the invitation below would be a lie.

          Each image IS its proof link. The three links used to sit in a
          paragraph below the table, which asked the reader to hold "the Grok
          copy" in their head, scroll past seven rows, and map the name back to
          a picture they could no longer see. The record belongs on the thing it
          is a record of. */}
      {/* Both edges are boundaries between two KINDS of thing, not between two
          paragraphs, so neither can use the 14px paragraph gap. Slightly tighter
          above than below because the paragraph introduces the pictures and they
          belong together; underneath, 12px caption text running into 16px body
          prose is the crowded one. Margins collapse against the paragraph above,
          so the top value is the gap, not an addition to it. */}
      <div className="bg-c2pa-grid" style={{ margin: "34px 0 56px" }}>
        {[
          { src: "/example/two-images/grok.jpg", w: 1248, h: 832, cap: "Grok", sub: "copy of the original", pos: "8,034", d: "XWWLhzD5efJ5FIukRTCGcOmWupaW2lELFzI1dPyX078", c: "8034",
            says: ["created, no parents", "chain leads to itself", "self-signed, LOCAL USE ONLY"] },
          { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the original", pos: "8,038", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8038",
            says: ["created, no parents", "chain leads to itself", "signed by OpenAI OpCo, LLC"] },
          { src: "/example/two-images/gemini.png", w: 1536, h: 1024, cap: "Gemini", sub: "copy of the copy", pos: "8,146", d: "1nyxWqQNa3KsIwo7i7kfHlyMqwh1_776Ht7ZjJU1W70", c: "8146",
            says: ["composite, one parent", "chain leads to the Grok image", "signed by Google LLC"] },
          /* THE SAME FILE AS THE SECOND CELL, byte for byte, recorded again an
             hour later. Its three lines are deliberately identical to that
             cell's, because they ARE identical: nothing about the file changed.
             Only the number moves, which is the argument the prose makes,
             rendered instead of claimed. The caption has to say "the same file"
             out loud or a fourth picture in a section about a chain of copies
             reads as a fourth copy. */
          { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the same file, recorded again", pos: "8,664", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8664",
            says: ["created, no parents", "chain leads to itself", "signed by OpenAI OpCo, LLC"] },
        ].map((im) => (
          /* Keyed by POSITION, not src: two cells are the same file. */
          <figure key={im.pos} style={{ margin: 0 }}>
            <Link
              href={`/proof/${im.d}?counter=${im.c}&epoch=2bx9IFX9ZOoY5HSwlZstSEGx1PWv8DncGofdK5v93jQ`}
              className="bg-arrow-link"
              style={{ textDecoration: "none", display: "block" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={im.src}
                width={im.w}
                height={im.h}
                loading="lazy"
                alt=""
                style={{ width: "100%", height: "auto", display: "block", border: "1px solid #d0d5dd" }}
              />
              <figcaption style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, color: "#111827" }}>{im.cap}</span>
                <span style={{ color: "#4b5563" }}>{"  ·  "}{im.sub}</span>
                <br />
                {/* "#8,034" alone does not say what the number is. */}
                <span style={{ color: "#0065A4", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  BitGraph #{im.pos} <span className="arrow" aria-hidden>&rarr;</span>
                </span>
                {/* What the file says about itself, in the same three lines for
                    all three, so the differences are the only thing that moves.
                    Signature times were a fourth line and came out: they are
                    contrasted explicitly in the prose below, and under a 230px
                    image a line that is already argued elsewhere is just
                    density.
                    This was a seven-row table underneath, which was a second
                    copy of the comparison these three columns already make, and
                    gave "Names its model" the same weight as the two lines that
                    are the entire argument. */}
                <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "#4b5563", lineHeight: 1.7 }}>
                  {im.says.map((line) => (
                    <span key={line} style={{ display: "block" }}>{line}</span>
                  ))}
                </span>
              </figcaption>
            </Link>
          </figure>
        ))}
      </div>

      <p style={BODY}>Google did the careful thing.</p>

      <p style={BODY}>
        Its manifest declares the image a composite, names a parent, and carries
        that parent&apos;s manifest inside the file so the chain can be followed.
      </p>

      <p style={BODY}>Follow it, and the chain ends at the Grok image.</p>

      <p style={BODY}>
        That is because Grok&apos;s manifest says its image was created with no
        parents at all.
      </p>

      <p style={BODY}>The ChatGPT original is not in the chain.</p>

      <p style={BODY}>
        Nothing inside any of the three files records the fact that the Grok
        image was copied from the ChatGPT image.
      </p>

      <p style={BODY}>
        A provenance chain is only as good as its weakest link. Everything
        downstream of a break can inherit a false origin even when every later
        participant behaves correctly.
      </p>

      <p style={BODY}>That is exactly what happened here.</p>

      {/* Read out of the certificates, not characterized. Grok's signature_info
          issuer is literally "Self-signed ephemeral certificate (Content
          Authenticity SDK) -- LOCAL USE ONLY" with common_name "xAI Grok
          Imagine": the name on it is a field the issuer chose, which is the
          point of the last clause. */}
      <p style={BODY}>
        Google correctly signed what it received. OpenAI correctly signed what it
        created. Grok&apos;s file carries a self-signed certificate marked for
        local use only, something that can be created locally and made to name
        essentially anyone.
      </p>

      <p style={BODY}>The signatures answer one kind of question.</p>

      <p style={BODY}>They do not answer order.</p>

      <p style={BODY}>
        The files cannot reliably be put into sequence from what they carry.
      </p>

      {/* Measured, and the mechanism is worth knowing before this line is ever
          edited. Both signed files carry a real RFC 3161 timestamp token in a
          `sigTst2` COSE header, so neither time is loosely asserted. But the
          authority that issued each one belongs to the signer: ChatGPT's chains
          through "OpenAI TSA Issuing CA" to "OpenAI TSA Root CA", all OpenAI
          OpCo LLC, and Gemini's through "Google C2PA Core Time-Stamping ICA G3"
          to "Google C2PA Root CA G3", all Google LLC. Grok's file has no
          timestamp token at all and no signature time.

          Which is exactly why the line says what it says. An earlier draft
          counted the times off one by one, which made the problem look like
          disagreement between clocks. The problem is that there is no clock:
          time and identity both come from the party whose statement is being
          evaluated, so a reader who trusts the signature has already trusted
          the time. "Independent" is the load-bearing word and a real RFC 3161
          token from the signer's own root does not weaken it. */}
      <p style={BODY}>
        The files do not share an independent clock. Any time they carry is part
        of what a signer asserts, and one carries no useful time at all.
      </p>

      {/* The line the page exists for. */}
      <p style={BODY}>
        <strong>The assertion and the order are two different things.</strong>
      </p>

      <p style={BODY}>
        BitGraph does not label one of these files the original. It does not
        decide which one deserves to come first.
      </p>

      <p style={BODY}>It gives each recording a place.</p>

      <p style={SEQ}>8,034 &rarr; 8,038 &rarr; 8,146</p>

      <p style={BODY}>
        The copy comes before the original because the copy was recorded first.
      </p>

      {/* The objection, answered in the reader's own terms. Left unsaid, a
          sequence that contradicts the history reads as a defect in the
          sequence. */}
      <p style={BODY}>
        That may look wrong if you are trying to reconstruct the history of the
        images.
      </p>

      <p style={BODY}>
        It is exactly right if you are recording the order in which the bits
        entered the sequence.
      </p>

      <p style={BODY}>
        A place is useful only if it cannot be rearranged afterward.
      </p>

      <p style={BODY}>That is what the anchors are for.</p>

      {/* "Anchored to Ethereum" was a phrase dropped in as though the reader
          already knew what it bought them. It is the load-bearing claim of the
          page, so it gets explained with this demo's own numbers rather than
          named. Verified against the Gemini export before writing: an anchor's
          artifact digest is SHA-256 of the block hash STRING, "0x…" as ASCII,
          and #8,146 really does sit between anchors at #8,144 and #8,148
          holding blocks 25725064 and 25725065. */}
      <p style={BODY}>
        Every few seconds, the sequence records an Ethereum block hash exactly as
        it records an image: the hash occupies the next position in the same
        chain.
      </p>

      <p style={BODY}>A block hash cannot be known before that block exists.</p>

      <p style={BODY}>
        So anything occupying an earlier BitGraph position must have been
        recorded before that particular block hash was available.
      </p>

      {/* The other half, and the reason the anchor is a BitGraph OF a block
          rather than a note about one. Block timestamps decoded from the two
          witness files in the Gemini export before writing: 25725064 is
          14:02:23 UTC and 25725065 is 14:02:35 UTC, which is the twelve second
          window its proof page renders in local time. */}
      <p style={BODY}>
        This is also how <strong>order acquires a clock</strong>.
      </p>

      <p style={BODY}>The sequence itself knows only order:</p>

      <p style={SEQ}>8,144 &rarr; 8,146 &rarr; 8,148</p>

      <p style={BODY}>There is no time inside those numbers.</p>

      {/* The hash, not the timestamp, is what does the cryptographic work, and
          this sentence has to say so. Named only as "a public time", a technical
          reader can come away thinking the security claim rests on Ethereum's
          timestamp field, which is the one part of a block a proposer has some
          latitude over. It does not: unpredictability is the whole mechanism
          and the timestamp only attaches a wall clock to it. */}
      <p style={BODY}>
        But an Ethereum block carries a public consensus timestamp and, more
        importantly, a hash that could not have been known before the block
        existed.
      </p>

      <p style={BODY}>
        A BitGraph of block{" "}
        <a href="https://etherscan.io/block/25725064" target="_blank" rel="noopener noreferrer" style={LINK}>25,725,064</a>{" "}
        therefore fixes one position in the sequence against a public event.
      </p>

      <p style={BODY}>
        The Gemini image occupies <strong>8,146</strong>, between that anchor and
        another containing block{" "}
        <a href="https://etherscan.io/block/25725065" target="_blank" rel="noopener noreferrer" style={LINK}>25,725,065</a>.
      </p>

      <p style={BODY}>
        Those blocks were published at <strong>14:02:23 UTC</strong> and{" "}
        <strong>14:02:35 UTC</strong>.
      </p>

      <p style={BODY}>So the Gemini recording happened between them.</p>

      {/* Three refusals in one breath, so they are one paragraph broken by line
          breaks rather than three paragraphs. Split them and the parallel that
          carries them falls apart. */}
      <p style={BODY}>
        Not because Gemini said so.
        <br />
        Not because BitGraph typed a timestamp into a database.
        <br />
        Not because anyone was trusted to remember the correct time.
      </p>

      <p style={BODY}>
        Its position is trapped between two public events twelve seconds apart.
      </p>

      <p style={BODY}>
        <strong>
          The order comes from BitGraph.
          <br />
          The clock comes from Ethereum.
        </strong>
      </p>

      <p style={BODY}>
        Anyone can inspect both blocks. Neither BitGraph nor any of the three
        companies chose what those blocks would contain.
      </p>

      <p style={BODY}>
        So the place can be checked by someone who believes none of the
        manifests.
      </p>

      <p style={BODY}>
        It can also be checked by someone who does not trust BitGraph.
      </p>

      {/* The fourth cell explained, once, after the reader has already seen it
          and wondered. */}
      <p style={BODY}>Now look at the fourth image.</p>

      <p style={BODY}>It is the second image again.</p>

      <p style={BODY}>Not another version. Not another copy.</p>

      <p style={BODY}>
        <strong>The same file. The same bits.</strong>
      </p>

      <p style={BODY}>
        Recorded a second time at <strong>8,664</strong>.
      </p>

      <p style={BODY}>
        Everything about the file is identical. Only its place is different.
      </p>

      <p style={BODY}>
        Recording it again did not overwrite <strong>8,038</strong>. It did not
        update its earlier record. It did not improve its provenance.
      </p>

      <p style={BODY}>It created another position.</p>

      <p style={BODY}>
        That is what it means for a BitGraph to be a{" "}
        <strong>place rather than a label</strong>.
      </p>

      <p style={BODY}>A label belongs to the file.</p>

      <p style={BODY}>This file now occupies two places.</p>

      {/* Stacked rather than run together: two places, one above the other, is
          the shape of the claim. "and" stays unbolded so the two numbers are
          what the eye lands on. */}
      <p style={SEQ}>
        8,038
        <br />
        <span style={{ fontWeight: 400, fontSize: 16, color: "#4b5563" }}>and</span>
        <br />
        8,664
      </p>

      {/* The turn to the reader, and the reason this page sits one click from
          /subjects. Everything above is a protocol demonstration; the buyer's
          question is what it costs THEM, and the answer is that signing is not
          enough. OpenAI signed correctly and still could not establish which
          came first, which is precisely the position an issuing authority is in.
          The inference lands here rather than in the title: put it first and it
          is spent before the evidence arrives. */}
      {/* "A signature says who" was the earlier line and this page refutes it
          three cells to the left: Grok's signature is valid and says whatever
          its issuer typed. Granting the signature everything it can legitimately
          provide, and only then naming what is missing, is the stronger move.
          The reader cannot answer "but that signature proved nothing" because
          the sentence already conceded the trusted case. */}
      <p style={BODY}>
        A trusted signature can say <strong>who</strong>.
      </p>

      <p style={BODY}>
        It still cannot, by itself, say <strong>which came first</strong>.
      </p>

      {/* "companies with enormous reputations at stake" is load-bearing: it
          pre-empts the dismissal that these signatures were somehow shoddy.
          They were not, which is the whole point. */}
      <p style={BODY}>
        Three valid signatures can sit on three files, including signatures from
        companies with enormous reputations at stake, and the order still has to
        come from somewhere else.
      </p>

      {/* "it can prove that it signed two things" rather than "who signed
          something": the authority's identity is not in question in this
          scenario, it is the authority. What it cannot establish is the order
          of its own two signatures, and stating the limit that precisely is
          what makes the next line land. */}
      <p style={BODY}>
        Any authority that signs and stops is in the same position: it can prove
        that it signed two things, but it cannot independently prove which one
        it signed first.
      </p>

      <p style={BODY}>
        For that, it needs a <strong>where</strong>.
      </p>

      {/* "All three images" against four visible cells was a loose end a
          careful reader would catch on the last line of the page. Naming the
          fourth here closes it, and repeats the one fact about that cell that
          matters. */}
      <p style={BODY}>
        All three distinct images above are the exact bytes that were recorded.
        The fourth entry is the ChatGPT file again, byte for byte.
      </p>

      <p style={BODY}>
        Download any one of them and drop it on the{" "}
        <Link href="/" style={LINK}>home page</Link>. The same proof comes back.
      </p>

      <p style={{ ...BODY, margin: "0 0 40px" }}>
        Each image above also links directly to its own record.
      </p>
    </article>
  );
}
