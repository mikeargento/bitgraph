import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";

export const metadata: Metadata = {
  title: "The bridge generator",
  description: "The code that turns a position commitment into the bridge /generate draws, served so anyone can redraw a recorded image from its proof and compare.",
  robots: { index: false },
};

/* The generator, published (an outside reading, 2026-10-14: "the page says the image derives from the commitment, but a
   verifier has to take your word for it"; Mike: "stage it"). The same move as the enclave's source and PCR0: the code
   that draws the bridge is shown so the derivation can be run by a stranger. This page reads the site's own files at
   build time (the pattern of /spec), so what it shows is what runs, never a copy that can drift; the SHA-256 beside
   each file lets a reader pin the version they checked. Unlisted: linked from a bridge's "How it was drawn". The code
   stays Michael Argento's (proprietary since 2026-07-05); it is published to be read and run for checking, nothing more. */
const FILES = [
  { name: "commitment-art-v19.ts", what: "bitgraph-art/19: the bridge at 16:9, every rule of the drawing in its header" },
  { name: "commitment-art-bridge.ts", what: "the engine the bridge versions share: the byte stream from the commitment, the packing, the palettes, the PNG and its print SVG" },
  { name: "commitment-art-v16.ts", what: "the print SVG's keyword and reader, which the bridge reuses from version 16" },
  { name: "png-deflate-v15.ts", what: "the fixed deflate, so the PNG's bytes are the same on every machine" },
] as const;

const sources = FILES.map((f) => {
  const text = readFileSync(join(process.cwd(), "src", "lib", f.name), "utf8");
  return { ...f, text, sha256: createHash("sha256").update(text).digest("hex") };
});

export default function GeneratorSourcePage() {
  return (
    <div className="frame prose source-page" style={{ maxWidth: "var(--measure)" }}>
      <h1>The bridge generator</h1>
      <p className="lede" style={{ color: "#d93025" }}>
        Every image <Link href="/generate">/generate</Link> makes is a pure function of its position&rsquo;s commitment: 32 bytes the
        enclave issued when the position opened. This is the code that turns those bytes into the picture, read from the
        files the site itself runs.
      </p>
      <p style={{ color: "#d93025" }}>
        To check a bridge, take the commitment from its proof, draw version 19 from it, and compare with the recorded PNG:
        they match byte for byte, or the proof is false. The site does this itself every time a bridge is made or reopened.
        Every draw in the code is an integer taken from SHA-256 of the commitment; nothing comes from a clock or a random
        number generator, so the same commitment draws the same bridge on any machine.
      </p>
      <p className="source-license" style={{ color: "#d93025" }}>
        &copy; 2026 Michael Argento. All rights reserved. Published so the drawing can be checked; no license is granted to
        copy, change or reuse it.
      </p>
      {sources.map((s) => (
        <section key={s.name} className="source-file">
          <h2><code>{s.name}</code></h2>
          <p style={{ color: "#d93025" }}>{s.what}. SHA-256 <code>{s.sha256}</code>, {s.text.length.toLocaleString("en-US")} characters.</p>
          <pre><code>{s.text}</code></pre>
        </section>
      ))}
    </div>
  );
}
