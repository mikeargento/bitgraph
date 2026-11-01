import type { Metadata } from "next";
import { InquiryForm } from "@/components/inquiry-form";

/**
 * Licensing (2026-10-27): the commercial paths for a company that already sells proof. No terms, prices or patent
 * claims are published here; those are set per agreement. The request goes to the company by email (InquiryForm).
 */
export const metadata: Metadata = {
  title: "Licensing",
  description: "License the BitGraph recording mechanism: managed recording, a mechanism license for your own infrastructure, or a broader strategic arrangement. Through Argento Computing Inc.",
};

export default function LicensingPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Licensing.</h1></div>

      <section className="home-section" aria-labelledby="lic-h">
        <p className="home-kicker">Licensing</p>
        <h2 id="lic-h">Keep your product. Upgrade your&nbsp;proof.</h2>
        <p>
          BitGraph adds attested recording to <a href="/applications">products for provenance, content credentials, trusted
          capture, timestamping and audit trails</a>. You keep your product, your customers and your brand. Your system submits a digest and receives a proof
          that travels with your records and can be verified offline.
        </p>
        <p>
          BitGraph establishes a verifiable position in an enclave&rsquo;s sequence. Your product can bind identity, timestamps and
          other evidence to that position.
        </p>
        <p>Licensing is offered through Argento Computing Inc., the company that develops and operates BitGraph.</p>

        <div className="sx-cards">
          <article className="tl-card">
            <p className="tl-label">Managed recording</p>
            <h3>Call the BitGraph service.</h3>
            <p>
              Your system sends SHA-256 digests; the enclave binds them and returns proofs your product stores and shows. There is no
              BitGraph infrastructure to operate, and your files never leave your systems.
            </p>
            <ul className="docs-list">
              <li>Fastest to integrate: one HTTP call, or the SDK</li>
              <li>Collections: one BitGraph for many items, each independently verifiable</li>
              <li>Usage-based terms</li>
            </ul>
          </article>
          <article className="tl-card">
            <p className="tl-label">Mechanism license</p>
            <h3>Run it under your control.</h3>
            <p>
              License the recording mechanism to integrate into your own infrastructure and product, with scope, field of use and
              deployment set by agreement.
            </p>
            <ul className="docs-list">
              <li>Your product experience, your customer relationship</li>
              <li>White-label where the agreement allows</li>
              <li>BitGraph runs on AWS Nitro today. The mechanism is designed for implementation in other protected environments, with deployment requirements, such as a deployment&rsquo;s own measured enclave build, agreed as part of the license.</li>
            </ul>
          </article>
          <article className="tl-card">
            <p className="tl-label">Strategic</p>
            <h3>Broader rights.</h3>
            <p>
              For organizations interested in the technology and its intellectual property more broadly, including exclusivity in a
              field or acquisition. Handled confidentially.
            </p>
            <ul className="docs-list">
              <li>Technical and diligence materials on request, under NDA</li>
              <li>Direct conversation with the inventor</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="home-section" aria-labelledby="lic-how">
        <div className="sx-split">
          <div>
            <p className="home-kicker">How it goes</p>
            <h2 id="lic-how">From first look to agreement.</h2>
            <ol className="tl-steps">
              <li><strong>Evaluate on your own.</strong> Read the mechanism and the threat model, make real BitGraphs, and verify them offline. No call needed: <a href="/evaluate">the evaluation guide</a>.</li>
              <li><strong>Fit.</strong> A technical conversation about where the recording step sits in your product and what it should bind.</li>
              <li><strong>Proof of concept.</strong> A working integration against the live service, on your data.</li>
              <li><strong>Agreement.</strong> Scope, deployment model and terms.</li>
            </ol>
            <p className="sx-fine">
              No terms are published, and nothing on this site is an offer. The verifier stays available to your customers whatever you
              choose, so the proofs you issue keep checking.
            </p>
          </div>
          <div>
            <p className="home-kicker" id="lic-form">Talk with us</p>
            <h2>Start a licensing conversation.</h2>
            <p className="sx-fine">Your request goes directly to Argento Computing. Nothing you send is published.</p>
            <InquiryForm topic="Licensing" />
          </div>
        </div>
      </section>
    </div>
  );
}
