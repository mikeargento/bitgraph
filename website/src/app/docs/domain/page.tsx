import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BitGraph Domain",
  description:
    "A domain publishes the keys that record for it: publish yours, pin one, and check what arrives against it, offline.",
};

/* ── /docs/domain: a BitGraph Domain is the company speaking for itself,
   never BitGraph speaking about the company. Doctrine this page must not
   break: identity is a property of the reader (a domain's file is A source
   a reader may pin, never THE authority); the domain line of a check is
   TRUE or UNDETERMINED, never FALSE (absence contradicts nothing, the same
   open-world rule as signedBy, Player SPEC §9.3); fingerprints are always
   derived from key material, never assigned. The file grammar is SPEC
   §9.1's trustedKeys grammar so entries paste into format 2 rules
   unchanged. Format details: packages/player/DOMAIN.md. Named "BitGraph
   Domain" by Mike 2026-08-22 (was "Letterhead", which survives only as the
   analogy line in The cost).

   Every verb this page names exists as of player 0.6.0 (published
   2026-08-22); the page was deliberately held back until it did, because
   a page must not name an entry point the program itself does not have. ── */

const DOMAIN_EXAMPLE = `{
  "version": "bitgraph-domain/1",
  "domain": "acme.com",
  "party": "Acme Corp",
  "keys": {
    "invoices": { "alg": "es256",   "publicKey": "<SPKI DER, base64>" },
    "press":    { "alg": "ed25519", "publicKey": "<raw 32 bytes, base64>" }
  }
}`;

const REPORT_EXCERPT = `  TRUE   domain       actor key "invoices" · published by acme.com (Acme Corp)
  UNDET  domain       no evidence binds this recording to acme.com`;

export default function DomainDocsPage() {
  return (
    <div className="prose-doc">
      <h1 className="mb-5">BitGraph Domain</h1>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        A BitGraph Domain is a company&apos;s own domain publishing the keys that record for it: one file, at one fixed address. A reader pins the domain once. From then on, anything the company delivers can be checked against it, offline: the file in hand holds a recorded position, and a key the domain published stands behind that recording.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 32 }}>
        Email made this move twenty years ago: domains publish their signing keys, and receivers check what arrives. Files never got the same statement. This is that statement, and it is the company speaking for itself, not BitGraph speaking about the company: a proof carries a key and nothing else, and whether to pin a domain belongs to each reader. There is no list to join and no one to ask.
      </p>

      <h2>Publish yours</h2>
      <p>Serve one JSON file over HTTPS at a fixed address on your domain:</p>
      <div className="code-block">
        <div className="code-block-header">https://acme.com/.well-known/bitgraph</div>
        <pre>{DOMAIN_EXAMPLE}</pre>
      </div>
      <p>
        <code>keys</code> follows the trusted-key grammar of the <a href="/docs/player">Player</a> spec, so an entry pastes into a rule&apos;s <code>trustedKeys</code> unchanged. For <code>es256</code>, the public key is SPKI DER in base64: the spelling every actor proof already carries, so the entry can be copied out of any proof the key has made. The names are yours; readers see them beside your domain. The file states one thing: these keys record for this domain. It is your letterhead, made checkable. Removing a key withdraws the statement for future pins; it rewrites nothing already recorded.
      </p>

      <h2>Record under yours</h2>
      <p>
        The file names <a href="/docs/actor">actor</a> keys. Recording does not change: one touch at <a href="/actor">bitgraph.ing/actor</a>, or the direct envelope from a server. The domain adds nothing to the proof; it lets a stranger resolve the key a proof already carries to the domain that published it.
      </p>

      <h2>Pin one</h2>
      <div className="code-block">
        <div className="code-block-header">once per domain</div>
        <pre>bitgraph-play pin acme.com</pre>
      </div>
      <p>
        The player fetches the domain&apos;s file, shows the party and each key&apos;s fingerprint, and stores what you confirm, on your machine. A fingerprint is the SHA-256 of the key itself; for <code>es256</code> keys it is exactly the <code>keyId</code> actor proofs carry, derived from the key material and never assigned, so a domain cannot claim a key it does not show. Pinning is the only step that touches the network. Pin again whenever you like: the player shows what changed before you accept it. The pin is your record; it never leaves your machine.
      </p>

      <h2>Check against one</h2>
      <div className="code-block">
        <div className="code-block-header">offline, from the export in hand and the pin on disk</div>
        <pre>{`bitgraph-play check "BitGraph (invoice-4471.pdf)/" --from acme.com`}</pre>
      </div>
      <p>One line joins the report for each recording:</p>
      <div className="code-block">
        <div className="code-block-header">check report (excerpt)</div>
        <pre>{REPORT_EXCERPT}</pre>
      </div>
      <p>
        <strong>TRUE.</strong> The file in hand hashes to the recorded digest, the recording verifies, and a key acme.com published stands behind it, either as the actor inside the proof or as a detached signature in the bundle. Nothing further to do.
      </p>
      <p>
        <strong>UNDETERMINED.</strong> The evidence in hand does not establish the connection. The file may be fine; nothing here says so. Ask the sender for the recording, or verify another way before relying on the file.
      </p>
      <p>
        <strong>FALSE</strong> never comes from the domain line. It comes from the recording itself, when evidence in hand contradicts it: an edited signature, a block header that does not hash to its anchor. Do not rely on the file.
      </p>

      <h2>What it establishes</h2>
      <p>
        That a key published by the domain stands behind a recording of exactly these bytes, at a fixed causal position. Not authorship: anyone can record a file they downloaded, under any key they hold. Not content: a recorded invoice can still be wrong. Not exclusivity: the same bytes may hold other positions, under other keys or none. And the statement is only as strong as the domain and the keys behind it: a stolen key keeps the domain&apos;s standing until it is removed and readers pin again.
      </p>
      <p>
        What changes is the default: a delivered file either arrives with the company&apos;s recording standing behind it, or it visibly arrives without it.
      </p>

      <h2>The cost</h2>
      <p>
        A domain&apos;s file names a key in public. From that moment, every recording the key has ever made or will make reads as the party&apos;s: the ledger is public, positions and volume included, and a pin, once stored, outlives the file that provided it. Publishing is retroactive, and it does not meaningfully un-publish. What it never exposes is content: only digests travel, so attributing a specific file still requires holding its bytes.
      </p>
      <p>
        The discipline is the one paper letterhead imposes: not every pen in the building writes on it. Publish keys you dedicate to what you intend to stand behind, named for their purpose, and record everything else as always: anonymously from home or the Folder, or under keys the file does not name. An anonymous recording&apos;s company is every recording ever made; nothing about a domain changes that.
      </p>

      <h2>In a rule</h2>
      <p>
        A domain&apos;s file is also evidence for rules: its entries paste into a format 2 rule&apos;s <code>trustedKeys</code>, and the <code>signedBy</code> claim verifies detached signatures under the same keys. The command and the rule language read the same statement; the <a href="/docs/player">Player</a> page has the rest.
      </p>
    </div>
  );
}
