"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Ask Jev on two BitGraphs. live.occproof.com (repo ~/Code/bitgraph-live, branch jev-two-bitgraphs) binds A (the
 * request), makes two questions from A's nonce, asks Jev, and binds B (the record), streaming each step. This page
 * shows it, and does not take the service's word for the questions: it fetches A's proof from bitgraph.ing itself,
 * reads the nonce, and makes the questions again here. A result survives leaving the page: /jev?p=<B's id>.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SandwichFigure } from "@/components/primitive-figures";
import { CopyableCode } from "@/components/copy-icon";

// The service runs on the enclave host behind its Cloudflare tunnel (2026-10-24), whose zone is occproof.com.
const LIVE = process.env.NEXT_PUBLIC_JEV_LIVE_URL ?? "https://live.occproof.com";
const QV = "bitgraph-jev-question/1";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
const urlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface Questions { version: string; code: string; both: { digit: string; letter: string; text: string }; first: { a: string; b: string; text: string } }
interface Side { id: string; counter: string; nonceCounter: string }
interface Asked {
  id: string; a: Side; b: Side; code: string; questions: Questions;
  truth: { both: boolean; first: string; at: { digit: number; letter: number; a: number; b: number } };
  answers: { both: { p: number; yes: boolean }; first: { choice: string; confidence: number | null } } | null;
  jevError: string | null; right: { both: boolean; first: boolean } | null; jev: { model: string; reported: string | null };
}

/** A proof page that also shows the file itself: ?files= is the record's download, which the proof page reads from
 *  live.occproof.com (an approved host) and shows only if a file in it has the proof's signed digest. */
const proofLink = (id: string, recordId: string) =>
  `/proof/${id}?files=${encodeURIComponent(`${LIVE}/api/result/${recordId}/download`)}`;

/** The questions, made from the code exactly as the service makes them (questions.ts). */
async function questionsFor(code: string): Promise<Questions> {
  const te = new TextEncoder();
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...te.encode(QV), 0, ...te.encode(code)])));
  const digit = String(h[0]! % 10), letter = LETTERS[h[1]! % 52]!;
  const a = String(h[2]! % 10);
  let b = String(h[3]! % 10);
  if (b === a) b = String((Number(a) + 1) % 10);
  return { version: QV, code, both: { digit, letter, text: `Does the code contain both the digit ${digit} and the letter ${letter}?` }, first: { a, b, text: `Reading left to right, which comes first: the digit ${a} or the digit ${b}?` } };
}

/** The code, with the first place each asked character appears marked. */
function MarkedCode({ r }: { r: Asked }) {
  const marks = new Set([r.truth.at.digit, r.truth.at.letter, r.truth.at.a, r.truth.at.b].filter((i) => i >= 0));
  const out: ReactNode[] = [];
  for (let i = 0; i < r.code.length; i++) out.push(marks.has(i) ? <mark key={i} className="jev-mark">{r.code[i]}</mark> : r.code[i]);
  return <CopyableCode text={r.code} label="the code"><pre className="hiw-code jev-code">{out}</pre></CopyableCode>;
}

export function JevAsker() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [step, setStep] = useState<string>("");
  const [r, setR] = useState<Asked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [derived, setDerived] = useState<"checking" | "match" | "mismatch" | "unavailable" | null>(null);

  /** The check that does not rest on the service: A's proof from bitgraph.ing, its nonce, the questions made here. */
  const checkQuestions = useCallback(async (rec: Asked) => {
    setDerived("checking");
    try {
      const res = await fetch(`/api/proofs/${rec.a.id}`);
      const body = res.ok ? ((await res.json()) as { proofs?: Array<{ proof: { commit?: { nonceB64?: string } } }> }) : null;
      const nonce = body?.proofs?.[0]?.proof?.commit?.nonceB64;
      if (!nonce) { setDerived("unavailable"); return; }
      const code = urlSafe(nonce);
      const q = await questionsFor(code);
      setDerived(code === rec.code && q.both.text === rec.questions.both.text && q.first.text === rec.questions.first.text ? "match" : "mismatch");
    } catch { setDerived("unavailable"); }
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("p");
    if (!p || !/^[A-Za-z0-9_-]{43}$/.test(p)) return;
    void (async () => {
      try {
        const res = await fetch(`${LIVE}/api/result/${p}`);
        if (!res.ok) return;
        const rec = (await res.json()) as Asked;
        setR(rec); setState("done"); void checkQuestions(rec);
      } catch { /* the page still asks */ }
    })();
  }, [checkQuestions]);

  const askNow = async () => {
    setState("running"); setError(null); setR(null); setDerived(null); setStep("Making BitGraph A…");
    try {
      const res = await fetch(`${LIVE}/api/ask`, { method: "POST" });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? `The service answered ${res.status}`); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", rec: Asked | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const s = JSON.parse(line) as { stage: string; record?: Asked; error?: string };
          if (s.stage === "a") setStep("Asking Jev…");
          else if (s.stage === "answered") setStep("Making BitGraph B…");
          else if (s.stage === "recorded" && s.record) rec = s.record;
          else if (s.stage === "failed") throw new Error(s.error ?? "it did not finish");
        }
      }
      if (!rec) throw new Error("it did not finish");
      setR(rec); setState("done");
      window.history.replaceState(null, "", `/jev?p=${rec.id}`);
      void checkQuestions(rec);
    } catch (e) {
      setError((e as Error).message); setState("error");
    }
  };

  return (
    <>
      <section className="home-section" aria-labelledby="jev-h">
        <p className="home-kicker">Ask AI</p>
        <h2 id="jev-h">Two questions that could not exist before you&nbsp;click.</h2>
        <p style={{ marginTop: 24 }}>
          One click makes BitGraph A. Its nonce, unseen until A is bound, chooses two questions for Jev, an AI. Jev answers, and
          the record is bound as BitGraph B, after A in the same sequence. Nothing about the questions existed before&nbsp;A.
        </p>
        <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* The primary action, filled (2026-10-20) so it stands out as the one thing to press. The record dot was tried
              and left off: on a button it reads as "this site will record you". */}
          <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} disabled={state === "running"} onClick={() => void askNow()}>
            {r ? "Ask again" : "Ask AI"}
          </button>
          {/* While it runs the button keeps its label and a bar fills, one part per step, instead of the label changing
              at each BitGraph (2026-10-19): a label swapped per step made the button blink. */}
          {state === "running" && (
            <span className="demo-progress" role="progressbar" aria-label={step} title={step}>
              <span style={{ width: `${Math.round(100 * (step.startsWith("Making BitGraph B") ? 0.85 : step.startsWith("Drawing") || step.startsWith("Asking") ? 0.5 : 0.15))}%` }} />
            </span>
          )}
          {state === "error" && <span className="db-bad">{error}</span>}
        </div>
      </section>

      {r && (
        // The result opens smoothly: the space grows and the content fades in, so the drawing below glides down
        // instead of jumping (2026-10-19).
        <div className="demo-reveal"><div>
        <section className="home-section" aria-labelledby="jev-r">
          <p className="home-kicker">The code: BitGraph A&rsquo;s nonce</p>
          <h2 id="jev-r" className="sr-only">Result</h2>
          <div style={{ marginTop: 16 }}><MarkedCode r={r} /></div>
          <ol className="docs-list" style={{ marginTop: 24 }}>
            <li>
              <strong>{r.questions.both.text}</strong><br />
              Jev: {r.answers ? `${r.answers.both.yes ? "yes" : "no"} (${Math.round(r.answers.both.p * 100)}%)` : "no answer"}. True answer: {r.truth.both ? "yes" : "no"}.{" "}
              {r.right && <span className={r.right.both ? "db-ok" : "jev-wrong"}>{r.right.both ? "Right." : "Wrong."}</span>}
            </li>
            <li>
              <strong>{r.questions.first.text}</strong><br />
              Jev: {r.answers ? r.answers.first.choice : "no answer"}. True answer: {r.truth.first}.{" "}
              {r.right && <span className={r.right.first ? "db-ok" : "jev-wrong"}>{r.right.first ? "Right." : "Wrong."}</span>}
            </li>
          </ol>
          {r.jevError && <p className="db-bad">Jev did not answer ({r.jevError}); the record says so.</p>}
          <p style={{ marginTop: 16 }}>
            {derived === "checking" && "Making the questions again in your browser from A’s proof on bitgraph.ing…"}
            {derived === "match" && "✓ Made again in your browser from A’s nonce, read from A’s proof on bitgraph.ing: the same code, the same two questions."}
            {derived === "mismatch" && <span className="db-bad">The questions do not match A&rsquo;s nonce on bitgraph.ing.</span>}
            {derived === "unavailable" && "A’s proof could not be read just now to remake the questions here; the links below still open both proofs."}
          </p>
          {/* The links are buttons (2026-10-19), like View proof on Make. */}
          <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a className="bg-action-link" style={{ margin: 0 }} href={proofLink(r.a.id, r.id)}>BitGraph A #{fmt(r.a.counter)}, the request</a>
            <a className="bg-action-link" style={{ margin: 0 }} href={proofLink(r.id, r.id)}>BitGraph B #{fmt(r.b.counter)}, the record</a>
            <a className="bg-action-link" style={{ margin: 0 }} href={`${LIVE}/api/result/${r.id}/download`}>Download both files and proofs</a>
          </div>
        </section>
        </div></div>
      )}
      {/* The drawing explains; it does not animate, and it sits below the result, so a result is the first thing seen
          after the button (2026-10-19): the animation added nothing, and the result reads better higher up the
          page. */}
      <section className="home-section" aria-label="How it works">
        <div>
          <SandwichFigure
            a="The request"
            steps={[{ title: "Questions", sub: "From A’s nonce" }, { title: "AI answers", sub: "Jev" }]}
            b="The answers"
            caption={<>The questions could not exist before&nbsp;A.<br />The answers are bound at&nbsp;B.</>}
            label="BitGraph A, the request. Two questions are made from A's nonce, the AI Jev answers them, and BitGraph B binds the record."
          />
        </div>
      </section>
    </>
  );
}
