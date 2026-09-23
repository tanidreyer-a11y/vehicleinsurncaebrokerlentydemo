# Insurance broker site + quote form

A landing page, a phone-first quote form, a privacy notice and a printable business card with a QR code.
Plain HTML, CSS and JavaScript: no build step, and it runs on any static host.

| File | What it is |
|---|---|
| `index.html` | Landing page |
| `quote.html` | The quote form (the QR code points here with `?src=card`) |
| `privacy.html` | POPIA privacy notice (has yellow TODOs) |
| `card.html` | Business card front and back at 90 × 50 mm, with a live QR code. Print to PDF for the print shop. |
| `assets/js/config.js` | **The one file to edit**: her name, business name, phone, FSP number, site URL, Google URL |
| `assets/js/quote.js` | Form engine: every question, dropdown and condition is in `buildSteps()` |
| `assets/js/quote-data.js` | Dropdown lists: car makes and models, insurers, banks, licence codes |
| `apps-script/Code.gs` | Google side: writes each quote to the Sheet and emails her |

## 1. Test it locally (no Google needed)

```
node server.js
```

Open http://localhost:3010. While `appsScriptUrl` in `config.js` is empty, every submission is saved to
`data/test-submissions.csv`, which opens in Excel. The server also prints a `192.168.x.x` address: open it on a
phone connected to the same Wi-Fi to test the real thing on a phone.

## 2. Connect Google Sheets + email (about 10 minutes, in her Google account)

1. Go to sheets.new and name it something like "Quote requests".
2. **Extensions → Apps Script**. Delete what's there and paste all of `apps-script/Code.gs`.
3. In the `CONFIG` block at the top, set `NOTIFY_EMAIL` to her email address, plus her name and business name.
4. Pick `setup` in the function dropdown and click **Run**. Google asks for permission (Sheets + send email):
   **Advanced → Go to project → Allow**. This creates the *Quotes* tab with a Status dropdown
   (New / Contacted / Quoted / Won / Lost).
5. Optional: run `testSubmission` and check that a row appears and the email arrives.
6. **Deploy → New deployment →** gear icon **→ Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy.
7. Copy the **Web app URL** (ends in `/exec`) into `appsScriptUrl` in `assets/js/config.js`.

Every quote then becomes one row in the sheet (**File → Download → Microsoft Excel** at any time), she gets an email
with every answer plus Call, WhatsApp and "Open in spreadsheet" buttons, and the client gets a short confirmation
email (turn it off with `SEND_CLIENT_CONFIRMATION: false`).

> If you change `Code.gs` later: **Deploy → Manage deployments → Edit → Version: New version**. Otherwise the old
> code keeps running.

## 3. Go live

Any static host works. With Vercel: `npx vercel` in this folder, then `npx vercel --prod`. After that:

- set `siteUrl` in `config.js` to the live address and redeploy
- open `/card.html`, check that the QR address is right and the yellow warning is gone, then print to PDF

## Still needed from her

- Her full name, business name and FSP number (`config.js`)
- A real photo of her (`index.html`, the "About" section) and a short bio
- Her public email, the area she covers, and her usual response time
- The Information Officer name and the retention period (`privacy.html`, yellow TODOs)
