import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Where, not when",
  description:
    "Three AI images, each generated from the one before it, and what their Content Credentials can and cannot establish. A worked example with live proofs.",
  openGraph: {
    title: "Where, not when.",
    description:
      "Three AI images, each generated from the one before it, and what their Content Credentials can and cannot establish.",
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
   sentence this proves (that the order has to come from somewhere else, since
   a hash cannot say which file existed first) is made there. */
export default function ThreeImagesPage() {
  return (
    <article className="prose-doc">
      {/* The settled doctrine, near-verbatim: a proof asserts a PLACE, not a
          time (2026-08-08). This page is the evidence for it, so the title
          reinforces language the product already uses rather than inventing a
          frame for one page. The earlier draft ran nineteen words across two
          clauses of equal weight and had no turn in it. */}
      <h1 className="mb-6">Where, not when.</h1>

      {/* THE WAY IN. Written for someone with no technical background, so
          nothing in it may be jargon: no manifest, no provenance, no hash, no
          C2PA, no signature. Those words all arrive later, once the pictures
          have given them something to attach to.

          ⚠️ "credential", never "record", for the C2PA thing. This said "a
          small record inside the file" and "those records label the files",
          which collided head on with the noun the rest of the page uses for a
          BitGraph: "there is a fifth record", "my record is last", "two of the
          five records". The page would have taught the reader that a record is
          the thing INSIDE the file, then used the same word for the thing
          BitGraph creates, and telling those two apart is the entire point.
          Worse, the collision sat in the sentence that ends "label the files",
          and label is the word the close uses for the opposite of a place.

          "Credential" is also already the page's own word for a manifest ("
          nothing inside the credential itself gives you a reason to believe the
          claim"), and it primes Content Credentials, which is the name the
          reader meets a few lines down. Keep record for BitGraph alone.

          ⚠️ "recording", never "file" or "image", as the thing that gets a
          place, and the page itself is the proof. The fourth image section
          exists to show ONE file holding TWO places, 8,038 and 8,664, and the
          close turns on it: "a label belongs to the file … this file now
          occupies two places". Say BitGraph gives each FILE a place and the
          ending contradicts the opening. "Image" is wrong twice over, since
          BitGraph records any file at all.

          "Recording" is the only accurate noun and it is also the one the
          reader has not met yet, so the sentence defines it in passing rather
          than assuming it: a file is recorded, and THAT recording is the thing
          with a place. Do not shorten this back to "each recording a place".

          It carries no device at all. ❄️ Three were tried and
          all three came off: larger type competed with the argument, a white
          fill read as a card (this site's treatment for DATA, so it made an
          introductory paragraph look like a component), and even a bare
          hairline outline was too much furniture for five plain sentences.

          Nothing is left but position and a gap, which turns out to be enough:
          it sits directly under the h1, so it reads as the opening because it
          IS the opening. Do not re-add a frame.

          "The pictures below", not "the three pictures": there are four images
          and five records down there, and a count in the first sentence is a
          promise the page then breaks twice on purpose.

          ⚠️ This names the label/place frame UP FRONT, which reverses the rule
          that an inference put first is spent before the evidence arrives. It
          was a deliberate call: a cold visitor arriving from a link had no idea
          what BitGraph even is until halfway down, and the frame is a lens
          rather than the finding. The finding, that the chain breaks and no
          signature can establish order, is still discovered rather than
          announced, so the close still has work to do. */}
      {[
        "The pictures below look almost the same. Each was made by a different AI company. The first was generated from a prompt; each one after that was generated from the picture before it.",
        "Every one carries a small credential inside the file, signed by the company that made it, describing where the picture came from and what happened to it.",
        "Those credentials label the files.",
        "BitGraph does something different. Each time a file is recorded, that recording gets a place in a sequence.",
        "This page shows the difference.",
      ].map((text, i, all) => (
        /* The only thing separating the preface from the narrative is the gap
           after its last line: 30px against the 14px paragraph rhythm. */
        <p key={i} style={{ ...BODY, margin: i === all.length - 1 ? "0 0 30px" : "0 0 14px" }}>
          {text}
        </p>
      ))}

      {/* "from nothing" was the first draft and came out. It is vivid and it
          hands a reader an argument about training data that has nothing to do
          with this demo. "No parent image" is the claim actually being made,
          and it is the same claim the manifests make in c2pa terms. */}
      <p style={BODY}>
        On August 10, 2026, an image was generated with ChatGPT from a prompt,
        with no parent image. That image was given to Grok, which generated its
        own version of it. That version was given to Gemini, which generated
        another.
      </p>

      {/* ⚠️ "A copy was made with Grok" was wrong and had to go. Nothing here
          was duplicated: each file is model output, confirmed in the manifests
          (Grok and ChatGPT both declare c2pa.created with digitalSourceType
          trainedAlgorithmicMedia; Gemini declares c2pa.edited producing a
          composite). Saying "copy" invites the reader to imagine a duplicate,
          which quietly answers the question the page is asking, because a
          duplicate could be matched by its bytes. These share no bytes, so
          declared provenance is the ONLY thing that could ever relate them,
          which is precisely what breaks two paragraphs later. */}
      <p style={BODY}>
        {/* Two earlier versions of this sentence were too absolute. "They share
            no bytes with each other" is not true of any two files, and "nothing
            but what they declare could ever connect them" is false as well:
            perceptual matching, external logs and watermarks can all relate two
            images. This file set proves it, because ChatGPT's manifest declares
            `c2pa.watermarked.unbound`, so an unbound watermark sits in the
            pixels quite apart from anything declared. The claim is now only as
            strong as it needs to be, which is also harder to attack. */}
        None of these is a copy. Each is a new image, new pixels, generated by a
        different model from the picture before it. Their cryptographic hashes
        do not match, so an exact-content hash cannot connect one to another.
        The relationship has to come from provenance, or from evidence outside
        the files.
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
      {/* Three lines, not one wrapping sentence. Run together they wrapped so
          that "3rd." fell alone on the second line at desktop width, and an
          orphan is worse here than anywhere else on the page because the three
          ordinals ARE the content. As a stanza they cannot orphan at any width,
          they scan as a list, and they match the other <br/> stanzas. */}
      <p style={BODY}>
        The Grok image was BitGraphed 1st.
        <br />
        The ChatGPT original was BitGraphed 2nd.
        <br />
        The Gemini image was BitGraphed 3rd.
      </p>

      <p style={BODY}>
        An hour later, the exact same ChatGPT original was BitGraphed again.
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
          { src: "/example/two-images/grok.jpg", w: 1248, h: 832, cap: "Grok", sub: "generated from the original", pos: "8,034", d: "XWWLhzD5efJ5FIukRTCGcOmWupaW2lELFzI1dPyX078", c: "8034",
            says: ["created, no parents", "chain leads to itself", "self-signed, LOCAL USE ONLY"] },
          { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the original", pos: "8,038", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8038",
            says: ["created, no parents", "chain leads to itself", "signed by OpenAI OpCo, LLC"] },
          { src: "/example/two-images/gemini.png", w: 1536, h: 1024, cap: "Gemini", sub: "generated from the Grok image", pos: "8,146", d: "1nyxWqQNa3KsIwo7i7kfHlyMqwh1_776Ht7ZjJU1W70", c: "8146",
            /* "chain leads to the Grok image" was not what the file does: the
               parentOf chain is Google to Google to Google, and Grok is
               attached to the earliest of those as `inputTo`. Exact now. */
            says: ["composite, one parent", "carries Grok's manifest as an input", "signed by Google LLC"] },
          /* THE SAME FILE AS THE SECOND CELL, byte for byte, recorded again an
             hour later. Its three lines are deliberately identical to that
             cell's, because they ARE identical: nothing about the file changed.
             Only the number moves, which is the argument the prose makes,
             rendered instead of claimed. The caption has to say "the same file"
             out loud or a fourth picture in a section about a chain of copies
             reads as a fourth copy. */
          { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the same file, BitGraphed again", pos: "8,664", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8664",
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

      {/* ⚠️ REWRITTEN to describe the file exactly. The earlier version said
          Gemini "names a parent … follow it, and the chain ends at the Grok
          image", which is not what the file does. Measured structure:

            d9c29760  Google  opened, edited(composite), converted  parentOf->ccf3b092
            ccf3b092  Google  opened, resized                       parentOf->ab79ace3
            ab79ace3  Google  created(trainedAlgorithmicMedia)      inputTo ->35fc9069
            35fc9069  Grok    created(trainedAlgorithmicMedia)      (no ingredients)

          Two things the old copy got wrong. The parentOf chain is Google to
          Google to Google and terminates: Grok hangs off the earliest Google
          manifest as `inputTo`, so a parent walk never reaches it. And Google
          was MORE careful than the page credited, because that earliest
          manifest declares a creation and names its input, which is exactly
          what happened. Grok declares a creation and names nothing. That is the
          real contrast and it is sharper than the old one.

          ChatGPT's manifest (484d86b4) is absent from the store entirely,
          verified, not inferred. */}
      <p style={BODY}>Google did the careful thing.</p>

      {/* ⚠️ "each naming the one before it as its parent" was here and was
          false: only TWO of the three Google manifests name a parent. The
          earliest (ab79ace3) names none, which is the exact fact the "follow
          parents alone" paragraph below depends on, so the summary was
          contradicting its own argument four lines later. */}
      <p style={BODY}>
        The file carries four manifests. Three are Google&apos;s own, each a
        step in its own processing. The fourth is Grok&apos;s.
      </p>

      <p style={BODY}>
        Google&apos;s earliest manifest says it created the image, and records
        the Grok picture as an input to that work, which is exactly what
        happened.
      </p>

      <p style={BODY}>
        Grok&apos;s manifest says it created its image too, and records no input
        at all.
      </p>

      <p style={BODY}>
        That is the entire difference between them. Both declare a creation. One
        names what it was given.
      </p>

      <p style={BODY}>
        Follow parents alone and you never reach Grok. That chain runs Google to
        Google to Google and stops, because Google&apos;s earliest manifest
        declares no parent either. Grok sits beside it, recorded as an input
        rather than an ancestor.
      </p>

      <p style={BODY}>
        Either way the trail ends at Grok, and the ChatGPT original appears
        nowhere in the file.
      </p>

      <p style={BODY}>
        Nothing inside any of the three files records the fact that the Grok
        image was generated from the ChatGPT image.
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
        {/* "Google correctly signed what it received" was here and contradicted
            the passage above, which now says Google's earliest manifest
            declares a creation. Google generated the image; what it did right
            was name its input. */}
        Google signed correctly and named what it was given. OpenAI signed
        correctly and had nothing to name. Grok&apos;s file carries a self-signed
        certificate marked for local use only, something that can be created
        locally and made to name essentially anyone.
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
        {/* ⚠️ THE DEMO SENTENCE. It began as "The copy comes before the original
            because the copy was recorded first" and has been edited exactly
            twice, both times under protest and both times correctly.

            "Copy" had to go because nothing on this page is a copy, and leaving
            it would have contradicted the paragraph that says so. "Recorded"
            had to go because the page now uses BitGraphed as the verb wherever
            recorded could be misread as made, and this is the sentence where
            that confusion would cost the most.

            The paradox is what makes the line, so the shape and the doubling
            are preserved exactly. Only the two words move. */}
        The derivative comes before the original because the derivative was
        BitGraphed first.
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

      <p style={BODY}>Not a new version. Not another generation.</p>

      <p style={BODY}>
        <strong>The same file. The same bits.</strong>
      </p>

      <p style={BODY}>
        BitGraphed a second time at <strong>8,664</strong>.
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

      {/* THE CLOSE, and it is a fifth record rather than an inference.

          This replaced four abstract paragraphs ("Any authority that signs and
          stops is in the same position…"). The abstraction was correct and it
          asked the reader to take the last step alone. A picture with my own
          name on it, recorded last, makes the same argument out of evidence the
          reader can check, and it moves the page from a protocol demonstration
          to the buyer's own problem.

          ⚠️ This file is NOT a forgery and must never be written up as one.
          Measured before a word of this was drafted: Lightroom Classic 15.5
          declared the ChatGPT original as `parentOf`, carried its manifest, and
          the file holds a two-manifest chain that leads back correctly. Its
          only action is `c2pa.opened`; it claims no creation. The whole point
          is that everything here was done properly and the name still is not
          established. */}
      <p style={BODY}>There is a fifth record.</p>

      <p style={BODY}>This one is mine.</p>

      {/* Full column width, alone. The 2x2 grid is the comparison; this one is
          the turn, and putting it in a fifth cell would file it as another
          specimen. Same three caption lines as the grid so it is legible as the
          same kind of object. */}
      <figure style={{ margin: "34px 0 40px" }}>
        <Link
          href="/proof/vT7YbZArhPWqFMLHh_bRLT-_SwQ30uDM33B5pAFLY_U?counter=9510&epoch=2bx9IFX9ZOoY5HSwlZstSEGx1PWv8DncGofdK5v93jQ"
          className="bg-arrow-link"
          style={{ textDecoration: "none", display: "block" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/example/two-images/mikeargento.jpg"
            width={1536}
            height={1024}
            loading="lazy"
            alt=""
            style={{ width: "100%", height: "auto", display: "block", border: "1px solid #d0d5dd" }}
          />
          <figcaption style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 700, color: "#111827" }}>Mike Argento</span>
            <span style={{ color: "#4b5563" }}>{"  ·  "}a Lightroom export of the original</span>
            <br />
            <span style={{ color: "#0065A4", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              BitGraph #9,510 <span className="arrow" aria-hidden>&rarr;</span>
            </span>
            <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "#4b5563", lineHeight: 1.7 }}>
              <span style={{ display: "block" }}>opened, one parent</span>
              <span style={{ display: "block" }}>chain leads to the ChatGPT original</span>
              <span style={{ display: "block" }}>signed by Adobe Inc.</span>
            </span>
          </figcaption>
        </Link>
      </figure>

      <p style={BODY}>
        I opened the ChatGPT original in Lightroom and exported it with Content
        Credentials turned on.
      </p>

      <p style={BODY}>
        Lightroom did everything correctly. It declared the ChatGPT image as the
        parent, carried its manifest inside the file, and had Adobe sign the
        result.
      </p>

      <p style={BODY}>Follow this chain and it ends where it should.</p>

      {/* ⚠️ The page used to stop at the line above, which credited the chain as
          established fact. It is not one, and the distinction was measured:
          the ingredient carries `relationship: parentOf` and the parent's
          manifest label, and the ChatGPT manifest really is embedded and really
          does validate (claimSignature.validated, timeStamp.validated, OCSP not
          revoked). What is absent is any binding between this file's pixels and
          that file's pixels, and there structurally cannot be one, because
          editing changes the bytes. So the derivation is Lightroom's assertion,
          countersigned by Adobe.

          This matters more than it looks. It means the chain and the creator
          field are the same kind of object, which is what makes the creator
          paragraph below a second instance rather than a special case, and it
          is why Grok belongs in the callback: identical mechanism, opposite
          honesty. */}
      {/* ⚠️ "Nothing in the file proves this picture came from that one" stood
          here and understated what C2PA actually does, which invites the fair
          reply that the page does not understand the format. The parent
          reference is NOT a name in a text field, and it was measured on this
          exact file: the `c2pa.opened` action carries a 32 byte hash of the
          ingredient assertion, `assertion.hashedURI.match` validates for
          `c2pa.ingredient.v3`, and `claimSignature.validated` is true. Adobe's
          signature really does cover "the parent is urn:c2pa:484d86b4…,
          relationship parentOf".

          Granting that in full is the stronger move. The hashes work, the
          signatures work, the manifests work, and the assertion can still be
          wrong, which is a boundary the C2PA spec itself draws: validation is
          about whether assertions are well formed, properly associated and
          untampered, never about whether the claim is true.

          "which manifest" rather than "which file" on purpose: the ingredient
          binds ChatGPT's MANIFEST and the relationship, not a hash of the
          parent's pixels. There is no pixel-level binding and there structurally
          cannot be one, because editing changes the bytes. */}
      <p style={BODY}>Or rather, it ends where Lightroom says it should.</p>

      <p style={BODY}>
        The ChatGPT manifest is cryptographically identified as the parent,
        carried inside mine, and Adobe signed that relationship. So the
        credential can prove exactly which manifest Lightroom named as its
        source, and that the naming has not been altered since.
      </p>

      <p style={BODY}>
        What it cannot independently prove is the assertion itself: that this
        image was actually made from that one.
      </p>

      <p style={BODY}>
        That relationship came from the software that wrote the manifest.
      </p>

      <p style={BODY}>Adobe signed it.</p>

      <p style={BODY}>
        Grok&apos;s manifest was created under the same rule, and it asserted
        that its image had no parent at all.
      </p>

      {/* ❄️ A paragraph on the timestamp sat here: Adobe's countersignature
          comes from DigiCert, an independent authority, where OpenAI and Google
          each stamped the time with their own. It is a genuine finding and it
          is preserved in the handoff, but its only job was to maximise the
          credentials before "and you did not believe it", and that move is gone
          (see below). Orphaned, it read as a boast. Do not reinstate it without
          a sentence for it to serve. */}
      <p style={BODY}>Now look at what the manifest says about who made it.</p>

      {/* The field in the file is `dc:creator`, inside a `cawg.metadata`
          assertion. The namespace prefix is dropped here on purpose. Shown raw
          it stops a careful reader to wonder what "dc" is, at exactly the
          moment the page wants them thinking "that is a field someone typed",
          and explaining it costs a sentence of Dublin Core history that does no
          work for the argument. Both were tried and both came out.

          This is the same register the captions already use: "created, no
          parents" and "opened, one parent" are glosses too. A skeptic who
          decodes the file finds dc:creator and recognises it as this. */}
      <p style={{ ...BODY, margin: "0 0 18px" }}>
        <code>creator: Mike Argento</code>
      </p>

      <p style={BODY}>That is a text field.</p>

      <p style={BODY}>I typed it.</p>

      <p style={BODY}>
        The signature proves that the field has not been altered since Adobe
        signed the credential. It proves nothing about whether the field is
        true.
      </p>

      <p style={BODY}>
        Nobody checked that I am Mike Argento. Nobody checked that I made
        anything.
      </p>

      {/* ❄️ "And you did not believe it." stood here, followed by a paragraph
          diagnosing WHY ("you have never heard of me"). Both are gone, and the
          reason is worth keeping: they gambled on the reader's reaction. A
          reader who thinks "actually, I did believe it" falls straight out of
          the argument at its most important moment, and the argument does not
          need the gamble. The fact is about the credential, not about the
          reader: nothing inside it supplies a reason either way. Stating that
          is both safer and stronger, so do not restore the rhetorical version. */}
      <p style={BODY}>
        And there is nothing inside the credential itself that gives you a
        reason to believe the claim.
      </p>

      <p style={BODY}>That is the important distinction.</p>

      <p style={BODY}>
        The cryptography can preserve an assertion perfectly without
        establishing the authority behind the assertion.
      </p>

      <p style={BODY}>
        If I had actually taken this photograph, the credential could look
        exactly the same: same name, same Adobe signature, same validation.
      </p>

      <p style={BODY}>
        The difference between a true claim and a false one would have to come
        from somewhere outside the credential.
      </p>

      <p style={BODY}>A signature does not create authority.</p>

      <p style={BODY}>It carries authority established somewhere else.</p>

      {/* The buyer, named without naming them, and NOT told their situation is
          hopeless. "Fatal if you are a county clerk" overshot: a clerk's
          authority is well established by other means, and claiming otherwise
          is both wrong and insulting to the reader who holds it. The real
          limitation is narrower and more interesting: Content Credentials do
          not make that authority portable or self-authenticating. */}
      <p style={BODY}>
        That works easily when the signer is already globally recognized. It
        becomes much harder for a county clerk, a testing lab, a claims
        adjuster, a photographer, or any other authority whose legitimacy exists
        inside a particular domain rather than in worldwide name recognition.
      </p>

      <p style={BODY}>
        BitGraph does not try to solve that by deciding whose claim deserves
        belief.
      </p>

      <p style={BODY}>It records where the claim entered the sequence.</p>

      <p style={SEQ}>8,034 &rarr; 8,038 &rarr; 8,146 &rarr; 8,664 &rarr; 9,510</p>

      <p style={BODY}>My record is last.</p>

      <p style={BODY}>Not because anyone weighed my claim against theirs.</p>

      <p style={BODY}>
        Not because BitGraph decided I was not the creator.
      </p>

      {/* ⚠️ "hours after this picture had already been recorded four times" was
          wrong twice. The four earlier records are of THREE different pictures,
          which this page now insists on, so "this picture ... four times" undoes
          its own correction. And the gap is 1h27m from #8,664 and 2h30m from
          #8,034, so "hours" overstated the near one. Both figures read off the
          ledger: 8,034 at 13:51:35Z, 8,664 at 14:54:23Z, 9,510 at 16:21:47Z. */}
      <p style={BODY}>
        It is last because it was BitGraphed last, more than an hour after the
        fourth record and more than two after the first.
      </p>

      <p style={BODY}>That fact does not require me to be believed.</p>

      <p style={BODY}>
        It does not require Adobe, OpenAI, Google, or Grok to be believed either.
      </p>

      {/* The widening, and it sits HERE rather than at the end on purpose.

          The page never says this is not about pictures, and the reader it is
          aimed at, the clerk and the lab and the adjuster named a few lines up,
          deals in documents. Placed immediately before the couplet, those two
          abstract lines arrive with the frame already widened and read as
          universal instead of as being about images. Placed after "It needs a
          where" it would have been a second ending competing with the first.

          ❄️ A closing pair went with it and came out: "Bits can be labeled. /
          They can also be given a place." That is precisely what the couplet
          below already does, and two label/place couplets four lines apart
          blunt each other. The couplet absorbs it; nothing is lost. */}
      <p style={BODY}>These happen to be images.</p>

      <p style={BODY}>
        BitGraph does not know or care what the bits represent.
      </p>

      <p style={BODY}>
        The same logic applies to a photograph, a document, a video, a dataset,
        a model output, a contract, or any other digital file.
      </p>

      <p style={BODY}>
        <strong>
          A label needs you to trust whoever applied it.
          <br />
          A place remains where it is even when nobody trusts anyone.
        </strong>
      </p>

      {/* Mike's own phrase, near-verbatim, and the title's callback. "Somewhere
          to point" is what an authority is actually short of; it is not short
          of ways to say who it is. Broken into single lines because the last
          four beats are the landing, and "where" has been earned by now: at the
          top of the page it is an abstraction, and here 9,510 is literally the
          somewhere. */}
      <p style={BODY}>That is what an authority needs from a record.</p>

      <p style={BODY}>Not a louder way to say who it is.</p>

      <p style={BODY}>Somewhere to point.</p>

      <p style={BODY}>
        It needs a <strong>where</strong>.
      </p>

      {/* The count has to be right or a careful reader catches it on the last
          line of the page. FIVE records, FOUR distinct files: Grok, ChatGPT,
          Gemini, mine, and the ChatGPT file a second time. Recount this line
          whenever a record is added. */}
      <p style={BODY}>
        Every image on this page is the exact bytes that were recorded. Two of
        the five records are the same ChatGPT file, byte for byte.
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
