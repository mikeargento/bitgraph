import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What BitGraph collects (fingerprints, not files), what it does not collect, who processes it, and how long it is kept.",
  alternates: { canonical: "https://bitgraph.ing/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <article className="prose">
        <h1>Privacy Policy</h1>
        <p className="meta">Effective date: August 27, 2026</p>

        <h2>1. What we collect</h2>
        <ul>
          <li>Your email address and what you send us, when you contact us or have a commercial agreement with us.</li>
          <li>Billing details, when a paid agreement exists, handled by our payment processor. We do not store card numbers.</li>
          <li>Service logs: timestamps, request data, and IP addresses, used for security, rate limiting, abuse prevention, and diagnosing failures.</li>
          <li>Protocol records: the SHA-256 fingerprint of each file, its size, and the slot and proof metadata the recording environment needs to sign a proof. These come back to you in the proof. BitGraph keeps the Ethereum anchors; proofs made since 8 September 2026 are not stored or indexed by us.</li>
        </ul>

        <h2>2. What we do not collect</h2>
        <p>
          File contents are not part of recording. Files are fingerprinted on
          your machine, and what travels is the fingerprint,
          the file&apos;s size, the slot record and the recipe bytes a proof
          needs. Software that builds the new file for you, such as the MCP
          server, also sends the file&apos;s first bytes, to choose a placement,
          and its name, to name the new file; neither is written into a
          proof. A SHA-256 fingerprint does not
          contain the file and cannot by itself be used to reconstruct
          arbitrary file contents.
        </p>

        <h2>3. How we use it</h2>
        <p>
          To operate, secure, and maintain the service, to diagnose failures,
          to administer billing, to prevent fraud and abuse, to
          enforce our terms, to respond when you contact us, and to comply
          with applicable law. We do not sell personal data, and we do not
          use service data for advertising.
        </p>

        <h2>4. Third parties</h2>
        <ul>
          <li>Amazon Web Services, for infrastructure, in a US region.</li>
          <li>Railway, for the anchoring service.</li>
          <li>Cloudflare, for network routing to the recording environment.</li>
          <li>Vercel, for hosting this site.</li>
          <li>Resend, for delivering contact form messages.</li>
          <li>Google Workspace, for email.</li>
          <li>Adobe Fonts, for the site&apos;s typeface, loaded by your browser.</li>
          <li>A payment processor, for billing under paid agreements.</li>
        </ul>
        <p>
          This site runs no analytics scripts and sets no non-essential
          cookies.
        </p>

        <h2>5. Retention</h2>
        <p>
          Ordinary service data (email, billing, support messages, and logs)
          is kept only as long as the purposes above need it. Ethereum
          anchors are retained indefinitely: they are the public floor every
          later position is measured against. BitGraph also keeps a public copy of each proof it makes, which holds a fingerprint of the file but never its contents, so the site can list proofs and look them up. Copies already kept are under a ten-year retention lock.
        </p>

        <h2>6. Your rights</h2>
        <p>
          Depending on where you live, applicable law may give you rights to
          access, correct, or delete personal information we hold about you.
          Send requests to{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a> and we will
          handle them as applicable law requires. These requests can reach
          ordinary service data. Copies of proofs, and the fingerprints in them, are under a ten-year retention lock and cannot be removed, including by us.
        </p>

        <h2>7. Children</h2>
        <p>
          The service is not directed at anyone under 13, or under 16 where
          local law sets that age. We do not knowingly collect data from
          children.
        </p>

        <h2>8. Changes and contact</h2>
        <p>
          If this policy changes materially we will give prominent notice on
          this site, and notice by email where we have an address for you.
          Questions:{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>.
        </p>

      </article>
    </div>
  );
}
