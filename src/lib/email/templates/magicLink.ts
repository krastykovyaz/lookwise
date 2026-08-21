// Lookwise-branded magic-link email. Kept as plain template-string HTML
// (no React Email dependency) to keep this milestone's dependency
// footprint small — swapping to a component-based template renderer
// later is a one-file change since callers only see renderMagicLinkEmail().

export function renderMagicLinkEmail(input: { url: string; expiresInMinutes: number }): {
  subject: string;
  html: string;
  text: string;
} {
  const { url, expiresInMinutes } = input;
  const subject = "Sign in to Lookwise";

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#111;">Lookwise</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <h1 style="font-size:20px;margin:16px 0 8px 0;color:#111;">Sign in to Lookwise</h1>
                <p style="font-size:15px;line-height:1.5;color:#444;margin:0 0 24px 0;">
                  Click the button below to securely sign in. This link expires in ${expiresInMinutes} minutes and can only be used once.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">
                  Sign in to Lookwise
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="font-size:13px;line-height:1.5;color:#888;margin:0 0 8px 0;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="font-size:13px;line-height:1.5;color:#888;margin:0;word-break:break-all;">${url}</p>
                <p style="font-size:13px;line-height:1.5;color:#aaa;margin:16px 0 0 0;">
                  If you didn't request this email, you can safely ignore it — no account changes were made.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = [
    "Sign in to Lookwise",
    "",
    `Click the link below to securely sign in. This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    "",
    url,
    "",
    "If you didn't request this email, you can safely ignore it — no account changes were made.",
  ].join("\n");

  return { subject, html, text };
}
