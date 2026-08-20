import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSessionSummary } from "./sessionSummary";

const source = readFileSync(new URL("./webhooks.ts", import.meta.url), "utf8");
const branchStart = source.indexOf("// ── REVIEW_REBOOKING_REQUESTED");
const branchEnd = source.indexOf("// -- INTERVIEW_LINK_SENT / NUDGE", branchStart);
const branch = source.slice(branchStart, branchEnd);

describe("Railway review-rebooking summary persistence", () => {
  it("persists the customer reply and deterministic assistant response with the shared summary", () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    expect(branch).toContain('history.push({ role: "user", content: inboundText');
    expect(branch).toContain('history.push({ role: "assistant", content: replyMsg');
    expect(branch).toContain("const summary = computeSessionSummary(history);");
    expect(branch).toContain("messageHistory: JSON.stringify(history), ...summary");
  });

  it("computes all summary fields from the actual final chronological rebooking history", () => {
    const history = [
      { role: "assistant", content: "Original review outreach", ts: 1_000 },
      { role: "user", content: "Customer reply", ts: 2_000 },
      { role: "user", content: "Customer reply", ts: 2_001 },
      { role: "assistant", content: "No worries at all, Taylor!", ts: 2_002 },
    ];

    expect(computeSessionSummary(history)).toEqual({
      lastMessageText: "No worries at all, Taylor!",
      lastMessageTs: 2_002,
      lastCustomerMessageTs: 2_001,
      lastMessageRole: "assistant",
      messageCount: 4,
    });
  });

  it("preserves the existing rebooking send path without introducing a new send call", () => {
    const updateIndex = branch.indexOf(".update(conversationSessions)");
    const sendIndex = branch.indexOf("sendSms({ to: fromPhone, content: replyMsg })");
    expect(updateIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(updateIndex);
    expect((branch.match(/sendSms\(/g) ?? [])).toHaveLength(1);
  });
});
