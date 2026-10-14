import type { Metadata } from "next";
import { CopyAddress } from "@/components/copy-address";

export const metadata: Metadata = {
  title: "Contact",
  description: "Write to Michael Argento at Argento Computing Inc., the company behind BitGraph.",
  alternates: { canonical: "https://bitgraph.ing/contact" },
};

/* One address, large, in the middle of the screen (Mike, 2026-10-14: "make the contact page more like this",
   mldangelo.com/contact). The form is gone; /api/contact still answers for anything that posts to it.
   Michael Argento reads and answers the mail himself. */
export default function ContactPage() {
  return (
    <div className="frame contact-page">
      {/* The address is the headline (Mike, 2026-10-14: no "Get in touch"). */}
      <h1><a className="contact-mail" href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a></h1>
      <CopyAddress address="mike@bitgraph.ing" />
    </div>
  );
}
