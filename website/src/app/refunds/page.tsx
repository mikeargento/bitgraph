import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund and Cancellation Policy",
  description:
    "Cancel any time, effective at the end of the billing period. No partial-month refunds; outage credits at our discretion.",
  alternates: { canonical: "https://bitgraph.ing/refunds" },
};

export default function RefundsPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 40px" }}>
      <article className="prose-doc">
        <h1>Refund and Cancellation Policy</h1>
        <p style={{ color: "#4b5563" }}>Effective date: August 27, 2026</p>

        <p>
          You can cancel any time, from the billing portal or by emailing{" "}
          <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>. Cancellation
          takes effect at the end of the current billing period, and you keep
          access until then.
        </p>
        <p>
          We do not give partial-month refunds for subscriptions. Metered usage
          you have already consumed is not refundable.
        </p>
        <p>
          If the service was unavailable for a material portion of a billing
          period due to our fault, contact us. We will credit or refund at our
          discretion.
        </p>
        <p>
          Refunds go back to the original payment method, processed by Stripe.
        </p>
        <p>
          Proofs you created before cancelling remain yours and remain
          verifiable offline.
        </p>
        <p>
          Questions: <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a>
        </p>
      </article>
    </div>
  );
}
