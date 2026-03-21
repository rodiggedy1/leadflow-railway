/**
 * webhookIdempotency.test.ts
 *
 * Tests for the OpenPhone webhook idempotency guard.
 * Verifies that duplicate message events (same msg.id) are dropped
 * and only processed once, preventing duplicate SMS sends.
 */

import { describe, it, expect } from "vitest";

// ─── Pure helper extracted from the webhook logic ────────────────────────────
// We test the idempotency decision logic in isolation so we don't need to
// mock the full Express / DB / OpenPhone stack.

/**
 * Mirrors the guard logic in webhooks.ts:
 *   if (inboundMessageId && session.lastProcessedMessageId === inboundMessageId) → skip
 */
function shouldSkipDuplicate(
  inboundMessageId: string | undefined,
  lastProcessedMessageId: string | null | undefined
): boolean {
  return !!(inboundMessageId && lastProcessedMessageId === inboundMessageId);
}

/**
 * Mirrors the DB update logic: persist the new message ID after processing.
 */
function nextLastProcessedMessageId(
  inboundMessageId: string | undefined,
  currentValue: string | null | undefined
): string | null | undefined {
  return inboundMessageId ?? currentValue;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Webhook idempotency guard — shouldSkipDuplicate", () => {
  it("processes a new message when lastProcessedMessageId is null", () => {
    expect(shouldSkipDuplicate("MSG_001", null)).toBe(false);
  });

  it("processes a new message when lastProcessedMessageId is undefined", () => {
    expect(shouldSkipDuplicate("MSG_001", undefined)).toBe(false);
  });

  it("processes a new message when IDs differ (normal conversation flow)", () => {
    expect(shouldSkipDuplicate("MSG_002", "MSG_001")).toBe(false);
  });

  it("skips a duplicate when the same message ID arrives again", () => {
    expect(shouldSkipDuplicate("MSG_001", "MSG_001")).toBe(true);
  });

  it("skips even if the duplicate arrives a third time", () => {
    // Simulate: MSG_001 processed, then two retries arrive
    const lastProcessed = "MSG_001";
    expect(shouldSkipDuplicate("MSG_001", lastProcessed)).toBe(true);
    expect(shouldSkipDuplicate("MSG_001", lastProcessed)).toBe(true);
  });

  it("does NOT skip when inboundMessageId is undefined (legacy events without ID)", () => {
    // If OpenPhone doesn't include msg.id (e.g. older API version), we can't
    // deduplicate — allow processing to avoid silently dropping messages.
    expect(shouldSkipDuplicate(undefined, "MSG_001")).toBe(false);
  });

  it("does NOT skip when inboundMessageId is empty string", () => {
    expect(shouldSkipDuplicate("", "MSG_001")).toBe(false);
  });

  it("is case-sensitive — different casing is treated as different IDs", () => {
    expect(shouldSkipDuplicate("msg_001", "MSG_001")).toBe(false);
  });
});

describe("Webhook idempotency guard — nextLastProcessedMessageId persistence", () => {
  it("stores the new message ID after first processing", () => {
    expect(nextLastProcessedMessageId("MSG_001", null)).toBe("MSG_001");
  });

  it("overwrites the previous message ID with the new one", () => {
    expect(nextLastProcessedMessageId("MSG_002", "MSG_001")).toBe("MSG_002");
  });

  it("keeps the existing value when inboundMessageId is undefined", () => {
    expect(nextLastProcessedMessageId(undefined, "MSG_001")).toBe("MSG_001");
  });

  it("keeps null when both are undefined/null", () => {
    expect(nextLastProcessedMessageId(undefined, null)).toBe(null);
  });
});

describe("Webhook idempotency guard — full duplicate scenario simulation", () => {
  it("simulates OpenPhone delivering the same event 3 times — only first is processed", () => {
    // Initial session state
    let lastProcessedMessageId: string | null = null;
    const processedCount = { value: 0 };

    const handleEvent = (msgId: string) => {
      if (shouldSkipDuplicate(msgId, lastProcessedMessageId)) {
        return; // duplicate — skip
      }
      // Process the message
      processedCount.value++;
      // Persist the message ID
      lastProcessedMessageId = nextLastProcessedMessageId(msgId, lastProcessedMessageId) ?? null;
    };

    // OpenPhone fires the same event 3 times
    handleEvent("MSG_MORNING_REPLY");
    handleEvent("MSG_MORNING_REPLY"); // duplicate
    handleEvent("MSG_MORNING_REPLY"); // duplicate

    expect(processedCount.value).toBe(1);
    expect(lastProcessedMessageId).toBe("MSG_MORNING_REPLY");
  });

  it("simulates a normal conversation — each unique message is processed once", () => {
    let lastProcessedMessageId: string | null = null;
    const processedMessages: string[] = [];

    const handleEvent = (msgId: string, text: string) => {
      if (shouldSkipDuplicate(msgId, lastProcessedMessageId)) return;
      processedMessages.push(text);
      lastProcessedMessageId = nextLastProcessedMessageId(msgId, lastProcessedMessageId) ?? null;
    };

    handleEvent("MSG_001", "Monday");
    handleEvent("MSG_002", "1501 Canyon Ledge Court");
    handleEvent("MSG_003", "Now");

    expect(processedMessages).toEqual(["Monday", "1501 Canyon Ledge Court", "Now"]);
    expect(lastProcessedMessageId).toBe("MSG_003");
  });

  it("simulates duplicate delivery mid-conversation — only new messages advance the flow", () => {
    let lastProcessedMessageId: string | null = null;
    const processedMessages: string[] = [];

    const handleEvent = (msgId: string, text: string) => {
      if (shouldSkipDuplicate(msgId, lastProcessedMessageId)) return;
      processedMessages.push(text);
      lastProcessedMessageId = nextLastProcessedMessageId(msgId, lastProcessedMessageId) ?? null;
    };

    handleEvent("MSG_001", "Monday");
    handleEvent("MSG_001", "Monday"); // duplicate of first
    handleEvent("MSG_002", "1501 Canyon Ledge Court");
    handleEvent("MSG_002", "1501 Canyon Ledge Court"); // duplicate of second
    handleEvent("MSG_002", "1501 Canyon Ledge Court"); // third delivery of second
    handleEvent("MSG_003", "Now");

    // Only 3 unique messages should be processed
    expect(processedMessages).toHaveLength(3);
    expect(processedMessages).toEqual(["Monday", "1501 Canyon Ledge Court", "Now"]);
  });
});
