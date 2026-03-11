/**
 * Tests for the quotes.submit tRPC procedure and OpenPhone SMS helpers
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildQuoteSmsMessage } from "./openphone";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock fetch so we don't hit the real OpenPhone API in tests ───────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock DB so tests don't need a real database ─────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

// ─── Mock ENV so we have credentials available ───────────────────────────────
vi.mock("./_core/env", () => ({
  ENV: {
    openPhoneApiKey: "test-api-key",
    openPhoneNumberId: "PNtest123",
    openPhoneFromNumber: "+17259009272",
    ownerOpenId: "",
    appId: "",
    cookieSecret: "",
    databaseUrl: "",
    oAuthServerUrl: "",
    isProduction: false,
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

// ─── Helper: create a minimal tRPC context ───────────────────────────────────
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── buildQuoteSmsMessage tests ───────────────────────────────────────────────
describe("buildQuoteSmsMessage", () => {
  it("includes the first name in the message", () => {
    const msg = buildQuoteSmsMessage({
      name: "Jane Doe",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(msg).toContain("Jane");
    expect(msg).toContain("Maids in Black");
  });

  it("includes bedroom and bathroom info", () => {
    const msg = buildQuoteSmsMessage({
      name: "John",
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Deep Cleaning",
    });
    expect(msg).toContain("3 Bedrooms");
    expect(msg).toContain("2 Bathrooms");
  });

  it("includes a dollar amount estimate", () => {
    const msg = buildQuoteSmsMessage({
      name: "Alice",
      bedrooms: "1 Bedroom",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    expect(msg).toMatch(/\$\d+/);
    // Real price: 1 bed, 1 bath, standard = $179
    expect(msg).toContain("$179");
  });

  it("calculates correct price: 3 bed, 2 bath, standard = $259", () => {
    const msg = buildQuoteSmsMessage({
      name: "Test",
      bedrooms: "3 Bedrooms",
      bathrooms: "2 Bathrooms",
      serviceType: "Standard Cleaning",
    });
    // 3 bed base $229 + 1 extra bath $30 = $259
    expect(msg).toContain("$259");
  });

  it("calculates correct price: 2 bed, 1 bath, deep clean = $269", () => {
    const msg = buildQuoteSmsMessage({
      name: "Test",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Deep Cleaning",
    });
    // 2 bed base $209 + $60 surcharge = $269
    expect(msg).toContain("$269");
  });

  it("calculates correct price: 4 bed, 3 bath, move-in/out = $399", () => {
    const msg = buildQuoteSmsMessage({
      name: "Test",
      bedrooms: "4 Bedrooms",
      bathrooms: "3 Bathrooms",
      serviceType: "Move-In / Move-Out Cleaning",
    });
    // 4 bed base $279 + 2 extra baths $60 + $60 surcharge = $399
    expect(msg).toContain("$399");
  });

  it("applies the deep cleaning multiplier (higher price than standard)", () => {
    const standard = buildQuoteSmsMessage({
      name: "Bob",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Standard Cleaning",
    });
    const deep = buildQuoteSmsMessage({
      name: "Bob",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      serviceType: "Deep Cleaning",
    });

    const extractPrice = (msg: string) => parseInt(msg.match(/\$(\d+)/)?.[1] ?? "0");
    expect(extractPrice(deep)).toBeGreaterThan(extractPrice(standard));
  });
});

// ─── quotes.submit procedure tests ───────────────────────────────────────────
describe("quotes.submit", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const validInput = {
    name: "Test User",
    email: "test@example.com",
    phone: "+12025551234",
    serviceType: "Standard Cleaning",
    bedrooms: "2 Bedrooms",
    bathrooms: "1 Bathroom",
  };

  it("returns success:true and smsSent:true when OpenPhone responds 202", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "MSG_test_123" } }),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.quotes.submit(validInput);

    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true);
  });

  it("returns success:true immediately even when OpenPhone API returns an error (fire-and-forget)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "Payment required",
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.quotes.submit(validInput);

    // Fire-and-forget: form always returns success immediately;
    // SMS errors are handled in the background without blocking the user
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true); // optimistic — background handles actual SMS
  });

  it("returns success:true immediately even when fetch throws a network error (fire-and-forget)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.quotes.submit(validInput);

    // Fire-and-forget: form always returns success immediately;
    // network errors are caught and logged in the background
    expect(result.success).toBe(true);
    expect(result.smsSent).toBe(true); // optimistic — background handles actual SMS
  });

  it("validates required fields — throws on missing name", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.quotes.submit({ ...validInput, name: "" })
    ).rejects.toThrow();
  });

  it("validates required fields — throws on invalid email", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(
      caller.quotes.submit({ ...validInput, email: "not-an-email" })
    ).rejects.toThrow();
  });

  it("calls the OpenPhone API with the correct Authorization header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "MSG_abc" } }),
    });

    const caller = appRouter.createCaller(createPublicContext());
    await caller.quotes.submit(validInput);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openphone.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "test-api-key",
        }),
      })
    );
  });
});
