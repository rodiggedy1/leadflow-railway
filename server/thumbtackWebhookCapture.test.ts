import { describe, expect, it } from "vitest";
import { summarizeThumbTackWebhook } from "./thumbtackWebhookCapture";

describe("Thumbtack webhook capture", () => {
  it("reports an initial lead payload with no phone value without inventing one", () => {
    const summary = summarizeThumbTackWebhook({
      type: "NegotiationCreatedV4",
      negotiation: {
        id: "neg-123",
        lead: { id: "lead-123", customer: { name: "Customer" } },
      },
    });

    expect(summary.eventType).toBe("NegotiationCreatedV4");
    expect(summary.negotiationId).toBe("neg-123");
    expect(summary.leadId).toBe("lead-123");
    expect(summary.phoneValuesPresent).toBe(false);
    expect(summary.phonePaths).toEqual([]);
  });

  it("detects a phone field wherever a later Thumbtack payload places it", () => {
    const summary = summarizeThumbTackWebhook({
      event: { name: "NegotiationUpdatedV4" },
      negotiation: {
        negotiationID: "neg-456",
        customer: { phoneNumber: "+12025550123" },
      },
    });

    expect(summary.eventType).toBe("NegotiationUpdatedV4");
    expect(summary.negotiationId).toBe("neg-456");
    expect(summary.phoneValuesPresent).toBe(true);
    expect(summary.phonePaths).toContain("negotiation.customer.phoneNumber");
  });

  it("does not expose payload values in the field-path summary", () => {
    const summary = summarizeThumbTackWebhook({
      customer_phone: "+12025550123",
      customer_name: "Private Customer",
    });

    expect(summary.fieldPaths).toContain("customer_phone");
    expect(summary.fieldPaths).not.toContain("+12025550123");
    expect(summary.fieldPaths).not.toContain("Private Customer");
  });
});
