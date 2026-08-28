import type { Metadata } from "next";
import { CopyEmail } from "@/components/copy-email";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Recording is licensed. Verification is free to everyone, forever.",
  alternates: { canonical: "https://bitgraph.ing/pricing" },
};

/* PREVIEW, not shipped: Mike is reviewing the shape before anything commits.
   House rules applied: no card grid (three hairline-ruled sections down the
   reading column, the /subjects pattern), the money line opens the page as
   its thesis, the free tier is the camera that already exists rather than an
   invented "Free plan", and the paid tier's action is a conversation until
   Stripe and API keys exist ("no checkout button that goes nowhere"). $XX is
   the placeholder for Mike's number. */

const tierRule: React.CSSProperties = {
  borderTop: "1px solid #d0d5dd",
  paddingTop: 26,
  marginTop: 34,
};


export default function PricingPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 40px" }}>
      <article className="prose-doc">
        <h1>Pricing</h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "#1f2937" }}>
          Recording is licensed. Verification is free to everyone, forever.
        </p>

        <section style={tierRule}>
          <h2 style={{ marginTop: 0 }}>Free</h2>
          <p>
            Drop a file and it gets a BitGraph.
            <br />
            A permanent public record for those exact bits, with its own proof
            page. No account.
          </p>
          {/* The file-as-key property in one outward line. NOT "unlock":
              nothing is locked, the record is public on the Roll; the file
              is the ADDRESS, and possessing the bits is what lets you ask. */}
          <p>
            The file is the key: drop the same file again, any time, and its
            record comes back.
          </p>
          <p>
            Checking is part of verification, so it stays free. Drop any file
            to look it up, open any proof page, or verify offline with the
            open-source player. No service required.
          </p>
          {/* The tier boundary, self-testing (is it me clicking, or my
              software?). Two earlier versions died the same day: "Free means
              real use, not industrial use" (ambiguous, no test to apply) and
              "Recording by hand..." (Mike: "thats dumb"). This one echoes the
              Enterprise section's own "inside your own products", so the two
              sections click together. The boundary is mechanism, not volume:
              enterprise demand comes from wanting recording inside their
              systems, never from free running out. */}
          <p>
            Recording here is free. Recording inside your own product is
            licensed.
          </p>
          <p>
            <a
              href="/"
              className="bg-arrow-link"
              style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", textDecoration: "none" }}
            >
              Record a file <span className="arrow" aria-hidden="true">&rarr;</span>
            </a>
          </p>
        </section>

        <section style={tierRule}>
          <h2 style={{ marginTop: 0 }}>Enterprise</h2>
          <p>
            Your volume, your integration, your terms. MCP for your AI
            systems, custom integrations into the workflows you already run,
            and patent-licensed use of the protocol inside your own products.
          </p>
          <p>
            Start with a live demo, enterprise consultation, or licensing
            conversation.
          </p>
          {/* The address itself, not a form (Mike, 2026-08-28): the reply
              thread starts in the buyer's own mail. */}
          <p>
            <CopyEmail />
          </p>
        </section>
      </article>
    </div>
  );
}
