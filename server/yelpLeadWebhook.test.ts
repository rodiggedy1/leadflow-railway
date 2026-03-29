/**
 * Tests for Yelp lead email detection and parsing.
 */
import { describe, it, expect } from "vitest";
import { detectEmailType, parseYelpLeadBody } from "./emailLeadWebhook";

const SAMPLE_YELP_BODY = `You have a new move-in or move-out cleaning request.
Reply to Seattle on Yelp Biz
Sent to Maids in Black

5028 Wisconsin Ave Washington, DC 20016

How many bedrooms are in your home?

1 bedroom

How many bathrooms are in your home?

1 bathroom

When do you require this service?

2026-05-18

In what location do you need the service?

22025

Seattle G.`;

describe("detectEmailType — Yelp", () => {
  it("detects Yelp inquiry from body containing 'Yelp Biz'", () => {
    expect(detectEmailType(SAMPLE_YELP_BODY)).toBe("yelp_inquiry");
  });

  it("detects Yelp inquiry from subject containing 'yelp'", () => {
    expect(detectEmailType("some body text", "New Yelp Request")).toBe("yelp_inquiry");
  });

  it("detects Yelp inquiry from messaging.yelp.com sender address", () => {
    expect(detectEmailType("some unrelated body", "New Request", "reply+abc123@messaging.yelp.com")).toBe("yelp_inquiry");
  });

  it("detects Yelp inquiry from subject starting with 'New Lead: Reply to'", () => {
    expect(detectEmailType("some body", "New Lead: Reply to Seattle's move-in or move-out cleaning request")).toBe("yelp_inquiry");
  });

  it("does not misidentify a Google form submission as Yelp", () => {
    const googleBody = "Phone: +1 302 981 6191\nCleaning Type: BiWeekly\nBedrooms: Two\nBathrooms: One";
    expect(detectEmailType(googleBody)).toBe("form_submission");
  });
});

describe("parseYelpLeadBody", () => {
  it("extracts client name from 'Reply to X on Yelp Biz'", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.clientName).toBe("Seattle");
  });

  it("parses bedrooms correctly", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.bedrooms).toBe("1 Bedroom");
  });

  it("parses bathrooms correctly", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.bathrooms).toBe("1 Bathroom");
  });

  it("parses requested date", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.requestedDate).toBe("2026-05-18");
  });

  it("parses zip code and ignores business address zip", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.zipCode).toBe("22025");
  });

  it("detects move-in/out service type", () => {
    const result = parseYelpLeadBody(SAMPLE_YELP_BODY);
    expect(result.serviceType).toBe("Move-In/Out Cleaning");
  });

  it("detects deep cleaning from first line", () => {
    const body = SAMPLE_YELP_BODY.replace(
      "You have a new move-in or move-out cleaning request.",
      "You have a new deep cleaning request."
    );
    const result = parseYelpLeadBody(body);
    expect(result.serviceType).toBe("Deep Cleaning");
  });

  it("handles multi-bedroom Yelp inquiry", () => {
    const body = SAMPLE_YELP_BODY.replace("1 bedroom", "3 bedrooms");
    const result = parseYelpLeadBody(body);
    expect(result.bedrooms).toBe("3 Bedrooms");
  });

  it("returns null for missing fields gracefully", () => {
    const result = parseYelpLeadBody("Reply to John on Yelp Biz\nSent to Maids in Black");
    expect(result.clientName).toBe("John");
    expect(result.bedrooms).toBeNull();
    expect(result.bathrooms).toBeNull();
    expect(result.requestedDate).toBeNull();
  });
});
