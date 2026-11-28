#!/usr/bin/env node
"use strict";
// TEST ONLY — proves the staging outbound simulator + firewall. Run inside a no-internet sandbox:
//   unshare -n env -i PATH="$PATH" HOME="$HOME" node docs/claude/staging/sim/test/sim-test.cjs <path to node_modules>
// For an independent operating-system check, run it under:  strace -f -e trace=connect,sendto -o <file> ...
const { spawnSync } = require("child_process");
const path = require("path");
const SIM = path.join(__dirname, "..", "outbound-sim.cjs");
const MODULES = path.resolve(process.argv[2] || "node_modules");
const STAGING_OK = { RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: "mysql://u:p@db.staging.invalid:4000/leadflow_staging", PREVIEW_MODE: "true", CRON_DISABLED: "true" };
const wait = "globalThis.__stagingSimReady ? globalThis.__stagingSimReady.then(() => process.exit(0)) : process.exit(0)";

function run(env, args) {
  const r = spawnSync(process.execPath, ["--require", SIM, ...args], { encoding: "utf8", timeout: 120000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: MODULES, ...env } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
let failed = 0;
function expect(name, ok, detail) {
  console.log(`RESULT ${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + String(detail).slice(-600)}`);
  if (!ok) failed++;
}

// 1. Every integration style (simulated / blocked / allowed)
const main = run({ STAGING_SIM_LOCAL_TEST: "1", DATABASE_URL: STAGING_OK.DATABASE_URL }, [path.join(__dirname, "scenarios.cjs")]);
process.stdout.write(main.out.split("\n").filter(l => /RESULT|SIMULATED|ACTIVE|FAILED/.test(l)).join("\n") + "\n");
if (main.code !== 0) failed++;

// 2. Start-up safety checks
let r = run(STAGING_OK, ["-e", wait]);
expect("staging settings correct -> starts, self-test passes", r.code === 0 && /ACTIVE: self-test passed/.test(r.out), r.out);
r = run({ ...STAGING_OK, STRIPE_SECRET_KEY: "sk_live_" + "x".repeat(20) }, ["-e", wait]);
expect("LIVE Stripe key on staging -> refuses to start (value not printed)", r.code === 1 && /LIVE Stripe key/.test(r.out) && !/sk_live_x/.test(r.out), r.out);
r = run({ ...STAGING_OK, SOME_OTHER_SETTING: "pk_live_" + "y".repeat(20) }, ["-e", wait]);
expect("LIVE Stripe key in any variable -> refuses to start", r.code === 1 && /SOME_OTHER_SETTING/.test(r.out), r.out);
r = run({ ...STAGING_OK, DATABASE_URL: "mysql://u:p@db.example.invalid:4000/leadflow" }, ["-e", wait]);
expect("database other than leadflow_staging -> refuses to start", r.code === 1 && /leadflow_staging/.test(r.out), r.out);
r = run({ ...STAGING_OK, CRON_DISABLED: "" }, ["-e", wait]);
expect("scheduled jobs not disabled -> refuses to start", r.code === 1 && /CRON_DISABLED/.test(r.out), r.out);
r = run({ ...STAGING_OK, PREVIEW_MODE: "false" }, ["-e", wait]);
expect("PREVIEW_MODE not true -> refuses to start", r.code === 1 && /PREVIEW_MODE/.test(r.out), r.out);
r = run({ ...STAGING_OK, STRIPE_SECRET_KEY: "sk_test_" + "z".repeat(20) }, ["-e",
  `globalThis.__stagingSimReady.then(() => require("net").connect(443, "api.stripe.com").on("error", e => { console.log(/blocked/.test(e.message) ? "STRIPE BLOCKED" : "STRIPE ALLOWED"); process.exit(0); }))`]);
expect("Stripe TEST key -> Stripe test mode allowed", r.code === 0 && /STRIPE ALLOWED/.test(r.out), r.out);
r = run({ ...STAGING_OK, RAILWAY_ENVIRONMENT_NAME: "production" }, ["-e", `console.log(require("https").request.name); process.exit(0)`]);
expect("production environment -> helper does nothing (no patching)", r.code === 0 && /did nothing/.test(r.out) && /^request$/m.test(r.out), r.out);
r = run({ ...STAGING_OK, RAILWAY_ENVIRONMENT_NAME: "" }, ["-e", `console.log(require("https").request.name); process.exit(0)`]);
expect("no environment name -> helper does nothing", r.code === 0 && /did nothing/.test(r.out) && /^request$/m.test(r.out), r.out);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
