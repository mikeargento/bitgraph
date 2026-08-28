import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What BitGraph collects (fingerprints, not files), what it does not collect, who processes it, and how long it is kept.",
  alternates: { canonical: "https://bitgraph.ing/privacy" },
};

export default function PrivacyPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 40px" }}>
      <article className="prose-doc">
        <h1>Privacy Policy</h1>
        <p style={{ color: "#4b5563" }}>Effective date: August 27, 2026</p>

        <h2>1. What we collect</h2>
        <ul>
          <li>Your email address and what you send us, when you contact us, hold an account, or have a commercial agreement with us.</li>
          <li>Billing details, when a paid agreement exists, handled by our payment processor. We do not store card numbers.</li>
          <li>Service logs: timestamps, request data, and IP addresses, used for security, rate limiting, abuse prevention, and diagnosing failures.</li>
          <li>Protocol records: file fingerprints (SHA-256 digests), positions, signatures, anchors, and related proof metadata.</li>
        </ul>

        <h2>2. What we do not collect</h2>
        <p>
          File contents are not part of recording. Files are fingerprinted on
          your machine, and recording sends only the fingerprint and the
          protocol metadata a proof needs. A SHA-256 fingerprint does not
          contain the file and cannot by itself be used to reconstruct
          arbitrary file contents. We do not collect file names unless you
          supply one yourself.
        </p>

        <h2>3. How we use it</h2>
        <p>
          To operate, secure, and maintain the service, to diagnose failures,
          to administer accounts and billing, to prevent fraud and abuse, to
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
          is kept only as long as the purposes above need it. Protocol
          records may be retained indefinitely: they form part of
          BitGraph&apos;s append-only verification history, and later records
          are computed over the history that includes them.
        </p>

        <h2>6. Your rights</h2>
        <p>
          Depending on where you live, applicable law may give you rights to
          access, correct, or delete personal information we hold about you.
          Send requests to{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a> and we will
          handle them as applicable law requires. These requests can reach
          ordinary service data. Protocol records are append-only, so a
          fingerprint already committed to the chain may not be technically
          removable without altering the history that later records are
          computed over.
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
