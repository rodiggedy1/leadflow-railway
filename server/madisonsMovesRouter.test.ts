import { describe, expect, it } from "vitest";
import { excludeStopOptedRecipients, selectLiveMoveRecipients } from "./madisonsMovesRouter";

describe("Madison’s Moves send safeguards", () => {
  const reviewedMoveRecipients = [{ name: "Eligible Customer", phone: "+12025550123" }];

  it("does not allow a stale or client-injected recipient past the live move recheck", () => {
    const selected = selectLiveMoveRecipients(
      [...reviewedMoveRecipients, { name: "Injected Recipient", phone: "+12025550999" }],
      reviewedMoveRecipients,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].phone).toBe("+12025550123");
  });

  it("removes STOP-opted recipients before the send loop can contact them", () => {
    const selected = selectLiveMoveRecipients(reviewedMoveRecipients, reviewedMoveRecipients);
    expect(excludeStopOptedRecipients(selected, new Set(["+12025550123"]))).toEqual([]);
    expect(excludeStopOptedRecipients(selected, new Set())).toHaveLength(1);
  });
});
