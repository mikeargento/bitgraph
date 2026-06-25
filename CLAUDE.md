# BitGraph

## What This Is

A protocol for portable cryptographic proof of **causal ordering**. Drop a file through an authorized execution boundary and you get a self-contained proof that the file existed in this exact form at a specific position in a sequence, anchored to a public timeline via Ethereum.

The current application on **bitgraph.ing** is photos-first file provenance: "drop a file to create or check a proof." The broader protocol can be applied to other domains, but the public site and the IPTC demo are about file provenance.

**One-liner**: "BitGraph proofs are not labels or metadata added after the fact. They are new computations created when a file's hash fills a pre-existing cryptographic slot."

**Tagline**: "BitGraph — Patent Pending"

## Core Concept

- **Causal slots** — The TEE pre-allocates a slot (nonce + counter) from hardware entropy **before** the artifact hash is known. The slot reserves a position in a sequence.
- **Commit** — The artifact digest is bound to the pre-allocated slot and signed with Ed25519 inside the TEE.
- **BitGraphed before** — The counter chain is periodically anchored to Ethereum. Once an anchor is mined, every proof committed before that anchor is fixed in the public timeline and cannot be rewritten.
- **Epoch isolation** — Every TEE restart generates a new keypair and resets the counter. Each epoch is a sealed compartment, and a compromise of one epoch cannot retroactively forge proofs under a prior epoch's destroyed key.

This is **not**:
- A blockchain (no consensus, no tokens, no global ledger)
- A watermark (nothing is embedded in the file bytes)
- DRM (files are freely copyable; only the proof lineage is authoritative)
- Proof of authorship or truth (BitGraph proves the commit event, not the content)
- Identity verification (use C2PA or a passkey/agency flow for that)

## Project State (April 2026)

**IPTC Media Provenance Summit — April 16 2026.** All current work is aimed at that demo.

Repo was cleaned up in the April 3 session — 1,600+ files deleted from the old agent-control era (MCP proxy, policy SDK, CLI, agent integrations, etc.). The current structure is narrow and photos-focused.

## Repo Structure

```
bitgraph/
├── src/                          # Core library (npm: @mikeargento/bitgraph 1.0.0)
│   ├── proof-hash.ts             # Canonical proofHash computation
│   ├── types.ts                  # BitGraphProof schema (bitgraph/1)
│   └── __tests__/                # Canonical + regression tests
├── server/
│   └── commit-service/           # TEE (AWS Nitro enclave) + parent HTTP server
│       ├── src/enclave/          # Runs inside the enclave
│       ├── src/parent/           # EC2 host, bridges TCP ↔ VSOCK to enclave
│       └── deploy.sh             # nitro-cli build-enclave wrapper
├── packages/
│   ├── hosted/                   # ETH anchor service (Railway)
│   ├── ledger/                   # S3 ledger read/write (occ-ledger-prod, legacy archive)
│   └── adapter-nitro/            # Nitro NSM interface (PCR0, attestation)
└── website/                      # Next.js app on Vercel (bitgraph.ing)
    ├── src/app/                  # Routes — home, proof/[digest], docs
    ├── src/components/           # FileDrop, SiteNav, Chat, etc.
    ├── src/lib/                  # bitgraph client, s3, c2pa-reader, nitro-verify
    └── public/                   # verify.html, c2pa/ WASM (copied at build)
```

## Key Infrastructure

| Service | Location | Purpose |
|---|---|---|
| **TEE** | `nitro.occproof.com` (EC2, Nitro Enclave, Cloudflare tunnel) | Signs proofs inside the enclave, returns via VSOCK bridge |
| **Anchor service** | `occ.bitgraph.ing` (Railway project `content-quietude`) | Seals counter chain into Ethereum blocks, writes anchors to S3 |
| **S3 ledger** | `occ-ledger-prod` (us-east-2, Object Lock COMPLIANCE, 10-year retention) | Sole storage. Keys: `proofs/{epoch}/{counter}-{hash}.json`, `anchors/{epoch}/`, `by-digest/{digest}.json` |
| **Website** | `bitgraph.ing` (Vercel project `occ-docs`) | Built from `website/` subdirectory. Linked via `.vercel/` at the repo root |

**SSH to EC2**: `ssh -i ~/Desktop/Keys/occ-nitro-test.pem ec2-user@3.151.121.225`

### "Fire it up" shorthand

When the user says **"fire it up"**, bring the TEE online with 12s Ethereum anchoring:

1. SSH to EC2, `nitro-cli describe-enclaves` to check CID
2. If no enclave: `nitro-cli run-enclave --eif-path /home/ec2-user/nsm-test/bitgraph-enclave-v1.eif --cpu-count 2 --memory 1024`
3. Kill old socat, start new: `sudo bash -c "setsid socat TCP-LISTEN:9000,fork,reuseaddr VSOCK-CONNECT:{CID}:5000 </dev/null >/dev/null 2>&1 &"` (use setsid, not nohup — nohup+sudo+& over SSH can hang the session)
4. `sudo fuser -k 8787/tcp` then `sudo systemctl restart bitgraph-http-server`
5. Verify: `curl https://nitro.occproof.com/health`
6. Set 12s anchors: `curl -X POST https://occ.bitgraph.ing/api/anchor/interval -H "Content-Type: application/json" -d '{"seconds": 12}'`

When the user says **"shut her down"**, set the anchor interval back to 3600s to minimize Railway cost.

## Build Commands

```bash
# Core library (bitgraph)
npm run build          # compiles src/ → dist/
npm run test:core      # canonical + verifier tests

# Website (Next.js 16, Turbopack)
cd website && npm run dev    # localhost:3000 (copies c2pa WASM at start)
cd website && npm run build  # production build

# Vercel deploy must run from repo root (not website/) because
# the Vercel project has rootDirectory: "website" configured
cd bitgraph && ./website/node_modules/.bin/vercel --prod --yes
```

**Note**: the root `package.json`'s `test` script still references deleted `packages/mcp-proxy` and `packages/policy-sdk`. Use `npm run test:core` for now — the full `npm test` will fail on the missing sub-projects until that script is cleaned up.

## Proof Format

Canonical `proofHash` is SHA-256 of canonicalized signed-body subset:

```
{ version, artifact, commit, publicKeyB64, enforcement, measurement,
  attribution?, attestationFormat? }
```

Notably **not** in the signed body: `timestamps`, `metadata`, `claims`, `agency` (has its own P-256 signature), `slotAllocation` (has its own Ed25519 signature, bound via `commit.slotHashB64`).

The `proofHash` field is added by the ledger at write time (see `packages/ledger/src/s3.ts`). The on-the-wire `bitgraph/1` schema in `src/types.ts` does not include it.

## Website Design System

- **Light mode only.** Dark mode attempted and reverted in the April 3 session.
- **Background**: off-white `#f5f5f5`
- **Brand accent**: blue `#0065A4` (changed from `#1A73E8` on April 7). Used for titles, links, primary buttons.
- **Trust mark green**: emerald `#10b981` — verified check, C2PA "Signed" pill, attestation success states. Consistent across all trust indicators.
- **Font**: Acumin Pro via Typekit (kit `svq0oqy`), fallback to Inter / system sans
- **Nav**: solid `#f5f5f5` background, no border. Left: "BitGraph" text logo, `font-weight: 900`. Right: `Docs | GitHub` (GitHub is a top-level external link in the nav as of June 2026; the Resend contact form was removed and the duplicate GitHub entry in the docs dropdown was dropped)
- **Drop zone**: 90% width, max 640px, 360px tall (280 mobile). Fluid typography: `min(22px, 4.25vw)` headline, `min(13px, 3vw)` subtitle so everything fits on one line at any viewport
- **Proof pages**: 800px max width, single column. Simple view is the default; "See details" flips to the technical card grid (Slot → Artifact → Commit → Signer → Environment → BitGraphed Before)
- **Cards**: white `#ffffff`, 1px `#d0d5dd` border, 16px radius

## Language & Tone Guardrails

The chat system prompt and docs enforce conservative, infrastructure-style language. **Use**:
- "cryptographically bound"
- "designed to prevent"
- "detectably invalid if altered"
- "cannot be retroactively constructed"
- "BitGraphed before" / "causal order" / "causal position"

**Do not use**:
- "unforgeable", "impossible to fake"
- "changes everything", "revolutionary"
- "proves authorship", "proves who made this"
- "proves absolute time", "proves when it was taken"
- Marketing hype, emotional appeals, cosmic framing

Any claim of identity should come from **verified** sources only — C2PA manifest creators (signed by a CA like Adobe CAI or Leica) or actor-bound agency proofs (passkey). Self-claimed `attribution.name` is rendered as "Submitter's note" with explicit "self-attributed, not verified" disclaimer — never as "Creator".

## Style Preferences

- **No generic card grids.** The AI-slop pattern of a 3-column grid of icon cards is banned. Use linear lists, single-column layouts, or deliberately asymmetric sections.
- **No emojis** in code, docs, or commit messages unless the user explicitly asks.
- **Photos-first product language**: camera, prove, verify, photo, file — not "agent", "tool call", "policy", "action".
- Conservative by default. When in doubt, strip words out.

## Don't Touch

- `server/commit-service/` — deployed enclave service, the EIF is measured and changes require a rebuild + fresh PCR0
- `.env*` files — gitignored, never commit
- `website/public/c2pa/` — gitignored; copied from `node_modules` at dev/build time via `copy-c2pa-assets` script

## Legacy / Removed (Do Not Reintroduce)

The following were part of an older agent-control direction that was abandoned. If you see references in stale docs or old sessions, they do not apply to the current state:

- `bitgraph-mcp-proxy`, `bitgraph-anthropic`, `bitgraph-openai`, `bitgraph-vercel`, `bitgraph-langgraph`, `bitgraph-langchain`, `bitgraph-crewai`, `bitgraph-gemini`, `bitgraph-google-adk` — all deleted
- Policy-in-proof / default-deny faucet model — removed
- ProofStudio branding, `proofstudio.xyz` domain — legacy, do not use
- Emerald-400 (`#34d399`) accent — wrong, current trust green is `#10b981`
- "Cryptographic control for AI agents" tagline — wrong, see current tagline above
- CommandCentral dashboard — deleted
- DynamoDB anchor — replaced by S3 ledger
- RFC 3161 TSA timestamps as primary time — Ethereum anchors are the time mechanism; the `timestamps` field exists in the schema as optional/advisory only
