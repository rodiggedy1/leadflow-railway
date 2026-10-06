import { describe, expect, it } from "vitest";
import { buildMadisonActionProposal } from "./madisonActionApprovalStore";

describe("Madison structured action proposals", () => {
  it("creates a cancellation task without implying a booking mutation", () => {
    expect(buildMadisonActionProposal("I need to cancel tomorrow")).toMatchObject({
      proposalType: "cancellation",
      title: "Cancellation request",
      task: expect.stringContaining("cancel the booking"),
      recommendation: expect.stringContaining("Do not change the booking"),
    });
  });

  it("creates a reschedule task with an availability checkpoint", () => {
    expect(buildMadisonActionProposal("Can we move my cleaning to another day?")).toMatchObject({
      proposalType: "reschedule",
      title: "Reschedule request",
      task: expect.stringContaining("check openings"),
      recommendation: expect.stringContaining("availability"),
    });
  });

  it("creates a customer-care task for service issues", () => {
    expect(buildMadisonActionProposal("The cleaning was not done properly and I want a credit")).toMatchObject({
      proposalType: "customer_care",
      title: "Customer-care request",
    });
  });

  it("does not create an action for an ordinary question", () => {
    expect(buildMadisonActionProposal("What time do you close?")).toBeNull();
  });
});
