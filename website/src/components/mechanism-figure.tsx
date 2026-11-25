// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The mechanism, for the Technology page (2026-11-25): a digest goes into the enclave, which in one atomic action signs a
 * position record at count N (a fresh hardware nonce, no digest) and a commit at count N+1 (the digest, the same nonce, the
 * position record's hash, the previous proof's hash), attests the commit's signed body, and only then advances by two.
 * Under it, what each part shows. Layout is the .mf figure in globals.css; the record lines, the attestation and the two
 * statements underneath are .mf2-* rules at the end of that file.
 */
function Box({ title, sub, count, lines, sig }: { title: string; sub?: React.ReactNode; count?: string; lines?: string[]; sig?: string }) {
  return (
    <div className={count ? "mf-box has-count" : "mf-box"}>
      {count ? <div className="mf-count"><span className="mf-count-word">Count</span> <span className="mf-count-n">{count}</span></div> : null}
      <div className="mf-title">{title}</div>
      {sub ? <div className="mf-sub">{sub}</div> : null}
      {lines ? <div className="mf2-lines">{lines.map((l) => <div key={l} className="mf2-line">{l}</div>)}</div> : null}
      {sig ? <div className="mf2-sig">{sig}</div> : null}
    </div>
  );
}
const Arrow = () => <span className="mf-arrow" aria-hidden="true" />;

export function MechanismFigure() {
  return (
    <div className="mf-wrap">
      <figure className="mf" aria-label="The data's SHA-256 goes into a measured AWS Nitro enclave, one request at a time. At count N the enclave signs a position record: a fresh nonce from the hardware's random number generator, the count, the epoch and the key, and no digest. At count N+1 it signs a commit: the digest, the same nonce, the hash of the position record and the hash of the previous proof. A Nitro attestation covers the SHA-256 of the commit's signed body. If any step fails, nothing is released and the counter does not move; otherwise it moves by exactly two. The result is an attested proof anyone can check offline.">
        <Box title="SHA-256" sub={<><span className="mf-keep">Of any data.</span> <span className="mf-keep">The file stays with you</span></>} />
        <Arrow />
        <div className="mf-enclave">
          <div className="mf-label">Measured AWS Nitro enclave</div>
          <div className="mf-inner">
            <Box count="N" title="Position record" lines={["Nonce from the hardware RNG", "Count, epoch, key", "No digest"]} sig="Signature 1" />
            <Arrow />
            <Box count="N+1" title="Commit" lines={["Digest and the same nonce", "Hash of the position record", "Hash of the previous proof"]} sig="Signature 2" />
          </div>
          <div className="mf2-attest">
            <div className="mf2-attest-title">Nitro attestation</div>
            <div className="mf2-attest-sub">Covers the SHA-256 of the commit&rsquo;s signed body</div>
          </div>
          <div className="mf-note">One request at a time. If any step fails, nothing is released and the counter does not move. Otherwise it moves by exactly&nbsp;two.</div>
        </div>
        <Arrow />
        <Box title="Attested proof" sub={<><span className="mf-keep">Checks offline,</span> <span className="mf-keep">by anyone</span></>} />
      </figure>
      <div className="mf2-proves">
        <div className="mf2-prove">
          <div className="mf2-prove-title">Math proves</div>
          <div className="mf2-prove-sub">The position record came first: the commit holds its hash</div>
        </div>
        <div className="mf2-prove">
          <div className="mf2-prove-title">Attestation proves</div>
          <div className="mf2-prove-sub">The measured code drew the nonce, blind to the digest</div>
        </div>
      </div>
    </div>
  );
}
