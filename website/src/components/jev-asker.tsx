"use client";

/**
 * Ask Jev (Mike, 2026-10-06: "the click a button is a better demo", "build it with both questions",
 * "make the image demo and the jev demo be similar in design"). The /image page's structure and
 * classes exactly: the headline and one button; on the click only the steps, in the middle of the
 * screen; then the result fades in under one plain paragraph, with four actions two and two and the
 * technical details closed.
 *
 * The work is done by live.bitgraph.ing (repo ~/Code/bitgraph-live): it opens a BitGraph position
 * itself, makes the two questions from that position's code, asks Jev, records the exchange in that
 * position, and streams each step as a JSON line. This page only shows it. The questions are made
 * from the code again here (questionsFor) and the true answers worked out here too, so what the page
 * shows does not rest on the service's word.
 *
 * A result is never lost by leaving the page: the address becomes /jev?p=<record id>, which reads the
 * record back from the service.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, commitmentForProof, signedFloorOf, verifyProofIntegrity, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import { rememberMade, madeHere } from "@/lib/made-here";

const LIVE = process.env.NEXT_PUBLIC_JEV_LIVE_URL ?? "https://live.bitgraph.ing";

type Stage = "opening" | "asking" | "recording" | "ready";
const STEPS: Array<{ key: Stage; label: string }> = [
  { key: "opening", label: "Opening position" },
  { key: "asking", label: "Asking Jev" },
  { key: "recording", label: "Recording answers" },
  { key: "ready", label: "Ready" },
];
const stepIndex = (s: Stage | null) => (s === null ? -1 : STEPS.findIndex((x) => x.key === s));
const n = (x: number | string) => Number(x).toLocaleString("en-US");
/** The spinner stays at least this long (Mike, 10-06: "it goes so fast on jev questions its barely there"):
 *  shorter reads as a flicker, not as speed. A slower run shows its result the moment it is recorded. */
const MIN_WAIT_MS = 1000;

/* ── The questions, made again here from the code (bitgraph-jev-question/1) ─────────────────── */
const QV = "bitgraph-jev-question/1";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
interface Questions { version: string; code: string; both: { digit: string; letter: string; text: string }; first: { a: string; b: string; text: string } }
function questionsFor(code: string): Questions {
  const te = new TextEncoder();
  const input = new Uint8Array([...te.encode(QV), 0, ...te.encode(code)]);
  const h = sha256(input);
  const digit = String(h[0]! % 10), letter = LETTERS[h[1]! % 52]!;
  const a = String(h[2]! % 10);
  let b = String(h[3]! % 10);
  if (b === a) b = String((Number(a) + 1) % 10);
  return { version: QV, code, both: { digit, letter, text: `Does the code contain both the digit ${digit} and the letter ${letter}?` }, first: { a, b, text: `Reading left to right, which comes first: the digit ${a} or the digit ${b}?` } };
}
function truthOf(q: Questions) {
  const at = { digit: q.code.indexOf(q.both.digit), letter: q.code.indexOf(q.both.letter), a: q.code.indexOf(q.first.a), b: q.code.indexOf(q.first.b) };
  const first = at.a < 0 && at.b < 0 ? "neither" : at.b < 0 || (at.a >= 0 && at.a < at.b) ? q.first.a : q.first.b;
  return { both: at.digit >= 0 && at.letter >= 0, first, at };
}

interface Answers { both: { p: number; yes: boolean }; first: { choice: string; confidence: number | null } }
interface JevRecord {
  id: string; digestB64: string; counter: string; epoch: string; position: string; floorBlock: number; code: string;
  /** The floor block's chain, when the service says: "base" since enclave v10. Else the proof check names it. */
  floorChain?: "ethereum" | "base";
  answers: Answers | null; jevError: string | null;
  jev: { model: string; reported: string | null; requestId: string | null; ms: number | null };
  verified: string; recordedAt: string; files: string[];
}

/** The code with the four asked characters marked where they first appear. */
function MarkedCode({ code, q }: { code: string; q: Questions }) {
  const t = truthOf(q);
  const marks = new Map<number, string>();
  if (t.at.digit >= 0) marks.set(t.at.digit, "jev-q1");
  if (t.at.letter >= 0) marks.set(t.at.letter, "jev-q1");
  if (t.at.a >= 0) marks.set(t.at.a, marks.has(t.at.a) ? "jev-q1 jev-q2" : "jev-q2");
  if (t.at.b >= 0) marks.set(t.at.b, marks.has(t.at.b) ? "jev-q1 jev-q2" : "jev-q2");
  return (
    <code className="jev-code" aria-label={`Position commitment: ${code}`}>
      {[...code].map((ch, i) => (marks.has(i) ? <mark key={i} className={marks.get(i)}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </code>
  );
}

const hex2 = (b: number) => b.toString(16).padStart(2, "0");
const toB64Url = (b: Uint8Array) => bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * The code is checked against the proof, read from bitgraph.ing (not from the Jev service): the proof's
 * signature and attestation, then the code recomputed from the position record the enclave signed when
 * the position opened and the floor block bound into it (a Base block since enclave v10, Ethereum before). A code that matches could not have been
 * computed before that position opened, so neither could the questions made from it.
 */
type CodeCheck =
  | { status: "checking" }
  | { status: "ok"; counter: string; position: string; floorBlock: number | null; floorChain: "ethereum" | "base" | null }
  | { status: "mismatch"; recomputed: string }
  | { status: "unavailable"; reason: string };

async function checkCode(id: string, counter: string, code: string): Promise<CodeCheck> {
  try {
    const r = await fetch(`/api/proofs/digest/${id}`);
    if (!r.ok) return { status: "unavailable", reason: `bitgraph.ing answered ${r.status}` };
    const d = await r.json();
    const list: Array<{ proof?: BitGraphProof }> = Array.isArray(d?.proofs) ? d.proofs : [];
    const proof = list.find((x) => String(x.proof?.commit?.counter) === String(counter))?.proof ?? list[0]?.proof;
    if (!proof || !proof.slotAllocation) return { status: "unavailable", reason: "the proof was not found on the ledger yet" };
    const integrity = await verifyProofIntegrity({ proof });
    if (!integrity.valid) return { status: "unavailable", reason: `the proof does not verify: ${integrity.reason ?? "unknown"}` };
    const recomputed = toB64Url(commitmentForProof(proof, proof.slotAllocation));
    if (recomputed !== code) return { status: "mismatch", recomputed };
    let floor: ReturnType<typeof signedFloorOf> = null;
    try { floor = signedFloorOf(proof); } catch { floor = null; }
    return { status: "ok", counter: String(proof.commit.counter), position: String(proof.slotAllocation.counter), floorBlock: floor?.blockNumber ?? null, floorChain: floor?.chain ?? null };
  } catch (e) {
    return { status: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** The working, byte by byte: SHA-256 of the code to the characters asked. */
function Working({ q }: { q: Questions }) {
  const h = sha256(new Uint8Array([...new TextEncoder().encode(QV), 0, ...new TextEncoder().encode(q.code)]));
  const b2raw = h[3]! % 10, bumped = String(b2raw) === q.first.a;
  return (
    <div className="jev-working">
      <p>SHA-256 of <code>{QV}</code>, a zero byte, and the code:</p>
      <p><code className="break">{Array.from(h, hex2).join(" ")}</code></p>
      <ul>
        <li>byte 1 <code>{hex2(h[0]!)}</code> = {h[0]}, and {h[0]} mod 10 = <strong>{q.both.digit}</strong>: the digit {q.both.digit}</li>
        <li>byte 2 <code>{hex2(h[1]!)}</code> = {h[1]}, and {h[1]} mod 52 = {h[1]! % 52}: letter {h[1]! % 52 + 1} of A to Z then a to z, <strong>{q.both.letter}</strong></li>
        <li>byte 3 <code>{hex2(h[2]!)}</code> = {h[2]}, and {h[2]} mod 10 = <strong>{q.first.a}</strong>: the digit {q.first.a}</li>
        <li>byte 4 <code>{hex2(h[3]!)}</code> = {h[3]}, and {h[3]} mod 10 = {b2raw}{bumped ? <>, the same as byte 3&rsquo;s, so one more: <strong>{q.first.b}</strong></> : <>: the digit <strong>{q.first.b}</strong></>}</li>
      </ul>
    </div>
  );
}

const pct = (p: number) => `${Math.round(Math.max(p, 1 - p) * 100)}% sure`;

export function JevAsker({ children }: { children?: ReactNode } = {}) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [failedAt, setFailedAt] = useState(-1);
  const [code, setCode] = useState<string | null>(null);
  const [record, setRecord] = useState<JevRecord | null>(null);
  const [shown, setShown] = useState(false);
  const [restored, setRestored] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCheck, setCodeCheck] = useState<CodeCheck | null>(null);
  const busy = useRef(false);
  const stageRef = useRef<Stage | null>(null);
  const showTimer = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => () => window.clearTimeout(showTimer.current), []);

  // Coming back: /jev?p=<record id> reads the record back from the service.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("p");
    if (!p || !/^[A-Za-z0-9_-]{43}$/.test(p)) return;
    let cancelled = false;
    setRestoring(true);
    fetch(`${LIVE}/api/result/${p}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: JevRecord | null) => {
        if (cancelled) return;
        if (r && r.code) { setRecord(r); setCode(r.code); setRestored(!madeHere(r.id)); setShown(true); }
        else { setError("That answer could not be found. Ask two new questions below."); window.history.replaceState(null, "", "/jev"); }
      })
      .catch(() => { if (!cancelled) setError("That answer could not be opened right now. Try reloading the page."); })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, []);

  // Once a result is on screen: the code against its proof, read from bitgraph.ing itself.
  useEffect(() => {
    if (!record || !shown) { setCodeCheck(null); return; }
    let cancelled = false;
    setCodeCheck({ status: "checking" });
    const run = async (tries: number) => {
      const c = await checkCode(record.id, record.counter, record.code);
      if (cancelled) return;
      // A fresh record can take a moment to reach the ledger's lookup.
      if (c.status === "unavailable" && tries > 0) { setTimeout(() => void run(tries - 1), 1500); return; }
      setCodeCheck(c);
    };
    void run(4);
    return () => { cancelled = true; };
  }, [record, shown]);

  const ask = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    window.clearTimeout(showTimer.current);
    startedAt.current = performance.now();
    window.history.replaceState(null, "", "/jev");
    setError(null); setRecord(null); setCode(null); setShown(false); setRestored(false); setFailedAt(-1); setCopied(false);
    const go = (s: Stage) => { stageRef.current = s; setStage(s); };
    go("opening");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch(`${LIVE}/api/ask`, { method: "POST" });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `the service answered ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", done: JevRecord | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.stage === "opened") { setCode(m.code); go("asking"); }
          else if (m.stage === "answered") go("recording");
          else if (m.stage === "recorded") { done = m.record; go("ready"); }
          else if (m.stage === "failed") throw new Error(m.error);
        }
        if (end) break;
      }
      if (!done) throw new Error("the service stopped before the answers were recorded");
      setRecord(done);
      window.history.replaceState(null, "", `/jev?p=${done.id}`);
      rememberMade(done.id);
      showTimer.current = window.setTimeout(() => setShown(true), Math.max(0, MIN_WAIT_MS - (performance.now() - startedAt.current)));
    } catch (e) {
      setFailedAt(stepIndex(stageRef.current));
      setStage(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, []);

  const copyLink = useCallback(async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* nothing to do */ }
  }, []);

  const running = stage !== null && !shown && failedAt < 0;
  const q = code ? questionsFor(code) : null;
  const t = q ? truthOf(q) : null;
  const a = record?.answers ?? null;
  // The floor block's own chain: the record's word, else the checked proof's; unnamed until one of them says.
  const floorChain = record?.floorChain ?? (codeCheck?.status === "ok" ? codeCheck.floorChain : null) ?? null;
  const floorBlockName = (num: number) => `${floorChain === "base" ? "Base block" : floorChain === "ethereum" ? "Ethereum block" : "block"} ${n(num)}`;
  const right = a && t ? { both: a.both.yes === t.both, first: a.first.choice === t.first } : null;
  const proofHref = record ? `/proof/${record.id}` : "#";
  const yesNo = (b: boolean) => (b ? "Yes" : "No");
  const firstLabel = (c: string) => (c === "neither" ? "Neither" : `The ${c}`);

  return (
    <div className={`art${shown ? " is-active" : ""}`}>
      {children && (
        <div className={`art-hero${stage !== null || failedAt >= 0 || shown || restoring ? " is-away" : ""}`}>
          <div className="art-hero-inner">{children}</div>
        </div>
      )}
      <div className={`art-hero art-go-wrap${running || shown || restoring ? " is-away" : ""}`}>
        <div className="art-hero-inner jev-go-inner">
          <button type="button" className="bg-action-link is-make art-go" onClick={ask} disabled={running} aria-busy={running}>
            {failedAt >= 0 ? "Try again" : "Ask Jev two new questions"}
          </button>
        </div>
      </div>

      {/* While it runs, the site's own spinner (Mike, 10-06: "the green checks are dumb and make it seem like
          its taking longer ... use normal spinner we have on site"): the proof page's fresh-recording wait. */}
      {running && (
        <div className="art-wait" role="status" aria-label="BitGraphing">
          <div className="bg-spinner art-spinner" />
          <div className="art-wait-label">BitGraphing&hellip;</div>
        </div>
      )}
      {restoring && <p className="art-restoring" role="status">Opening the answer&hellip;</p>}
      {error && <div className="art-error" role="alert"><p>{error}</p></div>}

      {record && shown && q && t && (
        <div className="art-result">
          {/* What just happened, for someone who has never heard of BitGraph. */}

          <div className="jev-card">
            <div className="jev-card-label">Position commitment</div>
            <MarkedCode code={record.code} q={q} />
            <ol className="jev-qs">
              <li>
                <div className="jev-q"><span className="jev-chip jev-q1" aria-hidden>1</span>{q.both.text}</div>
                {a ? (
                  <div className="jev-a">
                    <span>Jev: <strong>{yesNo(a.both.yes)}</strong> <span className="jev-sure">({pct(a.both.p)})</span></span>
                    <span className={`jev-verdict ${right?.both ? "is-right" : "is-wrong"}`}>{right?.both ? "Right" : `Wrong: ${yesNo(t.both)}`}</span>
                  </div>
                ) : <div className="jev-a"><span>Jev did not answer: {record.jevError}</span></div>}
              </li>
              <li>
                <div className="jev-q"><span className="jev-chip jev-q2" aria-hidden>2</span>{q.first.text}</div>
                {a ? (
                  <div className="jev-a">
                    <span>Jev: <strong>{firstLabel(a.first.choice)}</strong>{a.first.confidence !== null ? <span className="jev-sure"> ({Math.round(a.first.confidence * 100)}% sure)</span> : null}</span>
                    <span className={`jev-verdict ${right?.first ? "is-right" : "is-wrong"}`}>{right?.first ? "Right" : `Wrong: ${firstLabel(t.first)}`}</span>
                  </div>
                ) : null}
              </li>
            </ol>
          </div>

          {/* The caption under the image (Mike, 10-06: "it should caption under image"). */}
          <p className="art-explain art-explain-one art-caption">{/* The same claim as /image's caption (Mike, 10-06: "do both"; "the bits" from 10-07). */}The proof for these questions began before the bits&nbsp;existed.</p>
          <div className="actions art-actions">
            <a className="bg-action-link is-make" href={proofHref}><span>See the full proof</span></a>
            <a className="bg-action-link" href={`${LIVE}/api/result/${record.id}/download`}><span>Download the record</span></a>
            <button type="button" className="bg-action-link" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
            <button type="button" className="bg-action-link" onClick={ask}>Ask two new questions</button>
          </div>

          <details className="art-details">
            <summary className="art-details-title">Technical details</summary>
            <ol className="art-timeline">
              <li><span>{floorBlockName(record.floorBlock).replace(/^block/, "Block")}</span><span>the floor</span></li>
              <li><span>Position {n(record.position)} opened, code issued</span><span>after the floor</span></li>
              <li><span>Two questions made from the code</span><span>{QV}</span></li>
              <li><span>Jev answered</span><span>{record.jev.ms !== null ? `in ${n(record.jev.ms)} ms` : ""}</span></li>
              <li><span>Recorded as <a href={proofHref}>BitGraph #{n(record.counter)}</a></span><span>{record.files.length} files</span></li>
            </ol>
            <div className="art-detail-parts">
              {/* Mike, 10-06: "how will people know the QUESTION is truly random?", "that has to be proven AFTER
                  position opens or this is dumb". */}
              <h3>How these questions were chosen</h3>
              <p><strong>1. The code comes from the position.</strong> It is worked out from the record BitGraph&rsquo;s enclave signed when the position opened, together with the hash of {floorChain === "base" ? "a Base block" : floorChain === "ethereum" ? "an Ethereum block" : "the floor block"} bound into it, so it could not be computed before the position opened. Checked here, in your browser, from the proof on bitgraph.ing:</p>
              <p className={`jev-check is-${codeCheck?.status ?? "checking"}`}>
                {codeCheck === null || codeCheck.status === "checking" ? "Checking the proof\u2026"
                  : codeCheck.status === "ok" ? <>BitGraph #{n(codeCheck.counter)}: signature and attestation valid; the code recomputed from position {n(codeCheck.position)}{codeCheck.floorBlock !== null ? <> and {codeCheck.floorChain === "base" ? "Base" : "Ethereum"} block {n(codeCheck.floorBlock)}</> : null} matches the code above.</>
                  : codeCheck.status === "mismatch" ? <>The code recomputed from the proof does not match: <code className="break">{codeCheck.recomputed}</code>.</>
                  : <>The proof could not be checked just now ({codeCheck.reason}). The full proof page checks it too.</>}
              </p>
              <p><strong>2. The questions come from the code,</strong> by a public rule with no choice in it. Anyone can redo this with any SHA-256 tool:</p>
              <Working q={q} />
              <h3>What it proves</h3>
              <p>The questions were made from the position&rsquo;s code, and that code did not exist until the position opened. So no one could have seen these questions, or their answers, before the click. Jev&rsquo;s answers were recorded in that same position.</p>
              <h3>How the questions are made</h3>
              <p>The SHA-256 of the code ({QV}) chooses a digit and a letter for the first question and two digits for the second. Anyone can make them again from the code and check the true answers by eye: the marked characters show where each one first appears.</p>
              <h3>What it does not prove</h3>
              <p>That Jev worked alone, how Jev works, or anything beyond these two answers. The kind of question is public; only these exact questions are new.</p>
              <h3>The numbers</h3>
            </div>
            <dl>
              <dt>Code</dt><dd><code className="break">{record.code}</code></dd>
              <dt>Record</dt><dd>BitGraph #{n(record.counter)}, epoch <code>{record.epoch.slice(0, 8)}</code></dd>
              <dt>Position</dt><dd>opened at {n(record.position)}, after {floorBlockName(record.floorBlock)}</dd>
              <dt>Jev</dt><dd>{record.jev.reported ?? record.jev.model}{record.jev.requestId ? <>, TypeSafe request <code className="break">{record.jev.requestId}</code></> : null}</dd>
              <dt>Recorded files</dt><dd>{record.files.join(", ")}</dd>
              <dt>Record SHA-256</dt><dd><code className="break">{record.digestB64}</code> (base64)</dd>
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}
