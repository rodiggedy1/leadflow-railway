/**
 * quoteLink.test.ts
 * Tests the createQuoteLink helper that calls the external quote app API.
 */

import { describe, it, expect, vi } from "vitest";
import { createQuoteLink } from "./quoteLink";

describe("createQuoteLink", () => {
  it("calls the quote app API and returns url/slug/quoteId on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://maidsquotes-b55s3sg4.manus.space/quote/test-ab12",
        slug: "test-ab12",
        quoteId: "MIB-99999",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await createQuoteLink({
      customerName: "Sarah Johnson",
      customerPhone: "+12025551234",
      bedrooms: 3,
      bathrooms: 2,
      serviceType: "Deep Cleaning",
      frequency: "One-time",
      price: 250,
      slots: ["Monday • 9:00 AM", "Tuesday • 1:00 PM"],
      source: "LeadFlow SMS",
      conversationSummary: "Customer wants extra attention to kitchen.",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain("/api/quotes/create-from-leadflow");
    expect(options.headers["x-api-secret"]).toBe(process.env.QUOTE_APP_SECRET ?? "");

    const body = JSON.parse(options.body as string);
    expect(body.customerName).toBe("Sarah Johnson");
    expect(body.price).toBe(250);
    expect(body.bedrooms).toBe(3);

    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://maidsquotes-b55s3sg4.manus.space/quote/test-ab12");
    expect(result?.slug).toBe("test-ab12");
    expect(result?.quoteId).toBe("MIB-99999");

    vi.unstubAllGlobals();
  });

  it("returns null when the API returns a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await createQuoteLink({
      customerName: "Test",
      customerPhone: "+12025551234",
      bedrooms: 1,
      bathrooms: 1,
      price: 99,
    });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await createQuoteLink({
      customerName: "Test",
      customerPhone: "+12025551234",
      bedrooms: 1,
      bathrooms: 1,
      price: 99,
    });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});
