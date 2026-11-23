import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Never import real routers, models, settings, providers, or application startup.
const boundary = vi.hoisted(() => {
  const forbidden = (name: string) => vi.fn(() => {
    throw new Error(`Offline ownership test forbids ${name}`);
  });
  return {
    getDb: forbidden("DB access"),
    sendSms: forbidden("SMS"),
    estimatePrice: forbidden("pricing"),
    getNextAvailableSlots: forbidden("availability"),
    formatAvailabilityQuestion: forbidden("availability formatting"),
    logActivity: forbidden("activity"),
    notifyOwner: forbidden("owner notification"),
    sendPushToAll: forbidden("push"),
    getSetting: forbidden("settings"),
    getFlowTemplate: forbidden("flow templates"),
    readEnv: forbidden("environment settings"),
    fetch: forbidden("network fetch"),
    normalizePhone: vi.fn((phone: string) => {
      const digits = phone.replace(/\D/g, "");
      return digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : null;
    }),
  };
});

vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("../drizzle/schema", () => ({ conversationSessions: {}, opsChatMessages: {} }));
vi.mock("./openphone", () => ({ sendSms: boundary.sendSms, estimatePrice: boundary.estimatePrice }));
vi.mock("./availability", () => ({
  getNextAvailableSlots: boundary.getNextAvailableSlots,
  formatAvailabilityQuestion: boundary.formatAvailabilityQuestion,
}));
vi.mock("./activityLogger", () => ({ logActivity: boundary.logActivity }));
vi.mock("./_core/notification", () => ({ notifyOwner: boundary.notifyOwner }));
vi.mock("./webPush", () => ({ sendPushToAll: boundary.sendPushToAll }));
vi.mock("./routers", () => ({ normalizePhone: boundary.normalizePhone }));
vi.mock("./settingsRouter", () => ({ getSetting: boundary.getSetting, getFlowTemplate: boundary.getFlowTemplate }));
vi.mock("./_core/env", () => ({ ENV: { get zapierWebhookSecret() { return boundary.readEnv(); } } }));

let email: typeof import("./emailLeadWebhook");
let log: ReturnType<typeof vi.spyOn>;
const acknowledgement = "[Thumbtack] Email notification acknowledged — native webhook owns lead processing";
const subject = "New direct lead! Alex T.";
const fromAddress = "notifications@thumbtack.com";
const phone = "202-555-0123";
const description = "Please deep clean the living room and kitchen before our move.";
const thumbtackBody = (withPhone: boolean) => [
  "Alex T.", "Direct lead", "Deep Cleaning", "Arlington, VA 22201",
  "Dates: Nov 25-27", "Open to other dates you suggest",
  ...(withPhone ? [phone] : []), description,
  "Number of bedrooms: Two", "Number of bathrooms: One", "Number of rooms: 3 rooms",
].join("\n");

beforeAll(async () => {
  vi.stubGlobal("fetch", boundary.fetch);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  // Import only after the mocks/network guard are installed, not the Express app.
  email = await import("./emailLeadWebhook");
});
beforeEach(() => {
  // Check import-time boundary calls before resetting per-test call records.
  for (const mock of Object.values(boundary)) expect(mock).not.toHaveBeenCalled();
  vi.clearAllMocks();
});
afterEach(() => {
  // Also catches calls swallowed by a handler's own try/catch.
  for (const mock of Object.values(boundary)) expect(mock).not.toHaveBeenCalled();
  vi.clearAllMocks();
});
afterAll(() => {
  log.mockRestore();
  vi.unstubAllGlobals();
});

describe("Thumbtack email notifications are passive; native webhooks own leads", () => {
  it.each([true, false])("direct handler acknowledges without any side effects (phone=%s)", async (withPhone) => {
    expect(email.parseThumbtackLeadBody(thumbtackBody(withPhone), subject).phone)
      .toBe(withPhone ? phone : null);
    await expect(email.handleThumbtackEmail(thumbtackBody(withPhone), fromAddress, subject))
      .resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(acknowledgement);
  });

  it.each([
    ["body_plain", true], ["body_plain", false],
    ["stripped-text", true], ["stripped-text", false],
    ["body-plain", true], ["body-plain", false],
  ] as const)("main dispatcher is passive for %s (phone=%s)", async (bodyField, withPhone) => {
    const payload = { subject, from_email: fromAddress, [bodyField]: thumbtackBody(withPhone) };
    await expect(email.handleEmailLead(payload)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[EmailLead] Detected email type: thumbtack_lead");
    expect(log).toHaveBeenCalledWith(acknowledgement);
  });

  it("acknowledges an empty direct notification with omitted subject", async () => {
    await expect(email.handleThumbtackEmail("", fromAddress)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(acknowledgement);
  });

  it.each([
    ["", "Notification", fromAddress],
    ["", subject, "mail@example.test"],
    ["View at thumbtack.com", "Notification", "mail@example.test"],
  ])("preserves Thumbtack detection for body=%s subject=%s sender=%s", (body, title, sender) => {
    expect(email.detectEmailType(body, title, sender)).toBe("thumbtack_lead");
  });
});

describe("non-Thumbtack detection and pure parsers remain available", () => {
  it.each([
    ["Phone: 202-555-0123\nCleaning Type: Deep", "Form submission", "forms@example.test", "form_submission"],
    ["You received a call from:\n(202) 555-0123", "Call", "voice@example.test", "phone_call"],
    ["", "Missed call", "voice@example.test", "phone_call"],
    ["Reply to Seattle on Yelp Biz", "New lead: Reply to Seattle", "customer@messaging.yelp.com", "yelp_inquiry"],
    ["Unrelated email", "Hello", "person@example.test", "unknown"],
  ])("keeps body=%s subject=%s sender=%s classified as %s", (body, title, sender, expected) => {
    expect(email.detectEmailType(body, title, sender)).toBe(expected);
  });

  it("preserves detection precedence for call and Yelp notifications", () => {
    expect(email.detectEmailType("You received a call from:\n202-555-0123", subject, fromAddress)).toBe("phone_call");
    expect(email.detectEmailType("Reply to Seattle on Yelp Biz", subject, "customer@messaging.yelp.com")).toBe("yelp_inquiry");
  });

  it.each([true, false])("preserves complete Thumbtack parser output (phone=%s)", (withPhone) => {
    expect(email.parseThumbtackLeadBody(thumbtackBody(withPhone), subject)).toEqual({
      clientName: "Alex T.", phone: withPhone ? phone : null, serviceType: "Deep Cleaning",
      // Preserve the current parser's first free-text line, including this flexibility text.
      description: "Open to other dates you suggest", location: "Arlington, VA 22201", requestedDates: "Nov 25-27 (flexible)",
      bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", rooms: "3 rooms",
    });
  });

  it("preserves structured form parser output", () => {
    expect(email.parseEmailLeadBody([
      "First Name: Alex", "Last Name: Test", "Email: alex@example.test", "Phone: 202-555-0123",
      "Cleaning Type: BiWeekly 0.85", "Bedrooms: One 149", "Bathrooms: Five 150",
    ].join("\n"))).toEqual({
      phone, email: "alex@example.test", firstName: "Alex", lastName: "Test", fullName: null,
      bedrooms: "1 Bedroom", bathrooms: "5 Bathrooms", serviceType: "Standard Cleaning",
      frequency: "Bi-Weekly", rawCleaningType: "BiWeekly",
    });
  });

  it("preserves call notification parser output", () => {
    expect(email.parseCallNotificationBody("Hi,\nYou received a call from:\n(202) 555-0123\nat\n2026-11-23 09:57 AM -04:00"))
      .toEqual({ phone: "(202) 555-0123", callTime: "2026-11-23 09:57 AM -04:00" });
  });

  it("preserves Yelp inquiry parser output without invoking its handler", () => {
    expect(email.parseYelpLeadBody([
      "You have a new move-in or move-out cleaning request.", "Reply to Seattle on Yelp Biz",
      "Sent to Maids in Black", "How many bedrooms are in your home?", "1 bedroom",
      "How many bathrooms are in your home?", "1 bathroom", "When do you require this service?",
      "2026-11-25", "In what location do you need the service?", "22025",
    ].join("\n"))).toEqual({
      clientName: "Seattle", serviceType: "Move-In/Out Cleaning", bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom", requestedDate: "2026-11-25", zipCode: "22025",
    });
  });

  it("preserves numeric and cleaning-type helper behavior", () => {
    expect(email.stripNumericSuffix("BiWeekly 0.85")).toBe("BiWeekly");
    expect(email.parseBedroomCount("Studio")).toBe("Studio");
    expect(email.parseBedroomCount("Two 179")).toBe("2 Bedrooms");
    expect(email.parseBathroomCount("1.5")).toBe("1.5 Bathrooms");
    expect(email.parseCleaningType("Move Out")).toEqual({ serviceType: "Move-In/Out Cleaning", frequency: null });
  });

  it("preserves pure authentication checks without reading live settings", () => {
    expect(email.verifyZapierSecret("offline-secret", "offline-secret")).toBe(true);
    expect(email.verifyZapierSecret(undefined, "offline-secret")).toBe(false);
    expect(email.verifyZapierSecret("wrong-secret", "offline-secret")).toBe(false);
    expect(email.verifyMailgunSignature("123", "token", "invalid", "offline-key")).toBe(false);
  });
});
