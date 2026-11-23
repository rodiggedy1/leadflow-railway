import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { transformSync } from "esbuild";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";
import { prepareWorldClassCsReplyMessages, type WorldClassCsReplyInput } from "./worldClassCsReply";
const source = readFileSync("server/opsChatRouter.ts", "utf8");
const start = source.indexOf("  csReply: opsChatProcedure");
const block = source.slice(start, source.indexOf("\n  /**", start));
const originalBody = block.slice(block.indexOf("      const systemPrompt = `"), block.indexOf("\n\n      const result = await invokeLLM"));
const compiledBody = transformSync(`function prepare() { ${originalBody}\nreturn messages; }`, { loader: "ts", target: "node18" }).code;
const original = new Function("input", "MAIDS_IN_BLACK_KNOWLEDGE_BASE", `${compiledBody}\nreturn prepare();`);

describe("literal WorldClass preparation parity, offline", () => {
  it.each([
    { history: [] },
    { history: [], scenario: "", customerName: "", conversationContext: "", jobContext: "" },
    { history: [], customerName: " Jane Native ", jobContext: "Tuesday April 14, 3pm, 2bd/2ba", scenario: "First Thumbtack introduction" },
    { history: [{ role: "user", content: "Original question" }, { role: "assistant", content: "Original answer" }],
      customerName: "Jane", conversationContext: "Customer: Confirm my notes", jobContext: "Skip office", scenario: "Retained ".repeat(3000) },
  ] as WorldClassCsReplyInput[])("forwards exact system/user/history strings without truncation %#", input => {
    const before = structuredClone(input);
    expect(prepareWorldClassCsReplyMessages(input)).toEqual(original(input, MAIDS_IN_BLACK_KNOWLEDGE_BASE));
    expect(input).toEqual(before);
  });
  it("retains the actual WorldClass date/time/number rule and complete business knowledge", () => {
    const messages = prepareWorldClassCsReplyMessages({ history: [] });
    expect(messages[0].content).toContain('3a. NEVER change any date, time, day name, or number');
    expect(messages[0].content).toContain(MAIDS_IN_BLACK_KNOWLEDGE_BASE);
  });
  it("leaves the general WorldClass router completely unchanged", () => {
    expect(source).toBe(execFileSync("git", ["show", "bfbb0973c26d3893722805a42a701e3c0d6f6ac3:server/opsChatRouter.ts"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  });
  it("new passive preparation adds no database, model, sender or operational dependency", () => {
    const helper = readFileSync("server/worldClassCsReply.ts", "utf8");
    expect(helper).not.toMatch(/invokeLLM|fetch\s*\(|sendSms|setInterval|\.\/db/);
    expect(helper).not.toMatch(new RegExp(["cleaner" + "Jobs", "cleaner" + "_jobs"].join("|")));
  });
});
