// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The mechanism, for the sales pages (2026-10-27): a digest goes into the enclave, which in one atomic action takes count N
 * for a fresh hardware nonce and count N+1 for the digest, signed together; out comes an attested proof. Its own small
 * layout (.mf in globals.css): one row across the page where there is room, read left to right, and otherwise one
 * column, read top to bottom. The two counts stand side by side inside the enclave, each under its count in large type.
 */
function Box({ title, sub, count }: { title: string; sub: React.ReactNode; count?: string }) {
  return (
    <div className={count ? "mf-box has-count" : "mf-box"}>
      {count ? <div className="mf-count"><span className="mf-count-word">Count</span> <span className="mf-count-n">{count}</span></div> : null}
      <div className="mf-title">{title}</div>
      <div className="mf-sub">{sub}</div>
    </div>
  );
}
const Arrow = () => <span className="mf-arrow" aria-hidden="true" />;

export function MechanismFigure() {
  return (
    <div className="mf-wrap">
      <figure className="mf" aria-label="The data's SHA-256 goes into a measured AWS Nitro enclave. In one atomic action, count N takes a fresh nonce from the hardware's random number generator and count N+1 binds the digest right after it, both signed together. The result is an attested proof anyone can check offline.">
        <Box title="SHA-256" sub="Of any data" />
        <Arrow />
        <div className="mf-enclave">
          <div className="mf-label">Measured AWS Nitro enclave</div>
          <div className="mf-inner">
            <Box count="N" title="Nonce" sub={<><span className="mf-keep">Fresh from</span><br /><span className="mf-keep">the hardware RNG</span></>} />
            <Arrow />
            <Box count="N+1" title="Digest" sub={<><span className="mf-keep">Bound right after,</span><br /><span className="mf-keep">signed together</span></>} />
          </div>
          <div className="mf-note">One atomic action. If any step fails, nothing is released and the counter does not move.</div>
        </div>
        <Arrow />
        <Box title="Attested proof" sub="Checks offline, by anyone" />
      </figure>
    </div>
  );
}
