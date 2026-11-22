import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { customerSmsFailureDetailsSchema, customerSmsDraftHidesUnanswered, describeCustomerSmsFailure } from "./claudeCustomerSmsFailure";

describe("customer SMS failure diagnostics — no raw model, SDK, SQL or credential text", () => {
  it("retains exact application error codes and failing phase", () => {
    expect(describeCustomerSmsFailure(new Error("SMS_QUOTE_INVALID_EVIDENCE"), "generation"))
      .toEqual({ phase: "generation", name: "Error", code: "SMS_QUOTE_INVALID_EVIDENCE", issues: [] });
  });
  it("retains a database error code but not its query or credentials", () => {
    const error = Object.assign(new Error("mysql://private-user:private-password@host SELECT private input"), { code: "ER_LOCK_DEADLOCK" });
    const detail = describeCustomerSmsFailure(error, "preparation");
    expect(detail.code).toBe("ER_LOCK_DEADLOCK"); expect(JSON.stringify(detail)).not.toMatch(/private|mysql|SELECT/);
  });
  it.each(["TOP_SECRET_KEY", "private customer text $999 https://private.example", "Bearer hidden-key", "sk-live-private-key"])
    ("does not copy arbitrary exception content: %s", message => {
      const detail = describeCustomerSmsFailure(new Error(message), "generation");
      expect(detail.code).toBe("UNCLASSIFIED_ERROR"); expect(JSON.stringify(detail)).not.toContain(message);
    });
  it("retains schema error fields and types without copying values or custom messages", () => {
    const result = z.object({ customerNameConfirmed: z.literal(true), city: z.string() }).safeParse({ city: 123 });
    if (result.success) throw Error("Expected schema failure");
    const detail = describeCustomerSmsFailure(result.error, "generation");
    expect(detail.name).toBe("ZodError"); expect(detail.issues.map(issue => issue.path)).toEqual([["customerNameConfirmed"], ["city"]]);
    expect(JSON.stringify(detail)).not.toContain("123");
  });
  it("redacts dynamic field names and custom validation messages", () => {
    const error = new z.ZodError([{ code: "custom", path: ["PRIVATE_SECRET_FIELD"], message: "raw private input" }]);
    const detail = describeCustomerSmsFailure(error, "generation");
    expect(detail.issues).toEqual([{ code: "custom", path: ["[field]"] }]);
    expect(JSON.stringify(detail)).not.toMatch(/PRIVATE_SECRET|raw private/);
  });
  it("bounds validation details and rejects raw unrecognized diagnostic fields", () => {
    const error = new z.ZodError(Array.from({ length: 20 }, () => ({ code: "custom" as const, path: Array.from({ length: 20 }, () => "fields"), message: "secret" })));
    const detail = describeCustomerSmsFailure(error, "generation");
    expect(detail.issues).toHaveLength(8); expect(detail.issues.every(issue => issue.path.length === 8)).toBe(true);
    expect(customerSmsFailureDetailsSchema.safeParse({ failures: [detail], rawError: "secret" }).success).toBe(false);
    expect(customerSmsFailureDetailsSchema.safeParse({ failures: [detail, detail, detail] }).success).toBe(false);
  });
  it.each([null, undefined, "private thrown string", 123])("handles non-Error throws without retaining their contents: %j", error => {
    expect(describeCustomerSmsFailure(error, "generation")).toEqual({ phase: "generation", code: "UNCLASSIFIED_ERROR", name: "UnknownError", issues: [] });
  });
});

describe("failure receipts remain unanswered", () => {
  it.each(["CONFIG_CHANGED", "STALE_CUSTOMER_MESSAGE", "GENERATION_OR_PERSISTENCE_FAILED"])("exposes an unsent automatic %s failure", errorCode => {
    expect(customerSmsDraftHidesUnanswered({ status: "DISMISSED", capability: "claude_customer_reply_v1", errorCode })).toBe(false);
  });
  it.each([{ dismissedBy: "Sam" }, { dismissedAt: new Date() }, { outboundOpenPhoneId: "actual-sent" }, { sentAt: new Date() }])("preserves actual human dismissal/actual send %#", patch => {
    expect(customerSmsDraftHidesUnanswered({ status: "DISMISSED", capability: "claude_customer_reply_v1", errorCode: "CONFIG_CHANGED", ...patch })).toBe(true);
  });
  it("preserves legacy dismissed receipts and actual acceptance", () => {
    expect(customerSmsDraftHidesUnanswered({ status: "DISMISSED", capability: "legacy" })).toBe(true);
    expect(customerSmsDraftHidesUnanswered({ status: "SENT", capability: "claude_customer_reply_v1" })).toBe(true);
    expect(customerSmsDraftHidesUnanswered({ status: "SENDING", errorCode: "SUBMISSION_UNCERTAIN" })).toBe(false);
  });
});

it("the application adapter forwards the failure third argument and logs unsuccessful owner alerts", () => {
  const source = readFileSync(new URL("./claudeCustomerSmsApplication.ts", import.meta.url), "utf8");
  expect(source).toContain("prepare: async (claim, plan, failure)");
  expect(source).toContain("taskStore.prepare(claim, plan, failure)");
  expect(source).toContain("if (!delivered) console.warn");
});

it.each(["HUMAN_REPLY_WON", "MANUAL_FIRST_RESPONSE"])("does not equate the %s send-attempt gate to actual human submission", errorCode => {
  expect(customerSmsDraftHidesUnanswered({ status: "DISMISSED", capability: "claude_customer_reply_v1", errorCode })).toBe(false);
});
