// Self-test for .claude/hooks/guard.mjs. Feeds synthetic hook payloads to the guard; nothing in them is executed.
// Run: node .claude/hooks/guard-selftest.mjs   (expects every case to PASS)
import { spawnSync } from "node:child_process";
const GUARD = process.argv[2] ?? new URL("./guard.mjs", import.meta.url).pathname;
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const gh = (tool, input) => ({ tool_name: `mcp__github__${tool}`, tool_input: input });
const cases = [
  // [payload, expectBlocked, label]
  [bash("git push origin main"), true, "push to main"],
  [bash("git push -u origin HEAD:main"), true, "push HEAD:main"],
  [bash("git -C /home/user/leadflow-railway push origin main"), true, "push main via -C"],
  [bash("cd x && git push origin preview"), true, "push preview in chain"],
  [bash("git push origin production"), true, "push production"],
  [bash("git push origin refs/heads/main"), true, "push refs/heads/main"],
  [bash("git push --force origin claude/x"), true, "force push"],
  [bash("git push origin +claude/x"), true, "force refspec"],
  [bash("git push origin"), true, "push without branch"],
  [bash("git push origin --tags"), true, "push tags"],
  [bash("git push origin pre-production-123"), true, "push tag-like ref"],
  [bash("./scripts/push-main-safe.sh abc pre-production-x"), true, "release script"],
  [bash("DRY_RUN=1 bash scripts/push-main-safe.sh a b"), true, "release script dry run"],
  [bash("railway up"), true, "railway up"],
  [bash("npx @railway/cli variables"), true, "railway via npx"],
  [bash("pnpm db:push"), true, "db:push"],
  [bash("npx drizzle-kit push"), true, "drizzle-kit push"],
  [bash("npx drizzle-kit migrate"), true, "drizzle-kit migrate"],
  [bash("npx drizzle-kit generate"), true, "drizzle-kit generate"],
  [bash("RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js"), true, "migration runner"],
  [bash("node dist/runVersionedMigrations.js"), true, "migration runner bare"],
  [bash("DATABASE_URL=mysql://u:p@gateway01.tidbcloud.com:4000/db RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js"), true, "migration runner remote db"],
  [bash("DATABASE_URL=mysql://root@127.0.0.1:3306/a DATABASE_URL=mysql://u@prod.example.com/b RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js"), true, "migration runner mixed dbs"],
  [bash("DATABASE_URL=mysql://root@127.0.0.1:3306/leadflow_local RUN_VERSIONED_MIGRATIONS=true node dist/runVersionedMigrations.js"), false, "migration runner local db"],
  [bash("node send_20.mjs"), true, "send_20 script"],
  [bash("node ./send_next48.mjs"), true, "send_next48 script"],
  [bash("cd /home/user/leadflow-railway && node backfill_client_sms.mjs"), true, "backfill script"],
  [bash("npx tsx scripts/reconcile-gmail-state.ts"), true, "scripts/ ts"],
  [bash("node /home/user/leadflow-railway/cancel_overdue.mjs"), true, "absolute root script"],
  [bash("node query2.cjs"), true, "root cjs"],
  [bash("curl https://quote.maidinblack.com/api/health"), true, "curl production"],
  [bash("curl -X POST https://api.openphone.com/v1/messages"), true, "curl openphone"],
  [bash("wget https://foo.up.railway.app/api/preview-login"), true, "wget preview"],
  [bash("node -e \"fetch('https://api.stripe.com/v1/charges')\""), true, "node fetch stripe"],
  [bash("mysql -h gateway01.us-east-1.prod.aws.tidbcloud.com -u x"), true, "mysql remote"],
  // Launch27: its web addresses stay blocked; only the bare word (database column names) is no longer a trigger.
  [bash("curl https://maidsinblack.launch27.com/api/v1/bookings"), true, "curl Launch27 account host"],
  [bash("node -e \"fetch('https://api.launch27.com/v1/bookings')\""), true, "node fetch Launch27 API"],
  [bash("wget HTTPS://LAUNCH27.COM/"), true, "wget Launch27 uppercase"],
  [bash("DATABASE_URL=mysql://u:p@gateway01.tidbcloud.com:4000/db npx vitest run"), true, "hosted DATABASE_URL"],
  [gh("merge_pull_request", { owner: "o", repo: "r", pullNumber: 1 }), true, "gh merge"],
  [gh("push_files", { branch: "main", files: [] }), true, "gh push_files main"],
  [gh("create_or_update_file", { branch: "preview", path: "x" }), true, "gh update file preview"],
  [gh("create_or_update_file", { path: "x" }), true, "gh update file default branch"],
  [gh("actions_run_trigger", {}), true, "gh run workflow"],
  // allowed
  [bash("git push -u origin claude/zealous-albattani-a1pbpw"), false, "push own branch"],
  [bash("git push origin HEAD:claude/zealous-albattani-a1pbpw"), false, "push HEAD to own branch"],
  [bash("git push origin staging"), false, "push staging"],
  [bash("git -c push.negotiate=true push -u origin claude/zealous-albattani-a1pbpw"), false, "push own branch with -c option"],
  [bash("git push -u origin claude/x 2>&1 | tail -3"), false, "push own branch with redirection"],
  [bash("git -c push.negotiate=true push -u origin main"), true, "push main with -c option"],
  [bash("git push origin main 2>&1"), true, "push main with redirection"],
  [bash("/usr/bin/git push origin preview"), true, "push preview via full git path"],
  [bash("git status && git log --oneline -5"), false, "git status/log"],
  [bash("git commit -m 'docs: add staging guide'"), false, "git commit"],
  [bash("npx vitest run server/foo.test.ts"), false, "vitest"],
  [bash("npx tsc --noEmit"), false, "tsc"],
  [bash("pnpm build"), false, "build"],
  [bash("npx drizzle-kit export --dialect mysql --schema ./drizzle/schema.ts"), false, "drizzle-kit export"],
  [bash("node .claude/hooks/guard.mjs"), false, "guard itself"],
  [bash("cd /tmp/x && node shoot.cjs"), false, "bare non-repo script"],
  [bash("node scripts/check-gmail-quota.mjs"), true, "scripts/ file that exists"],
  [bash("node audit_rows.mjs"), true, "root file that exists"],
  [bash("node dist/index.js"), false, "start built server locally"],
  [bash("grep -rn quote.maidinblack.com server"), false, "grep for host"],
  [bash("mysql -h 127.0.0.1 -u root leadflow_local"), false, "local mysql"],
  [bash("mysql -h 127.0.0.1 -u root t -e \"SELECT launch27TeamId FROM scheduling_teams WHERE origin = 'launch27_import'\""), false, "local query naming Launch27 columns"],
  [bash("npx vitest run server/launch27Sync.test.ts"), false, "local test file named after Launch27"],
  [gh("push_files", { branch: "claude/zealous-albattani-a1pbpw", files: [] }), false, "gh push own branch"],
  [gh("create_pull_request", { base: "main", head: "claude/x" }), false, "gh create PR"],
  [gh("list_branches", {}), false, "gh read"],
  [{ tool_name: "Read", tool_input: { file_path: "x" } }, false, "non-Bash tool"],
];
let pass = 0, fail = 0;
for (const [payload, expectBlocked, label] of cases) {
  const r = spawnSync("node", [GUARD], { input: JSON.stringify(payload), encoding: "utf8" });
  const blocked = r.status === 2;
  const ok = blocked === expectBlocked && (r.status === 0 || r.status === 2);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${expectBlocked ? "block" : "allow"}  ${label}${ok ? "" : `  (exit ${r.status}: ${r.stderr.trim().slice(0, 160)})`}`);
}
console.log(`\n${pass} passed, ${fail} failed, ${cases.length} total`);
// Fail-closed check: malformed input must block.
const bad = spawnSync("node", [GUARD], { input: "not json", encoding: "utf8" });
console.log(`malformed input -> exit ${bad.status} (${bad.status === 2 ? "PASS: blocked" : "FAIL"})`);
process.exit(fail ? 1 : 0);
