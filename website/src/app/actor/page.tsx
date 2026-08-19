"use client";

// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * /actor — the camera that puts your key on a recording.
 *
 * A declared BitGraph is an ordinary BitGraph plus one thing: a key you hold
 * signed an authorization for that exact file, and the enclave verified that
 * signature against its own single-use nonce before it would record anything.
 *
 * ⚠️ THE CAMERA IS HOME'S, NOT A COPY (2026-08-19). This page renders
 * components/bitgraph-camera.tsx, the same implementation home renders, and
 * hands it one thing: lib/actor-strategy.ts, how a digest gets committed (the
 * enclave's nonce, one touch, the envelope). Everything a drop can do on home,
 * a drop does here identically: the one batched lookup, every position the
 * bytes hold, the folder check, the export, the hold through the daily key
 * renewal. Mike: "give bitgraph actor the same functionality exactly as
 * homepage but with actor key credentials". The 787-line reimplementation
 * this replaced drifted into six bugs in one evening; nothing about
 * recording belongs in this file again. What is left here is the key: the
 * register state, the line that says whose key is on the frame, and the
 * two controls that act on it.
 *
 * ⚠️ THE WORD IS **ACTOR** (Mike, 2026-08-19), after two days and seven
 * candidates. It is the protocol's own word already: `agency.actor`,
 * `actorKeyId`, and /docs/what-bitgraph-is-not's "actor-bound proofs... this
 * is actor-binding, not authorship attribution". UI, JSON and docs now say one
 * thing.
 *
 * WHY IT WON, and the test that killed the rest: **`actor` is present only on
 * these proofs and absent on anonymous ones**, so it names the subset by the
 * mechanism rather than by a metaphor. Everything else was either true of every
 * BitGraph or claimed something we do not establish:
 *
 *   signed        true of every BitGraph (the enclave signs them all)
 *   commissioned  true of every BitGraph (an anonymous drop is also requested);
 *                 and to a photographer it already means a client job
 *   authorized    implies a gatekeeper granted permission, which is the C2PA
 *                 framing this whole product differentiates from
 *   authored      /docs/what-bitgraph-is-not says actor-bound proofs are "not
 *                 authorship attribution" IN A SENTENCE ABOUT THIS FEATURE, and
 *                 anyone can act on a file they downloaded, so the name would
 *                 be disproven in one use
 *   auctor        reads as a typo for author, and sits one letter from `actor`,
 *                 which is in every proof's JSON
 *   declared      what it was called for a day. Honest, and it survived two
 *                 challenges, but it is a word about a statement where `actor`
 *                 is a word about the record
 *
 * ⚠️ Also ruled out on sight: certified/approved/endorsed (gatekeeper),
 * attested (collides with Nitro attestation), sealed (banned language), named
 * (BitGraph never learns a name), claimed (collides with /docs/overview's
 * "Most systems claim it"), and Content Credentials (C2PA's own brand, and our
 * foil twice on that same page).
 *
 * ⚠️ "Actor" is a NOUN, so it does not modify BitGraphs the way "Declared" did.
 * The page is named for the tool, BitGraph Actor, in the family of BitGraph
 * Folder and BitGraph Player. The docs' adjective is "actor-bound" if one is
 * ever needed. The proof page's card is titled Actor and its first field is
 * Name, whose value is "Not established here" for anyone else's key: identity
 * is a property of the reader and BitGraph never learns a name.
 *
 * ── Why this is a separate page rather than a switch on the home box ──
 *
 * An enrolled browser still needs to record anonymously: the shared chain's
 * anonymity set is every recording, and it would be a poor trade to shrink it
 * for a badge. So identity has to be a choice made per recording, and a URL is
 * the only form of that choice which adds no control to a page that refuses
 * controls. Home stays the camera; this is the camera that declares.
 *
 * Rules this page must not break:
 *   - the home box NEVER prompts. A first-time visitor drops a file and gets a
 *     proof, with no dialog and no decision.
 *   - an undeclared recording is not the degraded one. Order, slot binding and
 *     anchors are identical either way; only the who differs.
 *   - a folder drop is a READ, here as on home. A directory is dropped to ask
 *     what is in it, never to sign it; the cost of getting that wrong here is
 *     thousands of permanent positions under someone's key from one drag
 *     (it happened for an hour on 2026-08-19). The camera enforces it; the
 *     Record row is the only thing that mints, and it asks for the touch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BitGraphCamera, clearCameraCache } from "@/components/bitgraph-camera";
import { InfoLink } from "@/components/info-link";
import { makeActorStrategy } from "@/lib/actor-strategy";
import {
  clearStoredCredential,
  getStoredCredential,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  type StoredCredential,
} from "@/lib/webauthn";

export default function ActorPage() {
  const [cred, setCred] = useState<StoredCredential | null>(null);
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);
  const [name, setName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The credential lives in localStorage, which does not exist while this
  // renders on the server, so it cannot seed useState without a hydration
  // mismatch. Reading it on mount is the pattern; `ready` holds BOTH states
  // back until the answer is known, because the empty state and the camera
  // are different pages to a reader and flashing one into the other would be
  // a lie about which one they are on.
  useEffect(() => {
    setCred(getStoredCredential());
    setReady(true);
    void isPlatformAuthenticatorAvailable().then((ok) => setSupported(ok));
  }, []);

  /** The one thing this page hands the camera. Rebuilt when the credential
   *  changes (register, forget), never mid-run: the control that changes it
   *  sits on a title row that is not shown while a run is in flight. */
  const strategy = useMemo(() => (cred ? makeActorStrategy(cred) : null), [cred]);

  /** A row may print this device's label for this device's key, and nothing
   *  for anyone else's: the camera shows those as their key. */
  const actorName = useCallback(
    (keyId: string) => (cred && keyId === cred.keyId ? cred.name : undefined),
    [cred],
  );

  const register = useCallback(async () => {
    setRegistering(true);
    setRegisterError(null);
    try {
      // The ONE place a name is typed in this whole product, and it is
      // cosmetic: it labels the passkey in the keychain. What a verifier reads
      // is the key, resolved through the published list.
      const stored = await registerPasskey(name.trim() || "BitGraph");
      setCred(stored);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }, [name]);

  /* ❄️ NO RENAME (Mike, 2026-08-19: "rename is a bad idea. forget this device
     will suffice in an instance where you want to rename"). It existed for a
     day because a passkey's keychain label cannot be edited once created and
     the page's label could. But the label never enters a proof; the key does,
     and a second control that changes the one without the other taught the
     wrong thing about where identity lives. Forget and register again: a new
     key, a new label, and the old recordings keep the old key, which is the
     honest account of what happened. */
  const forget = useCallback(() => {
    clearStoredCredential();
    clearCameraCache("actor");
    setCred(null);
    setName("");
  }, []);

  return (
    <>
      <style>{`
        /* ── The register state's own column and title. ──
           The camera carries its own wrap and title rules, and they are not
           on the page until a key exists, so the state before that has to
           dress itself: the same 800px column, centred in the viewport, and
           the same title size as the camera's (clamp 34..40, 36px to what
           follows), so registering and then seeing the frame does not move
           the headline. ⚠️ These mirror .bitgraph-wrap / .bitgraph-tagline in
           components/bitgraph-camera.tsx; change both or neither. */
        .declare-register-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: 40px 0 40px;
          display: flex; flex-direction: column; align-items: stretch; justify-content: center;
          min-height: calc(100dvh - 114px); gap: 24px; }
        /* LEFT, like the camera's title row it stands in for (and every other
           title on the site, since 2026-08-19): the name on the left, "How it
           works →" on the right, baseline-aligned; on a phone the link wraps
           under the title. The form under it is left too. */
        .declare-title-row { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 24px; margin: 0 0 36px; }
        @media (max-width: 520px) { .declare-title-row { gap: 6px 12px; } }
        @media (max-height: 520px) { .declare-more { margin-top: 14px; } }
        .declare-title { font-size: clamp(34px, 6vw, 40px); margin: 0; }
        .declare-register { display: flex; flex-direction: column; align-items: flex-start; gap: 22px; }
        /* pretty, not balance, now that the lead is left-aligned: balance
           evens ragged centred lines; a left block wants its last line kept
           from a lone word. */
        .declare-lead { font-size: clamp(14px, 2.5vw, 16px); line-height: 1.6; color: #4b5563;
          max-width: 430px; margin: 0; text-wrap: pretty; }
        /* The one text field in the product. Square, hairline, brand focus:
           the site has no other input to match, so it borrows the card. */
        .declare-name { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; width: 100%; }
        .declare-name input {
          font-family: inherit; font-size: 15px; color: #111827; background: #fff;
          border: 1px solid #d0d5dd; border-radius: 0; padding: 11px 13px;
          width: min(320px, 100%);
        }
        .declare-name input:focus-visible { outline: 2px solid #0065A4; outline-offset: -2px; }

        /* ── Whose key this is: INSIDE the frame, the third line under the
           headline, after "Your file never leaves your device" (Mike,
           2026-08-19). It is a fact about the instrument, so it belongs on the
           instrument; and with it there, what is left under the frame is one
           line on both pages, which is what lets the two frames be the same
           size with no correction. It spent a day under the frame over its
           controls, and a day before that beside the title.
           The size and colour are the frame's own subhint line (the box sets
           them on the wrapper); only the name and the key are dressed here:
           the name at 600 in the heading colour because it is the fact, the
           key in the site's mono like every other hash. */
        .declare-who strong { font-weight: 600; color: #111827; }
        .declare-who .declare-key { font-family: var(--font-mono); }

        /* ── The one control that acts on the key: under the box, bottom left
           (Mike, 2026-08-19: "move Forget this device to bottom left on
           Actor"), at the foot of a closed results page. It was on the
           title's right for an afternoon and under the box, centred, the day
           before. 42px off the box: the box is one big click target and a
           stray hit opens a file dialog, so the buffer clears adjacent-tap
           distance. The site's standard link type (14 / 600 / -0.01em, brand
           blue). The hit area is grown the way .bg-arrow-link grows its own:
           padding the region and cancelling it in layout. */
        .declare-more { margin-top: 42px; }
        .declare-note { margin: 0; font-size: 16px; color: #4b5563; white-space: nowrap; }
        .declare-note-controls { display: inline-flex; gap: 20px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
        .declare-inline { appearance: none; border: 0; background: none; padding: 13px 0; margin: -13px 0;
          font: inherit; color: #0065A4; cursor: pointer; }

        /* Short viewports: the same tightening the camera applies to its own
           chrome, for the two blocks that are this page's. */
        @media (max-height: 520px) {
          .declare-register-wrap { padding-top: 12px; padding-bottom: 12px; }
          .declare-title { font-size: clamp(20px, 4.5vh, 30px); }
          .declare-title-row { margin-bottom: 14px; }
        }
      `}</style>

      {/* ── Two states, and only one of them is a drop target. ──
          A dashed edge means droppable, everywhere on this site. Before a
          key exists there is nothing to drop a file into, so the register
          state does not wear the frame and pretend: it is a line, a field,
          and one instruction. The camera arrives with the key. ── */}
      {ready && cred && strategy && (
        <BitGraphCamera
          id="actor"
          strategy={strategy}
          title="BitGraph Actor"
          actorName={actorName}
          /* Whose key this is, inside the frame as its third line: a STATUS
             of the instrument, so it sits on the instrument, right under the
             line that says the file never leaves the device. */
          frameNote={
            <span className="declare-who">
              Acting as <strong>{cred.name}</strong>, key{" "}
              <span className="declare-key">{cred.keyId.slice(0, 12)}&hellip;</span>
            </span>
          }
          belowClassName="declare-more"
          below={
            /* ── The one control that acts on the key, under the box, left.
                Forget is also how you rename (see the note at `forget`). ── */
            <p className="declare-note">
              <span className="declare-note-controls">
                <button type="button" className="declare-inline" onClick={forget}>
                  Forget this device
                </button>
              </span>
            </p>
          }
        />
      )}

      {ready && !cred && (
        <div className="declare-register-wrap">
          <div className="declare-title-row">
            <h1 className="bg-page-title declare-title">BitGraph Actor</h1>
            {/* The way to the explanation this screen does not carry (see the
                note under the action). Home has "What is a BitGraph →" in
                this slot; here the question is what the touch does and what a
                reader may conclude from it, and /docs/actor answers that.
                "Info →" on a phone, like home's. */}
            <InfoLink href="/docs/actor" label="How it works" />
          </div>
          <div className="declare-register">
            <p className="declare-lead">
              {supported
                /* "a name", not "your name": the field below takes a person
                   or a business, and a photographer trading as a studio is
                   exactly who declares here. "A key only you can use" already
                   says whose it is, so the possessive was doing no work. */
                ? "Acting puts a name on a recording, signed by a key only you can use."
                : "Acting needs a passkey: Touch ID, Face ID, or Windows Hello. This device has none."}
            </p>
            {supported && (
              <div className="declare-name">
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void register(); }}
                  placeholder="Name or organization"
                  aria-label="The name this device acts under"
                  spellCheck={false}
                  autoComplete="name"
                  disabled={registering}
                />
                <button
                  type="button"
                  className="bg-action-link"
                  onClick={() => void register()}
                  disabled={registering || !name.trim()}
                >
                  {registering ? "Waiting for you…" : "Register this device"}
                  {registering ? null : <span className="arrow" aria-hidden="true">&rarr;</span>}
                </button>
                {/* ── ❄️ NOTHING under the action, deliberately. ──
                    A line here explained that the key is public and appears on
                    every declaration. It read as a caution (Mike: "this seems
                    preachy") and then as clutter, and both were symptoms of the
                    same mistake: registration is not the consequential act.
                    Registering declares nothing — the first drop does, on a
                    different screen — so a warning fires here at the wrong
                    moment. The site also warns nowhere else that the ledger is
                    public, and it is public everywhere; the Roll lists every
                    recording anyone makes.

                    The linkability fact is real and non-obvious and should live
                    where a reader can act on it: the docs, and the Actor card
                    on a proof, beside the key it is about. Not here. ── */}
              </div>
            )}
            {registerError && (
              <p style={{ color: "#dc2626", fontSize: 14, margin: 0 }}>{registerError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
