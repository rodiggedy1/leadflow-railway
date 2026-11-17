import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import * as ts from "typescript";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

// Offline real ReactDOM/client + real DOMPurify + actual full detail component.
// Only the page's overlay is extracted: no app/server/provider/router is imported.
// All tRPC calls are synthetic; mutations throw and are counted. Chromium also
// blocks external traffic via CSP and the resolver. No Send/Resolve is clicked.
const ROOT = resolve(import.meta.dirname, "..");
const ARTIFACTS = mkdtempSync(join(tmpdir(), "email-navigation-parity-"));
const FIXTURES = join(ROOT, "server/fixtures/email-display-parity");
const FIXTURE = join(FIXTURES, "navigation-browser.tsx.fixture");
const A = "19_NAVIGATION_EXACT_A_001";
const B = "19_NAVIGATION_EXACT_B_002";
const sha = (source: string) => createHash("sha256").update(source).digest("hex");
let candidate: string;
let control: string;
let sourceReceipt: Record<string, unknown>;
const results = new Map<string, any>();

beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const page = readFileSync(join(ROOT, "client/src/pages/CommandChatExactLive.tsx"), "utf8");
  const detailPath = join(ROOT, "client/src/pages/CommandChatEmailDetail.tsx");
  const detail = readFileSync(detailPath, "utf8");
  const parsed = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const overlay = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ExactEmailWorkspaceOverlay");
  expect(overlay).toBeDefined();
  const code = overlay!.getText(parsed);
  expect(code).toContain("key={threadId}");
  expect(code).toContain("initialThreadId={threadId}");
  expect(code).toContain("detailOnly");
  // The negative control differs ONLY by removal of the corrected child key.
  const broken = code.replace("key={threadId} ", "");
  expect(broken).not.toBe(code);
  const require = createRequire(import.meta.url);
  const preflight = readFileSync(join(dirname(require.resolve("tailwindcss/package.json")), "preflight.css"), "utf8");
  const pageCss = readFileSync(join(ROOT, "client/src/pages/command-chat-exact-live.css"), "utf8");
  sourceReceipt = { pageSha256: sha(page), detailSha256: sha(detail), overlay: code, baseline: "same actual full detail, same CSS, same fixtures; only child key removed", compiled: ["actual overlay", "actual complete CommandChatEmailDetail", "ReactDOM/client", "DOMPurify", "lucide-react"], mocks: ["tRPC", "sonner toast"], css: "actual detail CSS imports plus page CSS, with installed Tailwind preflight reset" };
  async function compile(overlayCode: string) {
    const css = new Map<string, string>();
    const bundle = await build({
      absWorkingDir: ROOT, entryPoints: [FIXTURE], bundle: true, write: false,
      platform: "browser", format: "iife", jsx: "automatic", minify: true,
      nodePaths: [join(ROOT, "node_modules")], define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{ name: "offline-navigation-only", setup(builder) {
        builder.onLoad({ filter: /navigation-browser\.tsx\.fixture$/ }, () => ({ contents: readFileSync(FIXTURE, "utf8"), loader: "tsx", resolveDir: ROOT }));
        builder.onResolve({ filter: /^navigation-actual-overlay$/ }, () => ({ path: "overlay", namespace: "navigation" }));
        builder.onLoad({ filter: /^overlay$/, namespace: "navigation" }, () => ({ contents: `import React from 'react'; import CommandChatEmailDetail from ${JSON.stringify(detailPath)}; export ${overlayCode}`, loader: "tsx", resolveDir: ROOT }));
        builder.onLoad({ filter: /CommandChatEmailDetail\.tsx$/ }, () => ({ contents: detail, loader: "tsx", resolveDir: dirname(detailPath) }));
        builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "navigation" }));
        builder.onLoad({ filter: /^trpc$/, namespace: "navigation" }, () => ({ contents: `export { trpc } from ${JSON.stringify(FIXTURE)};`, loader: "ts", resolveDir: ROOT }));
        builder.onResolve({ filter: /^sonner$/ }, () => ({ path: "toast", namespace: "navigation" }));
        builder.onLoad({ filter: /^toast$/, namespace: "navigation" }, () => ({ contents: `export const toast={error(message){throw new Error('Unexpected offline toast: '+message)}};`, loader: "js" }));
        builder.onLoad({ filter: /\.css$/ }, args => { css.set(args.path, readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
      } }],
    });
    // Keep source import order (not concurrent esbuild onLoad completion order).
    const imports = [...detail.matchAll(/^import "(\.\/[^\"]+\.css)";/gm)].map(match => join(dirname(detailPath), match[1]));
    const styles = [preflight, ...imports.map(path => css.get(path)!), pageCss].join("\n");
    expect(styles).not.toContain("undefined");
    const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'"><style>${styles}</style></head><body><div id="root"></div><script>${js}</script><script>setTimeout(async()=>{let result;try{result=await window.navigationRun();}catch(error){result={fatal:String(error),stack:error.stack};}const output=document.createElement('pre');output.id='navigation-result';output.hidden=true;output.textContent=btoa(unescape(encodeURIComponent(JSON.stringify(result))));document.body.append(output);},50);</script></body></html>\n`;
  }
  candidate = await compile(code);
  control = await compile(broken);
  writeFileSync(join(ARTIFACTS, "navigation-candidate.html"), candidate);
  writeFileSync(join(ARTIFACTS, "navigation-key-removed-control.html"), control);
  writeFileSync(join(ARTIFACTS, "navigation-source-receipt.json"), JSON.stringify(sourceReceipt, null, 2) + "\n");
}, 30_000);

afterAll(() => { rmSync(ARTIFACTS, { recursive: true, force: true }); });

function run(width: number, height: number, variant: "candidate" | "control") {
  const id = `${variant}-${width}x${height}`;
  if (results.has(id)) return results.get(id);
  const file = join(ARTIFACTS, variant === "candidate" ? "navigation-candidate.html" : "navigation-key-removed-control.html");
  const output = execFileSync("python3", [join(FIXTURES, "navigation-chromium.py"), file, String(width), String(height)], { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const result = JSON.parse(output);
  writeFileSync(join(ARTIFACTS, `navigation-${id}-results.json`), JSON.stringify(result, null, 2) + "\n");
  expect(result.fatal, JSON.stringify(result)).toBeUndefined();
  results.set(id, result);
  return result;
}
function navigationCorrect(result: any) {
  return result.navigation.subject === "Exact subject B" && result.navigation.hasOldA === false
    && result.navigation.queries.filter((row: any) => row.name === "getThread").every((row: any) => row.input.threadId === B)
    && result.navigation.queries.some((row: any) => row.name === "getThread" && row.input.threadId === B);
}
function safe(result: any) {
  expect(result.audit.mutations).toEqual([]);
  expect(result.audit.outbound).toEqual([]);
  expect(result.audit.errors).toEqual([]);
  expect(result.browserExternalRequests).toEqual([]);
  expect(result.closeCount).toBe(0);
}

describe("actual email overlay navigation parity (offline Chromium React DOM)", () => {
  it.each([[390, 844], [1100, 900]])("navigates exact A → B without unmounting overlay; same thread retains reply/dismissal/scroll (%ipx)", (width, height) => {
    const result = run(width, height, "candidate");
    expect(result.a.viewport.width).toBe(width);
    expect(navigationCorrect(result)).toBe(true);
    expect(result.navigation.popupIdentity).toBe(true);
    expect(result.navigation.detailRemounted).toBe(true);
    expect(result.navigation.sender).toContain("b@example.test");
    expect(result.navigation.reply).toBe("");
    expect(result.navigation.draft).toContain("Synthetic Madison draft B");
    expect(result.navigation.draft).not.toContain("Synthetic Madison draft A");
    expect(result.same).toMatchObject({ popupIdentity: true, ownerIdentity: true, textareaIdentity: true, reply: "Offline unsent local UI state; NEVER send", draftDismissed: true });
    expect(result.same.scrollTop).toBe(result.same.beforeSameScrollTop);
    expect(result.same.scrollTop).toBeGreaterThan(0);
    expect(result.audit.queries.find((row: any) => row.name === "getThread").input.threadId).toBe(A);
    safe(result);
  }, 25_000);

  it.each([[390, 844], [1100, 900]])("retains entire HTML/plain/outbound thread inside one moving body viewport; composer/header/rail fixed (%ipx)", (width, height) => {
    const result = run(width, height, "candidate");
    for (const layout of [result.a, result.b]) {
      expect(layout).toMatchObject({ entries: 4, outsideEntries: 0, cards: 0, tabs: 0, fullMarkers: true, htmlParagraphs: 92, exactPlain: true, fullLastReply: true, lastReplyEndVisible: true, fixedOnBodyScroll: true, threadOverflow: "hidden", ownerOverflow: "auto", sanitized: true, xss: 0, popupHasOuterScroll: false, threadHasOuterScroll: false, documentHasOuterScroll: false });
      expect(layout.ownerHeight).toBeGreaterThan(20);
      expect(layout.ownerScrollHeight).toBeGreaterThan(layout.ownerHeight);
      expect(layout.scrollTop).toBeGreaterThan(0);
      expect(layout.scrollOwners).toEqual(["em2-msg-body em2-msg-body-scroll-owner"]);
      expect(layout.composer.bottom).toBeLessThanOrEqual(layout.popup.bottom + 1);
      expect(layout.composer.top).toBeGreaterThanOrEqual(layout.popup.top);
      expect(layout.popup.left).toBeGreaterThanOrEqual(0);
      expect(layout.popup.right).toBeLessThanOrEqual(width + 1);
      expect(layout.light).toBe("rgb(219, 230, 239)");
    }
    safe(result);
  }, 25_000);

  it("proves the same DOM navigation predicate fails without child key (stale A), while corrected overlay passes", () => {
    const broken = run(1100, 900, "control");
    expect(navigationCorrect(broken)).toBe(false);
    expect(broken.navigation.subject).toBe("Exact subject A");
    expect(broken.navigation.hasOldA).toBe(true);
    expect(broken.navigation.detailRemounted).toBe(false);
    expect(broken.navigation.popupIdentity).toBe(true);
    expect(broken.navigation.queries.filter((row: any) => row.name === "getThread").map((row: any) => row.input.threadId)).toEqual([A]);
    expect(navigationCorrect(run(1100, 900, "candidate"))).toBe(true);
    safe(broken);
  }, 25_000);
});
