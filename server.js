// Local test server. Serves the site and, while no Google Apps Script URL is set in
// assets/js/config.js, catches form submissions and writes them to data/ so the whole
// flow can be tested end to end without Google. Not used in production (static hosting).
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 3010;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".csv": "text/csv; charset=utf-8",
};

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Rebuilds data/test-submissions.csv from every submission so far. Columns are the union
// of all labels in first-seen order, the same rule the Apps Script uses for the Sheet.
function rebuildCsv(all) {
  const headers = [];
  for (const sub of all) for (const [label] of sub.fields) if (!headers.includes(label)) headers.push(label);
  const lines = [headers.map(csvCell).join(",")];
  for (const sub of all) {
    const map = new Map(sub.fields);
    lines.push(headers.map((h) => csvCell(map.get(h))).join(","));
  }
  // BOM so Excel opens the file as UTF-8 (otherwise accented names break)
  fs.writeFileSync(path.join(DATA_DIR, "test-submissions.csv"), "﻿" + lines.join("\r\n"));
}

function handleSubmit(req, res) {
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1e6) req.destroy();
  });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body);
      // Same leading columns the Google Sheet gets, so the test file looks like the real thing
      const s = payload.summary || {};
      payload.fields = [
        ["Reference", payload.reference], ["Received", new Date(payload.submittedAt).toLocaleString("en-ZA")], ["Source", payload.source],
        ["Name", s.name], ["Cell", s.cell], ["Email", s.email], ["Vehicles", s.vehicles],
        ...(payload.fields || []),
      ];
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const jsonPath = path.join(DATA_DIR, "test-submissions.json");
      const all = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : [];
      all.push(payload);
      fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2));
      rebuildCsv(all);
      console.log(`[submit] ${payload.reference} saved (${all.length} total) -> data/test-submissions.csv`);
      res.writeHead(200, { "Content-Type": TYPES[".json"] });
      res.end(JSON.stringify({ ok: true, reference: payload.reference }));
    } catch (err) {
      console.error("[submit] failed:", err.message);
      res.writeHead(400, { "Content-Type": TYPES[".json"] });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/local-submit") return handleSubmit(req, res);

    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Local:   http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces()))
      for (const n of list || []) if (n.family === "IPv4" && !n.internal) console.log(`On Wi-Fi (phone): http://${n.address}:${PORT}`);
  });
