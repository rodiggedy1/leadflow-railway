import { describe, expect, it } from "vitest";
import { publicReviewSchema, type ReviewGenerationResult, type SafeBookingContext } from "../../shared/reviewResponses";
import { reviewIdentity, safeBookingContext, severityReasonsFor, validateReviewResponse } from "./policy";

const review = (patch: Record<string, unknown> = {}) => publicReviewSchema.parse({
  platform: "google", accountId: "account", businessId: "business", reviewId: "review",
  rating: 5, reviewerName: "", text: "Great work!", createdAt: "2026-11-20T12:00:00Z", ...patch,
});
const generation = (patch: Partial<ReviewGenerationResult> = {}): ReviewGenerationResult => ({
  requestId: "request", reviewId: "review", responseText: "Thanks for the kind review!",
  groundingQuotes: ["Great work!"], safetyFlags: [], unsupportedClaims: [], ...patch,
});
const context: SafeBookingContext = {
  verified: true, matchMethod: "explicit_booking_link", bookingId: "private-booking-abc",
  serviceType: "Deep clean", privateTermsToExclude: ["Secret Customer", "Unit Blueberry", "2026-11-20"],
};

describe("review response policy", () => {
  it("hashes the full unambiguous platform/account/business/review tuple", () => {
    const original = review();
    expect(reviewIdentity(original)).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewIdentity(review({ text: "changed", rating: 1 }))).toBe(reviewIdentity(original));
    for (const patch of [{ platform: "thumbtack" }, { accountId: "different" }, { businessId: "different" }, { reviewId: "different" }]) {
      expect(reviewIdentity(review(patch))).not.toBe(reviewIdentity(original));
    }
    expect(reviewIdentity(review({ accountId: "a:b", businessId: "c" })))
      .not.toBe(reviewIdentity(review({ accountId: "a", businessId: "b:c" })));
  });

  it.each([1, 2, 3])("requires management for rating %i even with no text", rating => {
    expect(severityReasonsFor(review({ rating, text: "" }))).toContain("rating_1_to_3");
  });

  it.each([
    ["They damaged my dresser", "damage"], ["My vase was broken", "damage"],
    ["They stole my cash", "theft"], ["My jewelry is missing; theft!", "theft"],
    ["This was unsafe", "safety"], ["A safety hazard", "safety"],
    ["We experienced racial discrimination", "discrimination"], ["Their staff was racist", "discrimination"],
    ["I will sue", "legal"], ["I contacted a lawyer", "legal"],
    ["I dispute this payment: payment dispute", "payment_dispute"], ["They charged twice", "payment_dispute"],
    ["Dañaron la mesa", "damage"], ["El robo fue terrible", "theft"],
    ["Un peligro para mi familia", "safety"], ["Discriminación racial", "discrimination"],
    ["Mi abogado presentará una demanda", "legal"], ["Necesito un reembolso", "payment_dispute"],
    ["Ils ont cassé mon vase", "damage"], ["Un objet volé", "theft"],
    ["C'était dangereux", "safety"], ["Mon avocat", "legal"], ["Remboursement demandé", "payment_dispute"],
    ["Diebstahl", "theft"], ["Das ist gefährlich", "safety"],
    ["No damage occurred", "damage"],
  ])("flags serious mention at five stars: %s", (text, reason) => {
    expect(severityReasonsFor(review({ text }))).toContain(reason);
  });

  it("does not flag ordinary four/five-star text", () => {
    expect(severityReasonsFor(review({ rating: 4, text: "Friendly and thorough." }))).toEqual([]);
  });

  it("accepts an exact source quote with a grounded service detail", () => {
    const source = review({ text: "The kitchen was spotless." });
    const result = generation({ groundingQuotes: ["kitchen was spotless"], responseText: "Hearing that the kitchen was spotless made our day. Thanks for sharing!" });
    expect(validateReviewResponse({ review: source, text: result.responseText, generation: result })).toEqual([]);
  });

  it.each([
    [generation({ groundingQuotes: ["Great Work!"] }), "invalid_grounding_quote"],
    [generation({ groundingQuotes: [""] }), "invalid_grounding_quote"],
    [generation({ groundingQuotes: [] }), "missing_grounding_quotes"],
    [generation({ safetyFlags: ["private data"] }), "provider_safety_flags"],
    [generation({ unsupportedClaims: ["history"] }), "provider_unsupported_claims"],
  ])("rejects unsafe or ungrounded provider metadata", (result, issue) => {
    expect(validateReviewResponse({ review: review(), text: result.responseText, generation: result })).toContain(issue);
  });

  it.each([
    ["Email us at private@example.com", "private_contact_or_identifier"],
    ["Call +1 (202) 555-0199", "private_contact_or_identifier"],
    ["At 123 Orchard Lane", "private_address"],
    ["Your visit on 2026-11-20", "private_date_or_time"],
    ["See you on November 20", "private_date_or_time"],
    ["The appointment is Monday", "private_date_or_time"],
    ["Your booking ID is abc", "private_booking_identifier"],
    ["Hello Secret Customer", "private_context_term"],
    ["Thanks at UNIT BLUEBERRY", "private_context_term"],
    ["private-booking-abc", "private_context_term"],
  ])("rejects private output: %s", (text, issue) => {
    expect(validateReviewResponse({ review: review(), text, bookingContext: context })).toContain(issue);
  });

  it("blocks a linked negotiation identifier even without booking context", () => {
    expect(validateReviewResponse({ review: review({ negotiationId: "negotiation-private" }), text: "negotiation-private" }))
      .toContain("private_context_term");
  });

  it.each([
    ["We'll offer you a refund", "compensation_not_allowed"],
    ["We can give you a free cleaning", "compensation_not_allowed"],
    ["We damaged your furniture", "disputed_facts_admission"],
    ["We are at fault", "disputed_facts_admission"],
    ["This is your fault", "customer_blame"],
    ["You should have told us", "customer_blame"],
    ["We will contact you tomorrow", "unsupported_promise_or_history"],
    ["We have investigated this", "unsupported_promise_or_history"],
    ["We truly appreciate your wonderful feedback.", "generic_prompt_phrase"],
    ["We TRULY appreciate your wonderful feedback!", "generic_prompt_phrase"],
  ])("rejects prohibited public wording: %s", (text, issue) => {
    expect(validateReviewResponse({ review: review(), text })).toContain(issue);
  });

  it("allows empathy without admitting an allegation", () => {
    expect(validateReviewResponse({ review: review({ rating: 1, text: "My vase broke" }), text: "I'm sorry to hear about your concern. Thank you for bringing it to our attention." })).toEqual([]);
  });

  it("rejects consecutive opening and closing reuse individually", () => {
    const previous = "Thanks for sharing! We enjoyed hearing your feedback. Take care!";
    expect(validateReviewResponse({ review: review(), text: "Thanks for sharing! Another middle sentence. Wishing you well!", recentResponses: [previous] }))
      .toContain("consecutive_opening_reused");
    expect(validateReviewResponse({ review: review(), text: "What lovely feedback! A different middle. Take care!", recentResponses: [previous] }))
      .toContain("consecutive_closing_reused");
    expect(validateReviewResponse({ review: review(), text: "Thanks for sharing! A middle. Bye!", recentResponses: ["Different opening. Different close.", previous] }))
      .not.toContain("consecutive_opening_reused");
  });

  it("does not invent a reviewer name", () => {
    expect(validateReviewResponse({ review: review(), text: "Hi Alice! Thanks for your review." })).toContain("unverified_reviewer_name");
    expect(validateReviewResponse({ review: review({ reviewerName: "Alice Example" }), text: "Hi Alice! Thanks for your review." })).not.toContain("unverified_reviewer_name");
  });

  it("rating-only responses cannot acquire room details or service assertions", () => {
    const blank = review({ text: "" });
    const neutral = generation({ responseText: "Thank you for the five stars!", groundingQuotes: [] });
    expect(validateReviewResponse({ review: blank, text: neutral.responseText, generation: neutral })).toEqual([]);
    expect(validateReviewResponse({ review: blank, text: "Glad your kitchen was spotless." })).toContain("rating_only_fabricated_details");
    expect(validateReviewResponse({ review: blank, text: "We cleaned your home." })).toContain("rating_only_fabricated_details");
    expect(validateReviewResponse({ review: review(), text: "Happy your bathroom was spotless." })).toContain("unsupported_specific_details");
  });

  it("existing public replies are not accepted for another response", () => {
    expect(validateReviewResponse({ review: review({ existingResponse: "Already posted" }), text: "Another draft" })).toContain("existing_response");
  });

  it("requires explicit verified linkage and excludes actual booking ID", () => {
    expect(safeBookingContext(review(), context)?.privateTermsToExclude).toContain(context.bookingId);
    expect(safeBookingContext(review(), { ...context, verified: false } as unknown as SafeBookingContext)).toBeNull();
    expect(safeBookingContext(review(), { ...context, matchMethod: "thumbtack_negotiation_id" })).toBeNull();
    expect(safeBookingContext(review({ platform: "thumbtack", negotiationId: "neg-1" }), { ...context, matchMethod: "thumbtack_negotiation_id" })).not.toBeNull();
    expect(context.privateTermsToExclude).not.toContain(context.bookingId);
  });
});

describe("bounded style and specific grounding", () => {
  it.each([
    ["Thanks!!!", "exclamation_overuse"],
    ["Thank you 😀 😀", "emoji_overuse"],
    ["Hi Alice! Thanks, Alice.", "reviewer_name_overuse"],
  ])("flags obvious overuse: %s", (text, issue) => {
    expect(validateReviewResponse({ review: review({ reviewerName: "Alice Example" }), text })).toContain(issue);
  });

  it("rejects specific words that exist in review but not the provided grounding quote", () => {
    const source = review({ text: "Great work! The kitchen was spotless." });
    const generated = generation({ responseText: "Happy to hear the kitchen was spotless.", groundingQuotes: ["Great work!"] });
    expect(validateReviewResponse({ review: source, text: generated.responseText, generation: generated })).toContain("unsupported_specific_grounding");
  });
});
