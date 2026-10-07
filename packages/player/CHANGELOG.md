# Changelog

All notable changes to `@mikeargento/bitgraph-player` are documented here.

## 0.16.0 (2026-10-06): Base floors, enclave v10

- `check` reads Base floors when the audit reports them (`temporal.signedFloors`, `floorProblems`, and `source` / `chain` / `timeSource` on segment bounds), structurally, so it behaves as before against an audit without them. A recording's bound reads "after Base block N", with the header checked or "confirming the block needs a Base lookup"; a fuse/3 recording's fused floor is the Base block it signs (`CheckFloor.evidence: "signed-floor"`); a withheld floor says why; a floor problem is a contradiction (FALSE). Bounds on different chains compare by time, never by block number. Not checked gains whether the Base floor blocks are Base's own.
- `compare`: anchor-bound ordering reads anchor bounds only; a Base floor orders no epoch.
- `KNOWN_ENCLAVE_MEASUREMENTS`: a TODO marks where enclave v10's PCR0 goes once the host build publishes it.
- TODO at release: bump the `@mikeargento/bitgraph-audit` range to the release that carries `signedFloors` (the workspace currently resolves 0.7.0 from npm for the Player).

## 0.15.0 (2026-09-30)

- `KNOWN_ENCLAVE_MEASUREMENTS` gains enclave v9 (PCR0 `934feb8b…c1fcf8`, tag
  `enclave-v9`, live from 2026-09-30 17:16 UTC); v8's period closes the same day.
  v9 changes nothing a verifier reads: the allocation response now carries the
  floor anchor the enclave signs at commit, for `bitgraph-fuse/2`.

## 0.10.0 (2026-09-05)

- `KNOWN_ENCLAVE_MEASUREMENTS` gains enclave v6 (PCR0 `cd8ba52d…12f77bf`, tag
  `enclave-v6`, live from 2026-09-05); v5's period closes the same day. The
  verifier page is rebuilt with it. Nothing else changes; this build of the
  player does not read set proofs yet.

## 0.9.0 (2026-09-03)

- Domain pinning removed: the `pin` command, `check --from <domain>` and `--pins`, the `bitgraph-domain/1` file format and its exports (`parseDomainFile`, `checkDomain`, `fetchDomainFile`, the pin store). Check reports are always `bitgraph-check/1` and carry no `domain` line. Nothing in this package touches the network any more. Detached `bitgraph-sig/1` evidence and the rule evaluator's `trustedKeys` are unchanged.

## 0.8.1 (2026-09-03)

- `check` and the verifier page read the proof carried by a `bitgraph-fuse/1` Frame (audit 0.4.1).

## 0.8.0 (2026-09-03)

- `check` reports fused recordings: a `fused` line, the fused floor and span, and the verifier's statements.
