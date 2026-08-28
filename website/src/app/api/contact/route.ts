import { NextResponse } from "next/server";
import { Resend } from "resend";

// In-memory rate limit: max 5 submissions per IP per hour.
// Resets on serverless cold start, which is fine as a low-effort spam guard.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;
const submissions = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const history = (submissions.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (history.length >= RATE_MAX) {
    submissions.set(ip, history);
    return true;
  }
  history.push(now);
  submissions.set(ip, history);
  return false;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

/* ⚠️ Delivery reality (2026-08-28): the sandbox sender below only delivers
   to the Resend ACCOUNT OWNER's address. Pointing this at mike@bitgraph.ing
   (tried 08-27) silently broke the form. It goes back to bitgraph.ing mail
   only after the domain is verified in Resend (DNS is on Vercel, records
   can be added by API); until then the gmail is the address that works. */
const RECIPIENT = "mikeargento@gmail.com";
// Resend's sandbox sender — works without verifying a domain.
// To use hello@bitgraph.ing instead, verify bitgraph.ing in the Resend dashboard.
const SENDER = "BitGraph Contact <onboarding@resend.dev>";

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Contact form is not configured. Set RESEND_API_KEY in env." },
      { status: 503 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { name, email, company, message, website } = (body ?? {}) as {
    name?: unknown;
    email?: unknown;
    company?: unknown;
    message?: unknown;
    website?: unknown;
  };

  // Honeypot: bots fill any input named "website". Silently accept to
  // avoid signalling the rejection, but do not send.
  if (typeof website === "string" && website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (typeof email !== "string" || !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (
    typeof message !== "string" ||
    message.trim().length < 10 ||
    message.length > 5000
  ) {
    return NextResponse.json(
      { error: "Message must be between 10 and 5000 characters." },
      { status: 400 }
    );
  }
  if (typeof company === "string" && company.length > 200) {
    return NextResponse.json({ error: "Company too long." }, { status: 400 });
  }

  const safeName = name.trim();
  const safeEmail = email.trim();
  const safeCompany = typeof company === "string" ? company.trim() : "";
  const safeMessage = message.trim();

  const resend = new Resend(apiKey);

  try {
    const result = await resend.emails.send({
      from: SENDER,
      to: RECIPIENT,
      replyTo: safeEmail,
      subject: `[bitgraph.ing] ${safeName}${safeCompany ? ` (${safeCompany})` : ""}`,
      text: [
        `From: ${safeName} <${safeEmail}>`,
        ...(safeCompany ? [`Company: ${safeCompany}`] : []),
        `IP: ${ip}`,
        "",
        safeMessage,
      ].join("\n"),
    });

    if (result.error) {
      console.error("[contact] resend error:", result.error);
      return NextResponse.json(
        { error: "Failed to send message. Please try again later." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] send exception:", err);
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 500 }
    );
  }
}
