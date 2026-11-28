#!/usr/bin/env node
"use strict";
// TEST ONLY — the owner opt-in STAGING_ALLOW_ANTHROPIC lets through Claude's API (port 443) and nothing else.
// Run offline:  unshare -n env -i PATH="$PATH" HOME="$HOME" node docs/claude/staging/sim/test/sim-anthropic-test.cjs <node_modules>
const { spawnSync } = require("child_process");
const path = require("path");
const SIM = path.join(__dirname, "..", "outbound-sim.cjs");
const MODULES = path.resolve(process.argv[2] || "node_modules");
const BASE = { STAGING_SIM_LOCAL_TEST: "1", DATABASE_URL: "mysql://u:p@db.staging.invalid:4000/leadflow_staging" };
// Prints "blocked" when the simulator refuses the connection, otherwise the (offline) network error.
const probe = host => `globalThis.__stagingSimReady.then(() => { const s = require("tls").connect({ host: "${host}", port: 443, servername: "${host}" });
  s.on("error", e => { console.log("PROBE " + (/blocked/.test(e.message) ? "blocked" : "not-blocked")); process.exit(0); });
  s.on("secureConnect", () => { console.log("PROBE not-blocked"); process.exit(0); }); })`;
function run(extra, host) {
  const r = spawnSync(process.execPath, ["--require", SIM, "-e", probe(host)], { encoding: "utf8", timeout: 60000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: MODULES, ...BASE, ...extra } });
  const out = (r.stdout || "") + (r.stderr || "");
  return { probe: (out.match(/PROBE (\S+)/) || [])[1], active: /ACTIVE: self-test passed \(6\/6\)/.test(out), claude: /Claude API \(owner opt-in/.test(out) };
}
let failed = 0;
const check = (name, ok) => { console.log(`RESULT ${ok ? "PASS" : "FAIL"} | ${name}`); if (!ok) failed++; };
const off = run({}, "api.anthropic.com");
check("without the opt-in, Claude's API is blocked", off.probe === "blocked" && off.active && !off.claude);
const on = run({ STAGING_ALLOW_ANTHROPIC: "true" }, "api.anthropic.com");
check("with the opt-in, Claude's API is allowed and the self-test still passes 6/6", on.probe === "not-blocked" && on.active && on.claude);
const other = run({ STAGING_ALLOW_ANTHROPIC: "true" }, "example.com");
check("with the opt-in, every other outside host is still blocked", other.probe === "blocked");
const lookalike = run({ STAGING_ALLOW_ANTHROPIC: "true" }, "api.anthropic.com.evil.example");
check("a look-alike host name is still blocked", lookalike.probe === "blocked");
const wrongValue = run({ STAGING_ALLOW_ANTHROPIC: "yes" }, "api.anthropic.com");
check("only the exact value \"true\" turns it on", wrongValue.probe === "blocked");
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
