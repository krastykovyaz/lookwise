import "server-only";
import { Resend } from "resend";
import { renderMagicLinkEmail } from "./templates/magicLink";

// Server-only abstraction: nothing outside this file ever imports the
// Resend SDK or touches RESEND_API_KEY directly, so a future provider
// swap (or unit-testing email content) doesn't ripple outward.
let client: Resend | null = null;
function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set it in .env.local — see .env.example.",
    );
  }
  if (!client) client = new Resend(apiKey);
  return client;
}

function fromHeader(): string {
  const email = process.env.RESEND_FROM_EMAIL;
  const name = process.env.RESEND_FROM_NAME || "Lookwise";
  if (!email) {
    throw new Error(
      "RESEND_FROM_EMAIL is not configured. Set it in .env.local — see .env.example.",
    );
  }
  return `${name} <${email}>`;
}

export async function sendMagicLinkEmail(input: { to: string; url: string; expiresInMinutes: number }) {
  const { subject, html, text } = renderMagicLinkEmail({ url: input.url, expiresInMinutes: input.expiresInMinutes });
  const from = fromHeader();

  console.log("[AUTH EMAIL] sending", {
    from,
    to: input.to,
  });

  const { data, error } = await getClient().emails.send({
    from,
    to: input.to,
    subject,
    html,
    text,
  });

  console.log("[AUTH EMAIL] Resend response", {
    data,
    error,
  });

  if (error) {
    throw new Error(`Failed to send magic-link email: ${error.message}`);
  }
}

export async function sendAccountLinkedNotification(input: { to: string; provider: string }) {
  const { error } = await getClient().emails.send({
    from: fromHeader(),
    to: input.to,
    subject: "A new sign-in method was added to your Lookwise account",
    html: `<p>Hi,</p><p>${input.provider} was just linked to your Lookwise account (${input.to}). If this wasn't you, please contact support.</p>`,
    text: `${input.provider} was just linked to your Lookwise account (${input.to}). If this wasn't you, please contact support.`,
  });
  if (error) {
    // Best-effort notification — never block the auth flow on this.
    console.error("Failed to send account-linked notification:", error.message);
  }
}
