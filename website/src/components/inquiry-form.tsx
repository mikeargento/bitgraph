"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

const INTERESTS = ["General question", "Managed recording", "Mechanism license (OEM)", "Custom integration", "Strategic partnership", "Technology acquisition", "Not sure yet"];
const SCALES = ["Under 10,000 records a month", "10,000 to 1 million a month", "Over 1 million a month", "Not sure yet"];

/**
 * Every form on the site (contact, licensing, evaluation) is this one, posting the same way.
 * A licensing or evaluation request. It goes through /api/contact, the contact form's relay, which emails it to the
 * company and keeps nothing; the fields are folded into the message so the relay needs no new shape.
 */
export function InquiryForm({ topic }: { topic: "Contact" | "Licensing" | "Evaluation" }) {
  const [f, setF] = useState({ name: "", email: "", org: "", product: "", interest: topic === "Contact" ? INTERESTS[0]! : INTERESTS[1]!, scale: SCALES[3]!, message: "", website: "" });
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    if (!f.name.trim() || !f.email.trim()) { setStatus("error"); setErr("Add your name and email."); return; }
    if (topic === "Contact" && f.message.trim().length < 10) { setStatus("error"); setErr("Write a message of at least 10 characters."); return; }
    setStatus("sending"); setErr("");
    const message = [
      topic === "Contact" ? "Message" : `${topic} request`,
      `Interest: ${f.interest}`,
      `Product or application: ${f.product || "not given"}`,
      `Approximate scale: ${f.scale}`,
      "",
      f.message.trim() || "(no message)",
    ].join("\n");
    try {
      const r = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, name: f.name, email: f.email, company: f.org, message, website: f.website }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus("error"); setErr(d.error || `It was not sent (the server answered ${r.status}).`); return; }
      setStatus("sent");
    } catch { setStatus("error"); setErr("It was not sent: the network request failed. Try again in a moment."); }
  }

  if (status === "sent") {
    return (
      <div className="callout is-ok" role="status">
        <span className="kicker">Sent</span>
        <p>Your request was delivered. You will hear back at the address you gave.</p>
      </div>
    );
  }
  return (
    <form className="sx-form" onSubmit={submit} noValidate aria-describedby={status === "error" ? "inq-error" : undefined}>
      <div aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
        <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></label>
      </div>
      <div className="sx-form-row">
        <label className="field"><span>Name</span><input type="text" required maxLength={200} autoComplete="name" value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Organization{topic === "Contact" && <span className="dim" style={{ fontWeight: 400 }}> (optional)</span>}</span><input type="text" required={topic !== "Contact"} maxLength={200} autoComplete="organization" value={f.org} onChange={set("org")} /></label>
      </div>
      <div className="sx-form-row">
        <label className="field"><span>{topic === "Contact" ? "Email" : "Business email"}</span><input type="email" required maxLength={254} autoComplete="email" value={f.email} onChange={set("email")} /></label>
        <label className="field"><span>Product or application</span><input type="text" maxLength={200} value={f.product} onChange={set("product")} /></label>
      </div>
      <div className="sx-form-row">
        <label className="field"><span>Interested in</span><select value={f.interest} onChange={set("interest")}>{INTERESTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Approximate scale</span><select value={f.scale} onChange={set("scale")}>{SCALES.map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <label className="field"><span>{topic === "Contact" ? "Message" : <>What you need <span className="dim" style={{ fontWeight: 400 }}>(technical requirements, timeline)</span></>}</span><textarea maxLength={4000} rows={5} value={f.message} onChange={set("message")} /></label>
      {status === "error" && (
        <div className="callout is-err" id="inq-error" role="alert"><span className="kicker">Not sent</span><p>{err}</p></div>
      )}
      <button type="submit" className="bg-action-link is-make" style={{ margin: 0 }} disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : topic === "Licensing" ? "Send licensing request" : topic === "Evaluation" ? "Request an evaluation" : "Send message"}
      </button>
    </form>
  );
}
