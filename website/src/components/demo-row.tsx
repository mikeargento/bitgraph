"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * Pictures with their proofs, as tiles: a caption, the picture, and a link to its proof.
 *
 * Both rows are the fourth demo (/pictures): three files, three BitGraphs, twice. DemoRow is a picture made with
 * ChatGPT, copied by Google, then turned into a video by Grok. They look alike and are different bytes, so each has
 * its own proof. CopiesTiles is one photograph in three files, recorded one after the other.
 *
 * The page shows light display copies (resized pictures, a re-encoded silent video); each proof page shows the exact
 * file its proof covers (public/demo/, unchanged from the bytes recorded).
 *
 * The captions on the demo say who made each file. That is our caption, not a claim of the proof: a BitGraph proves
 * where the exact bytes stand in the sequence and when, not which tool made them.
 */
type Demo = { caption: string; place?: string; alt?: string; eager?: boolean; counter: string; proof: string; display: string; video?: { src: string }; bw?: boolean };

// The demo's first row: a picture, its copy and its video, recorded 2026-11-02 as #304, #308 and #312 of one epoch.
// Each caption follows the Content Credentials inside its file (OpenAI's, Google's with the OpenAI picture as its
// ingredient, xAI's). The row is shown in black and white (bw), a filter on the display copy; each proof covers its
// file as it is.
const EARLIER = "KmoEizbgaaeMeM-RMn6VuHvghxj9ZfyR9MV-hEpCrbs";
export const DEMOS: Demo[] = [
  { place: "1st", caption: "Created by ChatGPT", counter: "304", proof: `/proof/-yO5aQPDBxTTeFvV_ObC4__SkVHUMInfOsERBQSt6HA?counter=304&epoch=${EARLIER}`, display: "/demo/display/chatgpt.jpg", bw: true },
  { place: "2nd", caption: "Copied by Google", counter: "308", proof: `/proof/gZmj_LsVVoSgLYf8g0cZWNE5-5zXcSmNfpqTpqNShE8?counter=308&epoch=${EARLIER}`, display: "/demo/display/google.jpg", bw: true },
  { place: "3rd", caption: "Animated by Grok", counter: "312", proof: `/proof/VqIapIXBNyc-qhSurPKetHl1fpeznjL91M_uNDqIdpM?counter=312&epoch=${EARLIER}`, display: "/demo/display/grok-poster.jpg", video: { src: "/demo/display/grok.mp4" }, bw: true },
];

// The demo's second row: one photograph in three files, recorded one second apart as #20, #22 and #24 of one epoch,
// one unbroken run (2026-11-10). The pixels are identical and the bytes are not: each file carries a one-line comment,
// "Copy 1 of 3", "Copy 2 of 3" and "Copy 3 of 3", so any two differ by a single character and each has its own hash
// and its own proof. Nothing in the pictures tells them apart; their places in line do. All three tiles show one
// display copy; each proof page shows the exact file its proof covers. The same three files also hold #58, #62 and
// #66 of an earlier epoch, which is where the names of the files in public/demo/ come from.
const COPIES_EPOCH = "lz0ooY9N_eJ1rXvmIl0eLdcSQX4-0Vh9ppOSEzfm2fo";
const COPIES_ALT = "Boats moored along a dock in a harbor, with shingled buildings behind them";
export const COPIES: Demo[] = [
  { caption: "1st", alt: COPIES_ALT, counter: "20", proof: `/proof/7roNTix7clHFjNuPKoI2pEOfXcCN5seMP2JgCgTWhrg?counter=20&epoch=${COPIES_EPOCH}`, display: "/demo/display/harbor.jpg" },
  { caption: "2nd", alt: COPIES_ALT, counter: "22", proof: `/proof/bz7-raVGaSIYKEPO7DIgGcEdoIvb2wSQ4ekyw1pOFhg?counter=22&epoch=${COPIES_EPOCH}`, display: "/demo/display/harbor.jpg" },
  { caption: "3rd", alt: COPIES_ALT, counter: "24", proof: `/proof/9EDdSdS1KUrBbfoTx0Bmn1OLzeIRGQb5BHLtDn-GTOo?counter=24&epoch=${COPIES_EPOCH}`, display: "/demo/display/harbor.jpg" },
];

// Each set's place in line (1st, 2nd, 3rd) leads its caption on the demo tiles. The tiles load as they come into view.
function Media({ d }: { d: Demo }) {
  if (d.video) return <video className="demo-media" src={d.video.src} poster={d.display} autoPlay loop muted playsInline aria-label={d.alt ?? d.caption} />;
  return <img className="demo-media" src={d.display} alt={d.alt ?? d.caption} loading={d.eager ? "eager" : "lazy"} />;
}

/** The home hero's background: the video, muted on a loop from the first moment, under a dark wash; its proof in the
 *  corner. With reduced motion asked for, its still frame instead. */
export function HeroVideo() {
  const d = DEMOS.find((x) => x.video)!;
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false); }, []);
  return (
    <>
      <div className="hero-bg" aria-hidden="true">
        {still
          ? <img src={d.display} alt="" />
          : <video src={d.video!.src} poster={d.display} autoPlay loop muted playsInline />}
      </div>
      <p className="hero-credit">
        {d.caption} &middot; <a href={d.proof}>View proof</a>
      </p>
    </>
  );
}

function Tile({ d }: { d: Demo }) {
  return (
    <figure className={`demo-tile${d.video ? " is-video" : ""}${d.bw ? " is-bw" : ""}`}>
      {/* The picture opens its proof too; the View proof link below is the one in the tab order. */}
      <a className="demo-media-link" href={d.proof} tabIndex={-1} aria-hidden="true"><Media d={d} /></a>
      <figcaption>
        <div className="demo-caption">{d.place ? <>{d.place} &middot; </> : null}{d.caption}</div>
        <div className="demo-links">
          <a href={d.proof}>View proof</a>
        </div>
      </figcaption>
    </figure>
  );
}

/** A home tile: the photograph, and under it one link that says where it stands among the three. The order is the
 *  only thing on the page that tells them apart, so it is the whole caption; the proof it opens gives the number. */
function CopyTile({ d }: { d: Demo }) {
  return (
    <figure className="demo-tile">
      <a className="demo-media-link" href={d.proof} tabIndex={-1} aria-hidden="true"><Media d={d} /></a>
      <figcaption><a className="demo-place" href={d.proof}>{d.caption}</a></figcaption>
    </figure>
  );
}

/** The home page's three tiles: one photograph in three files, side by side, one over each card below. */
export function CopiesRow() {
  return (
    <div className="demo-row is-copies">
      {COPIES.map((d) => <CopyTile key={d.counter} d={d} />)}
    </div>
  );
}

/** The demo's second row, in color and square: the same photograph in three files, each captioned with its place. */
export function CopiesTiles() {
  return (
    <div className="demo-row is-square">
      {COPIES.map((d) => <Tile key={d.counter} d={d} />)}
    </div>
  );
}

export function DemoRow() {
  return (
    <div className="demo-row">
      {DEMOS.map((d) => <Tile key={d.counter} d={d} />)}
    </div>
  );
}
