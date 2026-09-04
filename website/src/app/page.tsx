"use client";

import Link from "next/link";
import { BitGraphCamera } from "@/components/bitgraph-camera";
import { anonymous } from "@/lib/commit-strategy";

/**
 * Home: the camera, with the plain commit.
 *
 * The implementation is components/bitgraph-camera.tsx, shared with /actor
 * since 2026-08-19 (the seam is lib/commit-strategy.ts). What is left here is
 * what is home's alone: its title, the one link under the frame, and the two
 * style rules those carry.
 *
 * Rules this page must not break:
 *   - the box NEVER prompts. A first-time visitor drops a file and gets a
 *     proof, with no dialog and no decision.
 *   - an undeclared recording is not the degraded one. Order, slot binding and
 *     anchors are identical either way; only the who differs, and here there
 *     is none. An enrolled browser still records anonymously from this page,
 *     and should: the shared chain's anonymity set is every recording.
 */
export default function BitGraphPage() {
  return (
    <>
      <style>{`
        /* The box IS the page (Mike, 2026-09-04): the h1 over it was dropped
           and its job passed to the drop headline, so that line carries the
           weight a page title carried. The document keeps a real h1 out of
           sight, since a home page with no heading is a hole for a screen
           reader and for a crawler. */
        .home-h1 {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip-path: inset(50%); white-space: nowrap;
        }

        .bitgraph-wrap.bitgraph-home {
          --fd-headline: clamp(24px, 5.8vw, 32px);
          --fd-weight: 600;
          --fd-hint-size: clamp(13px, 3vw, 14px);
          --fd-subhint-size: clamp(13px, 3vw, 14px);
          --fd-subhint: #4b5563;
        }
        .bitgraph-wrap.bitgraph-home .fd-headline {
          font-size: clamp(24px, 5.8vw, 32px) !important;
          font-weight: 600; letter-spacing: -0.015em;
        }

        /* Centred in what is left of the viewport under the nav. The flow mode
           this page uses lays out from the top, which left the box tight under
           the bar. The nav is subtracted twice: once because the region starts
           below it, once so the block's centre lands on the viewport's centre
           rather than a nav-height low. Padding, not margin, so the composition
           can still grow past the viewport on a short window. */
        .bitgraph-wrap.bitgraph-home.bitgraph-flow {
          min-height: calc(100dvh - 116px);
          justify-content: center;
          padding: 24px 0;
        }
        /* Centred on a phone too. The region is a min-height, not a height, so
           when the box outgrows the viewport the wrap grows with it and the
           page scrolls rather than clipping. */
        @media (max-width: 640px) {
          .bitgraph-wrap.bitgraph-home.bitgraph-flow { padding: 20px 0 28px; }
        }

        /* The frame grows to what it holds. The explainer moved inside it on
           2026-09-04, so a fixed height would either crop the paragraph or
           leave a hole under it; every ratio and cap the shared box carries is
           dropped here for that reason.

           ⚠️ Four classes, not three. The camera's own sheet carries
           .bitgraph-wrap.bitgraph-flow .bitgraph-camera at max-height 300px,
           and that sheet is rendered after this block, so at equal specificity
           the cap won: the wrapper stayed 300 tall while the dashed frame drew past it
           and the footer rode up over the last line of the paragraph. */
        .bitgraph-wrap.bitgraph-home.bitgraph-flow .bitgraph-camera {
          aspect-ratio: auto; height: auto; max-height: none; min-height: 0;
        }
        /* Room inside the dashes. The shared box gives its copy 20px at each
           end, which is right when the copy is three short lines and cramped
           once a paragraph is in there. The child is FileDrop's bordered
           surface, which is also the click target, so the padding is part of
           the target rather than a margin around it. */
        .bitgraph-wrap.bitgraph-home .bitgraph-camera > div { padding: 52px 40px; }
        /* Barely any side padding on a phone: FileDrop already insets its own
           copy, and every pixel here comes straight off a measure that is only
           ~30 characters to begin with. */
        @media (max-width: 640px) {
          .bitgraph-wrap.bitgraph-home .bitgraph-camera > div { padding: 30px 10px; }
        }

        /* The mechanism, last in the frame, under the two operating lines. It
           reads ragged right, never centred: a nine-line paragraph centred
           starts every line at a different place, which reads as display type
           and not as prose. Held to 600 inside the 800 frame: at the frame's
           full width a 16px line runs past 100 characters, which is past what
           the eye tracks back from. */
        .how {
          text-align: left; font-size: 16px; line-height: 1.7; color: #1f2937;
          margin: 30px auto 0; max-width: 600px;
          text-wrap: pretty;
        }
        /* Chromium's text-wrap pretty only rescues a SINGLE stranded word, so
           the tail of the closing sentence could still drop alone onto its own
           line. The last four words are bound instead, so whatever the measure,
           the final line is a whole clause. */
        .how .no-orphan { white-space: nowrap; }

        @media (max-height: 700px) { .how { font-size: 15px; line-height: 1.6; } }
        /* On a phone the measure is ~34 characters, so the paragraph runs to 13
           lines at 16px and the box is most of two screens. 15/1.6 pulls it
           back without dropping under the site's reading size. */
        @media (max-width: 640px) { .how { font-size: 15px; line-height: 1.6; margin-top: 20px; } }
      `}</style>
      <h1 className="home-h1">A BitGraph gives bits a place</h1>
      <BitGraphCamera
        id="home"
        strategy={anonymous}
        fuseByDefault
        acceptsPendingDrop
        fitViewport={false}
        /* Both operating lines lead, directly under the headline; the mechanism
           closes the stack. They ride in the note/subhint slots rather than
           hint/subhint because only those two are ordered that way in FileDrop.
           The privacy line was moved below the frame on 2026-09-04 and put
           back: the frame is the click surface, and the lines that describe it
           belong on it. */
        dropHint=""
        frameNote={
          <>
            Choose files, or drag in a whole folder.
            <div style={{ marginTop: 6 }}>Hashed in your browser, never uploaded.</div>
          </>
        }
        dropSubhint={
          <p className="how">
            A file is chosen. A position is opened with nothing from that file in the request.
            The enclave reveals the signed slot, and only then can the new file be finished, because
            its final ingredient comes from that slot. You hash the finished bytes and send the
            digest back, with the original file&rsquo;s hash attached as a declaration. The enclave
            spends the position on that digest, and it can never be spent again. It
            signs a record binding the digest to that position, linked to the proof before it. The hardware
            attests which code produced it, and this record in particular. The{" "}
            <span className="no-orphan">signed record is a BitGraph.</span>
          </p>
        }
      />
    </>
  );
}
