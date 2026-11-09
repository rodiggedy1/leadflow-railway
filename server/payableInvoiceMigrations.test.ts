import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"versioned-migrations");
const manifest=JSON.parse(readFileSync(path.join(root,"manifest.json"),"utf8"));
const additions=manifest.migrations.filter((m:{id:string})=>/^007[2-7]_create_payable_/.test(m.id));
describe("invoice managed storage contract",()=>{
  it("prepares exactly six new owned invoice tables, not changes to existing tables",()=>{expect(additions).toHaveLength(6);for(const m of additions){const sql=readFileSync(path.join(root,m.sqlFile),"utf8");expect(m.mode).toBe("create-table");expect(m.replayMode).toBe("verified-idempotent");expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS `payable_/);expect(sql).not.toMatch(/^\s*(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\s/im);expect(createHash("sha256").update(sql).digest("hex")).toBe(m.sha256);}});
  it("declares every durable request, paid-state and manual audit storage field",()=>{const schemas=additions.map((m:{postconditionsFile:string})=>JSON.parse(readFileSync(path.join(root,m.postconditionsFile),"utf8")));const table=(n:string)=>schemas.find((s:{table:string})=>s.table===n);const names=(n:string)=>table(n).columns.map((c:{name:string})=>c.name);expect(names("payable_invoices")).toContain("reviewHash");expect(names("payable_invoice_lines")).toContain("manualPaidCents");expect(names("payable_invoice_manual_payments")).toEqual(expect.arrayContaining(["occurrenceKey","accountId","requestId","recordedByAgentId","recordedAtMs"]));expect(names("payable_invoice_attempts")).toContain("refundedCents");expect(table("payable_invoice_lines").indexes).toContainEqual({name:"uq_payable_line_occurrence",columns:["occurrenceKey"],unique:true});});
});
