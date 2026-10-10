import { describe, expect, it } from "vitest";
import { buildMadisonCurrentFactContext } from "./madisonSmsAgent";

describe("Madison current-turn draft context", () => {
  it("keeps only fact observations whose evidence is verbatim in the current message", () => {
    const context = buildMadisonCurrentFactContext(
      "I have a second apartment in Annapolis that I need clean",
      [
        {
          factKey: "property_city",
          value: "Annapolis",
          evidenceExcerpt: "Annapolis",
        },
        {
          factKey: "bedrooms",
          value: "2",
          evidenceExcerpt: "two-bedroom",
        },
      ],
    );

    expect(context).toContain("property_city: Annapolis");
    expect(context).not.toContain("bedrooms: 2");
    expect(context).toContain("Do not use facts from earlier conversation history");
  });

  it("does not create a factual context block when Shadow has no validated facts", () => {
    const context = buildMadisonCurrentFactContext(
      "Will do thank you 😊",
      [
        {
          factKey: "property_city",
          value: "Silver Spring",
          evidenceExcerpt: "Silver Spring",
        },
      ],
    );

    expect(context).toContain("No validated current-turn facts were persisted");
    expect(context).not.toContain("Silver Spring");
  });
});
