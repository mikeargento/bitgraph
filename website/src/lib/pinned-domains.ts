// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The site's pinned BitGraph Domains.
 *
 * The proof page resolving an actor keyId to a name is THIS SITE acting
 * as ONE READER, with sources it chose: a domain's published key file
 * (bitgraph-domain/1 at https://<domain>/.well-known/bitgraph), pinned
 * here. Identity stays the reader's: this is never BitGraph establishing
 * who holds a key, and the card that renders a resolution says where it
 * came from ("pinned by this site") beside a link-able source.
 *
 * The pattern is KNOWN_ENCLAVE_MEASUREMENTS': derived constants,
 * committed, reviewed, and THE DEPLOY IS THE PIN. No runtime fetching,
 * no database: adding a pin is transcribing a domain's file into an
 * entry (copy the publicKey out of the file or out of any proof the key
 * has made), removing one is a commit. An unknown keyId resolves to
 * nothing and the card keeps "Not established here"; never an error.
 *
 * keyId = lowercase hex SHA-256 of the decoded publicKey bytes (the
 * enclave's own derivation for es256 SPKI DER). Verify when adding:
 *
 *   node -e 'const c=require("node:crypto");console.log(c.createHash(
 *     "sha256").update(Buffer.from(process.argv[1],"base64")).digest(
 *     "hex"))' "<publicKeyB64>"
 */

export interface PinnedDomain {
  /** The domain that published the key; the binding. */
  domain: string;
  /** The name the domain gives itself (its file's `party`). */
  party: string;
  /** The key's name inside the domain's file. */
  keyName: string;
  /** SPKI DER, base64: kept so the keyId above it stays re-derivable. */
  publicKeyB64: string;
}

/** keyId (lowercase hex) → the pinned domain that published it. */
export const PINNED_DOMAINS: Record<string, PinnedDomain> = {
  // bitgraph.ing/.well-known/bitgraph · pinned 2026-08-22 · first proof
  // under this key: counter 2554, epoch JSqfk3EYwePvGlW692mNFSQgWKhgCHBF….
  "9696c1a566050af0c180b0a74bc39504bc7193860bc084aa555d4a0a6544f8c0": {
    domain: "bitgraph.ing",
    party: "Mike Argento",
    keyName: "mike",
    publicKeyB64:
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhSHZ+7bOnBqPFWugwYxfsWz5Ash5VsDMXtOXEH8d/1SX+iRe+d5WhOM1euhZRgrGAcfcju+F8bAEy58uwhntlg==",
  },
};
