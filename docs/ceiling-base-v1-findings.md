# Ceiling on Base, v1: findings (investigation before code)

Branch `ceiling-base-v1`, from `main` at `50efbd3c`. Read against
`CANON.local.md` §3.5 (the rung ladder) and §3.6 (floor in time, ceiling in
position). This build is §3.5 **rung 3**: "a temporal upper bound via
publishing the chain head INTO a transaction ... Optional structural upgrade,
not a hole." It was raised as an open option on 2026-09-21 and not scoped then.
Nothing here changes the positional ceiling or its wording. It adds a second,
separate ceiling in time, carried beside the proof.

## 1. Where a commit is finalized

**One hook point: `handleCommit` in `server/commit-service/src/parent/server.ts`**
(the parent on the EC2 host), at the line that already hands the finished
proofs to `persistToLedger`. Every path that makes a proof reaches the enclave
through that one handler:

| Path | Route | Reaches the parent via |
| --- | --- | --- |
| Site drop box, single file | `website/src/app/api/commit/route.ts` | `fetch(\`${TEE_URL}/commit\`)` |
| Sets / `fuseSet()` (and MCP `bitgraph_record`) | `website/src/app/api/fuse/allocate` then `/api/fuse/commit` | `/allocate-slot`, then `/commit` with `slotId` |
| MCP `bitgraph_commit` (hosted) | `website/src/lib/mcp/api.ts` → site `/api/commit` | same as the drop box |
| SDK (`packages/sdk/src/task.ts`) | site `/api/*` | same |
| Server-side browser helper (`website/src/lib/bitgraph.ts`) | `${BITGRAPH_ENDPOINT}/commit` directly | parent `/commit` |
| Ethereum anchors (`packages/hosted/src/bitcoin-anchor.ts`, Railway) | `${TEE_URL}/commit` directly | parent `/commit` |

`/allocate-slot` mints nothing. A proof exists only after `/commit`, so the hook
sits there alone. At that point every proof in the response has its
`proofHash`, already computed a few lines above.

**Anchor proofs are left out of the queue.** They arrive through the same
handler (identifiable by `body.anchor`, or `attribution.name === "Ethereum
Anchor"`). If they were queued, the writer would send a Base transaction every
~12 s, about 7,200 a day, forever, with no user record in any of them. The
ceiling is for records. (Decision for Mike: they could ride along free inside
batches that a user record already triggered; v1 leaves them out.)

## 2. Does each proof include the previous record's hash?

**Yes.** `commit.prevB64` holds the **chain hash** (`computeChainHash`, the
whole proof minus ledger-added fields) of the previous proof on the same chain,
and the enclave writes it. It chains **per chain and per epoch**:
`server/commit-service/src/enclave/app.ts:140` says "each chainId gets its own
counter, prevB64, and epochLink". Epochs link via `commit.epochLink` on the
first proof after a restart. v1 builds its own batch Merkle roots and does not
rely on this.

Consequence: a single Base anchor over record N does **not** by itself cover
N-1, N-2, ..., because the chain link runs backward (N commits to N-1, not the
other way round). Each record needs its own leaf. That is what v1 does.

## 3. The leaf, and the position field

**Leaf: `proofHash`**, `computeProofHash()` in
`packages/verify/src/proof-hash.ts`: SHA-256 of the canonical signed-body
SUBSET (version, artifact, commit, publicKeyB64, enforcement, measurement,
attribution, attestationFormat). The leaf bytes are the 32 raw bytes
(base64-decoded), so leaf = `SHA256(0x00 || proofHash bytes)`.

⚠️ **The subset leaves out `actor` and `policy`**, which ARE signed. So a
ceiling bound to `proofHash` alone would not notice those two fields being
swapped. The verifier therefore does not accept a proof on the sidecar's word:
`verifyCeiling` recomputes `proofHash` from the proof and runs the existing
`verify()` on it, so the full-body signature holds every field. (The
alternative leaf, `computeChainHash`, covers the whole proof, but it is not
the ledger identity and not what S3 keys and sidecar names use. v1 keeps
`proofHash` as the prompt specifies, and the signature check closes the gap.)

**Position: `commit.counter`** (decimal string, per chain and per epoch; the
slot's is `commit.slotCounter`). Because counters are per `(epochId, chainId)`,
a batch never spans two epochs or two chains: the writer batches per
`(epochId, chainId)` group. `firstPos`/`lastPos` in the payload are that
group's counters. They are an index for humans. The binding is the root.

**The floor**, for the window, is `commit.slotAnchor` (`{counter,
blockNumber, blockHash}`): the latest authenticated anchor at slot allocation,
signed into the proof by enclave v7+. It carries **no time**. The block time
needs that block's header. So the sidecar carries an optional `floor` witness
(Ethereum header RLP, checked by keccak256 against the signed `blockHash`),
reusing the self-checking encoder in `packages/hosted/src/eth-header.ts`.
Without it, offline verification reports the floor as a block number and says
the time needs an RPC.

## 4. Export format, and where a sidecar travels

**Bundle** (`bitgraph-bundle/1`, `docs/BUNDLE-FORMAT.md`; built by
`website/src/lib/export-epoch.ts` and `packages/audit/src/export.ts`): a tar
of proof JSONs plus an optional unsigned `manifest.json`. Discovery is by
schema shape, never filename (§6.1). Unrelated files are tolerated and ignored
(§5), and they are counted in the contents hash. So a sidecar can travel as
`ceilings/<safeProofHash>.ceiling.json` beside `proofs/...` without breaking
any existing consumer.

⚠️ One interaction: §6.3 treats every entry that is not a proof, witness, or
manifest as a *candidate artifact*. A sidecar will be offered for digest
matching, match nothing, and be reported as an unmatched file by
`bitgraph-audit` until audit learns the `bitgraph-ceiling/1` shape. Harmless,
but noisy. Adding that recognition to audit is a small follow-up; it is not in
v1.

**Ledger**: proofs are Object-Locked (COMPLIANCE, 10 y) at
`proofs/{epoch}/{counter}-{hash}.json`. A sidecar changes status over time
(`included → safe → finalized`), so it cannot live in a locked object. v1
writes sidecars to the writer's local disk. An S3 sink at a NEW prefix
(`ceilings/`, not locked) is built but off by default. No existing S3 path
changes.

**Carrier** (`bitgraph-carrier/1`, the BitGraphed file): not touched. The
prompt says the ceiling is never fused into the file.

## 5. Other things found on the way

- **No test proofs on the production chain.** The standing rule is not to mint
  test proofs. So the §6 dry run (200 commits, a burst of 50, one Set) runs
  against the **local enclave harness** (the unmodified `app.ts` on the Mac
  with stubbed NSM, see memory `reference_local_enclave_harness`), and the
  real parent `server.ts` is pointed at it. The Base Sepolia transactions are
  real; the proofs are local.
- The floor gate (enclave v8) refuses to commit on `bitgraph:main` until an
  authenticated anchor exists in the epoch. Anchor claims are signed by the
  anchor service's key, which is not on this Mac. The harness run uses a
  scratch copy of `app.ts` with a throwaway test anchor key substituted, fed
  by a small local anchor loop that signs claims for **real** Ethereum mainnet
  blocks. So local proofs carry genuine floors and the measured windows are
  real. The scratch copy never enters the repo, and `app.ts` in the repo is
  not changed.
- `viem` is not in the repo. It is added to the writer only (in
  `server/commit-service`). The offline verifier stays dependency-light in
  `packages/verify` (adds `@noble/curves` for secp256k1 recovery; RLP, the
  Merkle-Patricia proof check and tx decoding are written out and
  cross-checked against viem in tests).
