# Changelog

All notable changes to `@mikeargento/bitgraph-player` are documented here.

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
