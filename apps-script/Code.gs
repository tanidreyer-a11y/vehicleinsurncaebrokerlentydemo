/**
 * Quote form receiver: Google Apps Script bound to a Google Sheet.
 *
 * Every submission from the website:
 *   1. becomes one new row on the "Quotes" tab (File > Download > Microsoft Excel works any time)
 *   2. sends a formatted email to NOTIFY_EMAIL with every answer
 *   3. optionally sends the client a short "got it" confirmation
 *
 * Setup is in README.md, step 2. Short version: paste this file into Extensions > Apps Script,
 * fill in CONFIG, run setup() once, then Deploy > New deployment > Web app (Anyone).
 */

const CONFIG = {
  NOTIFY_EMAIL: 'tanidreyer@gmail.com',   // where new quote alerts go (can be several, comma separated)
  BUSINESS_NAME: 'Broker Name Insurance',  // shown in emails
  BROKER_NAME: 'Broker Name',
  BROKER_PHONE: '072 147 0288',
  SEND_CLIENT_CONFIRMATION: true,          // email the client a short confirmation
  SHEET_NAME: 'Quotes',
};

// Columns that always come first, in this order. Everything else is added automatically,
// in the order it first appears, so new form questions never need a code change here.
const FIXED = ['Status', 'Reference', 'Received', 'Source', 'Name', 'Cell', 'Email', 'Contact by', 'Best time', 'Cover type', 'Vehicles'];
const STATUSES = ['New', 'Contacted', 'Quoted', 'Won', 'Lost', 'Not suitable'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = JSON.parse(e.postData.contents);

    // Honeypot filled in = a bot. Pretend success so it doesn't retry.
    if (p.website) return json_({ ok: true, reference: p.reference });
    if (!p.summary || !p.summary.name || !p.summary.cell) return json_({ ok: false, error: 'Missing required details' });

    const sheet = getSheet_();
    // A retry on a bad connection resends the same reference: don't add it twice
    const refCol = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].indexOf('Reference') + 1;
    if (refCol > 0 && sheet.getLastRow() > 1 &&
        sheet.getRange(2, refCol, sheet.getLastRow() - 1, 1).createTextFinder(p.reference).matchEntireCell(true).findNext()) {
      return json_({ ok: true, reference: p.reference, duplicate: true });
    }
    const received = new Date();
    const values = {
      'Status': 'New',
      'Reference': p.reference,
      'Received': received,
      'Source': p.source || 'Website',
      'Name': p.summary.name,
      'Cell': "'" + (p.summary.cell || ''), // leading apostrophe keeps the leading 0
      'Email': p.summary.email,
      'Contact by': p.summary.contactBy,
      'Best time': p.summary.bestTime,
      'Cover type': p.summary.cover,
      'Vehicles': p.summary.vehicles,
    };
    (p.fields || []).forEach(function (pair) {
      if (!(pair[0] in values)) values[pair[0]] = pair[1];
    });

    // Make sure every label has a column, then write the row in header order
    let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].filter(String);
    const missing = Object.keys(values).filter(function (k) { return headers.indexOf(k) === -1; });
    if (missing.length) {
      sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      headers = headers.concat(missing);
    }
    const row = headers.map(function (h) {
      const v = values[h];
      // Numbers like ID numbers must stay text, or Sheets turns them into 8.70602E+12
      if (typeof v === 'string' && /^[\d\s+]{8,}$/.test(v)) return "'" + v;
      return v === undefined ? '' : v;
    });
    sheet.appendRow(row);
    const rowNum = sheet.getLastRow();
    sheet.getRange(rowNum, headers.indexOf('Received') + 1).setNumberFormat('d mmm yyyy, hh:mm');

    notifyBroker_(p, sheet, rowNum);
    if (CONFIG.SEND_CLIENT_CONFIRMATION && p.summary.email) confirmClient_(p);

    return json_({ ok: true, reference: p.reference });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Lets you open the web app URL in a browser to check it's live
function doGet() {
  return ContentService.createTextOutput('Quote form endpoint is running.');
}

/** Run once from the editor: creates the Quotes tab, headers, status dropdown and layout. */
function setup() {
  const sheet = getSheet_();
  if (sheet.getLastColumn() === 0) sheet.getRange(1, 1, 1, FIXED.length).setValues([FIXED]);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#f7e7e9');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(5);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  // colour the status cell so she can scan the list at a glance
  const range = sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1);
  const colours = { New: '#fde2e4', Contacted: '#fff1c7', Quoted: '#dbe9ff', Won: '#d4f2e0', Lost: '#e9e4e4' };
  const rules = Object.keys(colours).map(function (s) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(colours[s]).setRanges([range]).build();
  });
  sheet.setConditionalFormatRules(rules);
  sheet.setColumnWidth(1, 110);
  // Ask for the email permission now, so the first real submission doesn't fail
  MailApp.getRemainingDailyQuota();
}

/** Run from the editor to send yourself a fake submission and check the row + email. */
function testSubmission() {
  const fake = {
    reference: 'TEST-' + Math.floor(Math.random() * 9000 + 1000),
    source: 'Test from the script editor',
    summary: { name: 'Test Client', cell: '082 123 4567', email: CONFIG.NOTIFY_EMAIL.split(',')[0], contactBy: 'WhatsApp', bestTime: 'Morning', cover: 'Comprehensive', vehicles: '2018 Suzuki Ciaz' },
    sections: [
      { title: 'About you', rows: [['First name', 'Test'], ['Surname', 'Client']] },
      { title: 'Vehicle 1', rows: [['Vehicle 1 · Year', '2018'], ['Vehicle 1 · Make', 'Suzuki'], ['Vehicle 1 · Model', 'Ciaz']] },
    ],
    fields: [['First name', 'Test'], ['Surname', 'Client'], ['Vehicle 1 · Year', '2018'], ['Vehicle 1 · Make', 'Suzuki'], ['Vehicle 1 · Model', 'Ciaz']],
  };
  const res = doPost({ postData: { contents: JSON.stringify(fake) } });
  Logger.log(res.getContent());
}

/* ── internals ──────────────────────────────────────────────────────────── */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME, 0);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

function notifyBroker_(p, sheet, rowNum) {
  const s = p.summary;
  const cellDigits = String(s.cell || '').replace(/\D/g, '').replace(/^0/, '27');
  const sheetUrl = sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId() + '&range=A' + rowNum;
  const sections = (p.sections || []).map(function (sec) {
    const rows = sec.rows.map(function (r) {
      return '<tr><td style="padding:6px 12px 6px 0;color:#6b5f61;vertical-align:top;width:42%">' + esc_(String(r[0]).replace(/^Vehicle \d+ · /, '')) +
        '</td><td style="padding:6px 0;font-weight:600;vertical-align:top">' + esc_(r[1]) + '</td></tr>';
    }).join('');
    return '<h3 style="margin:22px 0 6px;font-size:15px;color:#a51c30;border-bottom:1px solid #eee;padding-bottom:6px">' + esc_(sec.title) + '</h3>' +
      '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>';
  }).join('');

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:640px;color:#1c1718">' +
    '<p style="font-size:13px;color:#6b5f61;margin:0">New quote request · ' + esc_(p.reference) + ' · via ' + esc_(p.source) + '</p>' +
    '<h2 style="margin:6px 0 4px;font-size:22px">' + esc_(s.name) + '</h2>' +
    '<p style="margin:0 0 14px;font-size:15px">' + esc_(s.cover) + (s.vehicles ? ' · ' + esc_(s.vehicles) : '') + '</p>' +
    '<p style="margin:0 0 18px;font-size:15px">Prefers <b>' + esc_(s.contactBy) + '</b>, ' + esc_(String(s.bestTime).toLowerCase()) + '</p>' +
    '<p style="margin:0 0 20px">' +
    '<a href="tel:' + esc_(s.cell) + '" style="display:inline-block;background:#a51c30;color:#fff;text-decoration:none;padding:10px 16px;border-radius:99px;font-weight:bold;margin:0 6px 6px 0">Call ' + esc_(s.cell) + '</a>' +
    '<a href="https://wa.me/' + cellDigits + '" style="display:inline-block;background:#1c1718;color:#fff;text-decoration:none;padding:10px 16px;border-radius:99px;font-weight:bold;margin:0 6px 6px 0">WhatsApp</a>' +
    '<a href="' + sheetUrl + '" style="display:inline-block;border:1px solid #1c1718;color:#1c1718;text-decoration:none;padding:9px 16px;border-radius:99px;font-weight:bold">Open in spreadsheet</a>' +
    '</p>' + sections +
    '<p style="margin-top:26px;font-size:12px;color:#8a7d7f">Sent automatically by the website quote form. Reply to this email to answer the client directly.</p></div>';

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: 'New quote: ' + s.name + ' (' + (s.vehicles || s.cover) + ')',
    htmlBody: html,
    replyTo: s.email || undefined,
    name: CONFIG.BUSINESS_NAME + ' website',
  });
}

function confirmClient_(p) {
  const first = String(p.summary.name).split(' ')[0];
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1c1718;font-size:15px;line-height:1.55">' +
    '<p>Hi ' + esc_(first) + ',</p>' +
    '<p>Thank you, I have your details. I\'ll compare insurers for you and come back to you with your options.</p>' +
    '<p>Your reference is <b>' + esc_(p.reference) + '</b>. If anything changes in the meantime, just reply to this email or call me on ' + esc_(CONFIG.BROKER_PHONE) + '.</p>' +
    '<p>Kind regards,<br>' + esc_(CONFIG.BROKER_NAME) + '<br>' + esc_(CONFIG.BUSINESS_NAME) + '</p></div>';
  MailApp.sendEmail({
    to: p.summary.email,
    subject: 'Your quote request (' + p.reference + ')',
    htmlBody: html,
    replyTo: CONFIG.NOTIFY_EMAIL.split(',')[0],
    name: CONFIG.BROKER_NAME,
  });
}
