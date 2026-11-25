import type { Metadata } from "next";
import { InquiryForm } from "@/components/inquiry-form";

/** Contact (2026-10-27): the same form as Licensing and Evaluate, posting the same way (/api/contact). */
export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Argento Computing Inc., the company that built and runs BitGraph.",
};

export default function ContactPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <h1>Contact</h1>
      <section className="home-section" aria-labelledby="c-h">
        <div className="sx-split">
          <div>
            <p className="home-kicker">Contact</p>
            <h2 id="c-h">Talk with us.</h2>
            <p>
              BitGraph is built and run by Argento Computing Inc. Questions about the technology, an integration, licensing, or anything
              else reach us directly. Nothing you send is published.
            </p>
          </div>
          <div>
            <InquiryForm topic="Contact" />
          </div>
        </div>
      </section>
    </div>
  );
}
