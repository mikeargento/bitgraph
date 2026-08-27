import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What BitGraph collects (fingerprints, not files), what it never collects, who processes it, and how long it is kept.",
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
          <li>Your account email address.</li>
          <li>Billing details, handled by Stripe. We do not store card numbers.</li>
          <li>API key usage logs: timestamps, request counts, and IP addresses, kept for abuse prevention.</li>
          <li>File fingerprints (SHA-256 digests) and proof metadata: positions, signatures, and anchors.</li>
        </ul>

        <h2>2. What we do not collect</h2>
        <p>
          File contents, ever. Files are fingerprinted on your machine and only
          the fingerprint is sent. We do not collect file names unless you
          supply one yourself, and we collect nothing inside your files.
        </p>

        <h2>3. How we use it</h2>
        <p>
          To run the service, to bill you, to prevent abuse, and to respond
          when you contact support. Nothing else.
        </p>

        <h2>4. Third parties</h2>
        <ul>
          <li>Stripe, for billing.</li>
          <li>Amazon Web Services, for infrastructure, in a US region.</li>
          <li>Vercel, for hosting this site.</li>
          <li>Google Workspace, for email.</li>
        </ul>
        <p>
          No advertising, no selling of data. This site runs no analytics
          scripts and sets no non-essential cookies.
        </p>

        <h2>5. Retention</h2>
        <p>
          Account data is kept while your account exists and for a reasonable
          period afterward. Fingerprints and proofs are kept indefinitely:
          they are part of a chain that other users&apos; proofs depend on.
        </p>

        <h2>6. Your rights</h2>
        <p>
          You can ask us to show you, correct, or delete your account data at{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>. Fingerprints
          already committed to the chain cannot be removed, because deleting a
          position would break verification of every proof recorded after it.
          A fingerprint alone does not reveal anything about your file&apos;s
          contents.
        </p>

        <h2>7. Children</h2>
        <p>
          The service is not directed at anyone under 13, or under 16 where
          local law sets that age. We do not knowingly collect data from
          children.
        </p>

        <h2>8. Changes and contact</h2>
        <p>
          If this policy changes materially we will give notice on this site
          and by email. Questions:{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>.
        </p>

      </article>
    </div>
  );
}
