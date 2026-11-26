# Auth email templates

Branded templates for the emails Supabase Auth sends. The HTML files are generated: edit
`build.mjs`, then run `node supabase/templates/build.mjs`.

Supabase doesn't read these files. Paste each one into **Supabase → Authentication → Emails → Templates**:

| Template in Supabase | Subject                            | File                  |
| -------------------- | ---------------------------------- | --------------------- |
| Confirm signup       | `Confirm your Chromatic account`   | `confirm-signup.html` |
| Reset password       | `Reset your Chromatic password`    | `reset-password.html` |
| Change email address | `Confirm your new Chromatic email` | `change-email.html`   |

Notes:

- The logo loads from `https://chromatic.vercel.app/email/chromatic-mark.png` (`public/email/`),
  so it only appears after that file is deployed. Don't rename or remove it: emails already sent
  still point at it.
- Layout is tables with inline styles so it renders in Gmail, Outlook and Apple Mail.
- Variables used: `{{ .ConfirmationURL }}`, `{{ .Email }}`, and `{{ .NewEmail }}` (change email only).
- Mail is sent through Resend SMTP as `Chromatic <noreply@emptyconsole.com>`. Supabase can't set a
  reply-to, so the footer points people to the support address instead.
