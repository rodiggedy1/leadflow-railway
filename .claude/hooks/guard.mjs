#!/usr/bin/env node
// LeadFlow safety guard for Claude Code (PreToolUse hook).
//
// Runs before every Bash command and every GitHub MCP tool call. It blocks actions that could
// touch production, deploy, change the production database, or contact live services.
// Exit code 2 = block (the reason on stderr is shown to Claude). Exit code 0 = allow.
// The hook is configured with onFailure: "block", so if this script itself fails, the action
// is blocked too (fail-closed).
//
// This file is development tooling only. It is not part of the LeadFlow application and is
// never built, bundled or deployed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ALLOWED_PUSH_BRANCH = /^(claude\/[A-Za-z0-9._\/-]+|staging)$/;
const PROTECTED_BRANCH = /^(refs\/heads\/)?(main|master|preview|production)$/;

function block(reason) {
  process.stderr.write(
    `BLOCKED by LeadFlow safety guard (.claude/hooks/guard.mjs): ${reason}\n` +
      `This action needs the owner's explicit approval and must be done by the owner, not by Claude.\n`,
  );
  process.exit(2);
}

function checkGitPush(cmd) {
  // Every `git ... push ...` segment must push only to a claude/* branch or staging, without force.
  const segments = cmd.split(/&&|\|\||;|\||\n/);
  for (const raw of segments) {
    const seg = raw.trim();
    if (!/\bgit\b/.test(seg) || !/\bpush\b/.test(seg)) continue;
    // Tokenize like git: find `git`, skip its global options (-C dir, -c key=val, --opt[=val]), then expect `push`.
    const tokens = seg.split(/\s+/).filter(Boolean);
    const gitAt = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
    if (gitAt === -1) continue;
    let i = gitAt + 1;
    while (i < tokens.length && tokens[i].startsWith("-")) i += tokens[i] === "-C" || tokens[i] === "-c" ? 2 : 1;
    if (tokens[i] !== "push") continue;
    const pushArgs = tokens.slice(i + 1).filter((t) => !/^\d*[<>]/.test(t)); // drop shell redirections like 2>&1
    if (pushArgs.some((a) => /^(--force|--force-with-lease|--force-if-includes|-f|--mirror|--all|--tags|--delete|-d|--prune)(=|$)/.test(a))) {
      block("force, mirror, delete, tag or bulk pushes are not allowed.");
    }
    const args = pushArgs.filter((a) => !a.startsWith("-"));
    // args[0] = remote, args[1..] = refspecs
    const refspecs = args.slice(1);
    if (refspecs.length === 0) {
      block("`git push` must name the destination branch explicitly (claude/* or staging).");
    }
    for (const spec of refspecs) {
      if (spec.startsWith("+")) block("force refspecs (+branch) are not allowed.");
      const dest = spec.includes(":") ? spec.split(":").pop() : spec;
      const name = dest.replace(/^refs\/heads\//, "");
      if (PROTECTED_BRANCH.test(dest) || !ALLOWED_PUSH_BRANCH.test(name)) {
        block(`pushing to "${dest}" is not allowed. Claude may push only to claude/* branches (and staging once approved).`);
      }
    }
  }
}

const NETWORK_TOOL = /\b(curl|wget|http|https|httpie|nc|ncat|telnet|ssh|scp|mysql|mariadb|mysqldump|psql|node|python3?|deno|bun|tsx|npx)\b/;
const PRODUCTION_HOSTS =
  /(quote\.maidinblack\.com|maidsinblack\.com|maidinblack\.com|\.up\.railway\.app|railway\.app|railway\.com|backboard\.railway|api\.openphone\.com|api\.quo\.|api\.stripe\.com|api\.twilio\.com|api\.vapi\.ai|launch27|tidbcloud\.com|manus\.space|manus\.im|api\.deepgram\.com|gmail\.googleapis\.com|mybusiness\.googleapis\.com|api\.mailgun|hooks\.zapier\.com|ntfy\.sh|api\.thumbtack)/i;

function checkBash(cmd) {
  const c = cmd.replace(/\\\n/g, " ");

  // Releases and deployments
  if (/push-main-safe\.sh/.test(c)) block("the production release script is run by the owner only.");
  if (/(^|[\s;&|(`$])(railway|@railway\/cli)(\s|$)/.test(c)) block("the Railway CLI is not allowed (it can deploy and change production settings).");
  checkGitPush(c);

  // Production database / schema
  if (/\bdb:push\b/.test(c)) block("`pnpm db:push` changes a real database schema.");
  if (/drizzle-kit\s+(push|migrate|drop|up|generate|introspect|pull|studio)\b/.test(c))
    block("drizzle-kit commands that read or change a real database (or rewrite ./drizzle) are not allowed. Only `drizzle-kit export` is permitted.");
  if (/RUN_VERSIONED_MIGRATIONS\s*=\s*true/.test(c) || /runVersionedMigrations(\.js|\.ts)?\b/.test(c)) {
    // Allowed only against a throwaway database on this machine, named explicitly in the command,
    // and only when no other database is configured in the environment.
    const urls = c.match(/DATABASE_URL\s*=\s*['"]?mysql2?:\/\/\S+/g) || [];
    const localOnly = urls.length > 0 && urls.every((u) => /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(u));
    const inheritedRemote = process.env.DATABASE_URL && !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL);
    if (!localOnly || inheritedRemote)
      block("the versioned migration runner applies schema changes. It may run only against a local throwaway database named explicitly in the command (DATABASE_URL=mysql://...@127.0.0.1/...).");
  }
  if (/repairEffectivePayrollRows/.test(c)) block("payroll repair scripts modify production records.");
  if (/\b(mysql|mariadb|mysqldump)\b[^;&|]*\s(-h|--host)(\s*|=)(?!127\.0\.0\.1|localhost)\S/.test(c))
    block("database clients may connect only to a local database (127.0.0.1 / localhost).");
  if (/\bDATABASE_URL\s*=\s*\S*(tidbcloud|rlwy|railway|amazonaws|aivencloud|psdb)/i.test(c))
    block("pointing DATABASE_URL at a hosted database is not allowed.");

  // Operational scripts in the repository root and scripts/ (some send real SMS or write to production)
  if (/\b(node|tsx|bun|ts-node|npx\s+tsx|pnpm\s+exec\s+tsx|deno\s+run)\s+(\S*\/)?(?:\.\/)?(scripts\/)?[\w.-]+\.(mjs|cjs|js|ts)\b/.test(c)) {
    const m = c.match(/\b(?:node|tsx|bun|ts-node|npx\s+tsx|pnpm\s+exec\s+tsx|deno\s+run)\s+((?:\S*\/)?[\w.-]+\.(?:mjs|cjs|js|ts))\b/g) || [];
    for (const hit of m) {
      const file = hit.split(/\s+/).pop();
      const base = file.split("/").pop();
      // A bare or ./scripts/ path is blocked when a file of that name exists at the repository root
      // or in scripts/ (the live operational scripts). Absolute paths into the repository are always checked.
      const projectDir = process.env.CLAUDE_PROJECT_DIR || "/home/user/leadflow-railway";
      const existsInRepo = existsSync(path.join(projectDir, base)) || existsSync(path.join(projectDir, "scripts", base));
      const isRelativeRootOrScripts = /^(\.\/)?(scripts\/)?[\w.-]+\.(mjs|cjs|js|ts)$/.test(file);
      const isAbsoluteIntoRepo = /leadflow-railway\/(scripts\/)?[\w.-]+\.(mjs|cjs|js|ts)$/.test(file);
      if ((isRelativeRootOrScripts && existsInRepo) || isAbsoluteIntoRepo)
        block(`running "${file}" is not allowed: root-level and scripts/ files are live operational scripts (some send real SMS or write to production).`);
    }
  }

  // Live services and production hosts
  if (PRODUCTION_HOSTS.test(c) && NETWORK_TOOL.test(c)) block("commands that contact production or live third-party services are not allowed.");
}

function checkGithubTool(tool, input) {
  const name = tool.replace(/^mcp__github__/, "");
  if (["merge_pull_request", "enable_pr_auto_merge", "actions_run_trigger", "update_pull_request_branch", "delete_file", "fork_repository", "create_repository"].includes(name)) {
    block(`GitHub action "${name}" is not allowed for Claude. Merges and workflow runs are done by the owner.`);
  }
  if (["push_files", "create_or_update_file", "create_branch"].includes(name)) {
    const branch = String(input.branch ?? input.ref ?? "");
    if (!ALLOWED_PUSH_BRANCH.test(branch.replace(/^refs\/heads\//, ""))) {
      block(`GitHub "${name}" to branch "${branch || "(default branch)"}" is not allowed. Only claude/* branches (and staging once approved).`);
    }
  }
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  block("could not read the tool call (fail-closed).");
}
const tool = String(payload.tool_name ?? "");
const input = payload.tool_input ?? {};
if (tool === "Bash") checkBash(String(input.command ?? ""));
else if (tool.startsWith("mcp__github__")) checkGithubTool(tool, input);
process.exit(0);
