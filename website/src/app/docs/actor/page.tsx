import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "BitGraph Actor",
  description: "Recordings authorized by a key you hold: one passkey touch, verified inside the enclave against its own single-use nonce, and what a reader may and may not conclude from it.",
};

/* ── /docs/actor: the page the instrument is not allowed to be. ──
   /actor explains nothing by design (the register screen's warning was cut as
   preachy; the proof page's Actor card lost its explainer for the same
   reason), and both of those now point here. So this is where the mechanism,
   the claim and its limits, and the cost are written down, once, in the
   overview's vocabulary. Facts, in reading order; no doctrine restated from
   the overview beyond the one line each section needs. ── */

/* What a declared proof carries, shaped as the enclave emits it (and as
   lib/webauthn.ts builds the envelope). Edit only against those. */
const AGENCY_EXAMPLE = `"agency": {
  "actor": {
    "keyId": "ee0c6517…",            // hex SHA-256 of the public key (SPKI DER)
    "publicKeyB64": "MFkwEwYHKoZI…",  // P-256 public key
    "algorithm": "ES256",
    "provider": "passkey"
  },
  "authorization": {
    "purpose": "bitgraph/commit-authorize/v1",
    "format": "webauthn",
    "actorKeyId": "ee0c6517…",        // must equal actor.keyId
    "artifactHash": "<digestB64>",     // must equal artifact.digestB64
    "challenge": "<the enclave's nonce>",
    "timestamp": 1755620000000,
    "authenticatorDataB64": "…",      // flags: user present, user verified
    "clientDataJSON": "{…\\"challenge\\":…}",
    "signatureB64": "…"               // P-256 over authenticatorData ‖ SHA-256(clientDataJSON)
  },
  "batchContext": {                   // present on a run of more than one file
    "batchSize": 40, "batchIndex": 0, "batchDigests": ["…"]
  }
}`;

export default function ActorDocsPage() {
  return (
    <div className="prose-doc">
      {/* ❄️ No subtitle. One lived here for an hour ("The camera that puts
          your key on a recording"; Mike: "is dumb and i hate it"). The Folder
          page has none either; only Player carries one, and that line is
          Mike's. The first sentence says what this is. */}
      <h1 className="mb-5">BitGraph Actor</h1>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        A recording made at <a href="/actor">bitgraph.ing/actor</a> is an ordinary BitGraph plus one thing: an authorization for that exact file, signed by a key only your device can use, and verified inside the enclave against a nonce of its own before it would record anything. Same slot, same order, same anchors. Only the who differs.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 32 }}>
        BitGraph never learns who you are. The proof carries a key; who holds it is a question for whoever reads the proof, answered from a source they choose.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>
          <strong>Once, per browser: register a passkey.</strong> Touch ID, Face ID or Windows Hello makes a P-256 key pair in the device&apos;s secure hardware. The private key never leaves it. What the proof will carry is the public key and its <code>keyId</code>, the SHA-256 of that public key.
        </li>
        <li>
          <strong>Drop a file, as on home.</strong> It is hashed in your browser and the ledger is read. A file already on record comes back as the positions it holds, and nothing is signed: a lookup is not a recording.
        </li>
        <li>
          <strong>For files not yet on record, the enclave issues a nonce.</strong> Its own, from its hardware random source, kept for 60 seconds and accepted once. A nonce the caller chose would prove nothing about when the caller chose it.
        </li>
        <li>
          <strong>One touch.</strong> Your device signs that nonce (a WebAuthn assertion: the authenticator data and the client data, which names the nonce, under the P-256 key). The envelope that travels with the commit names the key, the file&apos;s digest, the nonce and the moment.
        </li>
        <li>
          <strong>The enclave checks before it allocates anything.</strong> The nonce is its own and still pending; the purpose is <code>bitgraph/commit-authorize/v1</code>; the digest named is the digest being committed; the <code>keyId</code> is the hash of the public key; the moment is inside the window; the authenticator reported the user present and verified; the signature verifies. Then it consumes the nonce and binds the file&apos;s hash into its slot with the actor inside the signed body.
        </li>
        <li>
          <strong>A batch is one touch.</strong> The first file of a run is validated in full; the rest inherit the actor through the batch context, for the same 60 seconds. Forty photos ask once.
        </li>
      </ol>

      <h2>What a declared proof carries</h2>
      <p>
        One object beside the rest of the proof. <code>actor</code> is inside the body the enclave signs, so it cannot be attached to a proof afterwards or removed from one; the authorization&apos;s own P-256 signature is checkable on its own, with no enclave involved.
      </p>
      <div className="code-block">
        <div className="code-block-header">proof.json (excerpt)</div>
        <pre>{AGENCY_EXAMPLE}</pre>
      </div>
      <p>
        The rest of the format is on <a href="/docs/proof-format">Proof Format</a>.
      </p>

      <h2>What it establishes</h2>
      <p>
        That the key named was used to authorize this recording at this position, on a device that reported its user present and verified, at a moment the enclave could check.
      </p>
      <p>
        <strong>Not authorship.</strong> Anyone can act on a file they downloaded. The proof fixes who authorized the recording, never who made the bytes.
      </p>
      <p>
        <strong>Not a name.</strong> BitGraph never learns one. On a proof page the Actor card prints a name only when the browser reading it holds that very key; beside anyone else&apos;s key it reads &ldquo;Not established here&rdquo;, which is the claim shown rather than asserted. Who holds a key is the reader&apos;s question. A published register, when one exists, will be one source for the answer, and the card will say so rather than present it as BitGraph&apos;s.
      </p>

      <h2>The cost</h2>
      <p>
        Every recording made under one key can be linked to every other. That is the feature, and it is the price. When the who is not the point, record from <Link href="/">home</Link> instead: the same slot, the same order and the same anchors, with no key on the proof. An enrolled browser can still do that, and should.
      </p>
      <p>
        There is one chain. Declared recordings are not kept on a ledger of their own, so the anonymity set of an anonymous recording is every recording ever made.
      </p>

      <h2>Reading one</h2>
      <p>
        On a proof page, the Actor card shows the name (when it can), the key, and what signed: a passkey on the actor&apos;s device, or the actor&apos;s own key.
      </p>
      <p>
        Offline, <a href="/docs/verification">bitgraph-verify</a> re-checks the authorization from the proof alone: that <code>keyId</code> is the SHA-256 of the public key, that <code>actorKeyId</code> and <code>artifactHash</code> match the actor and the artifact, that the client data is a <code>webauthn.get</code> over this nonce, that the authenticator reported presence and verification, and that the P-256 signature verifies over the authenticator data and the hash of the client data. A verifier&apos;s policy can require an actor on every proof, or accept only named keys or providers (<code>requireActor</code>, <code>allowedActorKeyIds</code>, <code>allowedActorProviders</code>).
      </p>

      <h2>Forgetting a device</h2>
      <p>
        <em>Forget this device</em> removes the key from this browser. The passkey itself stays in your keychain until you delete it there, and registering again makes a new key: recordings made under the old one keep it, which is the honest account of what happened. There is no rename. The label beside the key is this browser&apos;s own and never enters a proof.
      </p>
    </div>
  );
}
