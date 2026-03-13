/**
 * Tests for UTM attribution — quoteFormSchema accepts UTM fields,
 * and the captureUtms helper (logic mirrored here) correctly parses URL params.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror the quoteFormSchema UTM fields for isolated unit testing
const utmSchema = z.object({
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
  gclid: z.string().max(255).optional(),
});

// Mirror the captureUtms helper for unit testing
function captureUtms(search: string) {
  const p = new URLSearchParams(search);
  return {
    utmSource: p.get("utm_source") ?? undefined,
    utmMedium: p.get("utm_medium") ?? undefined,
    utmCampaign: p.get("utm_campaign") ?? undefined,
    utmContent: p.get("utm_content") ?? undefined,
    gclid: p.get("gclid") ?? undefined,
  };
}

describe("UTM schema validation", () => {
  it("accepts all UTM fields when present", () => {
    const result = utmSchema.safeParse({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "dc-deep-clean-spring",
      utmContent: "variant-a",
      gclid: "Cj0KCQjwkdO0BhDxARIsANkNcreABC123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.utmSource).toBe("google");
      expect(result.data.utmMedium).toBe("cpc");
      expect(result.data.utmCampaign).toBe("dc-deep-clean-spring");
    }
  });

  it("accepts submission with no UTM fields (direct traffic)", () => {
    const result = utmSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.utmSource).toBeUndefined();
      expect(result.data.gclid).toBeUndefined();
    }
  });

  it("rejects utmSource longer than 100 chars", () => {
    const result = utmSchema.safeParse({ utmSource: "g".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects utmCampaign longer than 255 chars", () => {
    const result = utmSchema.safeParse({ utmCampaign: "x".repeat(256) });
    expect(result.success).toBe(false);
  });
});

describe("captureUtms URL parser", () => {
  it("parses all UTM params from a URL query string", () => {
    const search = "?utm_source=google&utm_medium=cpc&utm_campaign=dc-clean&utm_content=v1&gclid=ABC123";
    const utms = captureUtms(search);
    expect(utms.utmSource).toBe("google");
    expect(utms.utmMedium).toBe("cpc");
    expect(utms.utmCampaign).toBe("dc-clean");
    expect(utms.utmContent).toBe("v1");
    expect(utms.gclid).toBe("ABC123");
  });

  it("returns undefined for missing params (direct traffic)", () => {
    const utms = captureUtms("");
    expect(utms.utmSource).toBeUndefined();
    expect(utms.utmMedium).toBeUndefined();
    expect(utms.gclid).toBeUndefined();
  });

  it("parses partial UTMs (only source and medium)", () => {
    const utms = captureUtms("?utm_source=instagram&utm_medium=organic");
    expect(utms.utmSource).toBe("instagram");
    expect(utms.utmMedium).toBe("organic");
    expect(utms.utmCampaign).toBeUndefined();
    expect(utms.gclid).toBeUndefined();
  });

  it("parses gclid-only (Google Ads auto-tag, no manual UTMs)", () => {
    const utms = captureUtms("?gclid=Cj0KCQjwkdO0BhDxARIsANkNcreABC123");
    expect(utms.gclid).toBe("Cj0KCQjwkdO0BhDxARIsANkNcreABC123");
    expect(utms.utmSource).toBeUndefined();
  });

  it("handles URL-encoded campaign names", () => {
    const utms = captureUtms("?utm_campaign=dc%20deep%20clean%20spring");
    expect(utms.utmCampaign).toBe("dc deep clean spring");
  });
});
