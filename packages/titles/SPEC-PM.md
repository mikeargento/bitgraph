# Possession Messages specification, bitgraph-pm/1

This document is the normative semantics of `bitgraph-pm/1` possession
messages, `bitgraph-pm-marker/1` consumption markers, and the custody
threads built from them. The TypeScript package in this directory is the
reference implementation.

BitGraph records. Titles convey. Player evaluates.

A possession message is a small file that states a claim about another
file, proves its author held that file, is signed by a key, and — once
recorded — occupies a position in the BitGraph causal order. It is
sealed by default and readable only when presented.

## 1. What a message establishes, and what it never does

A message establishes that these words, about these exact bytes, were
written by someone holding them, under this key, and — through its
recording — at this position. It never establishes that its statement is
true, who the person behind the key is, or who holds anything now. It
proves SAID, HELD, and PLACED. Truth stays with people. Events, never
states: the format can express that a holding was demonstrated at a
position, and can never express who holds something at this moment.

The title that threads of messages carry is EVIDENTIARY, never legal:
what force a thread has comes from whoever recognizes it. And a title is
to the THREAD, never to the bytes: the subject stays freely copyable,
exactly as before.

## 2. The four properties

| property | grounded in |
|---|---|
| HELD | the possession hash: derivable only from the subject's full bytes |
| SIGNED | the key's signature over the canonical message bytes |
| PLACED | the message file's own BitGraph recording |
| SEALED | only digests touch the chain; the mandatory salt makes a sealed message unconfirmable by guessing its contents |

## 3. The message file

A message is a JSON object with fields in exactly this order, absent
optionals omitted entirely, two-space indent, one trailing newline:

    pm           "bitgraph-pm/1"
    about        "sha256:<64 lowercase hex>" — digest of the subject bytes
    re?          "sha256:<hex>" — digest of the predecessor MESSAGE FILE
    to?          { "alg": "ed25519" | "es256", "publicKey": <base64> }
    body?        free text, any length; the human layer, never evaluated
    salt         32 lowercase hex characters (128 bits), MANDATORY
    possession   lowercase hex SHA-256, MANDATORY (section 4)
    alg          "ed25519" | "es256"
    publicKey    the signer's key (ed25519: raw 32 bytes, standard
                 base64; es256: SPKI DER, base64)
    signature    base64, over the canonical bytes of this object with
                 `signature` absent

(`claim` sits third, after `about`; see section 5 for the values.)

Unknown fields are errors. The signature covers the canonical
serialization of the object without its `signature` field; the
discriminator inside the signed content is the domain separation.

The salt does two jobs and is therefore mandatory: identical statements
made twice are distinct files (dedup must never collapse two
acknowledgments into one), and a sealed message's digest is unguessable,
so nobody can confirm a suspected message against the public chain
without holding its bytes.

## 4. The possession hash

    possession = SHA-256( "bitgraph-pm-possession/1\n" + subject bytes )

Only a holder of every subject byte can compute it. It is deliberately
NOT the subject's plain digest: plain digests of recorded works are
public on the ledger, and anything gate-shaped derived from one would
let a digest-scraper pose as a holder. Authoring requires holding.

Verification is three-valued by nature: verified with the subject bytes
in hand, unverifiable without them (not a failure), refuted when
supplied bytes contradict the hash.

## 5. Claims

    held           the base claim: the signer held the subject. The
                   origin of every thread. MUST NOT carry `re`.
    give           offers the subject onward. MUST name the recipient
                   key in `to`; `to` is meaningful nowhere else.
    take           accepts a give. MUST carry `re` naming the give.
    controls-key   key identity and continuity statements.
    supersedes     the subject replaces the file named by `re`.

Every claim is `held` plus a word: all carry the possession hash.

## 6. Threads

A custody thread is: one `held` origin, then give/take pairs. Two gates
guard every extension, and neither is secrecy:

  - a `give` MUST be signed by the current holder key — the origin
    signer until a take, then the most recent taker;
  - the following `take` MUST be signed by exactly the key the give
    named, and MUST reply (`re`) to that give's file digest.

Showing a thread is therefore safe: possession of its bytes never
confers the ability to extend it. Extension always requires the current
holder's signature. The salted digest of the head is a privacy curtain
and the capability to reply; the signature chain is the wall.

A PRESENTED thread must be linear: two replies to one predecessor in a
single presentation are a structural error. Competing threads are
separate presentations racing at the adjudication layer, where the
earliest-positioned reply wins — decided by causal positions over a
proof bundle, deterministically, on anyone's machine.

## 7. The three answers of a title check

    the KEY story     thread structure and signatures — the reference
                      checker, pure and offline (thread.ts)
    the CHAIN story   every file recorded, in the claimed order — a
                      generated bitgraph-player/1 rule (the title
                      ABSTRACT), evaluable by any conforming Player,
                      offline, byte-reproducible
    CURRENCY          "is the head unconsumed as of now" — a live
                      dedup-oracle lookup of the head's consumption
                      marker (the title SEARCH)

No answer claims another's ground. In particular the abstract never
claims currency: a bundle cannot prove chain-absence, and "no successor
exists anywhere" is a negative over an open world. "These exact marker
bytes have no recording" is the one absence the chain itself can answer,
because the chain is a closed world about its own contents — and that
answer is as-of-the-latest-anchor, like every title search in history.

## 8. Consumption markers

    { "marker": "bitgraph-pm-marker/1", "of": "sha256:<hex of a
      message file>" }

two-space indent, trailing newline. Deterministic and UNSALTED by
design: every holder of that message derives the same bytes, so
recording the marker collides via dedup for everyone after the first.
Only holders can derive it (a message's digest is salted and
unguessable), so markers leak nothing to strangers.

WHICH marker consumes a handoff: the marker of the HEAD BEING HANDED
OFF — the file the give's `re` names — never the marker of the give
itself. At take time the taker derives that marker and records it via
an ordinary drop. Any later party offered a competing give replying to
the same head derives exactly the same marker from that give's `re` and
performs the currency lookup of section 7: a fresh recording means the
head was unclaimed as of the latest anchor; an existing proof means
someone already consumed it. (A marker of the give itself would protect
nothing: only the give's own named recipient could ever collide with
it.)

Markers are DISCOVERY, never VALIDITY. A recorded marker with no valid
take behind it is a pulled fire alarm: flag and investigate, never
invalidate. Validity is signatures.

## 9. Versions: bitgraph-versions/1

A recording is public and unownable; a version is the holdable object
of the same work. The record is everyone's; the version is yours.

    version      "bitgraph-versions/1"
    of           "sha256:<64 lowercase hex>" — the work's digest
    body?        free text; sealed inside the version
    salt         32 lowercase hex characters (128 bits), MANDATORY
    possession   the possession hash of the work's bytes (section 4),
                 MANDATORY: minting requires holding. No file, no version.

Same canonical-serialization discipline as messages, byte-exactly
enforced at parse: a version's identity IS its file digest, and a
re-spelled variant would fracture one version into many.

A version is a BEARER object: no signature, no key. The salt makes its
bytes one of a kind and a sealed version unconfirmable by guessing; its
recording gives it one first recording at one position, forever. The
entropy changes direction here: a recording's uniqueness comes from the
enclave's randomness receiving your bytes; a version's comes from the
minter's randomness, which the chain then places.

`of` is a one-way edge. The work is untouched, its recording unchanged,
and the chain never learns versions exist. A version's recording
provably postdates the work's (an ordinary ordering claim), and causal
order numbers a work's versions with no numbering field: the earliest
is first as a matter of public record.

A version proves held and placed. It never proves that its body is
true, who minted it, or who holds it now. When a version must provably
change hands, it is a file like any other: the possession-message
conveyance layer above carries it.

## 10. What this package never does

It never records anything: giving a file a position happens through the
ordinary BitGraph surfaces, and authoring and placing are separate acts.
It never touches the network. No field of any format can cause an
action. And nothing in this specification touches, triggers, or
verifies the movement of money.
