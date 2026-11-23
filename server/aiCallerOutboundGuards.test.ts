import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("./vapiService.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("vapiService.ts", source, ts.ScriptTarget.Latest, true);
const declarations: string[] = [];
const checks: string[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === "VAPI_OUTBOUND_PHONE_NUMBER_IDS")) declarations.push(node.getText(parsed));
  if (ts.isIfStatement(node) && node.expression.getText(parsed).includes("VAPI_OUTBOUND_PHONE_NUMBER_IDS.has")) checks.push(node.expression.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
function check(index: number, call: { phoneNumberId?: string }, step = "", assistantName = "") {
  const code = ts.transpileModule(`${declarations[0]}\nreturn ${checks[index]};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("call", "OUTBOUND_ASSISTANT_NAMES", "OUTBOUND_METADATA_STEPS", "assistantName", "assistantMetadataStep", code)(call, new Set(["ScheduleEscalation", "FieldMgmtAlert", "LeadAlert"]), new Set(["ai_matrix_customer", "ai_matrix_cleaner"]), assistantName, step);
}

describe("existing outbound-call number guards", () => {
  it("retains one number set and all three existing guard checks", () => {
    expect(declarations).toHaveLength(1); expect(checks).toHaveLength(3);
  });
  it.each(["61431a3e-8144-4acd-b394-8f600ec3a473", "f2f1c044-c70a-4d73-a755-051f8a2a96e4"])("recognizes %s in all existing guards", phoneNumberId => {
    expect(check(0, { phoneNumberId }, "ai_matrix_customer")).toBe(true);
    expect(check(0, { phoneNumberId }, "ai_matrix_cleaner")).toBe(true);
    expect(check(1, { phoneNumberId })).toBe(true);
    expect(check(2, { phoneNumberId })).toBe(true);
  });
  it.each(["unrelated-inbound-number", undefined])("does not recognize unrelated or missing number %s", phoneNumberId => {
    for (let index = 0; index < 3; index++) expect(check(index, { phoneNumberId }, "ai_matrix_customer")).toBe(false);
  });
  it("keeps the secondary guard's assistant/step requirement for real inbound calls", () => {
    expect(check(0, { phoneNumberId: "f2f1c044-c70a-4d73-a755-051f8a2a96e4" })).toBe(false);
    expect(check(0, { phoneNumberId: "f2f1c044-c70a-4d73-a755-051f8a2a96e4" }, "", "LeadAlert")).toBe(true);
    expect(source).toContain("if (!isOutboundFieldMgmt)");
    expect(source).toContain("treating as inbound forwarded call, continuing normal processing");
  });
});
