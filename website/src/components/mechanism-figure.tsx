// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The mechanism, for the sales pages (2026-10-27): a digest goes into the enclave, which in one atomic action takes count N
 * for a fresh hardware nonce and count N+1 for the digest, signed together; out comes an attested proof. Its own small
 * layout (.mf in globals.css): one row when every title fits on a line, one column below 1150px, never in between.
 */
function Box({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mf-box">
      <div className="mf-title">{title}</div>
      <div className="mf-sub">{sub}</div>
    </div>
  );
}
const Arrow = () => <span className="mf-arrow" aria-hidden="true" />;

export function MechanismFigure() {
  return (
    <figure className="mf" aria-label="The data's SHA-256 goes into a measured AWS Nitro enclave. In one atomic action, count N takes a fresh nonce from the hardware's random number generator and count N+1 binds the digest right after it, both signed together. The result is an attested proof anyone can check offline.">
      <Box title="SHA-256" sub="Of any data" />
      <Arrow />
      <div className="mf-enclave">
        <div className="mf-label">Measured AWS Nitro enclave</div>
        <div className="mf-inner">
          <Box title="Count N: nonce" sub="Fresh from the hardware RNG" />
          <Arrow />
          <Box title="Count N+1: digest" sub="Bound right after, signed together" />
        </div>
        <div className="mf-note">One atomic action. If any step fails, nothing is released and the counter does not move.</div>
      </div>
      <Arrow />
      <Box title="Attested proof" sub="Checks offline, by anyone" />
    </figure>
  );
}
