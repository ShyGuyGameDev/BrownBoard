// Builds the three Supabase Auth email templates in this folder from one shared layout.
// Edit the copy or colours here, then run: node supabase/templates/build.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const C = {
  bg: "#f4f5f7",
  panel: "#ffffff",
  border: "#dfe2e8",
  text: "#0f1013",
  body: "#343843",
  muted: "#6b7280",
  accent: "#4a62f0",
  g1: "#4da3ff",
  g2: "#8b7cff",
};
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const LOGO = "https://chromatic.vercel.app/email/chromatic-mark.png";
const SUPPORT = "shyguygamedev@gmail.com";

const layout = ({
  title,
  preheader,
  heading,
  intro,
  button,
  after,
}) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
<style>
  @media (max-width: 600px) {
    .card-pad { padding: 32px 24px !important; }
    .outer-pad { padding: 16px 8px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${C.bg}; -webkit-text-size-adjust:100%;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background-color:${C.bg};">
  <tr>
    <td class="outer-pad" align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

        <!-- Brand -->
        <tr>
          <td style="padding:0 8px 24px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:8px;">
                  <img src="${LOGO}" width="32" height="32" alt="" style="display:block; width:32px; height:32px; border:0;">
                </td>
                <td valign="middle" style="font-family:${FONT}; font-size:18px; line-height:24px; font-weight:600; color:${C.text}; letter-spacing:-0.2px;">Chromatic</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td bgcolor="${C.panel}" style="background-color:${C.panel}; border:1px solid ${C.border}; border-radius:14px; overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td height="4" bgcolor="${C.accent}" style="height:4px; line-height:4px; font-size:0; background-color:${C.accent}; background-image:linear-gradient(90deg, ${C.g1}, ${C.g2}); border-radius:14px 14px 0 0;">&nbsp;</td>
              </tr>
              <tr>
                <td class="card-pad" style="padding:40px; font-family:${FONT};">
                  <h1 style="margin:0 0 16px 0; font-size:24px; line-height:32px; font-weight:600; color:${C.text}; letter-spacing:-0.3px;">${heading}</h1>
                  <p style="margin:0 0 32px 0; font-size:16px; line-height:24px; color:${C.body};">${intro}</p>

                  <!-- Button -->
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="${C.accent}" style="border-radius:8px; background-color:${C.accent};">
                        <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block; padding:12px 24px; font-family:${FONT}; font-size:16px; line-height:24px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:8px;">${button}</a>
                      </td>
                    </tr>
                  </table>

                  ${after ? `<p style="margin:32px 0 0 0; font-size:14px; line-height:24px; color:${C.body};">${after}</p>` : ""}

                  <!-- Fallback link -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
                    <tr><td style="border-top:1px solid ${C.border}; font-size:0; line-height:0;">&nbsp;</td></tr>
                    <tr>
                      <td style="padding-top:24px; font-family:${FONT}; font-size:13px; line-height:20px; color:${C.muted};">
                        Button not working? Copy and paste this link into your browser:<br>
                        <a href="{{ .ConfirmationURL }}" target="_blank" style="color:${C.accent}; text-decoration:underline; word-break:break-all;">{{ .ConfirmationURL }}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 8px 0 8px; font-family:${FONT}; font-size:13px; line-height:20px; color:${C.muted};">
            If you didn't request this, you can ignore this email.<br>
            Questions? Email <a href="mailto:${SUPPORT}" style="color:${C.muted}; text-decoration:underline;">${SUPPORT}</a>.
          </td>
        </tr>
        <tr>
          <td style="padding:16px 8px 0 8px; font-family:${FONT}; font-size:12px; line-height:16px; color:${C.muted};">
            Chromatic &middot; <a href="https://chromatic.vercel.app" style="color:${C.muted}; text-decoration:none;">chromatic.vercel.app</a>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;

const strong = (v) =>
  `<strong style="color:${C.text}; font-weight:600;">${v}</strong>`;

const templates = {
  "confirm-signup.html": {
    title: "Confirm your Chromatic account",
    preheader: "One click to finish creating your account.",
    heading: "Confirm your email",
    intro: `Thanks for signing up for Chromatic. Confirm ${strong("{{ .Email }}")} to finish creating your account.`,
    button: "Confirm email",
  },
  "reset-password.html": {
    title: "Reset your Chromatic password",
    preheader: "Choose a new password for your Chromatic account.",
    heading: "Reset your password",
    intro: `We got a request to reset the password for ${strong("{{ .Email }}")}. Click below to choose a new one.`,
    button: "Choose a new password",
    after: "Your current password keeps working until you set a new one.",
  },
  "change-email.html": {
    title: "Confirm your new Chromatic email",
    preheader: "Confirm the new email address for your Chromatic account.",
    heading: "Confirm your new email",
    intro: `Confirm that you want to change your Chromatic sign-in email from ${strong("{{ .Email }}")} to ${strong("{{ .NewEmail }}")}.`,
    button: "Confirm new email",
    after: "Until you confirm, you keep signing in with your current email.",
  },
};

for (const [file, t] of Object.entries(templates)) {
  writeFileSync(join(here, file), layout(t));
  console.log("wrote", file);
}
