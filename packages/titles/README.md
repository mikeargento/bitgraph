# BitGraph Titles

BitGraph records. Titles convey. Player evaluates.

A possession message is a small file that states a claim about another
file, proves its author held that file, is signed by a key, and — once
recorded — occupies a position in the BitGraph causal order. A custody
thread of possession messages is a title: who has held a thing, hand to
hand, on a record that never forgets. The title is to the thread, never
to the bytes: the work stays freely copyable, and standing is scarce
because the one thing that cannot be copied is the ability to sign.

A message proves said, held, and placed. It never proves that its
statement is true, who the person behind a key is, or who holds anything
now.

## The ritual

```
# once: a key (set BITGRAPH_KEY_PASSPHRASE to encrypt it)
bitgraph-title keygen --out alice.key.json

# open a title on a work you hold
bitgraph-title open gallery.zip --key alice.key.json --out origin.pm.json

# offer it onward: a give names the recipient key
bitgraph-title give gallery.zip --key alice.key.json \
  --re origin.pm.json --to <bobPublicKeyB64> --out give.pm.json

# the receiver reads, checks, and writes the take — the one act only a
# real receiver can perform
bitgraph-title take gallery.zip --key bob.key.json \
  --re give.pm.json --out take.pm.json
```

Recording the work, the messages, and the consumption marker — giving
them causal positions — happens through the ordinary BitGraph surfaces
(the drop, the Folder, the MCP). This tool is fully offline and never
records anything.

## The three answers of a title check

```
# the KEY story: structure and signatures, offline
bitgraph-title thread origin.pm.json give.pm.json take.pm.json --work gallery.zip

# the CHAIN story: generate the title abstract and evaluate it with any
# conforming Player over a proof bundle
bitgraph-title rule origin.pm.json give.pm.json take.pm.json \
  --floor assumption-dependent --out title.rule.json
bitgraph-play title.rule.json bundle/

# CURRENCY has two sides.
# At take time, the taker CONSUMES the handed-off head: derive the
# marker of the file the give's `re` names (the seller's presented
# head) and record it via an ordinary drop.
bitgraph-title marker origin.pm.json --out consumed.marker.json

# Later, anyone offered a conveyance checks the head it replies to the
# same way: derive that head's marker and drop it. Fresh means the
# head was unclaimed as of the latest anchor; a dedup hit means someone
# already consumed it. Markers are discovery, never validity.
bitgraph-title marker take.pm.json --out head.marker.json
```

## The vault

One file of sealed envelopes, opened by content: every message is
encrypted under a key derived from the subject's full bytes. No file,
no author — a leaked vault is a bag of unlinkable ciphertexts, and
handing someone the vault plus one work opens exactly that work's
messages.

```
bitgraph-title vault init --vault my.bgvault
bitgraph-title vault put  --vault my.bgvault --work gallery.zip origin.pm.json
bitgraph-title vault get  --vault my.bgvault --work gallery.zip
```

Back this file up, and back up the works themselves: a lost message is a
permanently mute digest, and a lost work seals its messages forever,
including to their author.

The normative format lives in [SPEC-PM.md](./SPEC-PM.md). MIT licensed,
like Player: the evaluator layer stays open.
