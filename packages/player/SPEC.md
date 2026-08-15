# BitGraph Player specification

This document is the normative semantics of `bitgraph-player/1` and
`bitgraph-player/2` rules and their verdicts (`bitgraph-player-verdict/1`
and `/2`). Sections 1 through 8 define format 1; section 9 defines the
format 2 extension. A format 1 rule MUST evaluate identically under an
evaluator that also implements format 2, to the byte. The TypeScript package in this
directory is the reference implementation; a conforming Player in any
language MUST reach the same result and, for the serialization defined in
section 7, the same bytes.

BitGraph records. Player evaluates. Player is a pure function:

    evaluate(rule, verified evidence) -> verdict

The evidence is a BitGraph proof bundle as interpreted by the audit
pipeline (`bitgraph-audit`), which is the canonical interpretation of
bundle contents. Player makes no network requests, reads no clock, and
uses no randomness. Same rule bytes, same bundle contents, same verdict
bytes, on any machine, at any later time.

## 1. Three-valued results

Every claim evaluates to `TRUE`, `FALSE`, or `UNDETERMINED`.

`UNDETERMINED` is the required answer wherever the evidence does not
decide. A conforming Player MUST NOT collapse it into `FALSE` or `TRUE`.
Composition uses strong Kleene connectives (the grammar in section 5
requires `all` and `any` to be non-empty, so the empty case never
arises):

    all: FALSE if any operand is FALSE; else UNDETERMINED if any is
         UNDETERMINED; else TRUE.
    any: TRUE if any operand is TRUE; else UNDETERMINED if any is
         UNDETERMINED; else FALSE.
    not: swaps TRUE and FALSE; UNDETERMINED is unchanged.

Evaluation is a FULL WALK: every sub-claim is evaluated and recorded even
when an outcome is already forced, so the verdict is a complete trace.

## 2. The rule file

A rule is a JSON object with exactly these top-level fields:

| field      | required | value |
|---|---|---|
| `rule`     | yes | `"bitgraph-player/1"`, or `"bitgraph-player/2"` (section 9) |
| `id`       | yes | non-empty string naming the rule |
| `cast`     | yes | object of at least one role (section 3) |
| `world`    | yes | the string `"closed"` (the only defined value) |
| `requires` | yes | `{ "ordering": "hash-linked" \| "assumption-dependent" }` |
| `trustedKeys` | no | format 2 only (section 9.1) |
| `claim`    | yes | a claim (section 5) |
| `then`     | no  | `{ "label": <non-empty string> }` |

Unknown fields anywhere in the file are errors. `requires.ordering` has
no default: a rule that does not declare its trust floor does not parse.
`then` is a label and nothing else; no field of a rule is capable of
causing an action. Player decides; it does not enforce.

Role names match `[A-Za-z0-9_.-]+` and MUST contain at least one
non-digit character: pure-integer names do not survive JSON object key
ordering identically across languages, and the verdict depends on
declaration order. Claim nesting is bounded at depth 32; deeper rules do
not parse. A claim MAY reference a role the cast does not declare; that
is not a parse error and evaluates per section 5.

## 3. Cast

The cast is the trust boundary. Everything in it is DECLARED — taken on
the rule author's word and surfaced in the verdict — never derived.

Each role is an object:

| field      | required | meaning |
|---|---|---|
| `digest`   | yes | SHA-256 of the bits, as `sha256:<hex>`, bare hex, base64, or base64url; all normalize to one canonical form. Base64 forms MUST be canonical spellings (round-trip byte-exactly); spellings with nonzero trailing padding bits are parse errors, never silently reinterpreted |
| `means`    | no  | what the digest means as a business object; echoed, never interpreted |
| `at`       | no  | occurrence pin: `{ "proofHash": s }` or `{ "epochId": s, "counter": decimal-string }` |
| `signedBy` | no  | external identity evidence; echoed verbatim, `verifiedHere: false`. SIGNED_BY is not a BitGraph primitive |
| `optional` | no  | boolean, default false |

### 3.1 Resolution

A digest identifies bits; a recording identifies an occurrence of those
bits at a causal position. A role resolves against the bundle's verified
recordings of its digest — proofs whose canonical verification PASSED:
audit status `"verified"` (the full-tier pass, artifact bytes present and
matching) or `"artifact-unavailable"` (the integrity-tier pass, verified
bytes-free; the digest is inside the signed body either way). Recordings
whose verification failed are not evidence. Digest matching is by decoded
BYTES, not string equality: a bundle proof may spell its digest in any
accepted form, and "only broken recordings exist" must not masquerade as
"no recordings exist".

| verified matches | pin | resolution |
|---|---|---|
| exactly 1 | — | resolved |
| 0, and matches exist unverified | — | invalid (evaluates UNDETERMINED): "only broken recordings" does not support an absence claim |
| 0, none at all, `optional: true` | — | definitely absent (a fact under the closed world) |
| 0, none at all, required | — | absent-required (evaluates UNDETERMINED) |
| 2 or more | none | ambiguous (evaluates UNDETERMINED; never a silent pick) |
| 2 or more | selects exactly 1 | resolved |
| any | selects 0 | invalid (evaluates UNDETERMINED) |
| any | selects 2+ | ambiguous |

## 4. Ordering

An artifact's causal position is its COMMIT position. The slot is
evidence about creation, never an alternative position.

Commit counters obey the canonical strict-decimal grammar `[0-9]+` (no
sign, no whitespace, no base prefix, non-empty). Any other counter string
is NO counter evidence, exactly as the audit pipeline treats it — never
parsed leniently, never a crash.

Given two resolved recordings A and B, precedence is decided by the first
applicable row and no other source:

| situation | answer | basis | tier |
|---|---|---|---|
| same recording | not-before (contributes FALSE to `before`) | — | — |
| either recording holds no causal position (unchained) | unordered | — | — |
| same partition (signer key, epochId, chainId), a DIRECTED prevB64 path through observed proofs connects the two, in both directions (cycle) | unordered (anomaly) | — | — |
| same partition, a directed prevB64 path connects the two, and both counters parse with an order CONTRADICTING the path | unordered (anomaly) | — | — |
| same partition, a directed prevB64 path connects the two | the path decides the direction (ancestor precedes descendant) | `chain-link` | hash-linked |
| same partition, no path, both counters parse, distinct | strict order of commit counters as integers | `counter-order` | assumption-dependent |
| same partition, no path, counters missing/unparseable or equal | unordered | — | — |
| different partitions, same epochId string | unordered (a self-declared epochId is not epoch membership) | — | — |
| different epochs, a chain of hard epochLink edges COVERS the pair (section 4.2) | A before B along the chain | `epoch-lineage` | hash-linked, or assumption-dependent when predecessor-side coverage rests on counters |
| different epochs, lineage coverage holds in both directions | unordered (contradictory) | — | — |
| different epochs, a not-after anchor bound on A's segment strictly precedes a not-before anchor bound on B's segment, and NOT also the reverse | A before B | `anchor-bounds` | assumption-dependent |
| different epochs, strict anchor separation in both directions | unordered (contradictory) | — | — |
| otherwise | unordered | — | — |

Undirected co-membership in a prevB64 component is NOT chain-link
evidence: two fork branches share a component with no path between them,
and their relative order rests only on counter discipline — which the
fork itself demonstrates is broken.

Strict anchor precedence means strictly smaller block number (or, when a
block number is absent, strictly smaller verified witness timestamp).
Equality proves nothing: A precedes the anchor COMMIT that consumed block
N while B follows the MINING of block N, and the gap between mining and
commit is exactly where they could swap. The not-after side always rests
on the anchor-freshness assumption, which is why every `anchor-bounds`
answer is assumption-dependent. A `weaker` flag is carried when the
evidence additionally rests on counter-order rather than a chain-link
path (on either side of an anchor comparison, or for `counter-order`
itself).

### 4.2 Lineage coverage

A hard epochLink edge proves one thing: the successor epoch's key was
created (at init) after the referenced predecessor proof existed. It is
applied at recording granularity, never as whole-epoch ordering by
epochId string — epochId is self-declared, and recordings the evidence
does not cover get nothing from it.

A chain of hard edges proves A-before-B when:

  - the first edge's observed predecessor proof P is in A's partition,
    and A is P itself or a directed prevB64 ancestor of P (hash-linked),
    or A's parseable counter is strictly smaller than P's (downgrades the
    whole answer to the assumption-dependent tier);
  - each subsequent edge's observed predecessor proof is in the partition
    the previous edge's via proof belongs to (free of assumptions: a
    proof signed by that key postdates the key's creation);
  - the last edge's via proof is in B's partition (B is covered by key:
    it cannot predate its own key's creation).

### 4.1 The evidence floor

`requires.ordering` is a floor on the tier of ordering evidence the rule
accepts. An ordering answer whose tier is below the floor makes the
predicate `UNDETERMINED` — in BOTH directions. The floor gates evidence,
not polarity: distrusted evidence may neither prove nor refute.

## 5. Claims

| claim | semantics |
|---|---|
| `{ "exists": r }` | TRUE if r resolved; FALSE if r definitely absent; else UNDETERMINED |
| `{ "before": [x, y] }` | TRUE/FALSE from precedence of x's and y's recordings, gated by the floor; FALSE when either is definitely absent; UNDETERMINED when either is undeclared, absent-required, ambiguous, invalid, or the pair is unordered |
| `{ "after": [x, y] }` | exactly `before(y, x)` |
| `{ "between": [s, a, b] }` | `all(after(s, a), before(s, b))`, recorded as its two halves |
| `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": c }` | strong Kleene (section 1) |

The closed world is scoped to the cast: definite absence exists only for
declared optional roles whose digest has no verified recording in the
bundle. Positive claims over a definitely absent role are FALSE, which is
what makes negatives over it hold. A role the cast never declared is
UNDETERMINED wherever it appears; the closed-world declaration cannot
speak about bits the author never named.

## 6. The verdict

A verdict is a JSON object with fields in exactly this order:

    verdict            "bitgraph-player-verdict/1"
    result             TRUE | FALSE | UNDETERMINED
    rule               { id, sha256 }   (sha256: lowercase hex of the rule file bytes)
    then?              echoed from the rule
    weakestEvidence?   weakest tier among ordering answers that decided a
                       step ("assumption-dependent" if any, else
                       "hash-linked"); absent when no ordering decided
                       anything
    cast               per role, in declaration order: digestB64,
                       resolution label, and when resolved: proofHash,
                       epochId?, chainId, counter?, slotCounter?
    derived            every evaluated step, in evaluation order — what
                       BitGraph established
    declared           what was taken on somebody's word — every `means`,
                       every `at` pin, every `signedBy`, each with
                       verifiedHere: false, and LAST the closed-world
                       entry: { assertion: "closed-world", verifiedHere:
                       false, castSize, recordingsInBundle, claim }
    evaluator          { name, version }
    network            "none"

The closed-world entry is mandatory. Nothing in BitGraph establishes that
a declared cast is complete; without this entry a verdict would pass
"there is no X before Y" off as established when what was established is
"among the recordings the author declared, no X precedes Y".

## 7. Determinism

Serialization: UTF-8 JSON, two-space indent, key order as constructed
per section 6, one trailing newline. A verdict MUST NOT contain a run
timestamp, a filesystem path, a hostname, or any other machine- or
run-local value. Two evaluations of the same rule bytes over the same
bundle contents MUST be byte-identical.

## 8. Exit codes (command-line Players)

    0 TRUE     1 FALSE     2 UNDETERMINED     3 error

Diagnostics go to stderr. Stdout carries verdict bytes only.

These requirements govern evaluation invocations. A command-line Player
MAY offer authoring conveniences (such as rule scaffolding) and reading
conveniences (such as a bundle check that reports, in the three values,
what a bundle establishes about the recordings it holds) as distinct
subcommands; those are outside this specification and MUST NOT change
the behavior of evaluation invocations. The reference implementation's
`check` subcommand uses the same exit-code mapping as evaluation.

## 9. Format 2: trustedKeys and signedBy

Format 2 (`"rule": "bitgraph-player/2"`) is format 1 plus signature
claims. Everything in sections 1 through 8 applies unchanged. Two
additions:

### 9.1 trustedKeys

An optional top-level object naming keys the rule author trusts:

    "trustedKeys": { "<name>": { "alg": "ed25519" | "es256",
                                 "publicKey": "<base64>" } }

Key names obey the role-name grammar (at least one non-digit). For
`ed25519` the publicKey is the raw 32-byte key in standard base64 — the
spelling bitgraph/1 proofs use for signer keys. For `es256` (ECDSA P-256
over SHA-256) it is SPKI DER in base64.

The name-to-key binding is DECLARED trust: the verdict surfaces every
entry in `declared` as `{ assertion: "trusted-key", verifiedHere: false }`.
Player verifies signature MATH against the key material; that the key
belongs to the named party is the rule author's assertion, exactly like a
cast digest's `means`. SIGNED_BY remains not a BitGraph primitive:
format 2 does not change what the chain knows, only what a rule can
verify about supplied evidence.

### 9.2 The bitgraph-sig/1 evidence file

A signature file is a JSON object:

    { "sig": "bitgraph-sig/1", "over": <digest>, "alg": <alg>,
      "publicKey": <base64>, "signature": <base64> }

`over` accepts the digest spellings of section 3. The signed message is
the UTF-8 bytes of:

    "bitgraph-sig/1\n" + lowercase hex SHA-256 of the target bytes

Domain separation is deliberate: a signature made in any other protocol
over the same digest is not a bitgraph-sig. For `ed25519` the signature
is the raw 64-byte form, base64; for `es256` it is DER-encoded ECDSA,
base64, verified over SHA-256 of the message.

### 9.3 The signedBy claim

    { "signedBy": [<roleName>, <trustedKeyName>] }

Valid only in format 2. The key name MUST be declared in trustedKeys;
an unresolvable reference is a parse error. Semantics:

| situation | result |
|---|---|
| role not declared in the cast | UNDETERMINED |
| trusted key material not decodable | UNDETERMINED |
| a supplied evidence file parses as bitgraph-sig/1, its `over` decodes to the role's digest bytes, its alg and publicKey equal the trusted key's, and the signature verifies | TRUE |
| otherwise | UNDETERMINED |

**signedBy is TRUE or UNDETERMINED, never FALSE.** "This key never
signed these bytes" is a negative over an open world: signatures can
exist outside any bundle, so absence of one proves nothing, and
`not(signedBy(...))` is therefore permanently UNDETERMINED under the
section 1 tables. A malformed or non-verifying signature file is not
evidence and not an error.

The claim is about BITS, not occurrences: it evaluates against the
declared role digest whether or not the role resolved to a recording.
Signature claims carry no ordering tier and never contribute to
`weakestEvidence`; a signature file's own causal position, when it has
been recorded, is claimed with the ordinary ordering predicates over a
role declaring the signature file's digest.

### 9.4 Evidence supply

Evaluation is a pure function; candidate signature bytes are an input.
A command-line Player evaluating a bundle MUST take as candidates every
bundle artifact that is matched to an observed proof and no larger than
1,048,576 bytes, keyed by content hash; embedders MAY supply additional
candidates. Candidates are scanned in ascending content-hash order and
the first verifying file decides, so the verdict is deterministic for a
given evidence set. A format 2 verdict is `bitgraph-player-verdict/2`;
the serialization discipline of section 7 is unchanged.
