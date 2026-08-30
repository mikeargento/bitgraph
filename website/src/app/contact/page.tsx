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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    background: "#ffffff",
    border: "1px solid #d0d5dd",
    borderRadius: 0,
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
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "64px 24px 96px",
      }}
    >
      <h1
        style={{
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          marginBottom: 12,
          color: "#111827",
        }}
      >
        Contact
      </h1>
      {/* The page says what it is for before asking for anything
          (2026-08-27). Facts and one instruction, no pitch. */}
      {/* Mike's wording verbatim (2026-08-27); the what-you-record second
          sentence was cut the same day. */}
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "#1f2937", margin: "0 0 8px" }}>
        Ask for a live demo, enterprise consultation, or licensing
        conversation.
      </p>
      <div style={{ height: 20 }} />
      {status === "sent" ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #d0d5dd",
            borderRadius: 0,
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
                  borderRadius: 0,
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
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <button type="submit" disabled={status === "sending"} className="bg-action-link">
                {status === "sending" ? "Sending…" : "Send message"}{" "}
                <span className="arrow" aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
