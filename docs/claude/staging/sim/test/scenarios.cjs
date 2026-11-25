"use strict";
// TEST ONLY. Run by sim-test.cjs inside a child process that preloads outbound-sim.cjs.
// Uses the same libraries the app uses (fetch, axios, Twilio SDK, Google SDK, Stripe SDK, ws, raw sockets).
const net = require("net"), tls = require("tls"), https = require("https"), http = require("http"), http2 = require("http2"), dgram = require("dgram");
const results = [];
const flat = e => { try { return [e?.message, e?.cause?.message, e?.cause?.cause?.message, e?.detail?.message, e?.raw?.message, ...(e?.errors || []).map(x => x?.message)].join(" | "); } catch { return String(e); } };
const isBlocked = e => /staging-sim\] blocked/.test(flat(e));
async function check(name, fn) {
  try { const r = await fn(); results.push([name, r === true ? "PASS" : `FAIL: ${typeof r === "string" ? r : JSON.stringify(r)}`]); }
  catch (e) { results.push([name, `FAIL: ${flat(e)}`]); }
}
const blockedBy = p => p.then(() => "it connected", e => isBlocked(e) || flat(e));
const sockBlocked = s => new Promise(r => { s.on("error", e => r(isBlocked(e) || flat(e))); s.on("connect", () => r("it connected")); s.on("secureConnect", () => r("it connected")); });
const json = (url, method, body, headers = {}) => fetch(url, { method, headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });

(async () => {
  await globalThis.__stagingSimReady;
  // ---- simulated: these must "succeed" without leaving the process ----
  await check("SIMULATED  OpenPhone text (fetch, as server/openphone.ts)", async () => {
    const r = await json("https://api.openphone.com/v1/messages", "POST", { content: "Hi Alex, your clean is confirmed for Tuesday.", from: "+19992000001", to: ["+19992000123"] }, { Authorization: "SIM" });
    const j = await r.json(); return (r.status === 202 && /^AC/.test(j.data.id)) || j;
  });
  await check("SIMULATED  OpenPhone text (axios)", async () => {
    const r = await require("axios").post("https://api.openphone.com/v1/messages", { content: "axios test", from: "+19992000001", to: ["+19992000124"] });
    return (r.status === 202 && !!r.data.data.id) || r.data;
  });
  await check("SIMULATED  Twilio phone call (Twilio SDK)", async () => {
    const call = await require("twilio")("AC" + "0".repeat(32), "sim-token").calls.create({ to: "+19992000123", from: "+19992000002", url: "https://example.invalid/twiml" });
    return /^CA/.test(call.sid) || call;
  });
  await check("SIMULATED  Vapi AI phone call (fetch)", async () => {
    const r = await json("https://api.vapi.ai/call", "POST", { assistantId: "sim", customer: { number: "+19992000123" } }, { Authorization: "Bearer SIM" });
    const j = await r.json(); return (r.status === 201 && !!j.id) || j;
  });
  await check("SIMULATED  Gmail email (Google SDK, incl. login token)", async () => {
    const { google } = require("googleapis");
    const auth = new google.auth.OAuth2("sim.apps.googleusercontent.com", "sim", "https://example.invalid/cb");
    auth.setCredentials({ refresh_token: "sim" });
    const raw = Buffer.from("To: u000001@example.invalid\r\nSubject: Your booking is confirmed\r\n\r\nHello").toString("base64url");
    const r = await google.gmail({ version: "v1", auth }).users.messages.send({ userId: "me", requestBody: { raw } });
    return !!r.data.id || r.data;
  });
  await check("SIMULATED  Google review reply (fetch)", async () => {
    const r = await json("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/3/reply", "PUT", { comment: "Thank you for the kind words!" });
    return r.status === 200 || r.status;
  });
  await check("SIMULATED  owner notification ntfy (fetch)", async () => {
    const r = await fetch("https://ntfy.sh/staging-topic", { method: "POST", body: "New lead: Alex Example" }); return r.ok || r.status;
  });
  // ---- blocked: production, AI, payments without test key, data sources, every connection style ----
  await check("BLOCKED    live LeadFlow site (fetch)", () => blockedBy(fetch("https://quote.maidinblack.com/api/health")));
  await check("BLOCKED    OpenAI (https.request)", () => new Promise(r => https.get("https://api.openai.com/v1/models").on("error", e => r(isBlocked(e) || flat(e))).on("response", () => r("it connected"))));
  await check("BLOCKED    Anthropic (axios)", () => blockedBy(require("axios").get("https://api.anthropic.com/v1/models")));
  await check("BLOCKED    Stripe without a TEST key (Stripe SDK)", () => blockedBy(require("stripe")("sk_test_notreal", { maxNetworkRetries: 0 }).customers.list()));
  await check("BLOCKED    Launch27 (fetch)", () => blockedBy(fetch("https://maidsinblack.launch27.com/api/bookings")));
  await check("BLOCKED    Thumbtack (fetch)", () => blockedBy(fetch("https://api.thumbtack.com/api/v4/businesses/1/reviews")));
  await check("BLOCKED    file storage R2 (https.request)", () => new Promise(r => https.request({ hostname: "abc.r2.cloudflarestorage.com", method: "PUT", path: "/x" }).on("error", e => r(isBlocked(e) || flat(e))).end()));
  await check("BLOCKED    websocket (ws)", () => new Promise(r => { const W = require("ws"); new W("wss://example.com/socket").on("error", e => r(isBlocked(e) || flat(e))).on("open", () => r("it connected")); }));
  await check("BLOCKED    HTTP/2", () => new Promise(r => http2.connect("https://example.com").on("error", e => r(isBlocked(e) || flat(e))).on("connect", () => r("it connected"))));
  await check("BLOCKED    raw TLS", () => sockBlocked(tls.connect({ host: "example.com", port: 443, servername: "example.com" })));
  await check("BLOCKED    email server SMTP", () => sockBlocked(net.connect(587, "smtp.gmail.com")));
  await check("BLOCKED    UDP", () => new Promise(r => { const s = dgram.createSocket("udp4"); s.send("x", 53, "8.8.8.8", e => { s.close(); r(e ? /blocked/.test(e.message) || e.message : "it was sent"); }); }));
  // ---- allowed: the staging database (exact host + port) and this machine ----
  await check("ALLOWED    staging database host:port (not blocked)", () => new Promise(r => net.connect(4000, "db.staging.invalid").on("error", e => r(!isBlocked(e) || "was blocked")).on("connect", () => r(true))));
  await check("BLOCKED    same database host, other port", () => sockBlocked(net.connect(4001, "db.staging.invalid")));
  await check("ALLOWED    this machine (127.0.0.1)", () => new Promise(r => {
    const srv = http.createServer((q, s) => s.end("ok")).listen(0, "127.0.0.1", async () => {
      const t = await fetch(`http://127.0.0.1:${srv.address().port}/`).then(x => x.text(), e => flat(e)); srv.close(); r(t === "ok" || t);
    });
  }));
  for (const [n, s] of results) console.log(`RESULT ${s.startsWith("PASS") ? "PASS" : "FAIL"} | ${n}${s.startsWith("PASS") ? "" : " | " + s}`);
  process.exit(results.every(([, s]) => s === "PASS") ? 0 : 1);
})();
