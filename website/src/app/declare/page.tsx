"use client";

// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * /declare — the camera that puts your name on it.
 *
 * A declared BitGraph is an ordinary BitGraph plus one thing: a key you hold
 * signed an authorization for that exact file, and the enclave verified that
 * signature against its own single-use nonce before it would record anything.
 *
 * ⚠️ It is a DECLARATION, and the word is chosen against the alternatives
 * (Mike, 2026-08-18). Not "signed": every BitGraph carries the enclave's
 * Ed25519 signature, so the word would imply the others do not. Not
 * "authorized" or "verified": BitGraph derives existence and order, and
 * derives nothing whatever about who a person is. What a declaration adds is
 * a WHO, never a better WHEN, and the honest word for a statement by a named
 * party is the one Player's own verdict already uses for it.
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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDrop } from "@/components/file-drop";
import { fmtRowWhen, useFileThumbs } from "@/components/folder-roll";
import { toUrlSafeB64 } from "@/lib/explorer";
import { cacheArtifactToIDB } from "@/lib/file-cache";
import { hashFile, commitDigest, type BitGraphProof } from "@/lib/bitgraph";
import {
  buildAgencyEnvelope,
  clearStoredCredential,
  getStoredCredential,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  requestAssertion,
  type StoredCredential,
} from "@/lib/webauthn";

interface Recorded {
  file: File;
  proof: BitGraphProof;
  when: number | null;
  /** "declared" was minted by this drop; "found" was already on the ledger
   *  and cost nothing. The row says which, because the difference is the
   *  whole answer to what the drop did. */
  kind: "declared" | "found";
}

/** Whose key, if any, is on a proof already. A row claims a name only when
 *  the proof itself carries the key it belongs to. */
function actorOf(proof: BitGraphProof): string | undefined {
  return (proof as unknown as { agency?: { actor?: { keyId?: string } } }).agency?.actor?.keyId;
}

type Phase =
  | { step: "idle" }
  | { step: "registering" }
  | { step: "working"; label: string }
  | { step: "error"; message: string };

/** The enclave's nonce. Never this browser's: a nonce the caller chose proves
 *  nothing about when the caller chose it, which is exactly why the enclave
 *  keeps its own pending set and consumes each one on first use. */
async function fetchChallenge(): Promise<string> {
  const res = await fetch("/api/challenge", { method: "POST" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || "Could not reach the camera");
  }
  return ((await res.json()) as { challenge: string }).challenge;
}

/** What the ledger already holds for these digests, one round trip.
 *
 *  A recording is not owned by whoever asks about it, so this is a plain read
 *  and costs nothing: no nonce, no signature, no position. When a digest has
 *  several positions, prefer one already carrying the asker's key, since
 *  "you declared this already" is a more useful answer than "somebody
 *  recorded this once".
 */
async function lookup(
  digests: string[],
  myKeyId?: string
): Promise<Map<string, { proof: BitGraphProof; writeTime?: number | null }>> {
  const out = new Map<string, { proof: BitGraphProof; writeTime?: number | null }>();
  const unique = [...new Set(digests)];
  if (!unique.length) return out;
  try {
    const r = await fetch("/api/proofs/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digests: unique.map(toUrlSafeB64) }),
    });
    if (!r.ok) return out;
    const found = ((await r.json()) as {
      results?: Record<string, {
        proofs?: Array<{ proof: BitGraphProof; writeTime?: number | null }>;
        unavailable?: true;
      }>;
    }).results || {};
    for (const d of unique) {
      const entry = found[toUrlSafeB64(d)];
      // ⚠️ A failed read is never an answer about these bytes. `unavailable`
      // means the ledger could not be read, not that nothing is recorded, and
      // treating it as absence would mint a second position for a file that
      // already has one.
      if (!entry || entry.unavailable || !entry.proofs?.length) continue;
      const mine = myKeyId ? entry.proofs.find((p) => actorOf(p.proof) === myKeyId) : undefined;
      out.set(d, mine ?? entry.proofs[0]);
    }
  } catch { /* a read that failed says nothing; the drop proceeds as new */ }
  return out;
}

export default function DeclarePage() {
  const router = useRouter();
  const [cred, setCred] = useState<StoredCredential | null>(null);
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [renaming, setRenaming] = useState(false);
  /** Declared here, this visit. They accumulate: a second drop appends. */
  const [results, setResults] = useState<Recorded[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  // The credential lives in localStorage, which does not exist while this
  // renders on the server, so it cannot seed useState without a hydration
  // mismatch. Reading it on mount is the pattern; `ready` holds BOTH states
  // back until the answer is known, because the empty state and the camera
  // are different pages to a reader and flashing one into the other would be
  // a lie about which one they are on.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage has no server value to seed from; one render is what it costs. */
    setCred(getStoredCredential());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void isPlatformAuthenticatorAvailable().then((ok) => setSupported(ok));
  }, []);

  const register = useCallback(async () => {
    setPhase({ step: "registering" });
    try {
      // The ONE place a name is typed in this whole product, and it is
      // cosmetic: it labels the passkey in the keychain. What a verifier reads
      // is the key, resolved through the published list.
      const stored = await registerPasskey(name.trim() || "BitGraph");
      setCred(stored);
      setPhase({ step: "idle" });
    } catch (err) {
      setPhase({
        step: "error",
        message: err instanceof Error ? err.message : "Registration failed",
      });
    }
  }, [name]);

  /** The ledger's write time, one round trip for the whole drop. Not this
   *  browser's clock: the product does not assert time from an untrusted
   *  source, and a row whose time came from the machine that made it would be
   *  a different claim wearing the same clothes. */
  async function fillTimes(made: Recorded[]) {
    try {
      const digests = [...new Set(made.map((m) => toUrlSafeB64(m.proof.artifact.digestB64)))];
      if (!digests.length) return;
      const r = await fetch("/api/proofs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digests }),
      });
      if (!r.ok) return;
      const found = ((await r.json()) as {
        results?: Record<string, { proofs?: Array<{ proof: BitGraphProof; writeTime?: number | null }> }>;
      }).results || {};
      setResults((prev) =>
        prev.map((row) => {
          if (row.when !== null) return row;
          const entry = found[toUrlSafeB64(row.proof.artifact.digestB64)];
          const hit = entry?.proofs?.find(
            (e) => String(e.proof?.commit?.counter) === String(row.proof.commit?.counter)
          );
          return hit?.writeTime ? { ...row, when: hit.writeTime } : row;
        })
      );
    } catch { /* the rows simply keep their blank when */ }
  }

  /** Rename the local label. The credential is untouched: the key is what a
   *  proof carries, and it does not change because its owner fixed a typo. */
  const saveName = useCallback(() => {
    const next = name.trim();
    if (!next || !cred) return;
    const updated = { ...cred, name: next };
    localStorage.setItem("bitgraph-passkey", JSON.stringify(updated));
    setCred(updated);
    setRenaming(false);
  }, [name, cred]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => f.size > 0);
      if (!list.length || !cred) return;
      try {
        // ── Look before minting. ──
        // Home's rule, and this page owes it more than home does: there a
        // known file costs a lookup, here an unchecked drop would cost a
        // biometric prompt and a permanent position for a file somebody only
        // wanted to look at. One gesture still, two outcomes, and the results
        // say which one happened rather than asking first.
        setPhase({ step: "working", label: list.length > 1 ? `Reading ${list.length} files` : "Reading the file" });
        const digests: string[] = [];
        for (const f of list) digests.push(await hashFile(f));

        setPhase({ step: "working", label: "Checking the ledger" });
        const known = await lookup(digests, cred.keyId);

        const found: Recorded[] = [];
        const fresh: number[] = [];
        list.forEach((f, i) => {
          const hit = known.get(digests[i]);
          if (hit) found.push({ file: f, proof: hit.proof, when: hit.writeTime ?? null, kind: "found" });
          else fresh.push(i);
        });
        if (found.length) setResults((prev) => [...prev, ...found]);

        // Everything was already on record: nothing to sign, nothing minted,
        // no prompt. The rows are the answer.
        if (!fresh.length) {
          setPhase({ step: "idle" });
          return;
        }

        // Hash first, THEN the nonce: it lives 60 seconds and the
        // authorization's timestamp must land inside that window, so a nonce
        // fetched before a long hashing pass would be dead on arrival.
        setPhase({ step: "working", label: "Waiting for the camera" });
        const challenge = await fetchChallenge();

        // One touch for the whole drop. The enclave validates the first
        // digest fully, consumes the challenge, and lets the rest of the
        // batch inherit the actor through batchContext — so a forty-photo
        // folder asks once, not forty times.
        setPhase({ step: "working", label: "Waiting for you" });
        const assertion = await requestAssertion(challenge, cred.credentialIdB64);

        const freshDigests = fresh.map((i) => digests[i]);
        const made: Recorded[] = [];
        for (let n = 0; n < fresh.length; n++) {
          const i = fresh[n];
          setPhase({
            step: "working",
            label: fresh.length > 1 ? `Declaring ${n + 1} of ${fresh.length}` : "Declaring",
          });
          const envelope = buildAgencyEnvelope(cred, assertion, digests[i], challenge);
          if (fresh.length > 1) {
            envelope.batchContext = { batchSize: fresh.length, batchIndex: n, batchDigests: freshDigests };
          }
          const proof = await commitDigest(digests[i], undefined, envelope);
          made.push({ file: list[i], proof, when: null, kind: "declared" });
          setResults((prev) => [...prev, made[made.length - 1]]);
        }

        setPhase({ step: "idle" });
        void fillTimes(made);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPhase({
          step: "error",
          // The two failures worth naming, because both are recoverable and
          // neither is the visitor's fault.
          message: /NotAllowed|cancel/i.test(message)
            ? "Nothing was recorded: the authorization was cancelled."
            : /challenge/i.test(message)
              ? "That authorization expired before it reached the camera. Drop again."
              : message,
        });
      }
    },
    [cred]
  );

  const thumbs = useFileThumbs(results.map((r) => r.file));

  const openProof = (row: Recorded) => {
    const digest = row.proof.artifact.digestB64;
    const c = row.proof.commit?.counter;
    const epoch = row.proof.commit?.epochId ? toUrlSafeB64(row.proof.commit.epochId) : "";
    void cacheArtifactToIDB(row.file, digest).catch(() => {});
    router.push(
      `/proof/${encodeURIComponent(toUrlSafeB64(digest))}` +
        (c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}` : "")
    );
  };

  const working = phase.step === "working" || phase.step === "registering";

  return (
    <div className={`bitgraph-wrap${results.length ? " declare-has-result" : ""}`}>
      <style>{`
        .bitgraph-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: 40px 0 80px;
          display: flex; flex-direction: column; align-items: stretch; gap: 24px; }
        .bitgraph-wrap:not(.declare-has-result) {
          justify-content: center; min-height: calc(100dvh - 114px); padding-bottom: 40px;
        }
        .declare-hero { display: flex; flex-direction: column; align-items: stretch; text-align: center; }
        /* The title is a plain noun like every page but home, whose metaphor is
           the one exception on the site. 46px to the frame, the measured gap
           that lands this composition at the same y as the home page's when
           there is no deck; re-derive if the title size or the frame changes. */
        /* 46px only when nothing follows the title but the frame; with the
           deck present its own 36px carries the rest, exactly as home's does.
           ⚠️ Re-derive if the title size or the frame changes. */
        .declare-title { font-size: clamp(34px, 6vw, 40px); margin: 0 0 46px; }
        .declare-hero:has(.declare-who) .declare-title { margin-bottom: 12px; }
        .declare-more { margin-top: 42px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        /* The one text field in the product. Square, hairline, brand focus:
           the site has no other input to match, so it borrows the card. */
        /* The register state: no frame, because a frame here would be a
           dashed edge over something that takes no drops. */
        /* Home's deck: same clamp, same colour, same 36px to the frame. */
        .declare-who { margin: 0 0 36px; }
        .declare-who p { margin: 0; font-size: clamp(14px, 2.5vw, 16px); line-height: 1.6;
          color: #4b5563; text-wrap: pretty; }
        .declare-register { display: flex; flex-direction: column; align-items: center; gap: 22px; }
        /* balance, not pretty: pretty only rescues a single orphaned word, and
           this lead's last line is three, so it wrapped at "only / you can
           use." Balance evens the lines instead. */
        .declare-lead { font-size: clamp(14px, 2.5vw, 16px); line-height: 1.6; color: #4b5563;
          max-width: 430px; margin: 0 auto; text-wrap: balance; }
        .declare-name { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
        .declare-name input {
          font-family: inherit; font-size: 15px; color: #111827; background: #fff;
          border: 1px solid #d0d5dd; border-radius: 0; padding: 11px 13px;
          width: min(320px, 100%); text-align: center;
        }
        .declare-name input:focus-visible { outline: 2px solid #0065A4; outline-offset: -2px; }
        /* The register state's two paragraphs share one measure, so the
           block reads as a column rather than two widths stacked. */
        .declare-register .declare-note { max-width: 430px; }
        .declare-inline { appearance: none; border: 0; background: none; padding: 0;
          font: inherit; color: #0065A4; cursor: pointer; }
        .declare-note { font-size: 12.5px; color: #4b5563; line-height: 1.6; max-width: 460px;
          margin: 0 auto; text-wrap: balance; }
        .declare-result { border-top: 1px solid #d0d5dd; padding-top: 18px; text-align: left; width: 100%; }
        @keyframes declareRowIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <div className="declare-hero">
        <h1 className="bg-page-title declare-title">Declared BitGraphs</h1>

        {/* ── The deck, in home's slot, saying whose page this is. ──
            It was a footnote under the box, which put the one fact that makes
            this page different from home below the thing it qualifies. Home
            states its claim beside its title; so does this. The box beneath is
            then home's, word for word: the same instrument, and the page says
            whose hands. ── */}
        {ready && cred && (
          <div className="declare-who">
            <p>Declared by {cred.name}, key {cred.keyId.slice(0, 12)}&hellip;</p>
          </div>
        )}

        {/* ── Two states, and only one of them is a drop target. ──
            A dashed edge means droppable, everywhere on this site. Before a
            key exists there is nothing to drop a file into, so the register
            state does not wear the frame and pretend: it is a line, a field,
            and one instruction. The camera arrives with the key. ── */}
        {ready && cred && (
          <div className="bitgraph-camera">
            <FileDrop
              multiple
              onFiles={handleFiles}
              disabled={working}
              /* Home's own headline, in this page's verb. The box takes both
                 outcomes now — a known file comes back as its proof, an
                 unknown one is declared — so saying only "Record as yourself"
                 described half of it. One headline in every state, because
                 the state is not what changes: the drop does the same thing
                 whether or not there are already results below it. */
              /* ⚠️ Home's three lines, VERBATIM (Mike: "this should be exactly
                 the same"). The instrument is the same instrument; what differs
                 is whose key is on the result, and the deck above has already
                 said that. Copying rather than sharing, as /c2pa did before it:
                 the same STYLE, not a second renderer. */
              headline={phase.step === "working" ? phase.label : "Record or check BitGraphs"}
              hint="Choose files, or drag in a whole folder."
              subhint="Your file never leaves your device."
            />
          </div>
        )}

        {ready && !cred && (
          <div className="declare-register">
            <p className="declare-lead">
              {supported
                /* "a name", not "your name": the field below takes a person
                   or a business, and a photographer trading as a studio is
                   exactly who declares here. "A key only you can use" already
                   says whose it is, so the possessive was doing no work. */
                ? "A declaration is a name on a recording, signed by a key only you can use."
                : "A declaration needs a passkey: Touch ID, Face ID, or Windows Hello. This device has none."}
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
                  aria-label="The name this device declares under"
                  spellCheck={false}
                  autoComplete="name"
                  disabled={working}
                />
                <button
                  type="button"
                  className="bg-action-link"
                  onClick={() => void register()}
                  disabled={working || !name.trim()}
                >
                  {phase.step === "registering" ? "Waiting for you\u2026" : "Register this device"}
                  {phase.step === "registering" ? null : <span className="arrow" aria-hidden="true">&rarr;</span>}
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
                    where a reader can act on it: the docs, and the Declaration
                    card on a proof, beside the key it is about. Not here. ── */}
              </div>
            )}
          </div>
        )}

        <div className="declare-more">
          {phase.step === "error" && (
            <p style={{ color: "#dc2626", fontSize: 14, margin: 0 }}>{phase.message}</p>
          )}

          {/* ── The label is correctable, and that is the answer to "should
              you have to type it twice" (Mike, 2026-08-18). It is not worth
              confirming: it never enters a proof, and treating it as though it
              did would teach the wrong thing about where identity lives. But a
              passkey cannot be renamed once created, so a typo would otherwise
              sit in the keychain forever. Renaming here changes the label
              beside the credential and leaves the key alone. ── */}
          {/* ── Maintenance, under the frame. ──
              The deck states whose page this is; changing or dropping the key
              is housekeeping, and housekeeping does not belong in a claim.
              Home keeps its one quiet link in this same slot. ── */}
          {ready && cred && !renaming && (
            <p className="declare-note">
              <button type="button" className="declare-inline" onClick={() => { setName(cred.name); setRenaming(true); }}>
                Rename
              </button>
              {" · "}
              <button
                type="button"
                className="declare-inline"
                onClick={() => { clearStoredCredential(); setCred(null); setName(""); setRenaming(false); }}
              >
                Forget this device
              </button>
            </p>
          )}

          {ready && cred && renaming && (
            <div className="declare-name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") { setRenaming(false); setName(cred.name); }
                }}
                placeholder="Name or organization"
                aria-label="The name this device declares under"
                spellCheck={false}
                autoFocus
              />
              <button type="button" className="bg-action-link" onClick={saveName} disabled={!name.trim()}>
                Save <span className="arrow" aria-hidden="true">&rarr;</span>
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="declare-result">
              {/* "BitGraphs Recorded", the same as home: recording is what
                  happened, and the declaration is a property of each one that
                  belongs on the proof where it can be checked. One grammar for
                  every results list on the site. */}
              <div className="bg-page-title" style={{ marginBottom: 20 }}>
                BitGraph{results.length === 1 ? "" : "s"} Recorded
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results.map((row, i) => (
                  <div
                    key={`${row.proof.commit?.counter ?? i}`}
                    className="bitgraph-file-card"
                    style={{ border: "1px solid #d0d5dd", animation: `declareRowIn 0.2s ease-out ${Math.min(i, 12) * 0.04}s both` }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openProof(row)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProof(row); } }}
                      className="bitgraph-file-row"
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }}
                    >
                      {thumbs.get(row.file) ? (
                        <img src={thumbs.get(row.file)} alt="" style={{ width: 48, height: 48, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e5e9", display: "block" }} />
                      ) : (
                        <span style={{ width: 48, height: 48, flexShrink: 0, border: "1px solid #e2e5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {row.file.name.slice(row.file.name.lastIndexOf(".") + 1).toUpperCase().slice(0, 4)}
                        </span>
                      )}
                      <span style={{ flexShrink: 0, fontSize: 14 }}>
                        <span style={{ fontWeight: 700, color: "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          #{Number(row.proof.commit?.counter).toLocaleString()}
                        </span>
                      </span>
                      {/* What this row IS, and it is never assumed. A name
                          appears only when the proof itself carries the key it
                          belongs to; a recording someone else declared shows
                          their key, not a guess at who they are; and a
                          recording with no declaration says so plainly rather
                          than borrowing this browser's name. */}
                      <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap" }}>
                        {(() => {
                          const actor = actorOf(row.proof);
                          if (actor && cred && actor === cred.keyId) return `Declared by ${cred.name}`;
                          if (actor) return `Declared by ${actor.slice(0, 12)}\u2026`;
                          return row.kind === "found" ? "Already recorded" : "Recorded";
                        })()}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtRowWhen(row.when)}
                      </span>
                      <span aria-label="Open" style={{ display: "inline-flex", flexShrink: 0, color: "#0065A4" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
