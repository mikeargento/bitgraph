import type { Metadata } from "next";
import Link from "next/link";
import { DocsPageNav } from "@/components/docs-page-nav";
import { CopyCode } from "@/components/copy-code";
import { Code, guessLang } from "@/components/code";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Every BitGraph endpoint: making a BitGraph on bitgraph.ing, the enclave host, reading the ledger, verifying, the types and the errors.",
};

const PCR0 = "eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b";

/**
 * One endpoint: the method and path in the data face, a one-line summary,
 * then whatever blocks and notes the endpoint needs. No badge, no colour:
 * a plain mono label is enough to tell POST from GET.
 */
function Endpoint({
  method,
  path,
  id,
  summary,
  children,
}: {
  method: "GET" | "POST";
  path: string;
  id: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>
        <span className="mono">{method}</span> <span className="mono break">{path}</span>
      </h3>
      <p>{summary}</p>
      {children}
    </section>
  );
}

/** A labelled code block: Request, Response, an example. */
function Block({ label, code }: { label: string; code: string }) {
  return (
    <div className="code-block">
      <div className="code-block-header"><span>{label}</span><CopyCode /></div>
      <Code lang={guessLang(label, code)}>{code}</Code>
    </div>
  );
}

export default function APIReferencePage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <article className="prose">
        <h1>API reference</h1>
        <p className="lede">
          Every endpoint BitGraph exposes, with its request, its response, its status codes and what each answer means. For engineers integrating over HTTP; the <Link href="/docs/integration">integration guide</Link> shows the same calls in the order a first integration uses them.
        </p>

        <h2 id="hosts">Hosts and conventions</h2>
        <dl className="terms">
          <dt>https://bitgraph.ing</dt>
          <dd>The site. Everything under <code>/api/</code>. Making a BitGraph goes through here: these routes sit behind the anchor-first gate, so every position they issue carries a floor, and they write the proof to the ledger.</dd>
          <dt>https://nitro.occproof.com</dt>
          <dd>The enclave host: the EC2 parent in front of the AWS Nitro enclave. The site&rsquo;s routes proxy to it. Commit here directly and the proof is not indexed by the site.</dd>
          <dt>Authentication</dt>
          <dd>None on the public endpoints. The enclave host accepts an optional <code>Authorization: Bearer &lt;key&gt;</code> and requires one only when the server is configured with API keys; the site forwards the header when present.</dd>
          <dt>Digests</dt>
          <dd>A file&rsquo;s fingerprint (SHA-256 digest), 32 bytes. Standard base64 inside proofs and request bodies; URL-safe base64 without padding in ledger paths and query strings. <code>/api/verify</code> accepts hex as well.</dd>
          <dt>Counters and epochs</dt>
          <dd>Counters are decimal strings. An epoch id is hex SHA-256 inside a proof and URL-safe base64 in query strings. Block times are ISO 8601, read from the block header.</dd>
          <dt>Body limit</dt>
          <dd>1 MB. Larger bodies get 413.</dd>
        </dl>

        <h2 id="make">Making a BitGraph on bitgraph.ing</h2>
        <p>
          The recommended path is two calls: allocate a slot, then commit the digest of the fused file you built around that slot. Recording a digest of bytes that already exist is a compatibility operation, listed third.
        </p>

        <Endpoint
          method="POST"
          path="/api/fuse/allocate"
          id="post-api-fuse-allocate"
          summary="Allocate an unused slot before the fused file exists. No body. The enclave signs the slot record before it receives any digest; the producer writes a commitment derived from that record into the new file, then commits the file's digest under the same slot with POST /api/fuse/commit."
        >
          <Block label="Request" code={`(no body)`} />
          <Block
            label="Response 200"
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",   // the slot's nonce
  "slot": {
    "version": "bitgraph/slot/1",
    "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
    "counter": "277",
    "epochId": "a1b2c3d4e5f6...",
    "publicKeyB64": "...",
    "chainId": "bitgraph:main",
    "signatureB64": "..."
  },
  "chainId": "bitgraph:main"
}`}
          />
          <ul>
            <li>The <code>slotId</code> is the slot&rsquo;s nonce: a bearer ticket until the slot is consumed. Write only the derived commitment into the file, never the nonce, and do not log it. The commitment is SHA-256 over the domain string <code>bitgraph-fuse/1</code>, a zero byte, the SHA-256 of the canonical slot record, and the nonce.</li>
            <li>The chain is bound at allocation and pinned to <code>bitgraph:main</code>, the anchored sequence. A slot that is never consumed expires after 120 seconds.</li>
            <li>The route sits behind the anchor-first gate and a rotation guard: until the current epoch has an anchor, in the window before the daily restart, and when the enclave cannot be reached, it answers <code>503 tee-restarting</code>. Retry. The epoch that issued the slot must be the epoch the gate approved; a slot from a rotation inside that check is refused the same way and expires on its own.</li>
            <li><code>429</code> with <code>Retry-After</code> when the per-address allocation budget is spent. <code>404 fuse-disabled</code> on a deployment that has not enabled the route. <code>502</code> if the enclave host&rsquo;s answer is not a slot record.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/fuse/commit"
          id="post-api-fuse-commit"
          summary="Commit the fused file's digest under the slot from /api/fuse/allocate. Exactly one digest. The signed attribution is the fused marker. The proof comes back whole, and the route refuses to return a proof minted under any other slot."
        >
          <Block
            label="Request"
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",   // must equal slot.nonceB64
  "slot": { ... },                   // the slot record from /api/fuse/allocate, verbatim
  "digests": [{
    "digestB64": "<SHA-256 of the fused bytes>",
    "hashAlg": "sha256"
  }],
  "chainId": "bitgraph:main",
  "attribution": {
    "name": "bitgraph-fuse/1",       // fixed value; marks a fused proof
    "title": "trailer/1",            // placement id: trailer/1 | container/1 | container/2 | produced/1 | set/1 | set/2, or the encoding id base64url
    "message": "<origin digest, standard base64>"   // optional; the original the new file was built from
  },
  "metadata": {                      // sets only: the manifest (set/1) or Merkle root document (set/2)
    "bitgraph-fuse/1": { ... }
  }
}`}
          />
          <Block
            label="Response 200"
            code={`{
  "proof": {
    "version": "bitgraph/1",
    "artifact": { "hashAlg": "sha256", "digestB64": "<SHA-256 of the fused bytes>" },
    "commit": { "nonceB64": "...", "counter": "278", "slotCounter": "277", "slotHashB64": "...", "epochId": "...",
                "slotAnchor": { "counter": "270", "blockNumber": 25949300, "blockHash": "0x..." } },
    "attribution": { "name": "bitgraph-fuse/1", "title": "trailer/1", "message": "..." },
    "slotAllocation": { ... },       // the held slot
    ...
  }
}`}
          />
          <ul>
            <li>An ordinary <code>bitgraph/1</code> proof: <code>slotAllocation</code> is the held slot, <code>commit.slotCounter</code> its counter, <code>commit.counter</code> the commit position. Keep the response: the proof returned here is the record. The service also writes it to the ledger and indexes it by digest, so a response lost in transit can be read back by the fused file&rsquo;s digest and matched on <code>commit.slotHashB64</code>; but store what comes back.</li>
            <li>Validation, all <code>400</code>: the body must be a JSON object; <code>slot</code> must be the record the allocate route returned; <code>slotId</code> must equal <code>slot.nonceB64</code>; <code>digests</code> carries exactly one entry with <code>hashAlg: "sha256"</code>; <code>attribution.name</code> must be <code>bitgraph-fuse/1</code>; <code>title</code> is printable ASCII, 1 to 64 characters; <code>message</code>, when present, is printable ASCII up to 128 characters.</li>
            <li>Sets: with title <code>set/1</code> or <code>set/2</code>, <code>metadata["bitgraph-fuse/1"]</code> carries the manifest or the Merkle root document, and it is verified before the slot is spent: exact shape, size cap, strict canonical round trip, the named slot&rsquo;s commitment, and the hash to the committed digest. <code>metadata</code> on any other title is refused. The returned proof carries the verified manifest whether or not the enclave echoed it; a different manifest from the enclave is refused with <code>502 manifest-mismatch</code>.</li>
            <li>An anchor must precede the slot in its epoch, or the fused floor is undefined: <code>409 no-anchor-before-slot</code>. That condition cannot heal for a given slot, so the failure is final: allocate again.</li>
            <li><code>502 slot-mismatch</code>: the enclave returned a proof under a different slot; nothing is reported as success. <code>503 tee-restarting</code> or <code>503 ledger-unavailable</code>: retry. <code>429</code> carries <code>Retry-After</code>.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/commit"
          id="post-api-commit"
          summary="Compatibility: record one or more digests of bytes that already exist. The floor bounds the placement of the digest, not the bytes. The site forwards the body to the enclave host's /commit, waits for the current epoch's first anchor, and indexes each proof by digest."
        >
          <Block
            label="Request"
            code={`{
  "digests": [
    { "digestB64": "jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU=", "hashAlg": "sha256" }
  ],
  "chainId": "bitgraph:main",        // optional
  "attribution": {                   // optional; signed
    "name": "Jane Doe",
    "title": "Sunset at Malibu",
    "message": "Original RAW capture"
  },
  "metadata": {                      // optional; not signed, advisory
    "source": "my-app",
    "fileName": "document.pdf"
  }
}`}
          />
          <Block
            label="Response 200"
            code={`[
  { "version": "bitgraph/1", "artifact": { ... }, "commit": { ... }, "signer": { ... },
    "environment": { ... }, "slotAllocation": { ... }, "attribution": { ... } }
]                                    // one complete proof per digest, in order`}
          />
          <ul>
            <li>For each digest the enclave allocates a slot and commits the digest under it in one request. The response is the enclave&rsquo;s, an array of proofs. An <code>Authorization</code> header is forwarded when present.</li>
            <li><code>503 tee-restarting</code> until the current epoch has an anchor, during the daily restart, or when the enclave host answers 502, 503 or 504. Nothing has been minted when this fires, so a retry cannot double-record. Any other enclave error is returned with its status and body. <code>500 {`{ "error": "Commit failed" }`}</code> otherwise.</li>
            <li>To make a BitGraph whose bytes carry their own floor, use the two calls above instead.</li>
          </ul>
        </Endpoint>

        <h2 id="enclave">The enclave host</h2>
        <p>
          <code>https://nitro.occproof.com</code> is the parent server on the EC2 host, bridging to the enclave over vsock. The site&rsquo;s routes call it; a self-hosted deployment exposes the same five endpoints.
        </p>

        <Endpoint
          method="POST"
          path="/commit"
          id="post-commit"
          summary="Commit one or more digests. For each digest the enclave allocates a slot (nonce and counter) and commits the digest under it, or, with slotId, commits one digest under a slot held from /allocate-slot. Returns a complete proof per digest. Requires an API key if the server is configured with keys."
        >
          <Block
            label="Request"
            code={`{
  "digests": [
    { "digestB64": "jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU=", "hashAlg": "sha256" }
  ],
  "slotId": "...",                   // optional: consume a held slot; then exactly one digest
  "chainId": "bitgraph:main",        // optional
  "attribution": { "name": "Jane Doe", "title": "Sunset at Malibu", "message": "Original RAW capture" },   // optional; signed
  "metadata": { "source": "my-app", "fileName": "document.pdf" }   // optional; not signed
}`}
          />
          <Block
            label="Response 200"
            code={`[
  {
    "version": "bitgraph/1",
    "artifact": {
      "hashAlg": "sha256",
      "digestB64": "jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU="
    },
    "commit": {
      "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
      "counter": "278",
      "slotCounter": "277",
      "slotHashB64": "...",
      "time": 1741496392841,
      "epochId": "a1b2c3d4e5f6...",
      "slotAnchor": {                    // the floor: the chain's latest anchor when the slot was allocated (enclave v8)
        "counter": "270",
        "blockNumber": 25949300,
        "blockHash": "0x..."
      }
    },
    "signer": {
      "publicKeyB64": "...",
      "signatureB64": "..."
    },
    "environment": {
      "enforcement": "measured-tee",
      "measurement": "${PCR0}",
      "attestation": {
        "format": "aws-nitro",
        "reportB64": "..."
      }
    },
    "slotAllocation": {
      "version": "bitgraph/slot/1",
      "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
      "counter": "277",
      "epochId": "a1b2c3d4e5f6...",
      "publicKeyB64": "...",
      "signatureB64": "..."
    }
  }
]`}
          />
          <Block
            label="Example: curl"
            code={`DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

curl -X POST https://nitro.occproof.com/commit \\
  -H "Content-Type: application/json" \\
  -d '{
    "digests": [{
      "digestB64": "'$DIGEST'",
      "hashAlg": "sha256"
    }]
  }'`}
          />
          <Block
            label="Example: TypeScript"
            code={`const bytes = new Uint8Array(await file.arrayBuffer());
const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
const digestB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

const resp = await fetch("https://nitro.occproof.com/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [{ digestB64, hashAlg: "sha256" }],
  }),
});

const proofs = await resp.json();
// proofs[0] is a complete BitGraphProof`}
          />
          <ul>
            <li>Consuming a held slot (<code>slotId</code>) is available only where the service enables it, and a held slot commits exactly one digest per request.</li>
            <li>On enclave v8 the anchored chain <code>bitgraph:main</code> refuses to commit until an authenticated anchor has landed in the epoch, and every slot on it carries the latest anchor as its floor.</li>
            <li>A proof committed here directly is not indexed by the site. To have it indexed, commit through <code>/api/commit</code>.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/allocate-slot"
          id="post-allocate-slot"
          summary="Allocate a slot before committing. The slot reserves a nonce and a counter position; the enclave signs the record before it receives any digest. Same key policy as /commit; metered per address in slots."
        >
          <Block label="Request (optional)" code={`{ "chainId": "bitgraph:main" }`} />
          <Block
            label="Response 200"
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
  "slot": {
    "version": "bitgraph/slot/1",
    "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
    "counter": "277",
    "epochId": "a1b2c3d4e5f6...",
    "publicKeyB64": "...",
    "chainId": "bitgraph:main",
    "signatureB64": "..."
  },
  "chainId": "bitgraph:main"
}`}
          />
          <ul>
            <li><code>POST /commit</code> without <code>slotId</code> allocates internally; this route is for producers that build a fused file. A slot record carries no clock.</li>
            <li>The <code>slotId</code> is the slot&rsquo;s nonce: a bearer ticket until it is consumed, so do not disclose it before the commit. A bare allocation holds one of the enclave&rsquo;s pending-slot entries for up to 120 seconds, then expires.</li>
            <li>The chain is bound at allocation and defaults to the anchored chain. <code>429</code> with <code>Retry-After</code> when the per-address allocation budget is spent.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/key"
          id="get-key"
          summary="The enclave's current Ed25519 public key, its measurement (PCR0), its epoch and its enforcement tier. Use it to pin allowedMeasurements and allowedPublicKeys in a verification policy."
        >
          <Block
            label="Response 200"
            code={`{
  "publicKeyB64": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
  "measurement": "${PCR0}",   // the current PCR0; PINS.md in the repo holds it
  "epochId": "...",
  "enforcement": "measured-tee"
}`}
          />
          <ul>
            <li>The key and the epoch change at every restart, once a day in production. The measurement changes only with a new enclave build.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/verify"
          id="post-verify"
          summary="Server-side verification of a proof against an optional policy, on the enclave host. Verification can be done entirely on your own machine with @mikeargento/bitgraph-verify; no call is required."
        >
          <Block
            label="Request"
            code={`{
  "proof": { ... },                  // complete BitGraphProof
  "policy": {                        // optional VerificationPolicy
    "requireEnforcement": "measured-tee",
    "allowedMeasurements": ["${PCR0}"],
    "requireAttestation": true,
    "minCounter": "100"
  }
}`}
          />
          <Block
            label="Response 200"
            code={`// Success
{ "valid": true }

// Failure
{ "valid": false, "reason": "measurement not in allowed set" }`}
          />
        </Endpoint>

        <Endpoint
          method="GET"
          path="/health"
          id="get-health"
          summary="Health check. 200 when the parent server is running and can reach the enclave."
        >
          <Block label="Response 200" code={`{ "ok": true }`} />
        </Endpoint>

        <h2 id="ledger">Reading the ledger on bitgraph.ing</h2>
        <p>
          The service keeps a copy of each proof it makes and indexes it by digest, and it keeps every anchor by counter. These routes read that copy. Two rules hold on all of them: a read that fails is a <code>503</code>, never an empty answer, because &ldquo;we could not look&rdquo; and &ldquo;nothing is there&rdquo; are opposite claims; and a lookup that finds nothing is not evidence that bytes were never recorded. Proofs made between 8 and 16 September 2026, when the per-proof writes were off, were backfilled afterwards; the holder&rsquo;s copy is the record in every case.
        </p>

        <Endpoint
          method="GET"
          path="/api/proofs/digest/{digest}"
          id="get-api-proofs-digest"
          summary="Every position the ledger holds for a digest, by position, never ranked, with the two anchors that bracket the selected one. The path digest is URL-safe base64 without padding."
        >
          <Block
            label="Query"
            code={`GET /api/proofs/digest/<digest>                          # the lead proof is the earliest recording
GET /api/proofs/digest/<digest>?counter=301&epoch=<url-safe>   # select which position the lead proof describes`}
          />
          <Block
            label="Response 200"
            code={`{
  "proofs": [{ "proof": { ... } }],   // the selected position; [] when the digest is not indexed
  "lookupKind": "recorded",           // "recorded" | "origin-only" (only fused files naming these bytes as their original exist)
  "positions": [
    {
      "counter": "278",
      "epoch": "<url-safe>",
      "lowerTime": "2026-03-07T12:00:00.000Z",   // the floor: the block time of the anchor before this position, or null
      "upperTime": "2026-03-07T12:00:12.000Z",   // the block time of the next anchor, or null; a place in the order, not an upper bound on the bytes
      "kind": "recorded",             // "recorded" | "fused"
      "artifactDigest": "<url-safe>"
    },
    {
      "counter": "301",
      "epoch": "<url-safe>",
      "lowerTime": "...",
      "upperTime": "...",
      "kind": "fused",
      "artifactDigest": "<url-safe>", // the fused file's own digest
      "placement": "trailer/1",
      "fusedOrigin": "<url-safe>",    // the original's digest, from the signed marker
      "member": { "index": 0, "count": 3, "role": "origin" },   // set members only: this file's row
      "setCount": 3                   // set entries only: how many members the set lists
    }
  ],
  "causalWindow": { "anchorBefore": { ... }, "anchorAfter": { ... } },   // AnchorView each, or null; null when neither exists
  "anchorBlock": null                 // for an anchor proof: its own block, as an AnchorView
}`}
          />
          <ul>
            <li>The lead proof is the earliest recording of these bytes. A fused file naming the bytes as its original never stands in for it: when only such descendants exist, <code>lookupKind</code> is <code>origin-only</code> and the bytes themselves are not on record.</li>
            <li>When the digest is a fused file&rsquo;s own, or a set member&rsquo;s, <code>positions</code> is the history of the original it was built from, so dropping the original and dropping the new file land on the same list.</li>
            <li><code>anchorBefore</code> is the floor. <code>anchorAfter</code> is the next anchor in the order: the ceiling, a position, not a clock reading.</li>
            <li>A miss is <code>{`{ "proofs": [] }`}</code>. When the service is running with indexing off (<code>LEDGER_WRITES=off</code>) the miss also carries <code>"discovery": "retired"</code> and a note; in either form it is not a finding about the bytes.</li>
            <li><code>503 {`{ "error": "ledger unavailable" }`}</code>: the ledger could not be read. Not an answer.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="POST"
          path="/api/proofs/batch"
          id="post-api-proofs-batch"
          summary="The same lookup for up to 2,000 digests in one round trip, keyed by the URL-safe digest exactly as sent."
        >
          <Block
            label="Request"
            code={`{
  "digests": ["<digest-a>", "<digest-b>", "<digest-c>"],   // 1 to 2,000 URL-safe digests
  "environments": "table",           // optional: send each distinct environment once, in a side table
  "members": "full"                  // optional: read every position so each set member entry carries its own evidence
}`}
          />
          <Block
            label="Response 200"
            code={`{
  "results": {
    "<digest-a>": {
      "proofs": [
        { "proof": { ... }, "writeTime": 1741496392841, "kind": "recorded" },
        { "proof": { ... }, "writeTime": 1741496410207, "kind": "fused",
          "member": { "index": 0, "count": 3, "role": "origin" }, "setDigest": "<url-safe>" }
      ]
    },
    "<digest-b>": { "proofs": [] },                        // not indexed here; not evidence the bytes were never recorded
    "<digest-c>": { "proofs": [], "unavailable": true },   // the read failed; not an answer
    "<digest-d>": { "proofs": [ ... ], "partial": true }   // answered from a set's member list: positions it holds, not necessarily all of them
  },
  "sets": { "<setDigest>": { ... } },        // each set a member entry names, once, with its manifest
  "environments": { "<id>": { ... } }        // only with environments: "table"
}`}
          />
          <ul>
            <li><code>400 Bad request</code> when the list is empty, longer than 2,000, or any entry is empty or longer than 100 characters.</li>
            <li>A set is one position. A few digests are looked up first; one that lands on a set member names its set, and that set&rsquo;s member list answers the other members without a read each. Those entries say <code>partial</code>: a reader must not present a count from them. A digest no list places is looked up in full.</li>
            <li>A set member&rsquo;s entry carries the set&rsquo;s proof without its manifest; the manifest travels once, under <code>sets</code>. With <code>members: "full"</code> every position is read and each member entry carries its own row, index and Merkle path, which an export needs and a check does not.</li>
            <li>With <code>environments: "table"</code>, each proof&rsquo;s <code>environment</code> is replaced by a reference into the table. A proof without its <code>environment</code> does not verify, so the caller must put it back before reading a proof. Callers that do not ask get the proofs whole.</li>
            <li>With indexing off, the answer carries <code>"discovery": "retired"</code> once, at the top level.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/proofs/anchors"
          id="get-api-proofs-anchors"
          summary="The anchors that bracket a position, by counter and epoch, and when one is missing, why. An empty list is never a verdict on its own; the bound state says what the emptiness means."
        >
          <Block
            label="Query"
            code={`GET /api/proofs/anchors?counter=278&epoch=<url-safe>            # up to two anchors after the position (the ceiling side)
GET /api/proofs/anchors?counter=278&epoch=<url-safe>&before=1   # the one anchor before it (the floor)`}
          />
          <Block
            label="Response 200"
            code={`{
  "anchors": [
    { ...the anchor proof as stored, "proofHash": "...", "ethereum": { "blockNumber": 25949300, "blockHash": "0x..." } }
  ],
  "bound": { "state": "anchored", "note": "An Ethereum anchor bounds this position on this side." }
}`}
          />
          <div className="table-scroll">
            <table className="table-k">
              <thead><tr><th>bound.state</th><th>Meaning</th></tr></thead>
              <tbody>
                <tr><td>anchored</td><td>Here it is.</td></tr>
                <tr><td>pending</td><td>The live epoch has anchors, but none past this counter yet. Temporary: ask again later and it resolves.</td></tr>
                <tr><td>closed</td><td>A past epoch, with anchors, none of them past this counter. Permanent: no ceiling exists in this epoch and none ever will.</td></tr>
                <tr><td>none</td><td>Before side only: no anchor precedes this position in its epoch; it sits at or before the epoch&rsquo;s first anchor. Permanent: a floor cannot arrive later.</td></tr>
                <tr><td>unknown-epoch</td><td>The ledger holds no anchors for that epoch, so nothing can be said about this side.</td></tr>
                <tr><td>undetermined</td><td>No anchor bounds this side, and the enclave could not be reached to say whether the epoch is still open. Ask again rather than reading it as final.</td></tr>
              </tbody>
            </table>
          </div>
          <ul>
            <li><code>400</code> when <code>counter</code> or <code>epoch</code> is missing, or the counter is not a non-negative integer.</li>
            <li><code>503 ledger-unavailable</code> when the read failed, including a floor search that ran out before reaching the epoch&rsquo;s start.</li>
            <li>Each anchor entry is the anchor&rsquo;s own proof with two fields added by the ledger: <code>proofHash</code> and <code>ethereum</code>. Its block time, when present, is in <code>metadata.anchor.blockTimeISO</code>.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/proofs/window"
          id="get-api-proofs-window"
          summary="The two anchors that bracket a position, as AnchorViews, from the counter and epoch a proof carries in its signed body. Nothing about the file is looked up or revealed."
        >
          <Block label="Query" code={`GET /api/proofs/window?counter=278&epoch=<url-safe>`} />
          <Block
            label="Response 200"
            code={`{
  "causalWindow": {
    "anchorBefore": { "counter": "270", "attrName": "Ethereum Anchor", "blockNumber": 25949300, "blockHash": "0x...",
                      "etherscanUrl": "https://etherscan.io/block/25949300", "blockTime": "2026-03-07T12:00:00.000Z", "digestB64": "..." },
    "anchorAfter": null              // no anchor follows this position in the index yet
  }
}`}
          />
          <ul>
            <li>A settled window (both sides present) is cached for an hour; an unsettled one for five seconds.</li>
            <li><code>anchorAfter: null</code> means no anchor follows the position in the index. For a position made seconds ago that is the truth; for an old one it would be a gap. <code>/api/proofs/anchors</code> carries the <code>bound</code> state that tells them apart.</li>
            <li><code>400</code> on missing or malformed parameters; <code>503 ledger-unavailable</code> when the read failed.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/proofs/witness"
          id="get-api-proofs-witness"
          summary="The offline block-header witness for an anchor's Ethereum block: the RLP-encoded header whose keccak256 equals the signed block hash. A verifier reads the block's time from it without an Ethereum node."
        >
          <Block label="Query" code={`GET /api/proofs/witness?block=25949300&hash=0x<64 hex>`} />
          <Block
            label="Response 200"
            code={`{
  "version": "bitgraph-anchor-witness/1",
  "headerRlpHex": "0x...",           // keccak256 of these bytes equals blockHash
  "blockNumber": 25949300,
  "blockHash": "0x..."
}`}
          />
          <ul>
            <li>The header comes from the anchor&rsquo;s own stored metadata when the anchor carries one (anchors written from 8 September 2026 do), re-checked against the block hash before it is served; otherwise from an Ethereum RPC. Either way it is returned only when the check passes.</li>
            <li><code>400</code> when <code>block</code> is not an integer or <code>hash</code> is not <code>0x</code> plus 64 hex characters. <code>404 {`{ "error": "witness unavailable" }`}</code> when no header can be found or re-encoded to match.</li>
          </ul>
        </Endpoint>

        <Endpoint
          method="GET"
          path="/api/ledger/head"
          id="get-api-ledger-head"
          summary="The ledger's heartbeat: the current epoch and its highest counter. Cheap enough to poll."
        >
          <Block label="Response 200" code={`{ "epoch": "<url-safe>", "head": 4210 }`} />
          <ul>
            <li>Cached for two seconds. <code>503 {`{ "error": "rotating" }`}</code> when the enclave&rsquo;s epoch cannot be learned and none has been seen yet; during the rotation window the last epoch seen is answered, and an unchanged head means nothing new.</li>
          </ul>
        </Endpoint>

        <h2 id="verify">Verifying</h2>

        <Endpoint
          method="POST"
          path="/api/verify"
          id="post-api-verify"
          summary="Server-side verification for callers that cannot run a verifier. It delegates to @mikeargento/bitgraph-verify, so this endpoint and the offline verifier cannot disagree, and it returns the proof whole so the caller can redo the check. Read-only."
        >
          <Block
            label="Request"
            code={`{
  "proof": { ... },                       // optional: a bitgraph/1 proof
  "digest": "<hex, or base64 in either form>",   // optional: the file's SHA-256; with proof, compared against artifact.digestB64
  "allowedMeasurements": ["${PCR0}"],   // optional: accepted PCR0 values
  "requireSlot": true,                    // default true
  "requireEpochId": true                  // default true
}                                         // proof, digest, or both; without proof, the ledger's proof for the digest is checked`}
          />
          <Block
            label="Response 200"
            code={`{
  "verified": true,
  "status": "valid",                  // "valid" | "valid, artifact not checked" | "mismatch" | "invalid" | "not on record"
  "reason": null,
  "artifactBinding": "checked",       // "checked" | "not-checked" | "mismatch"
  "checkedAgainst": "supplied proof", // "supplied proof" | "ledger"
  "onRecord": true,                   // the ledger holds a recording of these bytes
  "totalPositions": 1,
  "artifactHash": "<base64>",
  "artifactHashUrlSafe": "<url-safe>",
  "counter": "278",
  "slotCounter": "277",
  "epochId": "...",
  "chainId": "bitgraph:main",
  "proofUrl": "https://bitgraph.ing/proof/<url-safe>?counter=278&epoch=<url-safe>",
  "anchorWindow": "/api/proofs/digest/<url-safe>",
  "trustAnchors": { "requireSlot": true, "requireEpochId": true, "allowedMeasurements": [ ... ] },
  "verifiedBy": "server",
  "note": "Verified server-side with @mikeargento/bitgraph-verify. Re-run it yourself on the returned proof for an independent result; ...",
  "proof": { ... }
}`}
          />
          <Block
            label="Response 200: digest only, nothing recorded"
            code={`{
  "verified": false,
  "status": "not on record",
  "reason": "These bytes have never been recorded in the BitGraph ledger, so there is no proof to verify.",
  "fusedDescendants": 0,              // fused files naming these bytes as their original; they bound the bytes from above only
  "artifactBinding": "not-checked",
  "checkedAgainst": "ledger",
  "onRecord": false,
  "totalPositions": 0,
  "artifactHash": "<base64>",
  "artifactHashUrlSafe": "<url-safe>",
  "proofUrl": null,
  "proof": null
}`}
          />
          <ul>
            <li>Read <code>artifactBinding</code>, not only <code>verified</code>. <code>checked</code>: the digest you sent matches the one inside the proof. <code>not-checked</code>: the proof is sound but nothing tied it to a file. <code>mismatch</code>: the proof is genuine and is for different bytes; <code>verified</code> is then false.</li>
            <li>With <code>proof</code> supplied, <code>checkedAgainst</code> is <code>supplied proof</code> and the verdict is about the object itself; <code>onRecord</code> says separately whether the ledger holds those bytes. With only a <code>digest</code>, the earliest recording of the bytes is verified; a fused descendant never stands in for a recording.</li>
            <li>Time is deliberately absent from the response. A proof carries no clock reading; its bounds are the two anchors, at <code>anchorWindow</code>.</li>
            <li><code>400</code>: neither proof nor digest, a malformed digest, or a malformed policy. <code>503 {`{ "error": "ledger unavailable" }`}</code>: the ledger could not be read, which is not a verdict about the file; retry. This applies even when a proof was supplied, because the record check is part of the answer.</li>
          </ul>
        </Endpoint>

        <h2 id="types">Types</h2>

        <h3>BitGraphProof</h3>
        <Block
          label="TypeScript"
          code={`interface BitGraphProof {
  version: "bitgraph/1";
  artifact: {
    hashAlg: "sha256";
    digestB64: string;
  };
  commit: {
    nonceB64: string;
    counter?: string;          // decimal, monotonic
    slotCounter?: string;      // slot's counter (< commit counter)
    slotHashB64?: string;      // SHA-256 of canonical slot body
    time?: number;             // Unix ms; advisory
    prevB64?: string;          // chain link
    epochId?: string;          // hex SHA-256
    slotAnchor?: {             // the floor: the chain's latest anchor at allocation, signed into the proof (enclave v8)
      counter: string;
      blockNumber: number;
      blockHash: string;
    };
    anchor?: {                 // on Ethereum anchor proofs only: the block this proof anchors
      blockNumber: number;
      blockHash: string;
    };
  };
  signer: {
    publicKeyB64: string;      // Ed25519, 32 bytes
    signatureB64: string;      // Ed25519, 64 bytes
  };
  environment: {
    enforcement: "stub" | "hw-key" | "measured-tee";
    measurement: string;
    attestation?: {
      format: string;          // e.g. "aws-nitro"
      reportB64: string;
    };
  };
  slotAllocation?: SlotRecord;       // the slot record, made before any digest was received
  agency?: unknown;                  // legacy; present on some older proofs
  attribution?: {                    // signed; creator metadata, or the fused marker:
                                     //   name "bitgraph-fuse/1", title placement id, message origin digest
    name?: string;
    title?: string;
    message?: string;
  };
  timestamps?: {
    artifact?: TsaToken;
    proof?: TsaToken;
  };
  metadata?: Record<string, unknown>;   // not signed
  claims?: Record<string, unknown>;     // not signed
}`}
        />

        <h3>SlotRecord</h3>
        <Block
          label="TypeScript"
          code={`interface SlotRecord {             // what /api/fuse/allocate and /allocate-slot return as "slot"
  version: "bitgraph/slot/1";
  nonceB64: string;                // 32 random bytes from the enclave; also the slotId
  counter: string;                 // the slot's position, decimal
  time?: number;                   // advisory
  epochId: string;
  publicKeyB64: string;            // the enclave key that will sign the commit
  chainId?: string;                // "bitgraph:main" on the anchored sequence
  signatureB64: string;            // Ed25519 over the canonical slot body
}`}
        />

        <h3>VerificationPolicy</h3>
        <Block
          label="TypeScript"
          code={`interface VerificationPolicy {
  requireEnforcement?: "stub" | "hw-key" | "measured-tee";
  allowedMeasurements?: string[];
  allowedPublicKeys?: string[];
  requireAttestation?: boolean;
  requireAttestationFormat?: string[];
  minCounter?: string;
  maxCounter?: string;
  minTime?: number;
  maxTime?: number;
  requireEpochId?: boolean;
  requireSlot?: boolean;
  requireActor?: boolean;            // legacy
}`}
        />

        <h3>TsaToken</h3>
        <Block
          label="TypeScript"
          code={`interface TsaToken {
  authority: string;
  time: string;               // ISO 8601
  digestAlg: string;
  digestB64: string;
  tokenB64: string;           // DER-encoded RFC 3161
}`}
        />

        <h3>AnchorView</h3>
        <Block
          label="TypeScript"
          code={`interface AnchorView {             // one anchor, as the window and digest routes present it
  counter: string;                 // the anchor's position
  attrName: string;                // "Ethereum Anchor"
  blockNumber: number | null;
  blockHash: string | null;
  etherscanUrl: string | null;
  blockTime: string | null;        // ISO 8601, from the block header
  digestB64: string | null;        // the anchor's artifact: SHA-256 of the block hash string
}`}
        />

        <h3>AnchorWitness</h3>
        <Block
          label="TypeScript"
          code={`interface AnchorWitness {
  version: "bitgraph-anchor-witness/1";
  headerRlpHex: string;            // the RLP-encoded block header; keccak256 of it equals blockHash
  blockNumber: number;
  blockHash: string;
}`}
        />

        <h2 id="errors">Errors</h2>
        <p>Every error body is JSON with an <code>error</code> string. Where a <code>code</code> is present, it is stable and meant for programs.</p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Status</th><th>Cause</th><th>Body</th></tr></thead>
            <tbody>
              <tr><td className="k">400</td><td>Invalid request body or query parameters</td><td><code>{`{ "error": "..." }`}</code></td></tr>
              <tr><td className="k">401</td><td>Missing or invalid API key, on a host configured with keys</td><td><code>{`{ "error": "unauthorized" }`}</code></td></tr>
              <tr><td className="k">404</td><td>Fuse routes on a deployment that has not enabled them</td><td><code>{`{ "error": "...", "code": "fuse-disabled" }`}</code></td></tr>
              <tr><td className="k">404</td><td>No block header witness could be found or re-encoded to match</td><td><code>{`{ "error": "witness unavailable" }`}</code></td></tr>
              <tr><td className="k">409</td><td>No anchor precedes the slot in its epoch (fuse commit); allocate again</td><td><code>{`{ "error": "...", "code": "no-anchor-before-slot" }`}</code></td></tr>
              <tr><td className="k">413</td><td>Payload too large</td><td><code>{`{ "error": "Request body too large. Max 1 MB." }`}</code></td></tr>
              <tr><td className="k">429</td><td>Per-address allocation budget spent; <code>Retry-After</code> header set</td><td><code>{`{ "error": "..." }`}</code></td></tr>
              <tr><td className="k">500</td><td>Enclave or internal error</td><td><code>{`{ "error": "..." }`}</code></td></tr>
              <tr><td className="k">502</td><td>The enclave committed under a different slot (fuse commit)</td><td><code>{`{ "error": "...", "code": "slot-mismatch" }`}</code></td></tr>
              <tr><td className="k">502</td><td>The enclave returned a different set manifest (fuse commit)</td><td><code>{`{ "error": "...", "code": "manifest-mismatch" }`}</code></td></tr>
              <tr><td className="k">502</td><td>The enclave host&rsquo;s allocation answer is not a slot record (fuse allocate)</td><td><code>{`{ "error": "Unexpected allocation response from the boundary" }`}</code></td></tr>
              <tr><td className="k">503</td><td>Enclave restarting, not yet anchored, or unreachable; retry</td><td><code>{`{ "error": "...", "code": "tee-restarting" }`}</code></td></tr>
              <tr><td className="k">503</td><td>The ledger could not be read; not an answer about the bytes; retry</td><td><code>{`{ "error": "...", "code": "ledger-unavailable" }`}</code> or <code>{`{ "error": "ledger unavailable" }`}</code></td></tr>
              <tr><td className="k">503</td><td>The ledger head cannot name the current epoch yet</td><td><code>{`{ "error": "rotating" }`}</code></td></tr>
            </tbody>
          </table>
        </div>

        <h2 id="next">Where next</h2>
        <ul className="doors">
          <li><Link href="/docs/integration">Integration guide</Link><span>The same calls in the order a first integration uses them.</span></li>
          <li><Link href="/docs/proof-format">Proof format</Link><span>Every field of the proof, what is signed, and the fused placements.</span></li>
          <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
          <li><Link href="/docs/trust-model">Trust model</Link><span>What is assumed, what is enforced, what is detected, and what is not.</span></li>
        </ul>
      </article>
    <DocsPageNav current="/api-reference" />
    </div>
  );
}
