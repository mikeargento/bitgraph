"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * Three files, three BitGraphs, twice (2026-10-31, and a second set 2026-11-05): a picture made with ChatGPT, copied by
 * Google, then turned into a video by Grok. They look alike and are different bytes, so each has its own proof. The video plays behind the home hero from
 * the first moment, captioned with its own proof; all three sit side by side further down, in the order they were made. The page shows light
 * display copies (resized pictures, a re-encoded silent video); each proof page shows the exact file its proof covers
 * (public/demo/, unchanged from the bytes recorded).
 *
 * The captions say who made each file. That is our caption, not a claim of the proof: a BitGraph proves where the
 * exact bytes stand in the sequence and when, not which tool made them.
 */
type Demo = { caption: string; counter: string; proof: string; display: string; video?: { src: string }; bw?: boolean };

// Two sets, six files: a new picture, its copy and its video (2026-11-05, #30, #34 and #38 of one epoch), and the earlier
// three, re-recorded 2026-11-02 in the first epoch of per-record Base writes. Each caption follows the Content
// Credentials inside its file (OpenAI's, Google's with the OpenAI picture as its ingredient, xAI's). The first row is
// the earlier stills around the new video; the second row is the new stills around the earlier video. The page shows
// every other tile in black and white (bw), a checkerboard across the two rows; that is a filter on the display copy,
// and each proof covers its file as it is.
const NEW = "GCFxJ90RSg66_o4_Ri5ya4n9A626Jmp6k2zSeqxphgc";
const EARLIER = "KmoEizbgaaeMeM-RMn6VuHvghxj9ZfyR9MV-hEpCrbs";
export const DEMOS: Demo[] = [
  { caption: "Created by ChatGPT", counter: "304", proof: `/proof/-yO5aQPDBxTTeFvV_ObC4__SkVHUMInfOsERBQSt6HA?counter=304&epoch=${EARLIER}`, display: "/demo/display/chatgpt.jpg", bw: true },
  { caption: "Animated by Grok", counter: "38", proof: `/proof/UXTJPyhZgvAOmkZpSOdhPBZ9PET5xf9sG9VR6qRNu50?counter=38&epoch=${NEW}`, display: "/demo/display/grok-38-poster.jpg", video: { src: "/demo/display/grok-38.mp4" } },
  { caption: "Copied by Google", counter: "308", proof: `/proof/gZmj_LsVVoSgLYf8g0cZWNE5-5zXcSmNfpqTpqNShE8?counter=308&epoch=${EARLIER}`, display: "/demo/display/google.jpg", bw: true },
  { caption: "Created by ChatGPT", counter: "30", proof: `/proof/Mcr7iOK5afl1x1iwwcTrwn3nFGR31RmRyTyTsHCU_JM?counter=30&epoch=${NEW}`, display: "/demo/display/chatgpt-30.jpg" },
  { caption: "Animated by Grok", counter: "312", proof: `/proof/VqIapIXBNyc-qhSurPKetHl1fpeznjL91M_uNDqIdpM?counter=312&epoch=${EARLIER}`, display: "/demo/display/grok-poster.jpg", video: { src: "/demo/display/grok.mp4" }, bw: true },
  { caption: "Copied by Google", counter: "34", proof: `/proof/hQU63cRe-SH06EW0ivMBewEj5u1OsrNIvlKpjpPOt_A?counter=34&epoch=${NEW}`, display: "/demo/display/google-34.jpg" },
];

function Media({ d }: { d: Demo }) {
  if (d.video) return <video className="demo-media" src={d.video.src} poster={d.display} autoPlay loop muted playsInline aria-label={d.caption} />;
  return <img className="demo-media" src={d.display} alt={d.caption} loading="lazy" />;
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
        <div className="demo-caption">{d.caption}</div>
        <div className="demo-links">
          <a href={d.proof}>View proof</a>
        </div>
      </figcaption>
    </figure>
  );
}

export function DemoRow() {
  return (
    <div className="demo-row">
      {DEMOS.map((d) => <Tile key={d.counter} d={d} />)}
    </div>
  );
}
