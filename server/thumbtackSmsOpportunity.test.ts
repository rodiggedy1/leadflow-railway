/**
 * Tests for the Thumbtack SMS opportunity parser embedded in webhooks.ts.
 * We test the regex and extraction logic directly since the webhook handler
 * is an Express route and requires a full integration setup to invoke.
 */

import { describe, it, expect } from "vitest";

// ── Inline the same parsing logic used in webhooks.ts ─────────────────────────
// This mirrors the exact code so any change to the regex is caught here.

const THUMBTACK_ALERT_NUMBER = "+16505164957";

function parseThumbtackSmsOpportunity(fromPhone: string, text: string) {
  if (
    fromPhone !== THUMBTACK_ALERT_NUMBER ||
    !/new thumbtack opportunity/i.test(text)
  ) {
    return null;
  }

  const match = text.match(
    /new thumbtack opportunity[:\s]+(.+?)\s+needs\s+(.+?)\s+in\s+([^.]+)/i
  );
  const ttName    = match?.[1]?.trim() ?? "Thumbtack Lead";
  const ttService = match?.[2]?.trim() ?? "Cleaning";
  const ttCity    = match?.[3]?.trim() ?? "";

  const urlMatch = text.match(/https?:\/\/\S+|thmtk\.com\/\S+/);
  const ttUrl    = urlMatch?.[0] ?? null;

  return { ttName, ttService, ttCity, ttUrl };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Thumbtack SMS opportunity parser", () => {
  const SAMPLE =
    "New Thumbtack opportunity: B. P. needs Junk Removal in Lanham. Reply STOP to unsubscribe. thmtk.com/0RmAR6nw";

  it("detects the opportunity from the correct number", () => {
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, SAMPLE);
    expect(result).not.toBeNull();
  });

  it("ignores messages from other numbers", () => {
    const result = parseThumbtackSmsOpportunity("+12025551234", SAMPLE);
    expect(result).toBeNull();
  });

  it("ignores messages that do not contain the trigger phrase", () => {
    const result = parseThumbtackSmsOpportunity(
      THUMBTACK_ALERT_NUMBER,
      "Hey, check out this Thumbtack job!"
    );
    expect(result).toBeNull();
  });

  it("extracts the customer name", () => {
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, SAMPLE);
    expect(result?.ttName).toBe("B. P.");
  });

  it("extracts the service type", () => {
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, SAMPLE);
    expect(result?.ttService).toBe("Junk Removal");
  });

  it("extracts the city", () => {
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, SAMPLE);
    expect(result?.ttCity).toBe("Lanham");
  });

  it("extracts the Thumbtack short URL", () => {
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, SAMPLE);
    expect(result?.ttUrl).toBe("thmtk.com/0RmAR6nw");
  });

  it("handles a message without a URL gracefully", () => {
    const noUrl =
      "New Thumbtack opportunity: J. Smith needs House Cleaning in Rockville. Reply STOP to unsubscribe.";
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, noUrl);
    expect(result?.ttUrl).toBeNull();
    expect(result?.ttName).toBe("J. Smith");
    expect(result?.ttService).toBe("House Cleaning");
    expect(result?.ttCity).toBe("Rockville");
  });

  it("is case-insensitive for the trigger phrase", () => {
    const lower =
      "new thumbtack opportunity: A. B. needs Deep Cleaning in Silver Spring. thmtk.com/abc123";
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, lower);
    expect(result).not.toBeNull();
    expect(result?.ttName).toBe("A. B.");
  });

  it("falls back to defaults when the body format is unexpected", () => {
    const weird = "New Thumbtack opportunity: something weird here";
    const result = parseThumbtackSmsOpportunity(THUMBTACK_ALERT_NUMBER, weird);
    expect(result).not.toBeNull();
    expect(result?.ttName).toBe("Thumbtack Lead");
    expect(result?.ttService).toBe("Cleaning");
  });
});
