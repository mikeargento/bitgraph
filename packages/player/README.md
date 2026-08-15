# @mikeargento/bitgraph-player

Deterministic evaluation of causal rules over BitGraph proof bundles.

BitGraph records. Player evaluates.

A BitGraph proof bundle establishes facts: these bits were recorded at
these causal positions, anchored to a public timeline. Player
evaluates a rule over those facts and produces a verdict anyone can
reproduce from the bundle alone — no network, no clock, no account, no
trust in the machine that ran it first.

    evidence + rule = conclusion

## Install

    npm install @mikeargento/bitgraph-player

## Use

    bitgraph-play rule.json bundle/ > verdict.json

The bundle is a directory, `.tar`, or `.tar.gz` of BitGraph exports (the
folders the BitGraph Folder writes). Exit codes: `0` TRUE, `1` FALSE,
`2` UNDETERMINED, `3` error. `--out file` writes the verdict to a file;
`--summary` prints a bundle reconnaissance to stderr.

## Check a bundle

    bitgraph-play check "BitGraph (photo.jpg)/"
    bitgraph-play check proof.json photo.jpg --json

No rule needed. `check` reads an export (a folder or archive, or a
proof.json beside the file it records) and says, offline, what the bundle
establishes about each recording in it: that the file in hand hashes to
the recorded digest, that the Ed25519 signature and slot binding verify,
that the AWS Nitro attestation validates to the AWS root and binds this
exact proof, that the attested PCR0 is a published BitGraph enclave
measurement, and, from block headers in the bundle, which Ethereum blocks
the recording sits between. Every line is TRUE, FALSE, or UNDETERMINED:
FALSE only when evidence in hand contradicts the recording (an edited
signature, a block header that does not hash to its anchor), UNDETERMINED
when the evidence does not decide (the file is not in the bundle, a
witness is missing). Absence is never a verdict. The report ends with what
no offline check can establish, stated rather than implied. `--json`
prints the `bitgraph-check/1` report; exit codes match evaluation.

The same check runs in a browser: `verify.html`, built from this package,
ships with the BitGraph Folder and at bitgraph.ing/verify.html. Drop a
recording folder on it, offline, and it renders the same report from the
same code.

## Start a rule

    bitgraph-play init po.pdf delivery.jpg approval.pdf --out rule.json

`init` hashes the files you name and writes a rule skeleton with the
cast filled in: one role per file, digests computed, role names from
filenames. The skeleton does not run as written — `requires.ordering`
is a placeholder you must replace, because the trust floor is the
rule's own security policy and has no default, from the scaffolder or
anywhere else. Choose the floor, say what each digest means, refine the
claim, then run it.

`init` is a reserved first word as of 0.2.0. A rule file literally
named `init` is still reachable: write it as `./init`, or after `--`,
which ends option parsing (`bitgraph-play -- init bundle/`). When a
file named `init` exists in the working directory, the bare spelling is
refused as ambiguous rather than silently picking a mode.

## A rule

```json
{
  "rule": "bitgraph-player/1",
  "id": "po-release-payment",
  "cast": {
    "purchase_order": { "digest": "sha256:…", "means": "PO-4471" },
    "delivery":       { "digest": "sha256:…" },
    "approval":       { "digest": "sha256:…" },
    "cancellation":   { "digest": "sha256:…", "optional": true }
  },
  "world": "closed",
  "requires": { "ordering": "assumption-dependent" },
  "claim": { "all": [
    { "exists": "purchase_order" },
    { "after":  ["delivery", "purchase_order"] },
    { "after":  ["approval", "delivery"] },
    { "not": { "before": ["cancellation", "approval"] } }
  ]},
  "then": { "label": "release_payment" }
}
```

`cast` is everything taken on the rule author's word: which digest means
what, which occurrence is meant, who is said to have signed it. `claim`
is only what BitGraph derives. `then` is a label — no field of a rule can
cause an action. Player decides; whatever stakes money on a TRUE sits
above it.

## Three answers, not two

A claim evaluates to `TRUE`, `FALSE`, or `UNDETERMINED`. Undetermined is
the honest answer wherever the evidence does not decide: recordings whose
order the ledger does not establish, a digest recorded more than once
with no pin selecting the occurrence, evidence below the rule's declared
trust floor (`requires.ordering`). An evaluator that always answers is
wrong on some input.

The verdict splits `derived` (BitGraph established this) from `declared`
(a named party asserted this), and its last declared entry is always the
closed world itself — absence is asserted only among the roles the author
declared, and nothing establishes that the cast is complete.

## Determinism

Same rule bytes, same bundle contents, byte-identical verdict, on any
machine, years later. No timestamps, no paths, no randomness. The
normative semantics are in [SPEC.md](./SPEC.md); this package is the
reference implementation, and a conforming Player in any language must
agree with it.

## API

One call runs the whole pipeline — the CLI is built on the same
function, so embedding Player cannot drift from it:

```ts
import { play } from "@mikeargento/bitgraph-player";

const { verdict, bytes, exitCode } = await play("rule.json", "bundle/");
```

The pieces are exported individually for callers that already hold an
`AuditResult` or want to intercept a stage:

```ts
import { runAudit } from "@mikeargento/bitgraph-audit";
import {
  parseRule, resolveCast, evaluate, buildVerdict, serializeVerdict,
} from "@mikeargento/bitgraph-player";

const rule = parseRule(ruleText);
const audit = await runAudit(bundlePath);
const resolutions = resolveCast(rule.cast, audit);
const evaluation = evaluate(rule, resolutions, audit);
const verdict = buildVerdict(rule, ruleSha256Hex, resolutions, evaluation, audit);
process.stdout.write(serializeVerdict(verdict));
```

`check` is exported the same way, in two halves that the CLI and the
browser page share:

```ts
import { ingestBundle, ingestEntries } from "@mikeargento/bitgraph-audit";
import { checkIngest, renderCheckText } from "@mikeargento/bitgraph-player";

const report = await checkIngest(await ingestBundle("BitGraph (photo.jpg)/"));
// or, from bytes already in hand (a browser drop):
// await checkIngest(await ingestEntries([{ path: "proof.json", open: () => bytes }]));
process.stdout.write(renderCheckText(report));
```

## License

MIT. Verification and evaluation are permissionless by design.
