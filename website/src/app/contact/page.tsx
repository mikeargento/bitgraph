"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * The contact form. It posts to /api/contact, which relays the message by
 * email; the page reports exactly what the route answered. Michael Argento
 * reads and answers these himself.
 */
export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, hidden from people
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const resp = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message, website }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus("error");
        setErrorMsg(data.error || `The message was not sent (the server answered ${resp.status}).`);
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setErrorMsg("The message was not sent: the network request failed. Try again, or email directly.");
    }
  }

  return (
    <div className="frame prose" style={{ padding: "56px 0 96px" }}>
      <h1>Contact</h1>
      <p className="lede">
        BitGraph is built and run by Michael Argento at Argento Computing Inc. Write with a question, an evaluation you want to run, or a licence you need. Email <a href="mailto:mike@bitgraph.ing">mike@bitgraph.ing</a> or use the form; both reach the same inbox.
      </p>
      <div style={{ maxWidth: 560 }}>
        {status === "sent" ? (
          <div className="callout is-ok" role="status">
            <span className="kicker">Sent</span>
            <p>Your message was delivered. You will hear back at the address you gave.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate aria-describedby={status === "error" ? "contact-error" : undefined}>
            <div aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
              <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>
            <label className="field">
              <span>Name</span>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" />
            </label>
            <label className="field">
              <span>Company <span className="dim" style={{ fontWeight: 400 }}>(optional)</span></span>
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} autoComplete="organization" />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea required value={message} onChange={(e) => setMessage(e.target.value)} minLength={10} maxLength={5000} rows={7} />
              <span className="meta" style={{ display: "block", textAlign: "right", fontWeight: 400, marginTop: 4 }}>{message.length}/5000</span>
            </label>
            {status === "error" && (
              <div className="callout is-err" id="contact-error" role="alert">
                <span className="kicker">Not sent</span>
                <p>{errorMsg}</p>
              </div>
            )}
            <button type="submit" className="btn is-primary" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
      <p className="note" style={{ marginTop: 32 }}>
        Argento Computing Inc. is a Delaware corporation and BITGRAPH is its trademark. Nothing you write here is recorded on the ledger.
      </p>
    </div>
  );
}
