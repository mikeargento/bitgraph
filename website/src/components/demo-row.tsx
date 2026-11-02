"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect, useState } from "react";

/**
 * Three files, three BitGraphs (2026-10-31): one picture made with ChatGPT, copied by Google, then turned into a video by
 * Grok. They look alike and are different bytes, so each has its own proof. The video plays behind the home hero from
 * the first moment, captioned with its own proof; the two pictures sit side by side further down. The page shows light
 * display copies (resized pictures, a re-encoded silent video); each proof page shows the exact file its proof covers
 * (public/demo/, unchanged from the bytes recorded).
 *
 * The captions say who made each file. That is our caption, not a claim of the proof: a BitGraph proves where the
 * exact bytes stand in the sequence and when, not which tool made them.
 */
type Demo = { caption: string; counter: string; proof: string; display: string; video?: { src: string } };

// Re-recorded 2026-11-02 in the first epoch of per-record Base writes, so each proof shows its own Base write.
const EPOCH = "KmoEizbgaaeMeM-RMn6VuHvghxj9ZfyR9MV-hEpCrbs";
export const DEMOS: Demo[] = [
  { caption: "Made with ChatGPT", counter: "8", proof: `/proof/-yO5aQPDBxTTeFvV_ObC4__SkVHUMInfOsERBQSt6HA?counter=8&epoch=${EPOCH}`, display: "/demo/display/chatgpt.jpg" },
  { caption: "Made with Google", counter: "10", proof: `/proof/gZmj_LsVVoSgLYf8g0cZWNE5-5zXcSmNfpqTpqNShE8?counter=10&epoch=${EPOCH}`, display: "/demo/display/google.jpg" },
  { caption: "Animated by Grok", counter: "12", proof: `/proof/VqIapIXBNyc-qhSurPKetHl1fpeznjL91M_uNDqIdpM?counter=12&epoch=${EPOCH}`, display: "/demo/display/grok-poster.jpg", video: { src: "/demo/display/grok.mp4" } },
];

function Media({ d }: { d: Demo }) {
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
        {d.caption} &middot; BitGraph #{Number(d.counter).toLocaleString("en-US")} &middot; <a href={d.proof}>View proof</a>
      </p>
    </>
  );
}

function Tile({ d }: { d: Demo }) {
  return (
    <figure className={`demo-tile${d.video ? " is-video" : ""}`}>
      {/* The picture opens its proof too; the View proof link below is the one in the tab order. */}
      <a className="demo-media-link" href={d.proof} tabIndex={-1} aria-hidden="true"><Media d={d} /></a>
      <figcaption>
        <div className="demo-caption">{d.caption}</div>
        <div className="demo-num">BitGraph #{Number(d.counter).toLocaleString("en-US")}</div>
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
      {DEMOS.filter((d) => !d.video).map((d) => <Tile key={d.counter} d={d} />)}
    </div>
  );
}
