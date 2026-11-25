"use strict";
// LeadFlow — STAGING ONLY outbound simulator + firewall. Not part of the application; no app code is changed.
//
// Loaded only by the staging service's start command:
//   node --require ./docs/claude/staging/sim/outbound-sim.cjs dist/index.js
// Production and Preview start with plain `node dist/index.js`, so they never load it. As an extra guard it does
// nothing unless Railway says the environment is "staging" (or STAGING_SIM_LOCAL_TEST=1 for local tests).
//
// What it does inside the staging app process:
//  1. FIREWALL: every outgoing network connection is checked before it is opened. Only the staging database,
//     the machine itself, and (only with TEST keys) Stripe are allowed. Everything else fails immediately.
//  2. SIMULATOR: requests to OpenPhone/Quo, Twilio, Vapi, Gmail, Google Business and ntfy never leave staging.
//     They get a realistic "success" reply and are written to the staging log as "[staging-sim] SIMULATED ...".
//  3. REFUSES TO START if staging holds a LIVE Stripe key, points at a database other than leadflow_staging,
//     or has scheduled jobs switched on.
//  4. SELF-TEST at start-up: proves outside connections are blocked and simulated services answer; stops otherwise.

const net = require("net");
const http = require("http");
const https = require("https");
const dgram = require("dgram");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TAG = "[staging-sim]";
const MAIN_THREAD = require("worker_threads").isMainThread; // extra app threads are protected too, but stay quiet
const LOCAL_TEST = process.env.STAGING_SIM_LOCAL_TEST === "1";
const ENV_NAME = String(process.env.RAILWAY_ENVIRONMENT_NAME || "").trim().toLowerCase();

if (globalThis.__stagingSimLoaded) return;
if (ENV_NAME !== "staging" && !LOCAL_TEST) {
  console.warn(`${TAG} environment is not "staging": helper did nothing.`);
  return;
}
globalThis.__stagingSimLoaded = true;

function refuse(reason) {
  console.error(`${TAG} REFUSING TO START: ${reason}`);
  process.exit(1);
}

// ---------- 3. start-up safety checks (values are never printed) ----------
for (const [name, value] of Object.entries(process.env)) {
  if (/(^|[^a-z])(sk|rk|pk)_live_/i.test(String(value))) refuse(`variable ${name} holds a LIVE Stripe key. Staging may only use test keys.`);
}
function databaseTarget() {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    return { host: u.hostname.toLowerCase(), port: Number(u.port || 3306), name: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  } catch { return null; }
}
const DB = databaseTarget();
if (!LOCAL_TEST) {
  if (!DB || DB.name !== "leadflow_staging") refuse("DATABASE_URL must point at the leadflow_staging database.");
  if (process.env.PREVIEW_MODE !== "true") refuse("PREVIEW_MODE must be true on staging.");
  if (process.env.CRON_DISABLED !== "true") refuse("CRON_DISABLED must be true on staging (scheduled jobs off).");
}
const STRIPE_TEST = /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || "");

// ---------- which hosts are simulated / allowed ----------
const SIMULATED = [
  [/^api\.(openphone|quo)\.com$/, "OpenPhone"],
  [/(^|\.)twilio\.com$/, "Twilio"],
  [/^api\.vapi\.ai$/, "Vapi"],
  [/^(oauth2|gmail|www)\.googleapis\.com$/, "Google"],
  [/^mybusiness[a-z]*\.googleapis\.com$/, "GoogleBusiness"],
  [/^ntfy\.sh$/, "ntfy"],
];
const cleanHost = h => String(h || "localhost").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
function simulatedService(host) {
  const h = cleanHost(host);
  for (const [re, name] of SIMULATED) if (re.test(h)) return name;
  return null;
}
function isLocal(h) {
  return h === "localhost" || h === "::1" || h === "0.0.0.0" || h.startsWith("127.") || h.startsWith("::ffff:127.");
}
function allowed(host, port) {
  const h = cleanHost(host);
  if (isLocal(h)) return true;
  if (DB && h === DB.host && Number(port) === DB.port) return true;
  if (STRIPE_TEST && h === "api.stripe.com") return true;
  return false;
}

// ---------- 2. simulated replies ----------
const rid = (prefix, n = 24) => prefix + crypto.randomBytes(32).toString("hex").slice(0, n);
const uuid = () => crypto.randomUUID();
function parseBody(body, contentType) {
  if (!body) return {};
  if (/x-www-form-urlencoded/i.test(contentType || "")) return Object.fromEntries(new URLSearchParams(body));
  try { return JSON.parse(body); } catch { return {}; }
}
const one = s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
function emailSummary(raw) {
  try {
    const text = Buffer.from(String(raw), "base64url").toString("utf8");
    const to = (text.match(/^To:\s*(.*)$/im) || [])[1];
    const subject = (text.match(/^Subject:\s*(.*)$/im) || [])[1];
    return `EMAIL to ${one(to)} subject "${one(subject)}"`;
  } catch { return "EMAIL"; }
}

function simulate(service, method, host, fullPath, body, contentType) {
  const p = String(fullPath || "/").split("?")[0];
  const b = parseBody(body, contentType);
  const now = new Date().toISOString();
  const write = method !== "GET" && method !== "HEAD";
  let summary = "";
  let reply;
  switch (service) {
    case "OpenPhone":
      if (write && /\/messages$/.test(p)) {
        summary = `SMS to ${one([].concat(b.to || []).join(","))} from ${one(b.from)}: "${one(b.content ?? b.text)}"`;
        reply = [202, { data: { id: rid("AC"), object: "message", from: b.from, to: b.to, text: b.content ?? b.text, direction: "outgoing", status: "queued", createdAt: now } }];
      }
      break;
    case "Twilio":
      if (write) {
        const prefix = /Calls/.test(p) ? "CA" : /Messages/.test(p) ? "SM" : /Sessions/.test(p) ? "KC" : /Participants/.test(p) ? "KP" : "SI";
        summary = /Calls/.test(p) ? `CALL to ${one(b.To)} from ${one(b.From)}` : /Messages/.test(p) ? `SMS to ${one(b.To)}: "${one(b.Body)}"` : `${method} ${p}`;
        reply = [201, { sid: rid(prefix, 32), account_sid: "AC" + "0".repeat(32), status: "queued", to: b.To, from: b.From, body: b.Body,
          proxy_identifier: "+19992000000", date_created: new Date().toUTCString(), date_updated: new Date().toUTCString(), uri: p }];
      }
      break;
    case "Vapi":
      if (write && /^\/call\/?$/.test(p)) {
        summary = `AI PHONE CALL to ${one(b.customer?.number)}`;
        reply = [201, { id: uuid(), orgId: "sim-org", type: "outboundPhoneCall", status: "queued", createdAt: now, updatedAt: now, assistantId: b.assistantId, customer: b.customer }];
      } else if (write && /^\/assistant/.test(p)) {
        summary = `assistant ${method} ${one(b.name)}`;
        reply = [201, { id: uuid(), name: b.name, createdAt: now, updatedAt: now }];
      } else if (!write && /^\/call\/[^/]+$/.test(p)) {
        reply = [200, { id: p.split("/")[2], status: "ended", endedReason: "customer-ended-call", type: "outboundPhoneCall", createdAt: now, endedAt: now, transcript: "", messages: [], analysis: {} }];
      } else if (!write && /^\/(call|assistant|phone-number)\/?$/.test(p)) {
        reply = [200, []];
      } else if (!write && /recording/.test(p)) {
        reply = [404, { message: "No recording on staging (simulated)" }];
      }
      break;
    case "Google":
      if (/\/token$/.test(p)) {
        reply = [200, { access_token: rid("ya29.SIM_", 40), expires_in: 3599, token_type: "Bearer", scope: "simulated" }];
      } else if (write && /\/messages\/send$/.test(p)) {
        summary = emailSummary(b.raw);
        reply = [200, { id: rid("", 16), threadId: rid("", 16), labelIds: ["SENT"] }];
      } else if (write && /\/drafts$/.test(p)) {
        summary = `email draft ${emailSummary(b.message?.raw)}`;
        reply = [200, { id: rid("r", 16), message: { id: rid("", 16), threadId: rid("", 16) } }];
      } else if (write && /\/watch$/.test(p)) {
        reply = [200, { historyId: "1", expiration: String(Date.now() + 7 * 864e5) }];
      } else if (!write && /\/profile$/.test(p)) {
        reply = [200, { emailAddress: "staging-inbox@example.invalid", messagesTotal: 0, threadsTotal: 0, historyId: "1" }];
      } else if (!write && /\/history$/.test(p)) {
        reply = [200, { history: [], historyId: "1" }];
      } else if (!write && /\/(messages|threads)$/.test(p)) {
        reply = [200, { messages: [], threads: [], resultSizeEstimate: 0 }];
      } else if (!write && /\/labels$/.test(p)) {
        reply = [200, { labels: [] }];
      }
      break;
    case "GoogleBusiness":
      if (write && /\/reply$/.test(p)) {
        summary = `REVIEW REPLY: "${one(b.comment)}"`;
        reply = [200, { comment: b.comment, updateTime: now }];
      } else if (!write) {
        reply = [200, { accounts: [], locations: [], reviews: [], totalReviewCount: 0, averageRating: 0 }];
      }
      break;
    case "ntfy":
      summary = `OWNER NOTIFICATION: "${one(body)}"`;
      reply = [200, { id: rid("", 12), time: Math.floor(Date.now() / 1000), event: "message", topic: p.slice(1), message: one(body) }];
      break;
  }
  if (!reply) reply = write ? [200, { id: rid("SIM_"), status: "ok", simulated: true }] : [200, { data: [], items: [], simulated: true }];
  if (!/staging-sim-selftest/.test(p)) console.log(`${TAG} SIMULATED ${service} ${method} ${cleanHost(host)}${p}${summary ? " | " + summary : ""}`);
  return reply;
}

// Local in-process server that answers simulated http/https.request calls (a Unix socket file, no network port).
const SOCK = path.join(os.tmpdir(), `staging-sim-${process.pid}-${require("worker_threads").threadId}.sock`);
try { fs.unlinkSync(SOCK); } catch {}
const origHttpRequest = http.request;
const simServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const host = String(req.headers["x-staging-sim-host"] || "");
    const [status, json] = simulate(simulatedService(host) || "unknown", req.method, host, req.url, Buffer.concat(chunks).toString("utf8"), req.headers["content-type"]);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 204 ? undefined : JSON.stringify(json));
  });
});
simServer.listen(SOCK);
simServer.unref();
process.on("exit", () => { try { fs.unlinkSync(SOCK); } catch {} });

// ---------- patch http/https: simulated hosts go to the local simulator ----------
function requestTarget(args) {
  let url = null, opts = {}, cb, i = 0;
  if (typeof args[0] === "string" || args[0] instanceof URL) { try { url = new URL(String(args[0])); } catch { return null; } i = 1; }
  if (args[i] && typeof args[i] === "object") { opts = args[i]; i++; }
  if (typeof args[i] === "function") cb = args[i];
  if (opts.socketPath) return null;
  const host = cleanHost(opts.hostname || (opts.host && String(opts.host).replace(/:\d+$/, "")) || (url && url.hostname));
  const headers = opts.headers && !Array.isArray(opts.headers) ? { ...opts.headers } : {};
  return { host, cb, headers, method: String(opts.method || "GET").toUpperCase(), path: opts.path || (url ? url.pathname + url.search : "/") };
}
for (const mod of [http, https]) {
  const orig = mod.request;
  mod.request = function stagingSimRequest(...args) {
    const t = requestTarget(args);
    if (!t || !simulatedService(t.host)) return orig.apply(this, args);
    return origHttpRequest({ socketPath: SOCK, method: t.method, path: t.path, agent: false,
      headers: { ...t.headers, "x-staging-sim-host": t.host } }, t.cb);
  };
  mod.get = function stagingSimGet(...args) { const r = mod.request(...args); r.end(); return r; };
}

// ---------- patch fetch: simulated hosts answered directly ----------
const origFetch = globalThis.fetch;
if (typeof origFetch === "function") {
  globalThis.fetch = async function stagingSimFetch(input, init) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url); } catch { return origFetch(input, init); }
    const service = simulatedService(url.hostname);
    if (!service) return origFetch(input, init);
    const req = new Request(input, init ? { ...init, duplex: init.duplex || "half" } : undefined);
    const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
    const [status, json] = simulate(service, req.method, url.hostname, url.pathname + url.search, body, req.headers.get("content-type"));
    return new Response(status === 204 ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
}

// ---------- 1. firewall: every TCP/TLS connection (http, https, fetch, websockets, SDKs, SMTP...) ----------
const blockedCounts = new Map();
let selfTesting = false;
function logBlocked(host, port) {
  if (selfTesting) return;
  const key = `${host}:${port}`;
  const n = (blockedCounts.get(key) || 0) + 1;
  blockedCounts.set(key, n);
  if (n <= 3 || n % 50 === 0) console.warn(`${TAG} BLOCKED outbound connection to ${key} (attempt ${n})`);
}
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function stagingSimConnect(...args) {
  let o = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host, port;
  if (o && typeof o === "object") {
    if (o.path) return origConnect.apply(this, args);
    host = o.host; port = o.port;
  } else if (typeof o === "string" && !/^\d+$/.test(o)) {
    return origConnect.apply(this, args); // local Unix socket path
  } else {
    port = o; host = typeof args[1] === "string" ? args[1] : undefined;
  }
  host = cleanHost(host);
  if (allowed(host, port)) return origConnect.apply(this, args);
  logBlocked(host, port);
  const err = Object.assign(new Error(`${TAG} blocked outbound connection to ${host}:${port} (staging may not contact outside services)`),
    { code: "ECONNREFUSED", syscall: "connect", address: host, port: Number(port) });
  process.nextTick(() => this.destroy(err));
  return this;
};
const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function stagingSimSend(...args) {
  const addr = args.find((a, i) => i > 0 && typeof a === "string");
  if (addr && isLocal(cleanHost(addr))) return origSend.apply(this, args);
  logBlocked(addr || "?", "udp");
  const cb = args.find(a => typeof a === "function");
  if (cb) process.nextTick(cb, new Error(`${TAG} blocked outbound UDP`));
};
try { require("module").syncBuiltinESMExports(); } catch {}

// ---------- 4. self-test at start-up ----------
function expectBlocked(start) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(false), 5000); t.unref();
    let s;
    try { s = start(); } catch (e) { clearTimeout(t); return resolve(/blocked/.test(String(e?.message))); }
    s.on("error", e => { clearTimeout(t); resolve(/blocked/.test(String(e?.message))); });
    for (const ev of ["connect", "secureConnect", "response"]) s.on(ev, () => { clearTimeout(t); resolve(false); try { s.destroy(); } catch {} });
  });
}
async function selfTest() {
  const tls = require("tls");
  selfTesting = true;
  const checks = [
    ["raw connection", await expectBlocked(() => net.connect(443, "example.com"))],
    ["secure connection", await expectBlocked(() => tls.connect({ host: "example.com", port: 443, servername: "example.com" }))],
    ["https request", await expectBlocked(() => https.get("https://example.com/"))],
    ["fetch", await globalThis.fetch("https://example.com/").then(() => false, e => /blocked/.test(String(e?.cause?.message || e?.message)))],
    ["simulated fetch", await globalThis.fetch("https://api.openphone.com/v1/staging-sim-selftest").then(r => r.ok, () => false)],
    ["simulated https", await new Promise(r => https.get("https://ntfy.sh/staging-sim-selftest", res => { res.resume(); r(res.statusCode === 200); }).on("error", () => r(false)))],
  ];
  selfTesting = false;
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length) {
    console.error(`${TAG} SELF-TEST FAILED (${failed.join(", ")}): stopping so staging cannot run unprotected.`);
    process.exit(1);
  }
  if (MAIN_THREAD) console.log(`${TAG} ACTIVE: self-test passed (${checks.length}/${checks.length}). Outside connections blocked; allowed: ` +
    `${DB ? "database " + DB.host : "no database"}, this machine${STRIPE_TEST ? ", Stripe TEST mode" : ""}. ` +
    `Simulated: OpenPhone/Quo, Twilio, Vapi, Gmail, Google Business reviews, ntfy.`);
}
if (MAIN_THREAD) console.log(`${TAG} loading firewall + simulator (environment: ${LOCAL_TEST ? "local test" : ENV_NAME})`);
globalThis.__stagingSimReady = new Promise(r => setImmediate(() => selfTest().then(r)));
