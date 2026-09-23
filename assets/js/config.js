// ─────────────────────────────────────────────────────────────────────────────
// ONE PLACE TO EDIT. Every page reads the broker's details from here.
// Anything marked TODO is a gap we still need real information for.
// ─────────────────────────────────────────────────────────────────────────────
window.SITE = {
  brokerName: "Broker Name",            // TODO: her full name as clients should see it
  businessName: "Broker Name Insurance", // TODO: registered business / trading name
  initials: "BN",                         // TODO: shown in the logo mark until a real logo exists
  phoneDisplay: "072 147 0288",
  phoneIntl: "27721470288",               // used for tel: and WhatsApp links
  email: "",                              // TODO: public contact email (optional on the site)
  fspNumber: "",                          // TODO: FSP number. Leave empty to hide the line.
  area: "",                               // TODO: e.g. "Johannesburg and surrounds"
  responseTime: "one working day",        // TODO: confirm with her

  // The public address of the site once it's live, e.g. "https://example.co.za".
  // The printable card uses it for the QR code. Empty = use whatever address the page is open on.
  siteUrl: "",

  // Paste the Google Apps Script "Web app" URL here (see README, step 2).
  // Empty = test mode: on the local test server submissions go to data/test-submissions.csv.
  appsScriptUrl: "",
};
