import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zapier and Make",
  description:
    "Use BitGraph as a step in ordinary business workflows. Create, verify, and retrieve proofs from Zapier and Make without writing code.",
};

/**
 * The two platforms are not in the same state, and that is the first thing
 * someone landing here needs to know.
 *
 * Zapier and Make logos were considered for this slot on 2026-08-03 and
 * rejected. The Zapier app is private and unlisted, so their mark would
 * advertise an integration a reader cannot add from inside a Zap; and the Make
 * path that works today is Make's own HTTP module calling this API, not a Make
 * app, so their mark would claim a partnership that does not exist. Both are
 * also the trust-badge idiom this site rejects, and two marks side by side
 * become the banned card grid. A logo row would have said "these two brands";
 * this says which one is open to you right now, which is what the reader came
 * for. Do not re-pitch the logos before the Zapier app is actually listed.
 *
 * Page-local CSS in a style block, the same pattern as folder-process.tsx.
 * It also sidesteps `.prose-doc`'s unlayered defaults, which silently eat
 * Tailwind spacing utilities on p / li / h2 across every docs page.
 */
function Availability() {
  return (
    <div className="bg-avail">
      <style>{`
        .bg-avail { margin: 0 0 3rem; }
        .bg-avail dl {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px 22px;
          margin: 0;
        }
        .bg-avail dt {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #4b5563;
          /* optical baseline match against the 15px body text beside it */
          padding-top: 4px;
        }
        .bg-avail dd { margin: 0; font-size: 0.9375rem; line-height: 1.6; color: #1f2937; }
        .bg-avail dd .state { font-weight: 600; color: #111827; }
        @media (max-width: 480px) {
          .bg-avail dl { gap: 10px 16px; }
          .bg-avail dt { font-size: 10px; letter-spacing: 0.1em; }
        }
      `}</style>
      <dl>
        <dt>Make</dt>
        <dd><span className="state">Works today.</span> Nothing to install.</dd>
        <dt>Zapier</dt>
        <dd><span className="state">Works by invite.</span> Not yet listed in Zapier&apos;s directory.</dd>
      </dl>
    </div>
  );
}

export default function AutomationPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">Zapier and Make</h1>
      <p className="text-[#1f2937]" style={{ marginBottom: 36 }}>
        BitGraph as a step in an ordinary business workflow. A file arrives somewhere, it gets
        recorded, and the proof goes wherever the rest of your process needs it. No code, and
        the same ledger the API and MCP write to.
      </p>

      <Availability />

      {/* "What people build" was the header here and was cut: nobody builds
          these yet, so it was social proof for a product with no users. The
          rows are illustrations and the label now says so. */}
      <div className="code-block">
        <div className="code-block-header"><span>Where the step goes</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`Google Drive  ->  Create BitGraph  ->  Google Drive   (write the proof URL back)
DocuSign      ->  Create BitGraph  ->  Salesforce     (attach it to the record)
Dropbox       ->  Create BitGraph  ->  Slack          (post the causal window)
Any file      ->  Verify BitGraph  ->  Filter         (branch on verified)`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Three steps</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Create BitGraph</strong> · Give it a file. It returns the proof, its causal position, and a link to the proof page. A file already on record comes back with its existing proof rather than being recorded twice.</li>
        <li>• <strong className="text-text">Verify BitGraph</strong> · Give it a file, or a proof, or both. It returns verified or not, and says separately whether the file itself was checked against the proof.</li>
        <li>• <strong className="text-text">Retrieve Proof</strong> · Look up an existing proof by file, digest, or BitGraph number, including the Ethereum anchor window.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-12 mb-4">The file never leaves your automation</h2>
      <p className="text-[#1f2937] mb-8">
        Both platforms hash the file themselves and send only the 32-byte SHA-256 digest.
        Zapier and Make hold your file already, since they are what fetched it from Drive or
        Dropbox, but it goes no further: BitGraph receives a hash and nothing else. This is
        also why there is no field anywhere for a file URL that BitGraph would fetch itself.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Make</h2>
      <p className="text-[#1f2937] mb-4">
        Make can do this today with its built-in HTTP and Tools modules, with nothing to
        install. It works because Make&apos;s own <code>sha256</code> emits base64 of the raw
        digest, which is exactly the form the API takes:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Make expression</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`{{sha256(2.data; "base64")}}`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        Put that in the body of an HTTP module pointed at the commit endpoint:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>HTTP module, request content</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`POST https://bitgraph.ing/api/commit

{
  "digests": [{ "digestB64": "{{sha256(2.data; \\"base64\\")}}", "hashAlg": "sha256" }],
  "chainId": "bitgraph:main"
}`}</pre>
      </div>
      <p className="text-sm text-[#4b5563] mb-8">
        Exact module settings for all three operations, the URL-safe digest expression the
        proof links need, and importable scenario blueprints are in
        <code> packages/make/</code> in the <a href="https://github.com/mikeargento/bitgraph" target="_blank" rel="noopener noreferrer">repository</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Zapier</h2>
      <p className="text-[#1f2937]">
        The three steps above are built as ordinary Zapier actions. Map a file into{" "}
        <strong className="text-text">Create BitGraph</strong> and every field of the proof is
        available to later steps: the hash, the counter, the epoch, the chain, the proof URL,
        and the two Ethereum block times that bracket the recording.
      </p>
      {/* Said plainly rather than implied. The page described a connection
          flow in the present tense while the app was unlisted, so a reader
          could follow it to a search box that returns nothing.

          "Private" on Zapier means unlisted, NOT unusable: the integration
          works in full for anyone holding its invite link. Verified 2026-08-03
          against app 244638 (state `private`, 0 Zap users, a live
          public-invite link). So the honest fact is discoverability, not
          capability, and the earlier "cannot be added from inside a Zap"
          was wrong. The invite link itself is deliberately NOT printed here:
          every Zapier customer egresses from shared addresses into one per-IP
          rate-limit bucket until real keys are issued, and recordings are
          permanent and public on the Roll. */}
      <p className="text-sm text-[#4b5563]" style={{ marginBottom: 36 }}>
        The app is not in Zapier&apos;s directory yet, so it will not appear when you search
        inside the Zap editor. It works in full for anyone invited to it, and access is by
        invite for now. The source is in <code>packages/zapier/</code> in the{" "}
        <a href="https://github.com/mikeargento/bitgraph" target="_blank" rel="noopener noreferrer">repository</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Reading the result</h2>
      <p className="text-[#1f2937] mb-4">
        Two output fields deserve a second look, because acting on the wrong reading of either
        is the mistake worth avoiding.
      </p>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">artifactBinding</strong> is reported separately from <span className="font-mono text-xs">verified</span>, because &ldquo;this proof is genuine&rdquo; and &ldquo;this file is the one the proof describes&rdquo; are different claims. <span className="font-mono text-xs">checked</span> means the file was hashed and matches. <span className="font-mono text-xs">not-checked</span> means the proof is sound but nothing tied it to a file. <span className="font-mono text-xs">mismatch</span> means the proof is genuine and is for different bytes.</li>
        <li>• <strong className="text-text">bitgraphedAfter</strong> and <strong className="text-text">bitgraphedBefore</strong> are the two Ethereum blocks that bracket the recording. A proof carries no clock reading of its own, so this pair is the time statement, and it is a window rather than an instant.</li>
      </ul>
      <p className="text-sm text-[#4b5563] mt-8 mb-8">
        A freshly created proof has the lower bound but not yet the upper one: the later anchor
        lands with the next Ethereum block BitGraph anchors to, usually within a minute. If a
        step posts a time somewhere, either say &ldquo;after&rdquo; and use the lower bound, or
        wait and run Retrieve Proof for the settled window.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Notes</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Re-running is safe.</strong> A file already on record comes back with its existing proof and nothing new is created. Recording the same bytes again is a deliberate choice, because a second recording is a second causal position and means something different from the first.</li>
        <li>• <strong className="text-text">Recordings are permanent.</strong> The ledger has 10-year retention and no deletes. Point these steps at files you mean to put on record.</li>
        <li>• <strong className="text-text">Two failures are not failures.</strong> A 503 during the daily epoch rotation and a 429 from the rate limiter both reject before anything is minted, so both are safe to retry. Zapier retries by itself; in Make, use an error handler with Retry.</li>
        <li>• <strong className="text-text">One ledger.</strong> A recording made by a Zap is indistinguishable from one made by dropping the file on the site, and shows up on the same <a href="/roll">Roll</a>.</li>
        <li>• <strong className="text-text">Verification does not require us.</strong> Every proof these steps return can be checked offline with <code>@mikeargento/bitgraph-verify</code>, without this site or any network. See <a href="/docs/verification">Verification</a>.</li>
      </ul>
    </article>
  );
}
