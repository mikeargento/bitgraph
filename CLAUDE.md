# Working in this repository

## The owner's words stay out of the code

Never quote the owner's messages in code comments, commit messages, docs, or
tests. Do not write "Mike said", "Mike, 2026-10-22:", or any other attribution
of a decision to a person or a conversation. When a decision needs recording,
state the decision and the reason in neutral words, as documentation.

Wrong:

    // (Mike, 2026-10-17: "check is ledger")

Right:

    // The Check button opens the ledger.

## Only code goes to GitHub

Commit and push source code, tests, specs, and the docs that ship with the
code. Never commit documents produced for the owner to read or send elsewhere:
patent drafts, reports, letters, exports of conversations, generated reviews.
Those are delivered as files in the conversation, not through git. If a hook or
a reminder asks for uncommitted files to be committed, and the files are not
code, the answer is no.

## The enclave image is built from exactly these files

`server/commit-service/Dockerfile.enclave` copies `src/`, `packages/verify/`,
`packages/adapter-nitro/`, `packages/stub/`, the root `package.json`,
`package-lock.json` and `tsconfig*.json`, and the enclave and parent sources.
Any change to those changes the enclave's measurement (PCR0). Published
measurements are listed in `packages/verify/src/measurements.ts`. Do not touch
the build inputs unless a new enclave version is being made on purpose.

## Where things live

This repository began on 2026-10-22 as a single import of the code as it
stood. The full earlier history is in a private repository, bitgraph-archive,
and is not needed for any build. The branch `enclave-v13` here holds the exact
source tree that built the current enclave image; see
`server/commit-service/reproducible-build/PINS.md`.
