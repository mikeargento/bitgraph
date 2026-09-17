import type { Metadata } from "next";
import Link from "next/link";
import { DocsPageNav } from "@/components/docs-page-nav";

export const metadata: Metadata = {
  title: "Use cases",
  description:
    "Where a record's position is worth proving: records an AI agent writes about its own work, evaluations that must postdate a public moment, automated decisions in regulated settings, and records that cross organisations. Each case names the existing record, the verification problem, where BitGraph enters, and what the proof adds.",
  openGraph: {
    title: "BitGraph: use cases",
    description: "Where a record's position is worth proving, and what the proof adds in each case.",
  },
};

/**
 * Each case answers the same four questions in the same order: what record
 * already exists, what a reader cannot check about it today, where BitGraph
 * enters the workflow, and what the proof contributes (and does not). The
 * agent-record case leads because it is where the mechanism does the most
 * work and where the zero-integration path (MCP) exists. The evaluation case
 * follows because it is the one with public, checkable evidence.
 */
type Case = {
  id: string;
  title: string;
  record: string;
  problem: string;
  where: string;
  adds: string;
  not: string;
  link?: { href: string; label: string };
};

const cases: Case[] = [
  {
    id: "agents",
    title: "Records an AI agent writes about its own work",
    record: "The task record: what the agent was asked to do, the inputs it used, the tool calls it made, and what it produced. It is written by the agent's own harness and kept by the same party.",
    problem: "Whatever the record says about its own time and order is that party's claim. A log kept by the system under review can be regenerated in full before anyone looks at it, and a timestamp inside it is signed by the same key that would sign a forgery.",
    where: "Before the task starts, the agent asks BitGraph for a position and receives the slot's commitment. It writes that commitment into the task record and commits the record's digest under the same slot. Outputs are recorded as they are produced, each at a later position. Both MCP servers implement this pattern; nothing about the task leaves the machine except digests.",
    adds: "The task record could not have been finished before its slot was allocated, and the slot names a public Ethereum block that had already been mined. Every output sits at a later position in the same sequence. A reviewer checks the order from the files and the proofs alone, offline, with no access to the agent's infrastructure.",
    not: "That the agent did what the record says, that the outputs are correct, or which model produced them. Those stay with whatever evidence the harness signs.",
    link: { href: "/docs/mcp", label: "Connect an agent over MCP" },
  },
  {
    id: "model-evaluation",
    title: "An evaluation that must postdate a public moment",
    record: "A question paper and an answer sheet. The claim that matters is that the questions were not in the model's training data.",
    problem: "Today that claim is a promise about a process: the set was kept private, or written after a cutoff, or held out by the party running the test. A buyer comparing a vendor's score with an evaluator's can settle it only by being handed the test, which destroys it for everyone afterward.",
    where: "The paper is derived from the commitment of a freshly allocated slot, whose record names an Ethereum block, and is committed under that slot. The answers are recorded later, at a later position. The derivation is specified so anyone can repeat it.",
    adds: "The questions could not have existed before the block the slot names, so no corpus frozen before it can contain them. The answers provably follow the paper. Vendor, evaluator and buyer verify both from a folder, offline, without revealing the paper to each other.",
    not: "That the template families were unfamiliar to the model, that it worked unaided, or how long it took. The answer sheet has a floor, not a ceiling.",
    link: { href: "/exam", label: "The sealed exam: six real sittings, verifiable offline" },
  },
  {
    id: "regulated-finance",
    title: "Automated decisions in regulated finance",
    record: "A decision record, a receipt, a model output or a compliance result, produced by the institution's own systems and retained under rules such as MiFID II, SEC Rule 17a-4 or DORA.",
    problem: "A signed record shows what decision was made. The auditor or counterparty who relies on it still trusts the institution's infrastructure for the ordering and the history, and that is the party whose conduct is in question.",
    where: "Each record, or each day's records as one set, is committed as it is produced. The record stays inside the institution; only its digest is sent.",
    adds: "Independent evidence that this exact record occupied this position, after a public block, and was not inserted later into a more convenient place. The proof is checked outside the institution, and it supplements the retained record rather than replacing it.",
    not: "That the decision was correct or lawful. The record-keeping obligation itself is met by the institution's system; the proof is evidence about it, not compliance with it.",
  },
  {
    id: "clinical-ai",
    title: "Clinical decision support and change control",
    record: "A decision record, a model manifest, an authorisation, or a change-control artifact for AI-enabled software. HIPAA's audit-control and integrity requirements and change-control expectations all assume a decision can be reconstructed later.",
    problem: "Reconstruction may be needed years later, and ordinary logging, however strong, stays under the control of the organisation whose history is being audited.",
    where: "Manifests and decision records are committed as they change. Patient data is never sent; a digest reveals nothing about the record's contents unless someone already holds the exact bytes.",
    adds: "Independent evidence of the order between exact digital states: which manifest was in force before which decision, and after which public block.",
    not: "That the decision was clinically right, or who made it. Note the privacy exposures below before recording low-entropy records.",
  },
  {
    id: "government",
    title: "Government and sovereign environments",
    record: "An administrative decision record, a policy analysis, or an evidence artifact that must stay inside a jurisdiction and may be challenged after the vendor contract behind it has ended.",
    problem: "The auditor may not trust, or may not be able to reach, the vendor or cloud service that produced the record. The check may have to run offline.",
    where: "The system keeps its own signed evidence and commits a digest. The artifact never leaves the secure environment.",
    adds: "A proof that verifies offline, years later, with no call to the vendor or to BitGraph. The one external reference, an Ethereum block, is checkable against any archive.",
    not: "Anything about the content. And the trust root is AWS Nitro hardware and a published enclave image, which some sovereign settings will want to run themselves; the self-hosting guide covers that.",
    link: { href: "/docs/self-host-tee", label: "Run your own enclave" },
  },
  {
    id: "multi-party-agents",
    title: "Records that cross organisations",
    record: "Company A signs a delegation; company B signs an execution receipt. Each may attest the hardware that ran its side.",
    problem: "Neither record can show where the two stood relative to each other, and the ordering evidence lives inside one company's infrastructure, which is exactly what the other does not want to trust.",
    where: "Each delegation, receipt or manifest is committed by whoever produces it, on the same public sequence.",
    adds: "A shared coordinate system: either party, or a third-party reviewer, checks the other's evidence and its order without trusting the other's database. The proof travels with the record.",
    not: "Whether the delegation was proper or the action correct. Those stay with the systems that signed them.",
  },
];

const others = [
  { title: "Photography and photojournalism", line: "which version the photographer delivered, fixed at a position beside Content Credentials rather than in place of them." },
  { title: "Periodic reports and attestations", line: "each report takes the next position as it is issued, and a rewritten report no longer matches the position the original held." },
  { title: "Evidence and chain of custody", line: "which file existed before which, with no clock to dispute." },
  { title: "Issued documents and credentials", line: "a holder presents the document with its proof, and the position is checked without a call to the issuer." },
  { title: "Instrument and field data", line: "an order that someone who was not present can check; against an expectation of what should be there, a gap becomes visible." },
  { title: "Construction and site records", line: "a photo or daily report made on the day holds a position from that day, before any dispute exists." },
  { title: "Drafts, designs and prior art", line: "revisions take later positions, so the development history itself becomes evidence." },
];

export default function UseCasesPage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <article className="prose">
        <h1>Use cases</h1>
        <p className="lede">
          Not every record needs a position. The records someone may later dispute do. Each case below names the record that already exists, what a reader cannot check about it today, where BitGraph enters the workflow, and what the proof adds and does not add. BitGraph sits beneath the receipt, the log and the signature; it does not replace them.
        </p>

        {cases.map((c) => (
          <section key={c.id} id={c.id}>
            <h2>{c.title}</h2>
            <dl className="terms" style={{ maxWidth: "var(--measure)" }}>
              <dt>The record</dt><dd>{c.record}</dd>
              <dt>The problem</dt><dd>{c.problem}</dd>
              <dt>Where BitGraph enters</dt><dd>{c.where}</dd>
              <dt>What the proof adds</dt><dd>{c.adds}</dd>
              <dt>What it does not</dt><dd>{c.not}</dd>
            </dl>
            {c.link && <p className="note"><Link href={c.link.href}>{c.link.label}</Link></p>}
          </section>
        ))}

        <h2 id="others">Other records with the same shape</h2>
        <p>The property is the same wherever exact bytes have to be defended later by whoever holds them.</p>
        <ul>
          {others.map((o) => (
            <li key={o.title}><strong>{o.title}:</strong> {o.line}</li>
          ))}
        </ul>

        <h2 id="before">Before adopting it in a regulated setting</h2>
        <div className="callout is-limit">
          <span className="kicker">Read this first</span>
          <p>Every recorded digest, position and anchor is public and permanent; the ledger&rsquo;s compliance lock prevents deletion by anyone, including the operator. A digest reveals nothing about a record unless someone already holds the exact bytes, but for low-entropy records, such as a short form from a known template, a holder of a candidate can confirm whether it was recorded. The record itself never leaves your systems. The <Link href="/docs/trust-model#privacy">trust model</Link> lists the exposures in full.</p>
        </div>

        <h2 id="next">Where next</h2>
        <ul className="doors">
          <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop any file in your browser. Only its fingerprint leaves your machine, and the proof comes back to you.</span></li>
          <li><Link href="/docs/integration">Integration guide</Link><span>Record from your own systems: SDK, CLI, or two HTTP calls.</span></li>
          <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL.</span></li>
          <li><Link href="/contact">Contact</Link><span>Licensing and evaluation, with Michael Argento.</span></li>
        </ul>
      </article>
    <DocsPageNav current="/subjects" />
    </div>
  );
}
