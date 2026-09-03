"use client";

import Link from "next/link";
import { BitGraphCamera } from "@/components/bitgraph-camera";
import { anonymous } from "@/lib/commit-strategy";
import { CopyLine } from "./copy-line";

/**
 * Home: the primitive, then the instrument, then the trust model.
 *
 * Rebuilt 2026-09-03 to a written brief. The page had been the drop box alone
 * under a headline that changed all evening, then the box plus an adoption
 * argument. Neither delivered the idea fast enough. The brief: a developer
 * lands here to answer four questions in order, what is this, what does it
 * uniquely guarantee, can I check that myself, how do I integrate, and the
 * page must answer them in that order. "Refactor the homepage around
 * comprehension, not feature completeness."
 *
 * So the mechanism leads and the interface follows. The box is still here and
 * still records on the first drop; it simply is not the first thing the page
 * says any more. "How BitGraph works" came off the box the same evening: the
 * section under it now answers that, so a link away from it was an exit from
 * the answer.
 *
 * Rules this page must not break:
 *   - the box NEVER prompts. A first-time visitor drops a file and gets a
 *     proof, with no dialog and no decision.
 *   - every claim is checkable from the repo or the published packages.
 *     Nothing here may outrun what the verifier will actually say.
 *   - one word for the record, and it is "ledger" (Mike, 2026-09-03). "Order"
 *     is the property that is proved; the ledger is where positions are
 *     published. Never two words for one thing.
 *   - no buttons, square corners, one weight for action links (site rules).
 */

const MCP_URL = "https://bitgraph.ing/mcp";

/** A package row: the name links to npm, the note says what it does. */
function Pkg({ name, note }: { name: string; note: string }) {
  return (
    <div className="pkg">
      <a href={`https://www.npmjs.com/package/${name}`} target="_blank" rel="noopener noreferrer" className="pkg-name">
        {name}
      </a>
      <span className="pkg-note">{note}</span>
    </div>
  );
}

/** A mechanism step: a monospace stage label, then what happens in that stage. */
function Step({ stage, children }: { stage: string; children: React.ReactNode }) {
  return (
    <div className="step">
      <div className="step-stage">{stage}</div>
      <div className="step-body">{children}</div>
    </div>
  );
}

export default function BitGraphPage() {
  return (
    <>
      <style>{`
        /* One measure for the whole page, the site's 800. */
        .hp { width: 90%; max-width: 800px; margin: 0 auto; }

        /* ── Hero. Type and space only: no illustration, no panel, no gradient.
              The claim, two sentences of mechanism, the install line, two
              actions. Sparse on purpose. ── */
        .hero { padding: 68px 0 26px; }
        @media (max-width: 640px) { .hero { padding: 40px 0 20px; } }
        .hero h1 {
          font-size: clamp(30px, 6.4vw, 44px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.08;
          color: #111827;
          margin: 0 0 18px;
          text-wrap: balance;
        }
        .hero p {
          font-size: clamp(16px, 2.2vw, 18px);
          line-height: 1.6;
          color: #1f2937;
          margin: 0 0 10px;
        }
        /* The install line. A command, so it is set as one: mono, hairline,
           square, no chrome around it. */
        .install {
          margin-top: 24px;
          border: 1px solid #d0d5dd;
          background: #fff;
          padding: 10px 12px 10px 14px;
          display: flex; align-items: center; gap: 14px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px;
          color: #1f2937;
        }
        .install-text { flex: 1 1 auto; min-width: 0; overflow-x: auto; white-space: nowrap; }
        .install .prompt { color: #9ca3af; user-select: none; }
        /* An action link, not a button-shaped button. It holds its width when
           the word changes, so the line does not shift under the pointer. */
        .install-copy {
          flex: 0 0 auto; background: none; border: none; padding: 0; cursor: pointer;
          font-family: inherit; font-size: 12px; font-weight: 600; color: #0065A4;
          min-width: 46px; text-align: right;
        }
        .install-copy:hover { color: #004b7a; }

        /* ── Sections. A hairline is the only divider; nothing is in a card. ── */
        .sec { padding: 44px 0; border-top: 1px solid #d0d5dd; }
        .sec h2 {
          font-size: 22px; font-weight: 600; letter-spacing: -0.02em;
          color: #111827; margin: 0 0 8px;
        }
        .sec .lede { font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 26px; }
        .sec p { font-size: 16px; line-height: 1.7; color: #1f2937; margin: 0 0 16px; }
        .sec p:last-child { margin-bottom: 0; }
        /* Task 4: exactly three lines on the page carry display weight, so the
           reader's eye has somewhere to land in ten sections of even text. A
           fourth would flatten all three again. Type scale and whitespace only. */
        .sec .display {
          font-size: clamp(20px, 3.2vw, 25px); font-weight: 600; letter-spacing: -0.02em;
          line-height: 1.35; color: #111827; margin: 0 0 14px;
        }
        .sec h3.sub { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: #111827; margin: 30px 0 10px; }
        .sec a { color: #0065A4; }

        /* Three stages. A label column and a text column, not three cards. */
        .step { display: grid; grid-template-columns: 168px 1fr; gap: 20px; padding: 14px 0; border-top: 1px solid #e2e5e9; }
        .step:first-of-type { border-top: none; padding-top: 0; }
        .step-stage {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12.5px; letter-spacing: 0.04em; text-transform: uppercase;
          color: #4b5563; padding-top: 3px;
        }
        .step-body { font-size: 16px; line-height: 1.7; color: #1f2937; }
        @media (max-width: 640px) {
          .step { grid-template-columns: 1fr; gap: 6px; }
          .step-stage { padding-top: 0; }
        }

        /* Packages, one per row: name in mono, note beside it. */
        .pkg { display: grid; grid-template-columns: 268px 1fr; gap: 20px; padding: 11px 0; border-top: 1px solid #e2e5e9; }
        .pkg:first-of-type { border-top: none; }
        .pkg-name {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px; color: #0065A4 !important; text-decoration: none; word-break: break-all;
        }
        .pkg-note { font-size: 15px; line-height: 1.6; color: #1f2937; }
        @media (max-width: 640px) { .pkg { grid-template-columns: 1fr; gap: 4px; } }

        /* The two calls, drawn the way a developer would sketch them. */
        .calls {
          border: 1px solid #d0d5dd; background: #fff; padding: 18px 16px; margin: 0 0 20px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px; line-height: 2; color: #1f2937; overflow-x: auto;
        }
        .calls .step-arrow { color: #9ca3af; }
        .calls .aside { color: #6b7280; }

        /* A short list of plain statements. No bullets, no icons: the bold lead
           is the marker. */
        .claims { margin: 0; padding: 0; list-style: none; }
        .claims li { padding: 13px 0; border-top: 1px solid #e2e5e9; font-size: 16px; line-height: 1.7; color: #1f2937; }
        .claims li:first-child { border-top: none; }
        .claims b { color: #111827; font-weight: 600; }

        /* The grant, quoted rather than paraphrased, because it is the sentence
           an adopter decides to rely on. */
        .grant {
          border-left: 3px solid #0065A4; padding: 2px 0 2px 20px; margin: 0 0 18px;
          font-size: clamp(17px, 2.6vw, 20px); line-height: 1.55; letter-spacing: -0.01em;
          color: #111827;
        }

        .links-row { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 22px; }
        .links-row a { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: #0065A4; text-decoration: none; }

        /* The box keeps its own composition; the page only gives it room. */
        .hero-more { margin: 0; }
      `}</style>

      {/* ── 1. Hero ───────────────────────────────────────────────────────── */}
      <div className="hp hero">
        <h1>Give bits a provable place.</h1>
        <p>
          BitGraph creates a cryptographic position before the file exists, then binds the finished
          bytes to it. The result is a proof of order anyone can verify offline.
        </p>
        <CopyLine text="npm install @mikeargento/bitgraph" />
      </div>

      {/* ── The instrument. Still one drop from a real proof, just no longer
             the first thing the page says. ─────────────────────────────────── */}
      {/* The box is the action; two links naming it above it were saying the
          same thing twice (Mike, 2026-09-03). */}
      <div id="make">
        <BitGraphCamera
          id="home"
          strategy={anonymous}
          fuseByDefault
          acceptsPendingDrop
          dropHeadline="Make or Check BitGraphs"
          dropHint="Choose files, or drag in a whole folder."
          fitViewport={false}
          belowClassName="hero-more"
        />
      </div>

      {/* ── 2. Mechanism ──────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>How it works</h2>
        <p className="display">The position is allocated first.</p>
        <p className="lede">That single fact is what the rest of the system exists to preserve.</p>
        <Step stage="Before the file">
          BitGraph allocates a single-use position inside a measured AWS Nitro enclave, from
          hardware entropy, while the file that will occupy it does not yet exist.
        </Step>
        <Step stage="Build the file">
          The new file is constructed to carry a commitment to that position, written into the bytes
          before they are finalized, as a documented trailer or container entry.
        </Step>
        <Step stage="After the file">
          The finished exact bytes are hashed, and that digest is committed into the same position
          the enclave held open. The position is consumed and cannot be reused.
        </Step>
      </div>

      {/* ── 3. The guarantee ──────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>What that establishes</h2>
        <p>
          A BitGraph is a file whose cryptographic position was allocated before the file existed,
          plus the signed proof that establishes that order.
        </p>
        <p>
          These exact bytes could not have been finalized before the position they occupy, and they
          existed no later than the position at which they were committed.
        </p>
        <p>
          That is a statement about order, not about time. BitGraph does not establish who created a
          file, what it means, whether its contents are true, an exact clock time, an identity, or
          authorship.
        </p>
      </div>

      {/* ── 4. Verify without BitGraph ────────────────────────────────────── */}
      <div className="hp sec">
        <h2>Verify without BitGraph</h2>
        <p className="lede">
          Every BitGraph proof can be checked offline. No BitGraph API, account, blockchain node, or
          company permission required.
        </p>
        <Pkg name="@mikeargento/bitgraph-verify" note="Verifies canonical form, signatures, and slot binding." />
        <Pkg name="@mikeargento/bitgraph-audit" note="Validates the audit bundle and the AWS Nitro attestation chain." />
        <Pkg name="@mikeargento/bitgraph-player" note="Evaluates proofs against rules you write, offline." />
        <Pkg name="@mikeargento/bitgraph-mcp" note="Exposes the same operations to AI clients holding local files." />
        <p style={{ marginTop: 22 }}>
          There is also <a href="/verify.html">a standalone verifier page</a>. Save it and open it
          with no network connection at all.
        </p>
        <p className="display">Reading and verifying a BitGraph never requires trusting BitGraph.</p>
        <p>That is the property the whole design exists to hold.</p>
      </div>

      {/* ── 5. Integrate ──────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>Integrate in two calls</h2>
        <div className="calls">
          POST /api/fuse/allocate
          <br />
          <span className="step-arrow">&nbsp;&nbsp;&darr;&nbsp;&nbsp;</span>
          <span className="aside">build your artifact with the returned commitment</span>
          <br />
          POST /api/fuse/commit
        </div>
        <p>
          Allocate returns the single-use position. You construct the artifact using the commitment
          it hands back. Commit consumes that exact position with the digest of the finished
          artifact, and returns the signed proof.
        </p>
        <CopyLine text="bitgraph-fuse photo.jpg" />
        <CopyLine text="npx -y @mikeargento/bitgraph-mcp" style={{ marginTop: 10 }} />
        <CopyLine text={MCP_URL} prompt="" note="# hosted MCP, no install" style={{ marginTop: 10 }} />
        {/* Task 6: the question a serious evaluator asks first, answered before
            they ask it. Every number here is read from the shipped enclave
            (server/commit-service/src/enclave/app.ts): SLOT_TTL_MS = 120_000,
            MAX_PENDING_SLOTS = 1000, the counter advances inside
            handleAllocateSlot, pendingSlots is an in-memory Map so allocation
            persists nothing, and the file's own header documents the gaps.
            The second paragraph is the honest limit and must not be softened:
            a caller CAN hold several positions open inside the window. What
            the enclave attests is issuance before the digest, not independence
            from it. Saying so here is worth more than the claim it gives up. */}
        <h3 className="sub">What happens between the two calls</h3>
        <p>
          A position is held for 120 seconds. Up to 1,000 can be open at once across the whole
          enclave. Allocating one advances the counter immediately, so a position that is never
          committed leaves a permanent gap in the sequence. Nothing is written when a position is
          allocated, so an abandoned position never reaches the ledger and appears only as that gap.
          An enclave restart begins a new epoch and voids every position still open.
        </p>
        <p>
          The limit of the claim, stated plainly: inside that window a caller can hold several
          positions open and decide which artifact fills which. What the enclave signs is that it
          issued the position before it received the digest, and then bound the two. It does not say
          the position was chosen without knowledge of the artifact. Ordering between proofs comes
          from the previous-proof hash rather than from counters, so the gaps abandoned positions
          leave cost nothing.
        </p>
        <div className="links-row">
          <Link href="/docs/integration">
            Integration guide <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
          <Link href="/docs/proof-format">
            Proof format <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
          <Link href="/docs/mcp">
            MCP <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* ── 6. Trust and reproducibility ──────────────────────────────────── */}
      <div className="hp sec">
        <h2>Rebuild the enclave yourself</h2>
        <p>
          The enclave inputs are pinned and its measurement is published. Rebuild the image and
          compare the measurement you get against the one carried inside any proof&apos;s Nitro
          attestation. If they differ, the proof was not made by the code you just built.
        </p>
        <p>
          Every position ever committed is public on <Link href="/ledger">the ledger</Link>.
        </p>
        <div className="links-row">
          <Link href="/docs/trust-model">
            Trust model <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
          <Link href="/docs/self-host-tee">
            Self-host the enclave <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* ── 7. Privacy ────────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>Your file stays where it is</h2>
        <p>
          The original file is never uploaded and never modified. It is hashed where it lives, in
          your browser or on your machine. Only digests and signed slot records cross the network.
        </p>
      </div>

      {/* ── 8. Ethereum ───────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>What Ethereum is used for</h2>
        <p>
          Ethereum brackets portions of the BitGraph ledger between public block hashes that could
          not be predicted before those blocks were mined. It provides an external ordering
          boundary, not consensus for BitGraph itself.
        </p>
        <p>
          There is no token and no wallet. Anchoring writes nothing to Ethereum. Verifying a proof
          requires no Ethereum access, and a proof carries no trusted absolute timestamp.
        </p>
      </div>

      {/* ── 9. What it does not claim ─────────────────────────────────────── */}
      <div className="hp sec">
        <h2>What BitGraph does not claim</h2>
        <ul className="claims">
          <li>
            <b>Not a blockchain.</b> No consensus protocol, token, wallet, or blockchain of any
            kind. The BitGraph ledger is a signed sequence, not a chain with consensus.
          </li>
          <li>
            <b>Not a watermark.</b> The commitment inside a fused artifact is documented and
            explicit, never hidden, and the original is recoverable byte for byte where the format
            allows it.
          </li>
          <li>
            <b>Not proof of authorship.</b> BitGraph does not establish who created an artifact. A
            submitter&apos;s note is a claim by whoever recorded it, and is rendered as one.
          </li>
          <li>
            <b>Not proof of absolute time.</b> Anchors bound causal positions relative to public
            events. They do not make BitGraph a timestamp authority.
          </li>
          <li>
            <b>Not identity.</b> The protocol requires no account and no login.
          </li>
        </ul>
        <div className="links-row">
          <Link href="/docs/what-bitgraph-is-not">
            What BitGraph is not <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* ── 10. Licensing ─────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>What you may depend on</h2>
        <p>
          Verification is permissionless and stays that way. The four packages above are MIT
          licensed. The proprietary core and commit service are what issue proofs, and using them to
          issue proofs requires a written agreement.
        </p>
        <p>The core carries one permission that cannot be withdrawn:</p>
        <p className="grant">
          Permission is granted, free of charge and irrevocably, to any person obtaining a copy of
          this software, to copy, build, and run the software solely for the purposes of verifying
          BitGraph proofs and of reproducing and auditing the published enclave measurements.
        </p>
        <p>
          In practice: you can depend on proofs that already exist without depending on the
          continued existence, permission, pricing, or availability of Argento Computing. Patents
          are pending. Verification of BitGraph proofs is and remains permissionless.
        </p>
      </div>

      {/* ── 11. Adoption ──────────────────────────────────────────────────── */}
      <div className="hp sec">
        <h2>Evaluating it</h2>
        <p>
          If you are evaluating BitGraph, check it rather than believe it. Build the enclave. Verify
          a proof offline with a package you did not get from us. Read the signed structures and the
          proof format. Try to break the assumptions.
        </p>
        <div className="links-row">
          <Link href="/contact">
            Licensing, evaluations, and technical questions{" "}
            <span className="arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>
    </>
  );
}
