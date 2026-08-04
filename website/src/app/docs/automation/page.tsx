import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zapier and Make",
  description:
    "Use BitGraph as a step in ordinary business workflows. Create, verify, and retrieve proofs from Zapier and Make without writing code.",
};

/**
 * NO ZAPIER OR MAKE LOGOS. Considered 2026-08-03 and rejected, and the reason
 * outlived the layout that prompted it. Zapier's badge permissions run through
 * a published directory listing and this app is unlisted; the Make path that
 * works is Make's own HTTP module calling this API rather than a Make app, so
 * their mark would claim a partnership that does not exist. Both are also the
 * trust-badge idiom this site rejects, and two marks side by side become the
 * banned card grid. `website/public/logos/` is 26 dead partner SVGs from the
 * agent-control era; the site has done the logo wall once already.
 *
 * An availability rail lived here for a few hours the same day, reading
 * "MAKE - Works today" / "ZAPIER - Works by invite". It was cut once the
 * invite link went on the page: its whole job was to say which platform was
 * open to you, and after publishing the link and making the connector's key
 * optional, both are. "Works by invite" then read as a restriction that does
 * not exist, and "not yet listed in Zapier's directory" only cast doubt on
 * the working link below it. Do not rebuild it unless one of the two paths
 * actually closes again.
 */

/**
 * The all-versions invite, deliberately NOT the per-version one that
 * `users:links` also prints: a version-specific link goes stale the moment a
 * new version is pushed, and this one does not.
 *
 * Publishing it is a considered choice, not an oversight. It grants no
 * capability that is not already public: /api/commit takes anonymous writes
 * today, which is what the site's own drop zone uses, so the connector is a
 * nicer surface over an open endpoint rather than a door into one. Per
 * Zapier's docs a public link has no user cap and per-user access cannot be
 * revoked once accepted, so treat it as one-way.
 */
const ZAPIER_INVITE =
  "https://zapier.com/developer/public-invite/244638/3bb0a7733fb4d4a568b6a23d221d4a93/";

export default function AutomationPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">Zapier and Make</h1>
      <p className="text-[#1f2937]" style={{ marginBottom: 36 }}>
        BitGraph as a step in an ordinary business workflow. A file arrives somewhere, it gets
        recorded, and the proof goes wherever the rest of your process needs it. No code, and
        the same ledger the API and MCP write to.
      </p>

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

      {/* Zapier leads, and did not always. Make was first while the Zapier
          app was an unobtainable dead end and Make's HTTP path was the only
          thing a reader could act on. Publishing the invite and making the
          connector's key optional inverted that: adding a prebuilt
          integration is now less work than hand-building an HTTP module with
          the right expression in it, and the h1 and the nav both read
          "Zapier and Make", which the old order contradicted. The short
          section also earns going first, since anyone who wants the harder
          path will scroll. */}
      <h2 className="text-xl font-semibold mt-12 mb-4">Zapier</h2>
      <p className="text-[#1f2937]">
        The three steps above are built as ordinary Zapier actions. Map a file into{" "}
        <strong className="text-text">Create BitGraph</strong> and every field of the proof is
        available to later steps: the hash, the counter, the epoch, the chain, the proof URL,
        and the two Ethereum block times that bracket the recording.
      </p>
      {/* "Private" on Zapier means unlisted, NOT unusable: the integration
          works in full for anyone holding its invite link. Verified against
          app 244638 on 2026-08-03 (state `private`, a live public-invite
          link), which is why the link is the action here rather than a note
          saying to ask for one. An earlier draft said the app "cannot be
          added from inside a Zap", which was simply wrong.

          An arrow link, not a button: the site has no buttons, and a filled
          slab was tried on /docs/folder on 2026-08-03 and reverted the same
          hour. */}
      <p style={{ marginTop: 28, marginBottom: 20 }}>
        <a
          href={ZAPIER_INVITE}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-arrow-link text-[#0065A4] font-semibold no-underline"
        >
          Add BitGraph to your Zapier account <span className="arrow" aria-hidden="true">&rarr;</span>
        </a>
      </p>
      {/* Deliberately bare. Two sentences were cut here on 2026-08-03: one
          duplicated the availability rail that used to sit above, and the
          other explained that the connection asks for an API key that is not
          issued yet and that any value connects, which was the page
          apologising for the connector.

          That apology is no longer needed: `apiKey` is now `required: false`
          with honest helpText, pushed to Zapier the same day and verified
          against the deployed definition. If the field ever goes back to
          required, this paragraph has to say so again, because nothing else
          on the page warns anyone. */}
      <p className="text-sm text-[#4b5563]" style={{ marginBottom: 36 }}>
        The source is in <code>packages/zapier/</code> in the{" "}
        <a href="https://github.com/mikeargento/bitgraph" target="_blank" rel="noopener noreferrer">repository</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Make</h2>
      <p className="text-[#1f2937] mb-4">
        {/* "can do this today" was here while Zapier was unavailable, where
            "today" carried an implied contrast with the other platform. Both
            work now, so the word was doing nothing but hinting at a gap that
            has closed. */}
        Make does this with its built-in HTTP and Tools modules, with nothing to install. It
        works because Make&apos;s own <code>sha256</code> emits base64 of the raw digest,
        which is exactly the form the API takes:
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
      <p className="text-sm text-[#4b5563]" style={{ marginBottom: 36 }}>
        Exact module settings for all three operations, the URL-safe digest expression the
        proof links need, and importable scenario blueprints are in{" "}
        <code>packages/make/</code> in the <a href="https://github.com/mikeargento/bitgraph" target="_blank" rel="noopener noreferrer">repository</a>.
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
        {/* nowrap because a scoped package name is a single token someone
            copies, and splitting it hurts reading even where it renders
            cleanly. The chip's appearance when wrapped is handled globally by
            box-decoration-break in globals.css, so this is about the name, not
            the styling. Safe to pin: 235px on one line, inside the 288px
            column at 320px, so it cannot overflow. Do not add nowrap to longer
            strings like commands, which genuinely need to wrap. */}
        <li>• <strong className="text-text">Verification does not require us.</strong> Every proof these steps return can be checked offline with <code style={{ whiteSpace: "nowrap" }}>@mikeargento/bitgraph-verify</code>, without this site or any network. See <a href="/docs/verification">Verification</a>.</li>
      </ul>
    </article>
  );
}
