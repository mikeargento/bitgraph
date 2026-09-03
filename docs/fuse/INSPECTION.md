# BitGraph Fuse: section 5 inspection note

Date: 2026-09-03. Deliverable 1 of the revision 5 implementation prompt.
Repository: `occ` at HEAD `442e2428` (main, equals origin/main as last fetched).
Work branch: `bitgraph-fuse`, checked out in the worktree `../occ-fuse` from that HEAD. Every line number below is a HEAD line number, which is also the branch's line number. The main working tree carries an uncommitted, undeployed removal of `POST /allocate-slot` (server.ts and the api-reference page); inside `handleCommit` and `persistToLedger` that diff only shifts lines by +5 and changes no text. The branch does not carry that diff.

Method: ten reader agents traced the fourteen items, six agents answered the six questions, three adversarial lenses (cold re-read, empirical run, deployment state) checked each answer, and I re-read the load-bearing code myself. Where an agent's claim was refuted, the corrected statement is what appears here. Nothing in any repository was modified during the inspection. No production host, S3 bucket, or ledger was contacted; the empirical checks ran the unmodified enclave `app.ts` as a local process with a software NSM (see "Test harness" below).

Scope change during the inspection: Mike shelved BitGraph Gate ("that product is still on the shelf"). Deliverable 8 (spec 14.2, tests 15.10) is out of scope. The producer surfaces are the SDK `fuse(builder, options)` and the internal harness.

## 0. Verdict on the blocker rule

Not triggered. Client-slot reuse is a parent-only change.

- The enclave's `commitDigest` action takes `slotId` from the vsock message and refuses without it: `server/commit-service/src/enclave/app.ts:884-885`.
- The lookup is a bare map read on a module-global map keyed by the base64 nonce, with no binding to connection, caller, or process: `app.ts:238` (`const pendingSlots = new Map<string, SlotEntry>(); // nonceB64 → SlotEntry`), `app.ts:492-494` (`pendingSlots.get(req.slotId)` then "Slot not found or expired").
- The parent already sends allocate and commit as two separate TCP connections, one message each (`server/commit-service/src/parent/vsock-client.ts:107-130`), so a slot allocated by one HTTP request and consumed by a later one is indistinguishable to the enclave from what the parent does today.
- What blocks it today is entirely in the parent: the `/commit` body type has no slot field (`server.ts:241-249`) and the loop allocates unconditionally for every digest (`server.ts:315`).

Empirical confirmation (unmodified `app.ts` run locally, real parent `VsockClient`): a slot allocated on connection A, with another client allocating and committing in between, was consumed on a third connection; the proof's `slotAllocation.nonceB64` and `commit.nonceB64` equal the allocated slotId; counters were slot 1, other slot 2, other commit 3, our commit 4. Reuse of the consumed slot, a forged nonce, a slot after 125 s, and a slot from before an enclave restart were all refused. A commit with a 5-byte digest was refused and the slot was gone on retry, so a rejected commit burns its slot (delete at `app.ts:499` precedes validation at `app.ts:503-508`).

Six enclave facts Fuse designs around rather than changes:

1. Allocate, write, finish, hash, commit must complete inside `SLOT_TTL_MS = 120_000` (`app.ts:229`); an enclave restart (23:59 UTC rotation) voids every pending slot.
2. `slotId` is the raw nonce (`app.ts:302`) and the lookup is a bearer check, so the file must carry the derived commitment, never the raw nonce.
3. `chainId` is bound at allocation from the stored entry (`app.ts:497`), not at commit. A Fuse allocation must send `chainId: "bitgraph:main"`; HEAD's public route sends none and lands slots on the unanchored `global` chain (`server.ts:432`, `app.ts:152`).
4. The slot is deleted before digest and agency validation, so a refused commit leaves N with no M. The fused span [N, M] must tolerate N-only gaps, which the audit's G2 rule already treats as healthy.
5. `MAX_PENDING_SLOTS = 1000` (`app.ts:230`) caps one map shared by every chain, anchors included. Held Fuse slots compete with anchors, which is why allocation is metered at the parent.
6. The `commitDigest` dispatcher never extracts `metadata` (`app.ts:882-891`), so no Fuse marker can ride in metadata. The only caller-supplied signed free-form field is `attribution`.

## Items 1 to 14

### 1. Slot allocation

| path | symbol | lines | role |
|---|---|---|---|
| server/commit-service/src/enclave/app.ts | SLOT_TTL_MS, MAX_PENDING_SLOTS | 229-230 | TTL 120 s, pool cap 1000; enclave constants, PCR0-bound |
| app.ts | SlotEntry, pendingSlots | 232-238 | one map for all chains, key is nonceB64 |
| app.ts | cleanExpiredSlots | 240-247 | expiry sweep; the only wall-clock use, never signed |
| app.ts | handleAllocateSlot | 263-303 | sweep, cap check (266), per-chain counter bump (270-272), NSM nonce (274-276), slot body (278-287), sign (289-296), store and return (298-302) |
| packages/adapter-nitro/src/nitro-host.ts | NitroHost.getFreshNonce | 303-319 | NSM GetRandom, first 32 of 256 bytes |
| app.ts | handleCommit (consumption) | 491-499 | delete before validation; single use |
| app.ts | handleCommit (commit counter, fields, embed) | 556-558, 577-584, 684 | M > N; nonce, slotCounter, slotHashB64 into the signed body; full record embedded as `slotAllocation` |
| app.ts | dispatcher | 867-870, 882-892, 893-916 | `allocateSlot`, `commitDigest`, legacy `commit`; every commit path requires slotId |
| app.ts | setInterval | 983-986 | 30 s sweep |
| server/commit-service/src/parent/vsock-client.ts | AllocateSlotRequest, CommitDigestRequest | 31-35, 19-28 | wire shapes; `type` is mapped to `action` at 121-122 |
| vsock-client.ts | send, #doSend | 107-130 | one fresh TCP connection per message, serialized per message |
| server/commit-service/src/parent/server.ts | handleAllocateSlot | 427-441 | HEAD public route: body unread, no auth, no limiter, no chainId |
| server.ts | dispatcher, banner | 464-465, 486 | route registration |

HTTP shape at HEAD: `POST /allocate-slot` with any body returns 200 `{slotId, slot:{version:"bitgraph/slot/1", nonceB64, counter, epochId, publicKeyB64, signatureB64}, chainId:"global"}`; the pool cap surfaces as 500 `{"error":"Enclave error: Too many pending slots — try again later"}`; transport failure as 500 "Failed to allocate slot". The record has no `time` and no `chainId` member for the default chain. The HEAD api-reference page documents a `time` field the enclave never emits.

Caveats: the removal comment in the main working tree says the route's effect was "counter gaps"; at HEAD those gaps land on the `global` chain, not on `bitgraph:main`. The pool-filling effect is real for every chain.

### 2. Canonical slot-record serialization and hashing

One canonical form, one implementation: `packages/verify/src/canonical.ts:44-55` (`canonicalize`, recursive key sort then compact `JSON.stringify` then UTF-8; `sortedReplacer` at 68-108). The enclave imports it through the root `bitgraph` package (`app.ts:79`, `src/index.ts:32`).

| path | symbol | lines | role |
|---|---|---|---|
| app.ts | slot body and signature | 278-291 | signed bytes = canonicalize({version, nonceB64, counter, epochId, publicKeyB64, chainId?}) |
| app.ts | slotHashB64 subset | 563-574 | same field subset, excludes signatureB64; line 566 is `const slotBody = {` (the line the Imran package pins) |
| packages/verify/src/verifier.ts | verifySlotAllocation reconstruction | 894-906 | the verifier's rebuild; tolerates an optional `time` the enclave never emits |
| verifier.ts | signature, hash binding | 926, 951-960 | same bytes for both checks |
| verifier.ts | forbidden-key scan | 938-944 | runs over the reconstructed subset, so extra members in an embedded record are ignored, not rejected |
| imran/verifier/verify.mjs | slot_consumption, verifySlotSignature | 196-207, 75-87 | explicit subset (correct) and whole-record-minus-signature (equal for enclave records) |
| packages/ledger/src/verify.ts | verifyCausalPlacement | 99-108 | divergent (omits chainId); dead code, no importer |
| website/src/lib/bitgraph.ts | verifyProofSignature | 259-266 | browser verifier passes the slot on presence alone |

For production records the exact string is `{"chainId":"bitgraph:main","counter":"N","epochId":"...","nonceB64":"...","publicKeyB64":"...","version":"bitgraph/slot/1"}`. Fuse's `slotRecordHash` is SHA-256 of exactly these bytes, computed by the verify package's existing function. No second serialization is introduced.

### 3. Host-side commit orchestration

| path | symbol | lines | role |
|---|---|---|---|
| server.ts | handleCommit | 219-224 | REQUIRE_API_KEY gate (open by default) |
| server.ts | handleCommit | 226-239 | Content-Type, 1 MB cap (after full buffering) |
| server.ts | body type | 241-249 | digests, metadata, prevProofId (never read), agency, attribution, policy, chainId; no slot field |
| server.ts | digest shape | 258-268 | string plus hashAlg only; 32-byte length is checked by the enclave |
| server.ts | limiter | 270-287 | digest-denominated; API key exempts |
| server.ts | per-digest loop | 308-357 | allocate (315), agency offset (325-338), commitDigest (340-348), mid-batch failure returns 500 and orphans earlier proofs (350-352) |
| server.ts | response | 363-374 | proofHash appended by the parent; `persistToLedger` fire-and-forget; bare array |
| server.ts | persistToLedger | 53-103 | proofs/ key with COMPLIANCE lock; legacy by-digest key only |
| server.ts | INDEX_URL, indexProofs | 38, 105-116 | defined, never called; no POST /api/proofs exists |
| server/commit-service/src/parent/verify-helper.ts | verifySignatureOnly | 13-16 | POST /verify only; rebuilds the signed body without attribution, so it fails every attributed proof (incidental) |
| packages/hosted/src/bitcoin-anchor.ts | commitAnchor, persistAnchor | 585-614, 62-135 | the anchor service is an ordinary TEE-direct `/commit` client on `bitgraph:main` with signed attribution; it bypasses the proxy and the gate by design |
| website/src/app/api/commit/route.ts | POST | 95-104 | anchor-first gate, then verbatim forward |

### 4. The path that mints a fresh slot during commit

`server.ts:314-320`: `enclaveClient.send({ type: "allocateSlot", chainId: body.chainId })` for every digest, then `server.ts:340-348`: `{ type: "commitDigest", slotId, digestB64, agency, attribution, policy, metadata }`. The enclave side is `app.ts:867-870` (allocate) and `app.ts:882-885` plus `488-499` (commit, lookup by nonce). There is no combined action. Nothing promises M = N + 1; other callers' allocations sit between.

### 5. Caller-supplied allocation: ignored

A `slotId` in the `/commit` body is never read (`server.ts:241-249`, `315`). At HEAD a client can obtain a slot from `/allocate-slot` and can never consume it over HTTP; it expires and leaves a gap on the `global` chain. In the main working tree the route is a 404. The empirical run confirmed both: HEAD's parent committed under its own slot while the client's slot stayed pending, and the pending slot was then consumed directly from another process.

### 6. Construction of the signed commit message

Signed bytes = `canonicalize(signedBody)` where signedBody = `{version:"bitgraph/1", artifact, commit:{nonceB64, counter, slotCounter, slotHashB64, epochId, prevB64?, chainId?, epochLink?}, publicKeyB64, enforcement:"measured-tee", measurement, attestationFormat:"aws-nitro", actor?, attribution?, policy?}` (`app.ts:576-583`, `603-610`, `612-632`, `656-661`). Ed25519 signs the raw canonical bytes; SHA-256 of the same bytes is the Nitro attestation user_data. The verifier rebuilds the same object at `verifier.ts:250-279`; `buildSignedBody` at `packages/verify/src/proof-hash.ts:195-216` is the exported helper. Outside the signed bytes: `signer.signatureB64`, `attestation.reportB64`, `slotAllocation` (bound through `slotHashB64`), `agency.authorization`, `metadata`, `proofHash`, `timestamps`. Three hashes coexist and must not be confused: `computeProofHash` (frozen subset, ledger key, `proof-hash.ts:81-108`), the full signed-body hash, and `computeChainHash` (whole proof minus `LEDGER_ADDED_FIELDS`, `proof-hash.ts:128, 150-163`).

### 7. Attribution: construction and signature coverage

Inside the signed bytes. The enclave copies `name`, `title`, `message` into `signedBody.attribution` before signing (`app.ts:617-626`), stores the same object at `proof.attribution` (`app.ts:697-700`), and the verifier includes `proof.attribution` whole (`verifier.ts:274-277`). `computeProofHash` includes it (`proof-hash.ts:96-99`), so it is also in the ledger key identity. Who sets it: any HTTP caller; the parent forwards `body.attribution` on every commitDigest (`server.ts:340-348`), the proxy forwards the body verbatim (`route.ts:100-112`), the site UI never sets it (`website/src/lib/commit-strategy.ts:52-53`), MCP caps it at 200/200/2000 characters, Zapier and the raw API do not. The anchor service sets `name:"Ethereum Anchor"` (`bitcoin-anchor.ts:592-611`) and `name:"Interval"` (`352-356`); consumers classify anchors by that signed name (`packages/audit/src/anchors.ts:9-18, 57-59`; proof page `page.tsx:443` `isEth = name.startsWith("Ethereum")`). Empirically: any edit, removal, extra key, or injection of attribution on a production anchor fixture fails the signature; adding unsigned metadata does not; the signed-body hash appears verbatim inside the attestation report.

Constraints for Fuse: only the three keys survive (`app.ts:620-622`), values must be truthy strings, one attribution per request (so one fused file per commit), and `name` must not start with "Ethereum" or equal "Interval".

### 8. Proof JSON assembly and S3 key layout

Assembled inside the enclave (`app.ts:664-704`); `prevB64` for the next proof is SHA-256 of the canonical whole proof (`app.ts:706-708`). `proofHash` is appended by the parent (`server.ts:363-369`).

| key | writer | lines | lock |
|---|---|---|---|
| proofs/{epoch}/{counter12}-{proofHash}.json | parent persistToLedger; hosted persistAnchor (anchors, same key again) | server.ts:68-86; bitcoin-anchor.ts:85-95 | COMPLIANCE 10 y |
| by-digest/{digest}.json (legacy, latest wins) | parent; website proxy; hosted | server.ts:90-98; website/src/lib/s3.ts:247-254; bitcoin-anchor.ts:100-105, 244 | bucket default (see risks) |
| by-digest/{digest}/{epoch}-{counter12}.json (per position) | website proxy only for user proofs; hosted for anchors and intervals | s3.ts:207-215, 229-239 (backfill), 255-262; bitcoin-anchor.ts:112-117, 228-236 | bucket default |
| anchors/{epoch}/{counter}.json, anchors-by-time/ | hosted only | bitcoin-anchor.ts:120-135 | none explicit |
| anchor-claims/{block}.json | hosted only (conditional PUT mutex) | bitcoin-anchor.ts:735-741 | none |

Every by-digest key is derived from `proof.artifact.digestB64` in the stored body. `packages/ledger` is not imported by anything. The website proxy is the only writer of per-position keys for user proofs, which is one reason the Fuse commit route belongs behind the proxy.

### 9. Proof retrieval

| path | symbol | lines | role |
|---|---|---|---|
| website/src/lib/s3.ts | getProofsByDigest | 287-355 | ONE ListObjectsV2 page (MaxKeys 1000, no continuation) over the per-position prefix, GET each, merge legacy, dedupe by (epoch, counter), earliest first; throws LedgerUnavailableError |
| s3.ts | readLegacyDigest, getProofByDigest | 166-173, 152-154 | single-object legacy read |
| website/src/app/api/proofs/[digest]/route.ts | GET | 10-15 | all positions |
| api/proofs/digest/[digest]/route.ts | GET | 82-97, 128-137 | selects a position; positions payload carries counter, epoch, times, no digest, no kind |
| api/proofs/batch/route.ts | POST | 11-18, 44-47 | up to 500 digests |
| s3.ts | getProofsAroundCounter | 369-396 | the only position-keyed read; needs epoch and counter |
| s3.ts | getAnchorBeforeCounter, getAnchorsAfterCounter | 444-475, 505-522 | paginated anchor windows |
| api/search/route.ts | GET | 12-16, 37-39, 46-49 | legacy key only; bare numbers refused |
| api/verify/route.ts | POST | 105-110, 154-168 | entries[0] is "the originating proof"; digest mismatch → "mismatch" |
| app.ts | pendingSlots | 238, 492-499 | the only nonce-keyed structure anywhere; enclave memory, deleted on commit |

Not possible today: lookup by nonce, by counter alone, or by proofHash. Possible: by digest (many results), by (epoch, counter) via `/api/proofs/chain`.

### 10. Verifier entry points and verdict categories

bitgraph-verify 1.3.0 (`packages/verify/src/index.ts:26-31`): `verify` (bytes required, `verifier.ts:133-140`), `verifyProofIntegrity` (bytes-free, `179-188`), `resetEpochLinkState`; result `{valid, reason?}` plus `artifactBinding:"not-checked"` in the bytes-free variant. One pipeline, `runChecks` (`205-210`): structure (213-216), digest vs bytes (224-234, the only bytes-touching line and the branch point for a fused check), signed-body rebuild (250-280), Ed25519 (297-308), agency if present (314-318), slot if present (324-328; `requireSlot` only forces presence), epochLink if present (334-338), policy (344-348). Attestation contents and prevB64 linking are not checked here; both live in bitgraph-audit. The slot rule is intra-proof only (`968-985`). No verifier in verify, audit, or player compares a lineage predecessor's commit counter to this proof's slot counter; the only such rule is in the Imran package's own `verify.mjs` (`chain_continuity`), which is frozen and outside this repo.

Player 0.7.0 (`packages/player/src/check.ts`): `CheckLine.name` in {file, signature, attestation, enclave, witness, contradiction, domain} (`110-115`), result TRUE/FALSE/UNDETERMINED (`types.ts:24`), `CheckBounds` (`128-133`), `CheckRecording` (`135-150`, slotCounter already surfaced), `KNOWN_ENCLAVE_MEASUREMENTS` four entries (`83-104`, matches PINS.md), anchor vs recording split by signed attribution name (`307-323`), file line (`393-408`), signature line (`414-428`), unknown PCR0 → UNDETERMINED (`596-603`), strong-Kleene conjunction (`331-337`), `EXCERPT_NORMAL_CODES` (`243-249`). Renderers a fused category touches: `renderCheckText` (`955-971`), `summarize` (`926-933`), `web/verify-page.ts` label map (`387-396`), `whenRow` (`245-266`, the four `grey(` sites), primary card (`453-472`), `anchorOpener` (`404-406`), `pageTitleFor` (`207-209`), CLI exit codes (`cli.ts:33`). Player doctrine: an artifact's position is its commit position (`order.ts:10-11`, `343-345`).

Audit floor today: anchors with a verified witness in the same partition (`temporal.ts:150-159`), candidate when the proof is a prevB64 descendant or its COMMIT counter exceeds the anchor's (`174-178`, `183-191`), tightest = largest witness timestamp (`320-324`), claim text "committed no earlier than" (`361-368`). `slotCounter` enters only `positionRange` (`383-395`). Fuse's floor (last anchored block preceding the SLOT counter) is not computed anywhere and needs a slot-aware candidate filter plus a distinct bound kind and claim text; under the current evidence taxonomy it can only be counter-order (no hash path reaches a slot record). Audit shapes: `ObservedProof` (`types.ts:220-278`), open `AnomalyCode` union (`39-126`), `ReportProofRecord` (`1412-1434`), pipeline order (`audit.ts:72-89`), full tier is the only bytes-in-hand moment (`verify-tiers.ts:87-97`), exit flags (`audit.ts:149-165`).

Tests: root `npm test` = `test:core`, a hand-maintained list of 24 compiled files (`package.json:25-26`); verify and audit have no tests of their own (root `src/__tests__`: verifier 49, proof-integrity 30 with slot tests at 314-351, canonical 45, audit-temporal 10, audit-anomalies G2 at 74-93); player runs its own 134 (`packages/player`, check.test.ts 28); parent `auth.test.ts` 8, run by hand with `node --import tsx/esm --test`; CI runs the root list only. A new root test file is invisible until listed.

### 11. Allocation authentication and rate limiting

Every check lives inside `handleCommit` and applies to `/commit` only: `checkApiKey` (`server.ts:219-224`; `auth.ts:80-88`: allows unless `REQUIRE_API_KEY` is exactly "true"; `API_KEYS` grants only the exemption), body cap and Content-Type (`226-239`), digest limiter (`270-287`; `rate-limit.ts:24-26` defaults 5000 burst, 20/min, 100000/day, the box overrides the global to 50000 by a systemd drop-in; `getClientIp` at `49-58` trusts `cf-connecting-ip` only from loopback; `tryConsumeDigests` at `69-111`). `/allocate-slot`, `/challenge`, `/verify`, `/key`, `/health` call none of them (`462-476`). `/challenge` has the same shape (enclave pool 500, 60 s, `app.ts:175-177, 208-210`) but only blocks actor-bound commits. Identifiers available to key an allocation limiter: socket IP or `cf-connecting-ip` on loopback, and a Bearer token; nothing else exists (no actor key at allocation, no session). Proxied traffic is one identity at the parent (the proxy forwards only Authorization, `route.ts:90, 102`); the contact route shows the x-forwarded-for pattern (`api/contact/route.ts:45-48`) the proxy could adopt if the parent were taught to trust it from loopback. Edge: the Vercel WAF rule `commit-rate-limit` (POST /api/commit, 1000/day/IP) is dashboard configuration, absent from the repo, and would not cover `/api/fuse/*` without a new rule. The digest limiter cannot meter an allocation (nothing to count), so a per-allocation token is new parent work. Test template: `auth.test.ts` (factory over an env object, node:test); `rate-limit.ts` has no tests.

### 12. JSON canonicalization

- `packages/verify/src/canonical.ts` is the proof and slot-record scheme: recursive sort by UTF-16 code units (the doc comment at line 12 says code point; wrong for astral keys, harmless for ASCII), compact `JSON.stringify`, UTF-8. It matches RFC 8785 on key order, number formatting, and string escaping, but is not JCS on the edges: NaN/Infinity emit null, lone surrogates are escaped rather than rejected, undefined members are dropped, `Date` becomes `{}`, no safe-integer profile, and no duplicate-key rejection (it never parses). 45 tests, in the proprietary root package.
- Hand copies of the same algorithm, untested: `website/src/lib/canonical.ts:9-27`, `website/src/lib/bitgraph.ts:275-284`, `packages/hosted/src/bitcoin-anchor.ts:49-58`.
- A second scheme already coexists: the direct P-256 agency payload uses a one-level replacer-array `JSON.stringify` (`verifier.ts:811-825`, `app.ts:432-447`), byte-equal to canonicalize only because the payload is flat.
- `bitgraph-gate/packages/canon` is a strict RFC 8785 implementation (MIT, zero deps, 29 tests) but lives in the local-only never-push repo and its own header forbids interchange with the proof form. `gate-py/jcs.py` mirrors it. `trace-binding/src/jcs.mjs` and the Imran copy are the TRACE 3.2.2 profile (integers only, safe range) and are frozen.

Reuse verdict for Form C: use verify's `canonicalize`, exported from the MIT package with zero imports, under a schema restriction: string-valued fields only (counters and digests as strings, exactly like slot records), ASCII keys, no undefined. Under that restriction its bytes are identical to strict RFC 8785 output (checked empirically across verify, gate canon, and trace jcs for a Form-C-shaped object). The Fuse document must say "RFC 8785-equivalent for this schema", not cite the code-point wording. A Fuse verifier that parses Form C from text must compare the exact bytes against re-canonicalized parse output, which rejects duplicate keys and non-canonical payloads together.

### 13. Anchor-first gate

`website/src/app/api/commit/route.ts`: `TEE_URL` (5), `teeRestarting503` (38-42: 503 `{error:"The camera is restarting", code:"tee-restarting"}`, no Retry-After, plus the temporary Folder header), module caches (44-45: `/key` epochId cached 10 s; `anchoredEpochs` never evicts), `currentEpochHasAnchor` (47-68: GET `/key`, then one LIST of `anchors/{epoch}/`; "no" re-listed each time, "yes" memoized per instance), body parse and priors (72, 79-85), Authorization forward (87-90), the gate call (95-96), forward with 502/503/504 and thrown fetch mapped to the same 503 (98-110), other upstream errors passed through minus headers (112-115), per-position index (117-124). Nothing is exported except `dynamic` and `POST`; no middleware, no vercel.json. `getCurrentEpoch` in `s3.ts:75-77, 92-93` must not be used as the gate's epoch source (60 s TTL and an S3 fallback that answers with the previous epoch during rotation); `roll/head/route.ts:24-39` is a third private copy.

Bypass: a `POST https://nitro.occproof.com/commit` with `chainId:"bitgraph:main"` reaches `handleCommit`, which checks key policy, content type, size, digest shape, and the limiter, then allocates and commits with no anchor question (`server.ts:219-287`, `311-320`). The word "anchor" appears in the parent only in comments; the enclave has no anchor logic. The public api-reference page names the parent as the base URL. The gate's invariant is, by its own comment, scoped to the proxy.

Two corrections that change the Fuse design. First, the gate and the `anchors/{epoch}/` prefix are chain-blind while counters are per chain and anchors exist only on `bitgraph:main` (`bitcoin-anchor.ts:129-133`, `594`; `app.ts:150-158`, `270-272`, `278-286`). A slot on the `global` chain is incomparable with every anchor for the whole epoch, and a position-aware check "anchor counter < slot counter" would pass falsely for it. So the Fuse allocation must pin `chainId:"bitgraph:main"` and the Fuse verifier must require `slot.chainId === "bitgraph:main"` (signed into the slot body) before comparing any anchor counter to N. Second, the gate must sit in front of the ALLOCATE call, because the floor is anchored to N, not M; gating only the commit leaves N ungated. The gate remains necessary for the epoch-start case but is not what makes the floor well-defined.

### 14. Download and export utilities

No shared filename sanitizer. Two identical inline regexes sanitize only the outer zip name (`website/src/components/bitgraph-camera.tsx:1091-1093`, `website/src/app/proof/[digest]/page.tsx:724-725`: control characters, DEL and `/` become spaces, then trim); entry names inside zips are used verbatim. The proof-page download is a flat zip `BitGraph (<name>).zip` holding `proof.json`, the file (only if cached in IndexedDB), and `ethereum-anchors/{anchor-before.json, anchor-before-witness.json, anchor-after.json, anchor-after-witness.json}` (`page.tsx:635-641, 685-698, 701-716`); the camera zip is the same shape for one file and `<basename>/{file, proof.json}` per file for batches with one root `ethereum-anchors/` (`bitgraph-camera.tsx:1010-1058`). The retired Folder wrote `Recordings/<day>/BitGraph (<label>)/{proof.json, file, ethereum-anchors/}`; ~2,566 such folders exist in `~/BitGraph`.

Readers and a Frame sibling:

| reader | dot-prefixed name | plain name `<name>.bitgraph-fuse.json` |
|---|---|---|
| site drop (`website/src/lib/folder-check.ts:138-140, 199-202, 284-287, 323-336, 729-740`) | pruned at walk time, never read | extra artifact candidate; one extra hash; transient wrong name/thumbnail before verification |
| verify.html (`packages/player/web/verify-page.ts:70-82`) | read | read |
| bitgraph-audit and bitgraph-play (`packages/audit/src/ingest.ts:345-393, 813-821, 595-611`) | unmatched artifact, one note, no exit bit, unless proof-shaped | same |
| packages/export dist (orphan) and the retired Folder | ignored | may be picked as the artifact |

Design constraint: a Frame must not be proof-shaped (string `version` plus object-valued `artifact`, `commit`, `signer` at top level), or every audit reports `unsupported-version` (exit bit 1). The spec's Frame (`type`, `manifest`, `fusePayload`, `proof`) is not proof-shaped and `isBitGraphProof` (`website/src/lib/bitgraph.ts:109-121`) does not detect it, which is correct. The check report's note for an unmatched file says "its bytes differ from what was recorded" (`check.ts:857`); that wording is a UX wrinkle for a legitimate Frame, in a frozen package.

## The six answers

### Q1. Is ordinary-commit attribution inside the enclave-signed bytes? YES

Evidence: `app.ts:617-626` and `656-661`; `verifier.ts:274-277`; `proof-hash.ts:96-99`. Any caller can set it today with no validation at parent or proxy. All three lenses agreed; the empirical lens reproduced signature failure on every mutation and matched the signed-body hash inside the attestation report.

Implication (spec 6.5): the SIGNED branch. `attribution.name = "bitgraph-fuse/1"` (the profile id, ruled 2026-09-03), `attribution.title = placement id`, `attribution.message = origin digest`. Only those three keys, string values, one attribution per request, name must not start with "Ethereum". The signature proves the enclave sealed the claim, not that the claim is true, so reconstruction remains the truth check even on this branch.

### Q2. Can the host forward an already-issued slot with no enclave change? YES

See section 0. All three lenses agreed; the empirical lens ran the unmodified enclave. Parent changes: accept an optional `slotId` on `/commit` and skip the internal allocate; an allocation surface that forwards `chainId`; meter allocation. No vsock-client change (`CommitDigestRequest` already carries `slotId`, `AllocateSlotRequest` already carries `chainId`).

### Q3. Can a committed-but-lost proof be retrieved without a second commit? PARTIAL

By artifact digest only. `getProofsByDigest` returns every position; there is no idempotency key and no nonce- or slot-keyed index; a blind HTTP retry today mints again; the only consumed-slot refusal is the enclave's vsock error, forwarded by the parent as HTTP 500 "Enclave error: Slot not found or expired", which cannot distinguish consumed from expired.

Cold-refuter corrections, accepted: the proxy's `tee-restarting` 503 is not proof that nothing was minted (it also fires on a transport failure after the parent minted, `route.ts:98-110`), and any mid-batch enclave failure returns 500 before `persistToLedger`, orphaning proofs minted earlier in that request (`server.ts:350-352` vs `371-372`). The anchor service's `anchor-claims/` conditional PUT (`bitcoin-anchor.ts:729-750`) is the idempotency pattern in this repo.

Implication (spec 8.4): recovery needs no new index. The Fuse client holds, before commit, the signed slot record (so it can compute `commit.slotHashB64`) and the fused artifact digest. Rule: on timeout, network error, `tee-restarting` 503, or the consumed-slot code, read by the artifact digest, filter positions on `commit.slotHashB64` equal to SHA-256 of the held slot body, and never allocate again while that read can still succeed; if nothing is found after a short poll, allocate fresh (new nonce, re-fuse the file). The Fuse commit route accepts exactly one digest per request. The parent maps the enclave's "Slot not found or expired" to a distinct HTTP code so the proxy and client can tell it from a 500.

### Q4. Are unknown JSON properties tolerated by existing parsers? PARTIAL

No parser (verify, audit, player, website, parent, Imran's verifier) rejects unknown keys; there is no Ajv, zod, or `additionalProperties:false` on proofs. But an extra key inside `artifact`, `commit`, `attribution`, `policy`, or `agency.actor` breaks the Ed25519 check, and any extra top-level key changes `computeChainHash`, which audit `reconstruct.ts:146` and Imran's `verify.mjs` use to resolve `prevB64`. A Frame wrapping the unchanged proof is treated everywhere as a non-proof file. Name-keyed readers: the site drop path (`proof.json`), the orphan `packages/export`, Gate containers, and Imran's `verify.mjs` (`proofs/proof-N.json`). The empirical probe ran verify, audit, and player dist against a production fixture with each mutation. (The three lenses for this question were still re-running at the time of writing; the answer agrees with my own reading of `validateStructure`, `verifier.ts:363-439`.)

Implication (spec 7.2): never add a property to the proof object; nest the unchanged proof under `proof`; the Frame must not be proof-shaped; the manifest is advisory and nothing reads it today.

### Q5. Can the Fuse route sit behind the same anchor-first gate? PARTIAL, YES after a lift

The gate is module-private and inlined; a new route cannot import it. Lift `route.ts:38-68` into `website/src/lib/anchor-gate.ts` (exporting `currentEpochHasAnchor` and the 503 shape without the Folder header), re-point `api/commit`, and call it from `api/fuse/allocate` and `api/fuse/commit`. The parent enforces nothing on bypass and cannot arm `REQUIRE_API_KEY` without breaking the anchor service (`auth.ts:14-17`). The cold refuter's chain-blindness correction (section 13) is adopted: allocation pins `bitgraph:main`, and the fuse commit route makes a position-aware check (an anchor key under `anchors/{slot.epochId}/` with counter below `slot.counter`), which also closes the gate's 10 s epoch-cache window for the commit leg. The verifier reports UNDET when no anchor precedes N in the slot's epoch chain regardless of how the producer was gated; the gate is a promise of the bitgraph.ing surface, not a verifier invariant.

### Q6. Does the by-digest index support a second key per proof? PARTIAL

Mechanically yes: every by-digest key is a PutObject from the parent, the proxy, or the anchor service, always derived from `proof.artifact.digestB64`, and the one reader never compares the fetched proof's artifact digest to the lookup digest. But no reader can tell an origin entry from a recording of those bytes; the positions payload carries neither digest nor kind; entries are ranked earliest-first; `/api/verify` (entries[0] then "mismatch"), MCP `bitgraph_check` (`on_record = proofs.length > 0`), Zapier, and the camera (a solo "found" file returns before recording, `bitgraph-camera.tsx:537-545`, so a fused-only origin entry would silently prevent the origin bytes from ever being recorded through the camera) all conflate.

Cold-refuter corrections, accepted: by-digest keys are not unlocked; the bucket was created with Object Lock and a default COMPLIANCE retention of 3650 days plus versioning (`packages/ledger/setup-bucket.sh:20-46`), so every by-digest PUT becomes a permanent retained version and a later PUT only shadows what GET returns. A mistaken origin-index entry is therefore permanent as a version. And attribution is not the only signed caller field: `policy` (a `PolicyBinding`) is sealed too; Fuse keeps attribution per the spec. (Two lenses for this question were still re-running at the time of writing.)

Implication (spec 11): the proxy writes `by-digest/{originDigest}/{epoch}-{counter12}.json` for a fused proof, never the origin's legacy key, sourcing the origin digest from the signed `attribution.message`, not from the request body. Reader work on five surfaces: `getProofsByDigest` tags each entry `kind: recorded | fused` by comparing artifact digest to lookup digest; the digest route's positions carry `kind` and the entry's own artifact digest; the proof page labels rows and lists descendants unranked; `/api/verify`, the MCP route, Zapier, and the camera stop treating a fused-only list as "these bytes are on record". The single-page LIST caps an origin at 1000 descendants.

## Implementation map

Branch `bitgraph-fuse` in `../occ-fuse`. Nothing is deployed, published, or pushed. Enclave `app.ts` is never edited.

Deliverable 2, allocation authentication and rate limiting (parent; implemented on the branch, NOT deployed under the freeze):
- `server/commit-service/src/parent/rate-limit.ts`: add `tryConsumeAllocation(clientIp, now?)`, a per-IP allocation window sized to the 120 s TTL plus a global window well under the 1000 pool, env-overridable (`RL_ALLOC_PER_IP_PER_TTL`, `RL_ALLOC_GLOBAL_PER_TTL`), and `allocationLimitConfig()`.
- `server/commit-service/src/parent/server.ts`: `handleAllocateSlot` keeps its path (the Imran package says it "is available"), reads a JSON body `{chainId?}` defaulting to `bitgraph:main`, applies `checkApiKey`, applies the allocation limiter with the same API-key exemption as `/commit`, forwards `chainId`, and returns `{slotId, slot, chainId}`. Header comment and banner updated.
- `server/commit-service/src/parent/__tests__/allocation-limit.test.ts` in the `auth.test.ts` factory style.

Deliverable 3, Fuse path behind a flag:
- Parent `server.ts`: env `FUSE_ENABLED` (default off). When on, `/commit` accepts an optional `slotId` string with exactly one digest, skips the internal allocate, forwards the client's `slotId`, and maps "Slot not found or expired" to HTTP 409 `{code:"slot-unavailable"}`. `slotId` with more than one digest is 400.
- `website/src/lib/anchor-gate.ts` (lifted gate), `api/commit/route.ts` re-pointed.
- `website/src/lib/fuse-flag.ts`; `website/src/app/api/fuse/allocate/route.ts` (flag, gate, forward to the parent's `/allocate-slot` with `chainId:"bitgraph:main"`, refuse if the returned `slot.epochId` differs from the gated epoch); `website/src/app/api/fuse/commit/route.ts` (flag, position-aware gate over `anchors/{slot.epochId}/`, forward with `slotId`, priors snapshot, `storeProofByDigest` plus the origin index, return the proof).
- Test harness for the parent path: `server/commit-service/local-enclave/` (unmodified `app.ts` under a resolve hook with a software NSM; see below).

Deliverable 4, construction and parsing, placement registry, vectors, round-trip tests (MIT, in the verify package so any verifier can rebuild):
- `packages/verify/src/fuse.ts`: profile constants (`bitgraph-fuse/1`, domain bytes `UTF8("bitgraph-fuse/1") || 0x00`, `BGFUSE01`), `computeSlotRecordHash(slot)` (reusing the existing canonical subset), `computeSlotCommitment(slot, nonceB64)`, the placement registry with `build` and `locate` for `trailer/1`, `container/1` (uncompressed ustar, fixed entry order and zeroed metadata), `produced/1` (Form C canonical payload), strict Form C parse (bytes must equal re-canonicalized parse), Frame build and parse.
- `packages/verify/src/index.ts` exports; version 1.4.0 on the branch, unpublished.
- Root tests `src/__tests__/fuse-vectors.test.ts`, `fuse-roundtrip.test.ts`, `fuse-verify.test.ts`, added to the `test:core` list; fixtures under `src/__tests__/fuse-fixtures/` minted with the local enclave harness (signature-valid under a local key, fake PCR0), none containing the string "nonce:".

Deliverable 5, verification:
- `packages/verify/src/fuse-verify.ts`: `verifyFuse({proof, bytes, frame?, policy?})` implementing the two paths of spec 10.4 with the category set of 10.5 (names adapted to repo style), including `slot.chainId === "bitgraph:main"` before any floor comparison and the optional span policy of 12.1.
- `packages/player/src/check.ts`: a `fused` line built beside the file line; the slot-aware floor (last anchored block with `anchor.counter < slotCounter` in the same partition) as a distinct bound with its own claim text; `web/verify-page.ts` label map and `whenRow` floor sentence; player tests; version 0.8.0 on the branch, unpublished; `verify.html` rebuilt locally only.

Deliverable 6, ledger indexing: `website/src/lib/s3.ts` (origin index write when `attribution.name === "bitgraph-fuse/1"` and `message` decodes to 32 bytes; `getProofsByDigest` returns `kind`), `api/proofs/digest/[digest]/route.ts` (positions carry `kind` and `artifactDigest`), `app/proof/[digest]/page.tsx` (labels, descendants unranked), `api/verify/route.ts`, `app/mcp/route.ts`, `packages/zapier` (fused-only is not on record for the origin bytes), camera solo path.

Deliverable 7, SDK: `fuse(builder, options)` in the core package `@mikeargento/bitgraph` (`src/fuse.ts`; Mike's ruling 2026-09-03: the primitive and the producer function live in core, the workflow stays opt-in and separate; verification stays MIT): `fuse(builder, options)` allocating through `/api/fuse/allocate`, handing the commitment and origin digest to the builder, hashing, committing through `/api/fuse/commit` under the same slot, returning a Frame; the recovery rule from Q3; nonce hygiene per spec 9.4.

Deliverable 8: dropped (Gate shelved).

Deliverable 9, internal harness: the `/fuse` page and `/api/fuse/harness` route as specified (Mike's ruling 2026-09-03), 404 unless `FUSE_ENABLED` and `FUSE_HARNESS_ENABLED` are set, token-checked, running the same `fuse()` through the site's own routes; the `bitgraph-fuse` command in the core package remains for vectors. Deploy note: the website now depends on the core package by path (`file:..`), which resolves in a full-repo checkout only if the core package and verify 1.4.0 are built or published first.

Deliverable 10, docs: `docs/fuse/FUSE.md` with the doctrine, trust, and distinction paragraphs verbatim and the limitations of spec 4.2; no site page yet (a public docs page is an outward surface, which is Mike's call).

Must not be touched: `server/commit-service/src/enclave/app.ts` and `reproducible-build/`; every file under `~/Desktop/imran/` and `trace-binding/`; the published tarballs verify 1.3.0, audit 0.3.0, player 0.7.0; existing fixtures under `src/__tests__/real-fixtures/` and `packages/player/src/__tests__/fixtures/`; the main working tree's uncommitted removal diff.

## Test harness

The mock enclave (`server/commit-service/src/mock/mock-enclave.ts:45-53`) dispatches only `commit`, `challenge`, `key`; it has no slot protocol and its proofs carry no `slotAllocation`, so it cannot test any of this. The unmodified `app.ts` runs on the Mac under `node --import tsx/esm --import ./hooks-preload.mjs`, where the preload redirects only the bare import `@bitgraph/adapter-nitro` to a stub that re-exports the real adapter and replaces the NSM client with a software one (DescribePCR, GetRandom, Attestation), and patches `listen("/app/enclave.sock")` to a loopback port. The real parent then runs against it with `LEDGER_BUCKET` unset. Copies are kept at `server/commit-service/local-enclave/` on the branch. Proofs minted this way verify under bitgraph-verify (attestation contents are not checked there).

## Risks and freeze constraints

1. `occ` is a public GitHub repository. Mike's ruling (2026-09-03): Fuse is a re-ordering of BitGraph on the same patented nonce-first architecture, so no counsel gate applies. The `bitgraph-fuse` branch is pushed only on Mike's explicit word and not while the Imran freeze holds. The Imran package pins `enclave/app.ts` line 229 and line 566 on GitHub main, so nothing on main may shift those lines.
2. Mike's 09-02 freeze: no host patch or restart, no push to main, no npm publish, no site or proof-page change while Imran evaluates. Deliverable 2 is built and tested locally and stays undeployed. The main working tree's removal diff stays as it is; at deploy time Mike chooses between the removal (main) and the gated route (branch), and the branch keeps the package sentence "POST /allocate-slot ... is available" true.
3. Published verify 1.3.0, audit 0.3.0, player 0.7.0 are frozen for Imran; version bumps on the branch are not published and `verify.html` is not redeployed.
4. Attribution is settable by anyone with no validation, so the signed placement and origin are sealed claims; the verifier's reconstruction is the truth check.
5. The 120 s TTL and the nightly restart bound every Fuse operation; large-file finalize must fit or re-allocate with a new nonce and re-fuse.
6. A refused commit burns N; a mid-batch failure orphans proofs; the Fuse commit route therefore takes one digest per request and the client recovers by digest plus `slotHashB64`.
7. The gate is chain-blind and per Vercel instance; the fuse commit route's position-aware check is what makes the floor well-defined, and the verifier still reports UNDET when no preceding anchor exists in the slot's epoch chain.
8. By-digest writes are permanent versions under the bucket's default COMPLIANCE retention; an origin-index entry cannot be undone, only shadowed.
9. `getProofsByDigest` lists one page (1000 keys); popular origins would truncate silently.
10. Player doctrine says an artifact's position is its commit position (`order.ts:10-11`); Fuse's strict rule (spec 12.2, `commitCounter(A) < slotCounter(B)`) is implemented inside the fused verification output and does not change `compare()` for ordinary rules.
11. The parent's `verify-helper.ts` fails every attributed proof (rebuilds without attribution). Incidental, pre-existing, not touched by Fuse; noted for a later fix.
12. The `file-02.txt` recordings in `~/BitGraph/Recordings` contain the line `nonce: e317...`; no Fuse fixture is derived from them.

## Findings of the completeness critic, folded in (2026-09-03)

1. The package Imran holds has a verdict surface no trace inspected: its `verifier/verify.mjs` chain_continuity rule requires the prevB64 predecessor's commit counter to be below THIS proof's slot counter (line 233). A slot held across any other commit (the normal fused case) fails that category. Never send or reference a fused proof under the current TRACE package; any open profile verifier must compare the predecessor to the commit M and state the span [N, M]. The trace-binding working copy differs from the sent file on this point, which is why an earlier verdict missed it.
2. Daily rotation blackout: the enclave restarts at 23:59 UTC and voids pending slots, so a slot allocated inside the 120 s TTL before that instant can never be committed. The site's allocate route now refuses inside a 150 s guard with the same retryable 503 as the rotation (`FUSE_ROTATION_UTC`, `FUSE_ROTATION_GUARD_SECONDS`). A parent-direct producer must apply the same rule itself.
3. The parent's own `POST /verify` rebuilt the signed body without attribution and policy, so it reported every anchor proof and every fused proof as failing while the MIT verifier passed them. Fixed on the branch with tests; deploying it is a parent restart, so it waits with the rest.
4. A Frame dropped alone on the home page was hashed as an ordinary file and, being new, would have been auto-recorded at a fresh position. The site's proof detection now unwraps a Frame to its proof, which makes the drop a lookup.
5. Legacy recordings: about 500 production recordings in `~/BitGraph` (2026-06-27 and 2026-08-06) carry a `nonce: <hex>` line inside the file, the proto pattern of this design. No placement locates a commitment in such a file (test added). They are dated evidence of the pattern in practice on the public ledger; none appear in the Imran package, trace-binding, or Gate. Mike's 2026-09-03 ruling makes this a footnote, not a counsel question.
6. The root package's `files` whitelist includes `src`, so the fake-PCR0 fixtures would have shipped with the next publish of the core package; they are now excluded.
7. Tooling: `packages/audit/src/reconstruct.ts` reads as binary to BSD grep and is silently skipped without `-a`; the prevB64 resolver at line 146 lives there.
8. The branch's `website/public/verify.html` differs from the copy Imran holds; expected, since it is rebuilt from player 0.8.0, and it is neither deployed nor sent.
9. Production parity is still asserted, not observed. A deploy plan starts with a read-only diff of the box's `server.ts` against HEAD and this branch.
10. Publication hazard: the branch shares `.git` with the public repository. A `git push --all`, `git push --mirror`, or an IDE "publish branch" from either worktree would publish the branch, trigger a Vercel preview deployment of the Fuse routes, and run CI, all while the Imran freeze holds. No such command without Mike's explicit word.

## Decisions taken (stated as assumptions, changeable)

- The parent allocation path stays `POST /allocate-slot`, gated and metered, with `chainId` defaulting to `bitgraph:main`; the proxy exposes `/api/fuse/allocate` in front of it.
- `attribution.message` carries the origin digest as standard base64 (44 characters), the same encoding as every digest field in `bitgraph/1`; the Form C payload keeps the spec's lowercase hex.
- The Fuse commit is one digest per request.
- The SDK package is proprietary; everything a verifier needs is in the MIT verify package.
- The harness is gated by an environment flag and token, not a login.

## Status at the end of the build (2026-09-03)

Delivered on the branch, all local: 2 (allocation metered, chain pinned), 3 (held slot on `/commit` and the site's `/api/fuse/*` behind the shared gate, both behind `FUSE_ENABLED`), 4 (verify 1.4.0: commitment, placements, Frame, `verifyFuse`), 5 (audit 0.4.0 by-hash streaming; player 0.8.0 fused line and slot-based floor; `verify.html` rebuilt locally), 6 (origin index, `kind` on every by-digest reader, proof page labels, verify/MCP/Zapier/camera no longer conflate a descendant with a recording), 7 (`fuse(builder, options)` in the core package), 9 (`/fuse` harness page and route, plus the `bitgraph-fuse` command), 10 (`docs/fuse/FUSE.md`), 11 (`docs/fuse/STATEMENT.md`). The signed `attribution.name` is the profile id `bitgraph-fuse/1` (ruled 2026-09-03, see Rulings below; applied on the branch: both constants, the route's 400 text, the tests, the fixtures re-minted through the local harness, `verify.html` rebuilt). Dropped: 8 (Gate shelved). Test totals after the ruling (2026-09-03): parent 19, root Fuse 73 (SDK included), player 148, site Fuse helpers 5 (one is a drift guard keeping the site's pinned wire name equal to the verify package's), site `tsc --noEmit` clean, plus the end-to-end drivers against the unmodified enclave (allocate 14, held slot 20, SDK and CLI driver exit 0).

## Rulings (Mike, 2026-09-03)

1. **Signed attribution name: `bitgraph-fuse/1`.** `attribution.message` keeps the origin file SHA-256 and `attribution.title` the placement id (spec 6.5). The nested proof remains an ordinary `bitgraph/1` proof; `bitgraph-fuse/1` is the stable wire/profile identifier for this construction, not a new proof format. If the product name changes later, the v1 wire identifier does not. Applied: `FUSE_ATTRIBUTION_NAME = FUSE_PROFILE` in verify; the site pins the same value in `fuse-core.ts` (its verify dependency is the published 1.3.0) and a test keeps the two equal; fixtures re-minted; `verify.html` rebuilt.
2. **Allocation posture: keep and deploy the gated `/allocate-slot` from this branch. The removal diff on main is not used** (parked in a git stash on the main worktree, labelled REJECTED; it can be dropped). Requirements, all met on the branch and checked against the code: allocation uses the existing key gate and, for callers without a valid key, the slot limiter (`handleAllocateSlot`); `/commit` consumes exactly the named slot, one digest per request, and never allocates fresh when a slotId was given (`heldSlotId`); the site's commit route refuses a proof under any other slot (`slot-mismatch`); `/api/fuse/allocate` and `/api/fuse/commit` both sit behind the anchor-first gate, the commit route position-aware (an anchor below N in the slot's own epoch).
3. **No public docs page yet.** Only `docs/fuse/FUSE.md`, internal. Public documentation comes later under the spec's rollout (section 17). The flag-off half of this ruling was superseded the same afternoon by ruling 4.
4. **Ruling 4 (2026-09-03, later): Fuse fully enabled as the new standard BitGraph production path, operational end to end in production.** Host: drop-in `bitgraph-http-server.service.d/fuse.conf` with `FUSE_ENABLED=true`, `RL_ALLOC_PER_IP_CAPACITY=250`, `RL_ALLOC_PER_IP_REFILL_PER_MIN=125`; restarted 14:05 UTC with the epoch intact; banner reports client-held slots ENABLED and the allocation limit 250 per address burst, +125 per minute, 250 per 120 s global. Site: `FUSE_ENABLED=true`, `FUSE_HARNESS_ENABLED=true` and `FUSE_HARNESS_TOKEN` set on Vercel, the `commit-rate-limit` edge rule extended to POST `/api/fuse/allocate` and `/api/fuse/commit`, then a deploy. Proof of operation: one real fused artifact through the published CLI against bitgraph.ing, the Fuse document itself under `container/1`, verified on both paths, on the proof page, in the origin lookup and through MCP.

## Deploy checklist (only on Mike's word; nothing deployed as of 2026-09-03)

Order: verify 1.4.0, audit 0.4.0, player 0.8.0 and core 1.2.0 PUBLISHED 2026-09-03 by Mike, registry tarballs byte-identical to the branch (shasums compared); the site now depends on core `^1.2.0` from the registry and a clean checkout of `website/` builds (`npm ci` + `next build`, harness route present); the parent DEPLOYED on the host 2026-09-03 13:40 UTC: the box's three parent sources replaced with the branch's (its dead `/convert-bw` route and the `principal` passthrough main removed on 08-03 are gone), compiled on the box (Node 20, TypeScript 5.9.3), emitted diff limited to those three files, parent restarted with the epoch intact; banner: client-held slots disabled, `/allocate-slot` metered (20 slots per address burst, +10 per minute, 250 per 120 s global); `POST /verify` on a live anchor proof returns valid, which it did not before; backups at `~/fuse-backup-20260903-133940` on the box; site env (`FUSE_ENABLED`, `FUSE_HARNESS_ENABLED`, `FUSE_HARNESS_TOKEN`, all unset by default); extend the Vercel WAF rule `commit-rate-limit` (today POST `/api/commit` only) to POST `/api/fuse/allocate` and `/api/fuse/commit`. The Imran freeze governs the host and the published packages until it lifts.

## Second-model review before publish (2026-09-03)

An independent review of the publishable diffs (verify 1.4.0, audit 0.4.0, player 0.8.0, core 1.2.0) against main, every claim re-checked here. Blocker, fixed: on the FUSED_DIRECT path `verifyFuse` emitted "The supplied original matched the origin digest committed by this proof and therefore existed no later than commit position M" when no original had been supplied; the flag behind it only meant the origin digest inside the fused bytes agreed with the signed marker. The statement now names what was checked on each path (see FUSE.md "Statements"), the test that had pinned the wrong wording asserts the new split, and `verify.html` was rebuilt. Should-fix, done: root `prepack` (`npm run build`) and player `prepack` (`tsc && npm run build:web`) so a publish from a clean clone ships `dist/`, the `bitgraph-fuse` bin and `dist-web/verify.html`; root devDependency on audit `^0.1.0` raised to `^0.4.0`; changelog dates set; audit changelog notes the `toolVersion` value change. Passed: no removed or renamed export in any package, non-Fuse verify sources byte-identical to main, `readFuseAttribution` returns null for every non-fused proof, dependency ranges consistent, tarballs carry no fixtures or env files, marker is `bitgraph-fuse/1` everywhere, no import-time hazards for Node 20 (static evidence; runtime smoke ran on Node 24). Notes carried, not changed: (a) with an UNDECLARED placement the registry scan takes the first placement that locates a commitment, not the first whose commitment matches; the site route and the SDK always declare the placement, so it is reachable only through a hand-built attribution; (b) `bitgraph-fuse --help` names the parent-direct `/allocate-slot` and `/commit` paths; (c) publishing moves the `latest` tags off audit 0.3.0 and player 0.7.0, the versions cited in the OPAQUE/TRACE package; both new versions were run over that package and give identical results apart from the version fields; (d) the producer copy "Original recorded" in the CLI and harness is the spec's verbatim bounded copy, while the site's doctrine is that a fused descendant is not a recording of the origin bytes; Mike's call whether the word stays.

## End-to-end in production (2026-09-03, 14:04 UTC)

Fuse enabled everywhere under ruling 4: parent drop-in (flag on, allocation bucket 250 per address, 250 per 120 s global), Vercel production variables `FUSE_ENABLED`, `FUSE_HARNESS_ENABLED`, `FUSE_HARNESS_TOKEN`, edge rule `commit-rate-limit` extended to POST `/api/fuse/*` (config version 2), deploy d0eaf378. First production fused artifact, made with the published CLI (`npx -p @mikeargento/bitgraph@1.2.0 bitgraph-fuse fuse FUSE.md --placement container/1 --keep`) against bitgraph.ing: the Fuse document itself (13,736 bytes, origin `xIqN4tuO04a3/QCUIYkBoTnHzf0jZjjhQToT7kmzaJw=`), slot 7791, commit 7792, epoch `6iIBoRkg+aKBsztGRmaSt4h6yisupc1dMf3k1NlcjZU=`, fused digest `/m+ZeFg4UPaK3BF4D2duVK9GF4syUoXz3KbAstQB4D8=`, anchored between blocks 25897256 (counter 7790, before the slot) and the next anchor at counter 7794. CLI check: FUSED_DIRECT on the tar, FUSED_FROM_ORIGIN on the original, both exit 0. Site: proof page 200; fused digest recorded at 7792; origin lookup `origin-only` with the descendant `7792/fused(container/1)`; hosted MCP `bitgraph_check`: origin `on_record: false, fused_descendants: 1`, fused digest on record. Artifacts kept in `~/BitGraph/Fused/2026-09-03-FUSE.md/`.

Two gaps surfaced by the readers, both fixed on main the same hour: (1) the audit ingest did not recognise a Frame (`*.bitgraph-fuse.json`) as a proof carrier, so `bitgraph-play check <frame> <fused>` (and `verify.html`) said "no BitGraph proofs were found"; audit 0.4.1 unwraps the Frame, player 0.8.1 rebuilds `verify.html` on it, tests added at both levels. (2) The npm MCP package 0.1.1 predates the descendant doctrine and reported the origin as on record; the fix already on main ships as 0.1.2 (the hosted `/mcp` route was already right). Publish order: audit 0.4.1, player 0.8.1, mcp 0.1.2.

## Ruling 5 (Mike, 2026-09-03, later): the public drop fuses by default

Deliberate product change, implemented as a proof-model change with the drop experience preserved. The dropped file is the origin: preserved byte for byte, hashed as the origin digest; an unused slot is allocated; the `bitgraph-fuse/1` commitment is derived; the fused artifact is built with the registered placement chosen from the bytes; it is hashed; that exact slot is consumed with the fused digest; the visitor lands on the fused proof's page exactly as a recording used to land, and the export carries the original, the nested unchanged `bitgraph/1` proof, the Frame and the fused copy. Forms A and B are reconstructible by definition: nothing stores the fused bytes; the original plus the proof rebuilds them, and the proof page and the results card accept the original of a fused proof by reconstruction. Lookups index a fused proof under both its artifact digest and its origin digest, list descendants by position and placement without ranking, and a fused artifact's own page names its origin. Ordinary recording stays as the compatibility row and on /actor (an actor-bound fuse needs the agency envelope over the fused digest, which the core `fuse()` does not yet accept as a callback; follow-up). Files over 256 MB are recorded instead. Code: `website/src/lib/fuse-placement.ts` (bytes, not extension), `fuse-client.ts` (the browser pipeline over the core `fuse()`, `rebuildFromOrigin`), `bitgraph-camera.tsx` (`fuseByDefault`), the by-digest route (`fusedOrigin`, `placement` in both lookup directions), the proof page ("Fused from", "Placement", "Download fused copy", reconstruction in BringYourFile).

## Ruling 6 (Mike, 2026-09-03, later): simplify

Actor and Domain are removed from the site: the /actor page, /docs/actor, /docs/domain, the challenge proxy route, the passkey and actor-strategy libraries, the pinned-domain table, the site's own /.well-known/bitgraph statement, the nav and sitemap entries, the proof page's Actor card and "declare" action, and the results rows' actor label. Proofs that carry an `agency` envelope still verify (the verify package is unchanged); the site simply no longer shows or makes them. "BitGraph this file again" on the proof page now fuses the file in hand into a new artifact under a fresh slot and opens the new proof, instead of recording the same digest again; it is offered only with the file in hand, because fusing needs the bytes. The site's documentation was swept to describe the default operation, the compatibility recording, both-direction lookups, and the verifier's categories and statements, with Actor and Domain gone.

## Ruling 7 (Mike, 2026-09-03, later): MCP fuses; Zapier and Make leave the site; the player drops domain pinning

The npm MCP server (`@mikeargento/bitgraph-mcp` 0.2.0) takes BitGraphs the default way: for each file it holds, it reads the bytes, chooses the placement from them, and runs the core `fuse()` against the configured site (allocate, commitment, build, hash, commit under that slot, verify). It depends on `@mikeargento/bitgraph` 1.3.0, which now exports `placementForBytes` and `fusedNamesFor` so the site, the CLI and the MCP server share one placement policy. Outcomes are `fused`, `on record` (a recording or a fused artifact already names the bytes) and `not fused`; the Frame for each fused file rides in the structured result; the `attribution` input is gone (a fused proof's attribution is the marker). The hosted `/mcp` endpoint receives digests only, so it cannot build an artifact: its record tool stays the compatibility recording and its description says so and points to the tools that fuse. Zapier and Make are removed from the site (their docs page, the integrations redirect, the docs index entry, every mention); the connector package under `packages/zapier` is untouched pending a decision on the Zapier platform listing. The player 0.9.0 drops domain pinning (`pin`, `check --from`, `--pins`, the `bitgraph-domain/1` format and exports); reports are always `bitgraph-check/1`; nothing in the player touches the network.

Publish order for this round: core 1.3.0, then player 0.9.0, then mcp 0.2.0 (mcp depends on core ^1.3.0; the repo root lockfile is refreshed once core 1.3.0 is on the registry). The site deploy does not depend on any of them.

## Ruling 8 (2026-09-03): the hosted endpoint takes BitGraphs the default way

Mike, on a recording made through ChatGPT's connector (position 9546, an ordinary recording with no marker): "it has to record like this EVERYWHERE", and on how: "if it can hash the file it can create the virtual fused file and hash that."

The hosted MCP endpoint (`bitgraph.ing/mcp`) never holds a file, and does not need one. Every registered placement is a deterministic function of (original bytes, origin digest, commitment), and every byte of the new file that is not the original is computable from the origin digest, the origin size and the commitment. So the hosted path is two steps, and the caller builds the new file:

- `bitgraph_open`: per file, the name, exact size, SHA-256 digest and the first 16 bytes (the placement choice, the same `placementForBytes` policy as everywhere else; no head means the container). The route allocates a slot through the site's own `/api/fuse/allocate`, derives the commitment to the signed slot record, and returns a `fuse_token` (the open state, opaque, not secret: the enclave-signed slot record plus what the caller declared) and the recipe: `append` (48 bytes, trailer/1) or `prefix` and `suffix` (container/1: the manifest entry, the original's ustar header, the padding and the two end blocks).
- `bitgraph_commit`: per file, the token and the SHA-256 of the file the caller built. The route commits through the site's own `/api/fuse/commit` under that exact slot with the signed marker, checks the proof came back under that slot for those bytes with that marker, runs the integrity verifier (signature, slot binding, attestation; the byte half is the caller's and any reader's), and returns the proof and the Frame. Nothing is kept: the new file is virtual here as everywhere.

`bitgraph_record` stays as the compatibility recording of digests alone, described as such. The ustar writer in `website/src/lib/mcp/fuse-hosted.ts` is a verbatim copy of the verify package's; `website/src/lib/__tests__/fuse-hosted.test.ts` proves `prefix + original + suffix` equals `container/1`'s own build byte for byte at sizes around every 512-byte edge, and `original + append` equals `trailer/1`'s, and that the placement locates the commitment and the origin in what the caller built. The site's `fuse-placement.ts` now delegates to the core policy (dedupe done).

What only travels: digests, sizes, a file's first bytes, slot records, recipe bytes. What never travels: file contents. The proof page shows the new file's hash first, then the original's (Mike, same day).

