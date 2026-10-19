import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("manual Command Chat lead call contract", () => {
  it("uses strict US phone validation and protects the Vapi call from rapid duplicates", () => {
    const router = read("server/commandCenterRouter.ts");
    expect(router).toContain('normalizePhone as normalizePhoneStrict');
    expect(router).toContain("const normalizedPhone = normalizePhoneStrict(input.leadPhone);");
    expect(router).toContain("const manualLeadCallLocks = new Map<string, number>();");
    expect(router).toContain("code: \"CONFLICT\"");
    expect(router).toContain("MANUAL_LEAD_CALL_DEDUP_WINDOW_MS");
  });

  it("logs provider diagnostics without exposing them to the caller", () => {
    const router = read("server/commandCenterRouter.ts");
    expect(router).toContain('console.error("[CommandCenter] Manual lead bridge rejected by Vapi"');
    expect(router).toContain("responseBody.slice(0, 2000)");
    expect(router).toContain('message: "The office call could not be started."');
  });

  it("keeps the lead-card phone actions to copy, text, and the office bridge", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const cardLine = page.split("\n").find((line) => line.includes("ccc-live-lead-primary-contact")) ?? "";
    expect(cardLine).toContain("PhoneCall");
    expect(cardLine).not.toContain("href={`tel:");
    expect(page).toContain('aria-label={`Call ${lead.name} through office`}');
  });
});
