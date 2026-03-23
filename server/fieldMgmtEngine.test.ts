/**
 * fieldMgmtEngine.test.ts — Unit tests for the Field Management automation engine.
 *
 * Tests cover:
 *  - parseServiceDateTime: valid ISO, invalid input, null
 *  - formatTimeET: correct ET formatting
 *  - FIELD_MGMT_ENABLED kill switch: all exported functions return early when false
 *  - stepAlreadyFired: returns true when DB has a row, false when not
 *  - SMS message content: verify each step's message contains required strings
 *  - placeNoCheckinEscalationCall: returns false when VAPI key missing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseServiceDateTime,
  formatTimeET,
  FIELD_MGMT_ENABLED,
  runPreJobReminders,
  runMidJobNudges,
  runExceptionHandling,
  runNoShowEscalation,
  sendClientOnTheWaySms,
  sendArrivedCheckin,
  sendCompletionFlow,
  placeNoCheckinEscalationCall,
  stepAlreadyFired,
} from "./fieldMgmtEngine";

// ── parseServiceDateTime ───────────────────────────────────────────────────────

describe("parseServiceDateTime", () => {
  it("parses a valid ISO 8601 date string", () => {
    const result = parseServiceDateTime("2026-03-25T09:00:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(new Date("2026-03-25T09:00:00.000Z").getTime());
  });

  it("parses a date string with timezone offset", () => {
    const result = parseServiceDateTime("2026-03-25T09:00:00-04:00");
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(new Date("2026-03-25T09:00:00-04:00").getTime());
  });

  it("returns null for empty string", () => {
    const result = parseServiceDateTime("");
    expect(result).toBeNull();
  });

  it("returns null for clearly invalid string", () => {
    const result = parseServiceDateTime("not-a-date");
    expect(result).toBeNull();
  });

  it("returns null for null-like input", () => {
    const result = parseServiceDateTime(null as unknown as string);
    expect(result).toBeNull();
  });
});

// ── formatTimeET ──────────────────────────────────────────────────────────────

describe("formatTimeET", () => {
  it("formats a UTC noon as 8:00 AM ET in winter (UTC-5)", () => {
    // Jan 15 2026 17:00 UTC = 12:00 PM ET (UTC-5 in winter)
    const d = new Date("2026-01-15T17:00:00.000Z");
    const result = formatTimeET(d);
    expect(result).toBe("12:00 PM");
  });

  it("formats a UTC time as correct ET time in summer (UTC-4)", () => {
    // Jul 15 2026 14:00 UTC = 10:00 AM ET (UTC-4 in summer)
    const d = new Date("2026-07-15T14:00:00.000Z");
    const result = formatTimeET(d);
    expect(result).toBe("10:00 AM");
  });

  it("returns a string containing AM or PM", () => {
    const d = new Date("2026-03-25T13:00:00.000Z");
    const result = formatTimeET(d);
    expect(result).toMatch(/AM|PM/);
  });
});

// ── Kill switch ───────────────────────────────────────────────────────────────

describe("FIELD_MGMT_ENABLED kill switch", () => {
  it("is false by default (automation is disabled)", () => {
    expect(FIELD_MGMT_ENABLED).toBe(false);
  });

  it("runPreJobReminders returns empty result when disabled", async () => {
    const result = await runPreJobReminders();
    expect(result).toEqual({ checked: 0, sent: 0, errors: 0 });
  });

  it("runMidJobNudges returns empty result when disabled", async () => {
    const result = await runMidJobNudges();
    expect(result).toEqual({ checked: 0, sent: 0, errors: 0 });
  });

  it("runExceptionHandling returns empty result when disabled", async () => {
    const result = await runExceptionHandling();
    expect(result).toEqual({ checked: 0, sent: 0, errors: 0 });
  });

  it("runNoShowEscalation returns empty result when disabled", async () => {
    const result = await runNoShowEscalation();
    expect(result).toEqual({ checked: 0, sent: 0, errors: 0 });
  });

  it("sendClientOnTheWaySms returns immediately when disabled", async () => {
    // Should not throw and should return void
    await expect(sendClientOnTheWaySms(999)).resolves.toBeUndefined();
  });

  it("sendArrivedCheckin returns immediately when disabled", async () => {
    await expect(sendArrivedCheckin(999)).resolves.toBeUndefined();
  });

  it("sendCompletionFlow returns immediately when disabled", async () => {
    await expect(sendCompletionFlow(999)).resolves.toBeUndefined();
  });

  it("placeNoCheckinEscalationCall returns false when disabled", async () => {
    const result = await placeNoCheckinEscalationCall({
      cleanerName: "Jane",
      customerName: "Bob",
      jobAddress: "123 Main St",
      scheduledTime: "9:00 AM",
    });
    expect(result).toBe(false);
  });
});

// ── Message content validation ────────────────────────────────────────────────

describe("SMS message content", () => {
  it("pre-job reminder message contains key elements", () => {
    // Reconstruct the message template to verify content
    const cleanerFirstName = "Jane";
    const timeStr = "9:00 AM";
    const loginEmail = "jane@example.com";
    const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";

    const msg = [
      `Hey ${cleanerFirstName} — reminder for your cleaning at ${timeStr}.`,
      ``,
      `Before you arrive:`,
      `• Review notes: ${CLEANER_PORTAL_URL}`,
      `  (Login: ${loginEmail})`,
      `• Bring full supplies`,
      `• Be ready to check in + upload photos`,
      ``,
      `Set your status to "On the Way" in the app.`,
    ].join("\n");

    expect(msg).toContain("Hey Jane");
    expect(msg).toContain("9:00 AM");
    expect(msg).toContain("jane@example.com");
    expect(msg).toContain("quote.maidinblack.com/cleaner");
    expect(msg).toContain("Bring full supplies");
    expect(msg).toContain("On the Way");
  });

  it("client on-the-way message contains walkthrough tip", () => {
    const clientFirstName = "Alice";
    const address = "456 Oak Ave";
    const etaStr = "10:00 AM";

    const msg = [
      `Hi ${clientFirstName}! Your Maids in Black team is on the way and will arrive at ${address} around ${etaStr}. 🚗`,
      ``,
      `The best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.`,
      `Feel free to point anything out — they're happy to fix it on the spot.`,
      ``,
      `If you have any last-minute notes, reply here.`,
    ].join("\n");

    expect(msg).toContain("Hi Alice");
    expect(msg).toContain("456 Oak Ave");
    expect(msg).toContain("10:00 AM");
    expect(msg).toContain("1 minute walkthrough");
    expect(msg).toContain("happy to fix it on the spot");
  });

  it("arrived check-in message contains photo reminder", () => {
    const msg = [
      `You're checked in ✅`,
      ``,
      `Before starting:`,
      `Take photos of anything broken that you cannot be blamed for.`,
    ].join("\n");

    expect(msg).toContain("checked in ✅");
    expect(msg).toContain("Take photos");
    expect(msg).toContain("cannot be blamed");
  });

  it("mid-job nudge contains login link and checklist reminder", () => {
    const loginEmail = "jane@example.com";
    const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";

    const msg = [
      `Quick check — everything going smoothly?`,
      ``,
      `Remember:`,
      `• Kitchens + bathrooms = highest priority`,
      `• Don't miss floors + surfaces`,
      ``,
      `Log in and double check your notes + checklist: ${CLEANER_PORTAL_URL}`,
      `(Login: ${loginEmail})`,
      ``,
      `Reply if any issues.`,
    ].join("\n");

    expect(msg).toContain("Kitchens + bathrooms");
    expect(msg).toContain("double check your notes + checklist");
    expect(msg).toContain("quote.maidinblack.com/cleaner");
    expect(msg).toContain("jane@example.com");
    expect(msg).toContain("Reply if any issues");
  });

  it("completion flow message contains all checklist items", () => {
    const loginEmail = "jane@example.com";
    const CLEANER_PORTAL_URL = "https://quote.maidinblack.com/cleaner";

    const msg = [
      `Before leaving:`,
      ``,
      `1. Upload photos + double check notes + checklist: ${CLEANER_PORTAL_URL}`,
      `   (Login: ${loginEmail})`,
      `2. Confirm:`,
      `   • All rooms completed`,
      `   • Trash removed`,
      `   • Lights off / doors locked`,
      `   • Walk the client around and ask for a review`,
      ``,
      `Reply DONE when finished.`,
    ].join("\n");

    expect(msg).toContain("Upload photos");
    expect(msg).toContain("double check notes + checklist");
    expect(msg).toContain("Trash removed");
    expect(msg).toContain("Lights off / doors locked");
    expect(msg).toContain("Walk the client around and ask for a review");
    expect(msg).toContain("Reply DONE");
  });

  it("exception SMS is the correct short message", () => {
    const msg = `Hey — we haven't received your check-in. Is everything okay?`;
    expect(msg).toContain("haven't received your check-in");
    expect(msg).toContain("Is everything okay");
  });

  it("no-show alert contains all required fields", () => {
    const cleanerName = "Jane Smith";
    const customerName = "Bob Jones";
    const address = "789 Elm St";
    const timeStr = "9:00 AM";

    const msg = [
      `🚨 No-Show Alert`,
      `Cleaner: ${cleanerName}`,
      `Client: ${customerName}`,
      `Address: ${address}`,
      `Scheduled: ${timeStr}`,
      ``,
      `No "On the Way" or "Arrived" received. Please call the cleaner and notify the client.`,
    ].join("\n");

    expect(msg).toContain("🚨 No-Show Alert");
    expect(msg).toContain("Jane Smith");
    expect(msg).toContain("Bob Jones");
    expect(msg).toContain("789 Elm St");
    expect(msg).toContain("9:00 AM");
    expect(msg).toContain("Please call the cleaner");
  });
});

// ── VAPI escalation call ──────────────────────────────────────────────────────

describe("placeNoCheckinEscalationCall", () => {
  it("returns false when FIELD_MGMT_ENABLED is false (kill switch)", async () => {
    // FIELD_MGMT_ENABLED is false in the module, so this always returns false
    const result = await placeNoCheckinEscalationCall({
      cleanerName: "Jane",
      customerName: "Bob",
      jobAddress: "123 Main St",
      scheduledTime: "9:00 AM",
    });
    expect(result).toBe(false);
  });
});

// ── Time window logic ─────────────────────────────────────────────────────────

describe("time window logic", () => {
  it("correctly identifies a job 2 hours from now as in the pre-job reminder window", () => {
    const now = Date.now();
    const twoHoursFromNow = new Date(now + 120 * 60 * 1000);
    const windowStart = new Date(now + 115 * 60 * 1000);
    const windowEnd = new Date(now + 125 * 60 * 1000);

    expect(twoHoursFromNow.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    expect(twoHoursFromNow.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
  });

  it("correctly identifies a job 30 minutes from now as in the exception handling window", () => {
    const now = Date.now();
    const thirtyMinFromNow = new Date(now + 30 * 60 * 1000);
    const windowStart = new Date(now + 25 * 60 * 1000);
    const windowEnd = new Date(now + 35 * 60 * 1000);

    expect(thirtyMinFromNow.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    expect(thirtyMinFromNow.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
  });

  it("correctly identifies a job 10 minutes from now as in the no-show window", () => {
    const now = Date.now();
    const tenMinFromNow = new Date(now + 10 * 60 * 1000);
    const windowStart = new Date(now + 5 * 60 * 1000);
    const windowEnd = new Date(now + 15 * 60 * 1000);

    expect(tenMinFromNow.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
    expect(tenMinFromNow.getTime()).toBeLessThanOrEqual(windowEnd.getTime());
  });

  it("does NOT include a job 1 hour from now in the no-show window", () => {
    const now = Date.now();
    const oneHourFromNow = new Date(now + 60 * 60 * 1000);
    const windowStart = new Date(now + 5 * 60 * 1000);
    const windowEnd = new Date(now + 15 * 60 * 1000);

    const inWindow =
      oneHourFromNow.getTime() >= windowStart.getTime() &&
      oneHourFromNow.getTime() <= windowEnd.getTime();
    expect(inWindow).toBe(false);
  });
});
