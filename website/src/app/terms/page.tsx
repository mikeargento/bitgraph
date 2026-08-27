import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using BitGraph, in plain language: what the service does, what it does not do, billing, your data, and your rights.",
  alternates: { canonical: "https://bitgraph.ing/terms" },
};

/* Legal pages share the docs column but are not docs sections: they are not in
   the docs nav and have no previous/next pair. Plain-language house style: no
   legalese where a plain sentence works, no marketing, no em dashes. */

export default function TermsPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 40px" }}>
      <article className="prose-doc">
        <h1>Terms of Service</h1>
        <p style={{ color: "#4b5563" }}>Effective date: August 27, 2026</p>

        <h2>1. Who we are</h2>
        <p>
          BitGraph is operated by Argento Computing Inc., a Delaware corporation.
          You can reach us at <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>.
          These terms are an agreement between you and Argento Computing Inc.
          Using the service means you accept them.
        </p>

        <h2>2. What the service does</h2>
        <p>
          A sealed environment mints a single-use position, then binds your
          file&apos;s SHA-256 fingerprint to it in one indivisible step. Positions
          form a forward-only chain that is periodically anchored to a public
          blockchain timeline. You receive a portable proof bundle (your file,
          the proof, and the anchors) that anyone can verify offline with
          open-source tooling, with no account and nothing to look up.
        </p>
        <p>
          Only fingerprints are recorded. Your files never leave your machine.
          BitGraph cannot see, store, or reconstruct file contents.
        </p>

        <h2>3. What the service does not do</h2>
        <p>
          BitGraph records the position of exact bytes in time. It does not
          verify, endorse, or make any claim about the truth, accuracy,
          legality, originality, or authorship of any file. A proof shows when
          bytes were recorded, not what they mean. If a file is misleading,
          wrong, or fabricated, a BitGraph proof does not make it otherwise,
          and you must not present a proof as if it does.
        </p>

        <h2>4. Accounts and API keys</h2>
        <p>
          An API key belongs to one person or one entity. Keep your key secret.
          Anything recorded with your key is your responsibility, whether you
          did it or someone you gave the key to did. Tell us promptly if you
          believe a key has been exposed and we will rotate it.
        </p>

        <h2>5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>use the service in connection with unlawful activity, including fingerprinting content for an unlawful purpose;</li>
          <li>abuse the service or interfere with other people&apos;s use of it;</li>
          <li>attempt to disrupt, overload, or tamper with the anchoring infrastructure;</li>
          <li>attempt to reverse engineer, probe, or extract material from the sealed environment;</li>
          <li>evade rate limits. Rate limits may apply and may change.</li>
        </ul>

        <h2>6. Fees and billing</h2>
        <p>
          Paid plans are a monthly subscription plus metered usage, billed
          through Stripe. Current prices are published on this site.
          Verification is free to everyone. We may change prices with 30 days
          notice; the new prices apply from your next billing period after the
          notice.
        </p>

        <h2>7. Your data</h2>
        <p>
          We store fingerprints, positions, and proofs. We never receive file
          contents, so we cannot store them. Proofs may be retained
          indefinitely: every proof is part of a chain that other users&apos;
          proofs depend on, and deleting one would break verification for
          people who had nothing to do with it.
        </p>

        <h2>8. Intellectual property</h2>
        <p>
          BitGraph, the service software, and the pending patents belong to
          Argento Computing Inc. BITGRAPH is a trademark of Argento Computing
          Inc. You own your files, and you own the proofs you create with the
          service. The open-source verification tooling is published under its
          own license; see{" "}
          <a href="https://www.npmjs.com/package/@mikeargento/bitgraph-verify">bitgraph-verify</a>{" "}
          and{" "}
          <a href="https://www.npmjs.com/package/@mikeargento/bitgraph-player">bitgraph-player</a>{" "}
          (MIT).
        </p>

        <h2>9. Service availability</h2>
        <p>
          We run the service on a best-effort basis. There is no uptime
          guarantee at this tier. We may suspend access for abuse or
          non-payment. Proofs you already hold verify offline regardless of
          whether the service is up.
        </p>

        <h2>10. Disclaimer of warranties</h2>
        <p>
          The service is provided as is and as available, without warranties of
          any kind, express or implied, including merchantability, fitness for
          a particular purpose, and non-infringement. We do not warrant that
          the service will be uninterrupted or error-free.
        </p>

        <h2>11. Limitation of liability</h2>
        <p>
          To the maximum extent the law allows, Argento Computing Inc. is not
          liable for indirect, incidental, special, consequential, or punitive
          damages, or for lost profits, data, or goodwill. Our total liability
          for all claims arising out of the service is capped at the fees you
          paid us in the 12 months before the claim arose.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          You will indemnify Argento Computing Inc. against third-party claims
          arising from your files, your use of the service in violation of
          these terms, or your violation of law, limited to reasonable costs
          and damages finally awarded or agreed in settlement.
        </p>

        <h2>13. Termination</h2>
        <p>
          Either of us can end this agreement on notice. On termination your
          access ends and unpaid fees remain due. Proofs you already hold
          remain verifiable offline after termination; nothing about ending an
          account un-records what was recorded.
        </p>

        <h2>14. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of the State of Delaware,
          excluding its conflict-of-law rules. Disputes will be resolved in the
          state and federal courts located in Delaware, and both parties
          consent to their jurisdiction.
        </p>

        <h2>15. Changes to these terms</h2>
        <p>
          We may update these terms. For material changes we will give notice
          on this site and by email to the address on your account before the
          changes take effect. Continuing to use the service after the
          effective date of a change means you accept it.
        </p>

        <h2>16. Contact</h2>
        <p>
          Argento Computing Inc. ·{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>
        </p>

      </article>
    </div>
  );
}
