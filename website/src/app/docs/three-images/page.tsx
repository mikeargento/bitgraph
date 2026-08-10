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

const BODY: CSSProperties = { fontSize: 16, lineHeight: 1.75, color: "#1f2937", margin: "0 0 14px" };

/* Display sequences. Tabular figures so the numbers align, and deliberately NOT
   brand blue: every other blue number on this page links to a proof. */
const SEQ: CSSProperties = {
  fontSize: 19, lineHeight: 1.7, fontWeight: 600, color: "#111827",
  fontVariantNumeric: "tabular-nums", margin: "0 0 14px",
};

const LINK: CSSProperties = { color: "#0065A4", textDecoration: "none", fontWeight: 600 };

const EPOCH = "2bx9IFX9ZOoY5HSwlZstSEGx1PWv8DncGofdK5v93jQ";

/* Everything on this page was read out of the files or the ledger, never
   asserted. Manifests decoded with the same toolkit the proof pages use; block
   numbers, times and positions re-derived from the live API. If a line changes,
   re-measure first: the whole value of the page is that a reader can reproduce
   it. The measured record lives in occ/HANDOFF-THREE-IMAGES.md.

   ⚠️ Facts that have each been broken once and must not be broken again:
   · GENERATED, not copied. Grok and ChatGPT declare c2pa.created with
     trainedAlgorithmicMedia; Gemini declares c2pa.edited producing a composite.
     "Copy" invites the reader to picture a duplicate, which quietly answers the
     question the page asks, since a duplicate could be matched by its bytes.
   · Grok appears in Gemini's file as `inputTo`, NOT as a parent. The parentOf
     chain is Google to Google to Google and terminates.
   · The C2PA parent reference IS cryptographically bound (32-byte hash of the
     ingredient assertion, assertion.hashedURI.match, claimSignature.validated).
     What is unproven is the assertion, never the binding.
   · "credential" = the C2PA thing. "record" = a BitGraph. Never swap them.
   · "recording", never "file", is what gets a place: one file holds two.
   · Re-encoding any hosted image breaks its proof page, because the hash guard
     refuses bytes that do not hash to the digest in the URL. */
export default function ThreeImagesPage() {
  const cells = [
    { src: "/example/two-images/grok.jpg", w: 1248, h: 832, cap: "Grok", sub: "generated from the original", pos: "8,034", d: "XWWLhzD5efJ5FIukRTCGcOmWupaW2lELFzI1dPyX078", c: "8034",
      says: ["created, no parents", "names no input", "self-signed, LOCAL USE ONLY"] },
    { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the original", pos: "8,038", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8038",
      says: ["created, no parents", "the true origin", "signed by OpenAI OpCo, LLC"] },
    { src: "/example/two-images/gemini.png", w: 1536, h: 1024, cap: "Gemini", sub: "generated from the Grok image", pos: "8,146", d: "1nyxWqQNa3KsIwo7i7kfHlyMqwh1_776Ht7ZjJU1W70", c: "8146",
      says: ["composite, one parent", "carries Grok's manifest as an input", "signed by Google LLC"] },
    /* THE SAME FILE as the second cell, byte for byte. Its lines match that
       cell's because nothing about the file changed; only the number moves. */
    { src: "/example/two-images/chatgpt.png", w: 1536, h: 1024, cap: "ChatGPT", sub: "the same file, BitGraphed again", pos: "8,664", d: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY", c: "8664",
      says: ["created, no parents", "the true origin", "signed by OpenAI OpCo, LLC"] },
  ];

  const cell = (im: (typeof cells)[number]) => (
    <figure key={im.pos} style={{ margin: 0 }}>
      <Link href={`/proof/${im.d}?counter=${im.c}&epoch=${EPOCH}`} className="bg-arrow-link" style={{ textDecoration: "none", display: "block" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={im.src} width={im.w} height={im.h} loading="lazy" alt=""
          style={{ width: "100%", height: "auto", display: "block", border: "1px solid #d0d5dd" }} />
        <figcaption style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700, color: "#111827" }}>{im.cap}</span>
          <span style={{ color: "#4b5563" }}>{"  ·  "}{im.sub}</span>
          <br />
          <span style={{ color: "#0065A4", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            BitGraph #{im.pos} <span className="arrow" aria-hidden>&rarr;</span>
          </span>
          <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "#4b5563", lineHeight: 1.7 }}>
            {im.says.map((line) => <span key={line} style={{ display: "block" }}>{line}</span>)}
          </span>
        </figcaption>
      </Link>
    </figure>
  );

  return (
    <article className="prose-doc">
      <h1 className="mb-6">Where, not when.</h1>

      {/* THE WAY IN. No jargon at all: no manifest, no provenance, no hash, no
          signature. Those arrive once the pictures give them something to
          attach to. It carries no device: larger type, a white fill and a
          hairline outline were each tried and each came off. */}
      <p style={BODY}>
        The pictures below look almost the same. Each was made by a different AI
        company, each one generated from the picture before it.
      </p>

      <p style={BODY}>
        Every one carries a credential inside the file, signed by the company
        that made it, describing where the picture came from. Those credentials
        label the files.
      </p>

      <p style={{ ...BODY, margin: "0 0 30px" }}>
        BitGraph does something different. Each time a file is recorded, that
        recording gets a place in a sequence.
      </p>

      <p style={BODY}>
        On August 10, 2026, an image was generated with ChatGPT from a prompt.
        Grok generated its own version from that. Gemini generated another from
        Grok&apos;s.
      </p>

      <p style={BODY}>
        None of these is a copy. Each is new pixels, so no hash matches one to
        another. You can see they are related. You cannot see which came first.
      </p>

      <p style={BODY}>They were not BitGraphed in that order.</p>

      <div className="bg-c2pa-grid" style={{ margin: "34px 0 56px" }}>{cells.map(cell)}</div>

      <p style={BODY}>
        Google did the careful thing. Its earliest manifest says it created the
        image and names the Grok picture as an input, which is what happened.
        Grok&apos;s manifest says it created its image too, and names no input
        at all.
      </p>

      <p style={BODY}>Both declare a creation. One names what it was given.</p>

      <p style={BODY}>
        So the trail ends at Grok. The ChatGPT original appears nowhere in
        Gemini&apos;s file, and nothing in any of the three records that the
        Grok image was generated from it. Everything downstream of the break
        inherits a false origin, signed correctly by companies that did nothing
        wrong.
      </p>

      <p style={BODY}>
        Nor can the files be put in order from what they carry. They share no
        independent clock: any time they hold is part of what a signer asserts,
        and one holds none.
      </p>

      <p style={BODY}>
        <strong>The assertion and the order are two different things.</strong>
      </p>

      <p style={BODY}>
        BitGraph does not decide which file deserves to come first. It gives
        each recording a place.
      </p>

      <p style={SEQ}>8,034 &rarr; 8,038 &rarr; 8,146</p>

      <p style={BODY}>
        The derivative comes before the original because the derivative was
        BitGraphed first. That looks wrong if you are reconstructing the history
        of the images. It is exactly right if you are recording the order in
        which the bits arrived.
      </p>

      {/* The HASH does the cryptographic work, not the timestamp. Named only as
          "a public time", a technical reader concludes the claim rests on the
          block's timestamp field, the one part a proposer has latitude over. */}
      <p style={BODY}>
        A place is only useful if it cannot be rearranged afterward. Every few
        seconds the sequence records an Ethereum block hash exactly as it
        records an image, and a block hash cannot be known before its block
        exists. So anything at an earlier position was recorded before that hash
        was available.
      </p>

      {/* Re-derived from the live ledger: #8,146 sits between anchors #8,144
          and #8,148, holding blocks 25725064 and 25725065, published 14:02:23
          and 14:02:35 UTC. */}
      <p style={BODY}>
        That is also how order acquires a clock. A BitGraph of block{" "}
        <a href="https://etherscan.io/block/25725064" target="_blank" rel="noopener noreferrer" style={LINK}>25,725,064</a>{" "}
        fixes a position against a public event. The Gemini image sits at{" "}
        <strong>8,146</strong>, between that anchor and one holding block{" "}
        <a href="https://etherscan.io/block/25725065" target="_blank" rel="noopener noreferrer" style={LINK}>25,725,065</a>,
        published twelve seconds later. The recording happened between them.
      </p>

      <p style={BODY}>
        Not because Gemini said so. Not because BitGraph typed a timestamp into
        a database. So the place can be checked by someone who believes none of
        the manifests, and by someone who does not trust BitGraph.
      </p>

      <p style={BODY}>
        The fourth picture is the second one again. The same file, the same
        bits, BitGraphed a second time at <strong>8,664</strong>.
      </p>

      <p style={BODY}>
        Recording it again did not overwrite 8,038 or improve its provenance. It
        created another position. A label belongs to the file; this file now
        holds two places.
      </p>

      <p style={BODY}>There is a fifth record. This one is mine.</p>

      {/* Full width and alone. The grid is the comparison; this is the turn, and
          a fifth cell would file it as another specimen.

          ⚠️ NOT a forgery and must never be written up as one. Lightroom
          declared the ChatGPT original as parentOf, carried its manifest, and
          its only action is c2pa.opened. Everything was done properly and the
          name still is not established, which is the entire point. */}
      <figure style={{ margin: "34px 0 40px" }}>
        <Link href={`/proof/vT7YbZArhPWqFMLHh_bRLT-_SwQ30uDM33B5pAFLY_U?counter=9510&epoch=${EPOCH}`} className="bg-arrow-link" style={{ textDecoration: "none", display: "block" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/example/two-images/mikeargento.jpg" width={1536} height={1024} loading="lazy" alt=""
            style={{ width: "100%", height: "auto", display: "block", border: "1px solid #d0d5dd" }} />
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
        Credentials turned on. Lightroom did everything correctly: it named the
        ChatGPT manifest as the parent, carried it inside the file, and Adobe
        signed that relationship.
      </p>

      {/* Grant the format its strongest case. The binding is real; what is
          unproven is the assertion, which is the boundary the C2PA spec itself
          draws. Saying less than this invites "you do not understand C2PA". */}
      <p style={BODY}>
        So the credential proves exactly which manifest was named, and that the
        naming has not been altered. What it cannot prove is the assertion
        itself: that this image was actually made from that one. That came from
        the software. Adobe signed it. Grok&apos;s manifest was made under the
        same rule, and it named no parent at all.
      </p>

      <p style={BODY}>Then look at who it says made it.</p>

      {/* The field is `dc:creator` inside a `cawg.metadata` assertion. The
          prefix is dropped: it stops a reader to wonder what "dc" is at exactly
          the moment they should be thinking "someone typed that". */}
      <p style={{ ...BODY, margin: "0 0 18px" }}>
        <code>creator: Mike Argento</code>
      </p>

      <p style={BODY}>
        That is a text field. I typed it. The signature proves it has not been
        altered since Adobe signed it, and nothing about whether it is true.
      </p>

      {/* ❄️ "And you did not believe it" was here and gambled on the reader's
          reaction. A reader who DID believe it falls out of the argument at its
          most important moment. The fact is about the credential, not them. */}
      <p style={BODY}>
        Nothing inside the credential gives you a reason to believe the claim.
        The cryptography preserves an assertion perfectly without establishing
        the authority behind it. If I had actually taken this photograph, the
        credential would look exactly the same.
      </p>

      {/* ❄️ "Fatal if you are a county clerk" overshot: a clerk's authority is
          established by other means. The real limit is narrower and more
          interesting, that credentials do not make it portable. */}
      <p style={BODY}>
        A signature does not create authority. It carries authority established
        somewhere else. That works when the signer is already globally
        recognized. It is much harder for a county clerk, a testing lab, a
        claims adjuster, or a photographer, whose legitimacy exists inside a
        domain rather than in worldwide name recognition.
      </p>

      <p style={BODY}>
        BitGraph does not solve that by deciding whose claim deserves belief. It
        records where the claim entered the sequence.
      </p>

      <p style={SEQ}>8,034 &rarr; 8,038 &rarr; 8,146 &rarr; 8,664 &rarr; 9,510</p>

      <p style={BODY}>
        My record is last. Not because anyone weighed my claim against theirs,
        but because it was BitGraphed last. That does not require me to be
        believed, or Adobe, or OpenAI, or Google, or Grok.
      </p>

      <p style={BODY}>
        These happen to be images. BitGraph does not know what the bits
        represent, and the same logic applies to a document, a video, a dataset,
        a contract, or any other file.
      </p>

      <p style={BODY}>
        <strong>
          A label needs you to trust whoever applied it.
          <br />
          A place remains where it is even when nobody trusts anyone.
        </strong>
      </p>

      <p style={BODY}>
        That is what an authority needs from a record. Not a louder way to say
        who it is. Somewhere to point.
      </p>

      {/* ❄️ THE PAGE ENDS HERE. Three colophon paragraphs stood after this line,
          then one, then none. Anything after it is a comedown. */}
      <p style={BODY}>
        It needs a <strong>where</strong>.
      </p>
    </article>
  );
}
