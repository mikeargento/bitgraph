// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The mechanism (2026-11-25). A digest of any data enters a measured enclave, which in one atomic action signs a
 * position record at count N (a fresh hardware nonce, no digest) and a commit at count N+1 (the digest, the same nonce,
 * the position record's hash, the previous proof's hash); an attestation covers the commit's signed body; only then
 * does the counter move, by two. The digest's line runs into the commit, the only record that holds it. Under the
 * drawing, what each part shows. Styles: .mf3 in app/site.css.
 */
function Box({ tone, title, lines, sig }: { tone: "green" | "purple" | "plain"; title: string; lines: string[]; sig?: string }) {
  return (
    <div className={`mf3-box is-${tone}`}>
      <div className="mf3-title">{title}</div>
      <div className="mf3-lines">{lines.map((l) => <div key={l}>{l}</div>)}</div>
      {sig ? <div className="mf3-sig">{sig}</div> : null}
    </div>
  );
}

export function MechanismFigure() {
  return (
    <figure
      className="mf3 not-prose"
      aria-label="The SHA-256 of any data goes into a measured AWS Nitro enclave, one request at a time. At count N the enclave signs a position record: a fresh nonce from the hardware's random number generator, the count, the epoch and the key, and no digest. At count N+1 it signs a commit: the digest, the same nonce, the hash of the position record and the hash of the previous proof. A Nitro attestation covers the SHA-256 of the commit's signed body. If any step fails, nothing is released and the counter does not move; otherwise it moves by exactly two. The result is an attested proof anyone can check offline. The math shows the position record came first, because the commit holds its hash; the attestation shows the measured code drew the nonce, blind to the digest."
    >
      <div className="mf3-top">
        <Box tone="plain" title="SHA-256 of any data" lines={["The file stays with you"]} />
      </div>
      <div className="mf3-feed" aria-hidden="true"><span /><span /></div>

      <div className="mf3-enclave">
        <div className="mf3-head">
          <div className="mf3-head-title">Measured AWS Nitro enclave</div>
          <div className="mf3-head-sub">One atomic action, one request at a time</div>
        </div>
        <div className="mf3-drop" aria-hidden="true" />
        <Box tone="green" title="Count N: position record" lines={["Nonce from the hardware RNG", "Count, epoch, key", "No digest"]} sig="Signature 1" />
        <div className="mf3-across" aria-hidden="true" />
        <Box tone="purple" title="Count N+1: commit" lines={["Digest and the same nonce", "Hash of the position record", "Hash of the previous proof"]} sig="Signature 2" />
        <div className="mf3-down-right" aria-hidden="true" />
        <div className="mf3-wide">
          <Box tone="plain" title="Nitro attestation" lines={["Covers the SHA-256 of the commit’s signed body"]} />
        </div>
        <div className="mf3-note">
          If any step fails, nothing is released and the counter does not move. Otherwise it moves by exactly&nbsp;two.
        </div>
      </div>

      <div className="mf3-down" aria-hidden="true" />
      <div className="mf3-top">
        <Box tone="plain" title="Attested proof" lines={["Checks offline, by anyone"]} />
      </div>

      <div className="mf3-proves">
        <Box tone="green" title="Math proves" lines={["The position record came first: the commit holds its hash"]} />
        <Box tone="purple" title="Attestation proves" lines={["The measured code drew the nonce, blind to the digest"]} />
      </div>
    </figure>
  );
}
