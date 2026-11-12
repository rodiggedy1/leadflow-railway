import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as ts from "typescript";

const requireReal = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const env: Record<string, any> = { openPhoneApiKey: "offline-no-provider-key", openPhoneNumberId: "offline-default-line", openPhoneCsNumberId: "", isPreviewMode: false };
const fetchMock = vi.fn();
const procedure = { input: (_value: unknown) => ({ query: (_handler: unknown) => ({}), mutation: (_handler: unknown) => ({}) }) };

/** Compile the actual functions. Only module dependencies and the fetch boundary
 * are replaced; neither a database nor the application router is imported. */
function compile(file: string, dependencies: Record<string, unknown>, fetchBoundary = fetchMock) {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependency = (name: string) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency in offline fixture: ${name}`);
  };
  new Function("require", "exports", "fetch", code)(dependency, exports, fetchBoundary);
  return exports;
}
const handoff = compile("internalBookingHandoffRouter.ts", {
  zod: requireReal("zod"), "@trpc/server": requireReal("@trpc/server"),
  "drizzle-orm": {}, "../drizzle/schema": {},
  "./_core/trpc": { router: (value: unknown) => value, agentProcedure: procedure },
  "./_core/env": { ENV: env }, "./db": {}, "../shared/bookingArrival": {},
  "./internalBookingHandoffContext": {},
  "./internalBookingHandoffToken": { handoffConflict: (message: string) => { throw new Error(message); } },
});
const provider = compile("openphone.ts", {
  "./_core/env": { ENV: env },
  "./routers": { normalizePhone: (phone: string) => phone },
});
const canonicalTemplate = () => {
  const found = read("aiConciergeRouter.ts").match(/const PAYMENT_LINK_SMS_TEMPLATE = `([\s\S]*?)`;/);
  if (!found) throw new Error("Existing payment-link template is missing");
  return found[1];
};

beforeEach(() => {
  vi.clearAllMocks();
  env.openPhoneApiKey = "offline-no-provider-key";
  env.openPhoneNumberId = "offline-default-line";
  env.openPhoneCsNumberId = "";
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "offline-accepted-message" } }) });
});

describe("literal reuse of existing card-link text and SMS sender", () => {
  it.each(["card", "apple_pay"])("matches the existing full template, whitespace and punctuation for %s", method => {
    const url = `https://preview.example.test/pay/hc1_offline${method === "apple_pay" ? "?wallet=apple_pay" : ""}`;
    const expected = canonicalTemplate().replace("{first_name}", "Saved").replace("{link}", url);
    expect(handoff.buildExistingCardLinkSms("Saved", url)).toBe(expected);
    expect(() => handoff.assertReviewedHandoffMessage(expected, url)).not.toThrow();
    expect(expected).not.toContain("booking BK-");
    expect(expected).not.toContain("{first_name}");
  });
  it("lets the actual unchanged SMS helper use its existing default sender when the CS override is empty", async () => {
    const message = handoff.buildExistingCardLinkSms("Saved", "https://preview.example.test/pay/hc1_offline");
    const result = await handoff.submitReviewedHandoffSms("(202) 555-0123", message, provider.sendSms);
    expect(result).toMatchObject({ success: true, submitted: true, delivered: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openphone.com/v1/messages");
    expect(JSON.parse(options.body)).toEqual({ content: message, from: "offline-default-line", to: ["+12025550123"] });
  });
  it("preserves an existing nonempty CS override through the same helper", async () => {
    env.openPhoneCsNumberId = "offline-cs-line";
    await handoff.submitReviewedHandoffSms("+12025550123", "Reviewed message", provider.sendSms);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe("offline-cs-line");
  });
  it("does not fabricate send success or defeat missing provider configuration", async () => {
    env.openPhoneApiKey = "";
    const result = await handoff.submitReviewedHandoffSms("+12025550123", "Reviewed message", provider.sendSms);
    expect(result).toMatchObject({ success: false, submitted: false, delivered: false });
    expect(result.message).toContain("duplicate SMS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retains explicit failure and ambiguous timeout results without retries or raw provider errors", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "offline-provider-private-error" });
    const rejected = await handoff.submitReviewedHandoffSms("+12025550123", "Reviewed message", provider.sendSms);
    expect(rejected).toMatchObject({ success: false, submitted: false, delivered: false });
    expect(rejected.message).not.toContain("private-error");
    fetchMock.mockRejectedValueOnce(new Error("offline-network-private-error"));
    expect(await handoff.submitReviewedHandoffSms("+12025550123", "Reviewed message", provider.sendSms)).toEqual(rejected);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("still rejects a wrong recipient, extra link, missing URL and hidden control character before sending", async () => {
    await expect(handoff.submitReviewedHandoffSms("bad phone", "review", provider.sendSms)).rejects.toThrow("recipient phone");
    const url = "https://preview.example.test/pay/hc1_offline";
    for (const text of ["missing link", `${url} https://other.example.test`, `${url}\u0000`]) {
      expect(() => handoff.assertReviewedHandoffMessage(text, url)).toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps native token validation ahead of the same actual sender and does not invoke a new AI, inbox writer or provider framework", () => {
    const source = read("internalBookingHandoffRouter.ts");
    const send = source.slice(source.indexOf("export async function sendInternalHandoffLink"), source.indexOf("export const internalBookingHandoffRouter"));
    expect(send.indexOf("validateHandoffToken")).toBeLessThan(send.indexOf('import("./openphone")'));
    expect(send.indexOf("assertReviewedHandoffMessage")).toBeLessThan(send.indexOf('import("./openphone")'));
    expect(send).toContain("submitReviewedHandoffSms(current.booking.customerPhone, input.message, sendSms)");
    expect(source).not.toMatch(/aiConciergeRouter|appendCsOutboundMessage|fetch\(/);
  });
});
