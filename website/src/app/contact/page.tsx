"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
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
      const data = await resp.json();
      if (!resp.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong.");
        return;
      }
      setStatus("sent");
      setName("");
      setEmail("");
      setCompany("");
      setMessage("");
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  /* RESTYLE 2026-09-14. Square corners were the site's rule until the
     2026-09-11 pass made every interactive surface rounded — the pills in
     the nav, the action links, the menu card. A form left at borderRadius 0
     is the last square thing a visitor touches. 10px, not the card's 14:
     these sit at 46px tall and the card radius reads as a lozenge at that
     height. The border stays #d0d5dd, which is .bg-action-link's border, so
     the fields and the button they sit above are the same weight of line;
     --hair (#e5e7eb) is for dividers, not for things you click. */
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    background: "#ffffff",
    border: "1px solid #d0d5dd",
    borderRadius: 10,
    fontSize: 15,
    color: "#111827",
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: "#374151",
    marginBottom: 6,
  };

  return (
    /* The site's column, so the h1 lines up with the wordmark above it.
       This page centred a 640px block of its own, which left "Contact"
       starting a couple of hundred pixels right of "BitGraph" on any wide
       monitor — the one page on the site whose content did not sit on the
       measure. The FORM keeps a 640px cap inside the column, left aligned:
       a text field the full 1040 is a worse field, but that is a line-length
       decision and not a reason to move the page off its axis. */
    <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "56px 0 96px" }}>
    <div style={{ maxWidth: 640 }}>
      {/* .bg-page-title is the site's one h1 rule, clamp(26px, 6vw, 32px).
          The hardcoded 32 here never shrank, so this title sat 6px larger
          than every other page's on a phone. */}
      <h1 className="bg-page-title" style={{ margin: "0 0 12px" }}>Contact</h1>
      {/* The page says what it is for before asking for anything
          (2026-08-27). Facts and one instruction, no pitch. */}
      {/* Mike's wording, cut to the bone (2026-09-14). One instruction and
          two ways to follow it, and nothing else.

          What went is the tail: "to ask for a live demo, enterprise
          consultation, or licensing conversation", which had stood since
          2026-08-27. It was the only pitch on a page whose own rule two
          lines up is "facts and one instruction, no pitch", and it named
          three reasons to write, which quietly tells anyone with a fourth
          that they are in the wrong place. The h1 says Contact; the page
          does not need to list what contact is for. */}
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "#1f2937", margin: "0 0 8px" }}>
        Fill out and submit the form below, or email <a href="mailto:mike@bitgraph.ing" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600 }}>mike@bitgraph.ing</a>.
      </p>
      <div style={{ height: 20 }} />
      {status === "sent" ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid var(--hair)",
            borderRadius: "var(--radius-card)",
            padding: "32px 28px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
              marginBottom: 8,
            }}
          >
            Message sent.
          </div>
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Thanks for reaching out. You&apos;ll hear back at the email you
            provided.
          </div>
          {/* No "Send another" (Mike, 2026-08-28: "the button isnt needed"):
              the sent state is terminal; a person with more to say reloads
              or replies to the mail thread that just started. */}
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {/* Honeypot — invisible to humans, filled by bots */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-10000px",
              width: 1,
              height: 1,
              overflow: "hidden",
            }}
          >
            <label>
              Website
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label htmlFor="contact-name" style={labelStyle}>
                Name
              </label>
              <input
                id="contact-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0065A4")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d0d5dd")}
              />
            </div>

            <div>
              <label htmlFor="contact-email" style={labelStyle}>
                Email
              </label>
              <input
                id="contact-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0065A4")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d0d5dd")}
              />
            </div>

            {/* Company replaced Subject (Mike, 2026-08-27): the Enterprise
                tier links here, and who is asking frames the reply better
                than a headline the message's first line already carries. */}
            <div>
              <label htmlFor="contact-company" style={labelStyle}>
                Company <span style={{ color: "#6b7280", fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="contact-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={200}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0065A4")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d0d5dd")}
              />
            </div>

            <div>
              <label htmlFor="contact-message" style={labelStyle}>
                Message
              </label>
              <textarea
                id="contact-message"
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                minLength={10}
                maxLength={5000}
                rows={7}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  minHeight: 140,
                  lineHeight: 1.55,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#0065A4")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d0d5dd")}
              />
              <div
                style={{
                  fontSize: 12,
                  color: "#6b7280",
                  marginTop: 6,
                  textAlign: "right",
                }}
              >
                {message.length}/5000
              </div>
            </div>

            {status === "error" && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "#991b1b",
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* The site's action idiom (2026-08-27), replacing the filled
                slab this form shipped with in June: blue label + arrow, no
                chrome, centred. .bg-action-link carries the tap target,
                hover nudge, and disabled grey. */}
            {/* Left, with the fields, not centred. It was centred under a
                centred 640px block; in the column the form is left aligned
                and a centred button floats away from the thing it submits.
                The site's actions all start at the measure's left edge. */}
            <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8 }}>
              <button type="submit" disabled={status === "sending"} className="bg-action-link">
                {status === "sending" ? "Sending…" : "Send message"}{" "}
                <span className="arrow" aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
    </div>
  );
}
