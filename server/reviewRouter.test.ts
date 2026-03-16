/**
 * reviewRouter.test.ts
 * Tests for the post-cleaning review request flow.
 */
import { describe, it, expect } from "vitest";
import {
  parseCompletedJobsCsv,
  classifyReviewReply,
  REVIEW_INITIAL_MESSAGE,
  REVIEW_POSITIVE_RESPONSE,
  REVIEW_NEGATIVE_RESPONSE,
  REVIEW_CONFIRMED_RESPONSE,
  GOOGLE_REVIEW_URL,
} from "./reviewRouter";

// ─── CSV parsing ──────────────────────────────────────────────────────────────
describe("parseCompletedJobsCsv", () => {
  const VALID_CSV = `Phone,Date,First Name,Last Name,Full Name,Frequency
3029816191,2026-03-15,Rohan,Test,Rohan Test,Standard
2025551234,2026-03-14,Jane,Doe,Jane Doe,Deep Clean
`;

  it("parses valid CSV with multiple contacts", () => {
    const result = parseCompletedJobsCsv(VALID_CSV);
    expect(result).toHaveLength(2);
    expect(result[0]!.phone).toBe("+13029816191");
    expect(result[0]!.firstName).toBe("Rohan");
    expect(result[0]!.name).toBe("Rohan Test");
    expect(result[0]!.jobDate).toBe("2026-03-15");
    expect(result[0]!.serviceType).toBe("Standard Cleaning");
    expect(result[1]!.serviceType).toBe("Deep Cleaning");
  });

  it("normalizes 10-digit phone to E.164", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency\n3029816191,2026-03-15,Test,User,Test User,Standard\n`;
    const result = parseCompletedJobsCsv(csv);
    expect(result[0]!.phone).toBe("+13029816191");
  });

  it("normalizes 11-digit phone starting with 1", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency\n13029816191,2026-03-15,Test,User,Test User,Standard\n`;
    const result = parseCompletedJobsCsv(csv);
    expect(result[0]!.phone).toBe("+13029816191");
  });

  it("deduplicates by phone number, keeping most recent job date", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency
3029816191,2026-03-10,Rohan,Test,Rohan Test,Standard
3029816191,2026-03-15,Rohan,Test,Rohan Test,Standard
`;
    const result = parseCompletedJobsCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]!.jobDate).toBe("2026-03-15");
  });

  it("skips rows with missing phone", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency
,2026-03-15,No,Phone,No Phone,Standard
3029816191,2026-03-15,Real,Person,Real Person,Standard
`;
    const result = parseCompletedJobsCsv(csv);
    expect(result).toHaveLength(1);
  });

  it("skips rows with invalid date", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency
3029816191,not-a-date,Test,User,Test User,Standard
`;
    const result = parseCompletedJobsCsv(csv);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty CSV", () => {
    expect(parseCompletedJobsCsv("")).toHaveLength(0);
    expect(parseCompletedJobsCsv("Phone,Date\n")).toHaveLength(0);
  });

  it("derives firstName from First Name column", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency\n3029816191,2026-03-15,Sarah,Smith,Sarah Smith,Standard\n`;
    const result = parseCompletedJobsCsv(csv);
    expect(result[0]!.firstName).toBe("Sarah");
  });

  it("falls back to first word of Full Name if First Name is empty", () => {
    const csv = `Phone,Date,First Name,Last Name,Full Name,Frequency\n3029816191,2026-03-15,,Smith,Sarah Smith,Standard\n`;
    const result = parseCompletedJobsCsv(csv);
    expect(result[0]!.firstName).toBe("Sarah");
  });
});

// ─── Reply classification ─────────────────────────────────────────────────────
describe("classifyReviewReply", () => {
  // Opt-out
  it("classifies STOP as opt_out", () => {
    expect(classifyReviewReply("STOP")).toBe("opt_out");
    expect(classifyReviewReply("stop")).toBe("opt_out");
    expect(classifyReviewReply("Unsubscribe")).toBe("opt_out");
  });

  // Review confirmed
  it("classifies review confirmation messages", () => {
    expect(classifyReviewReply("I just left a review!")).toBe("review_confirmed");
    expect(classifyReviewReply("Done! Just posted it.")).toBe("review_confirmed");
    expect(classifyReviewReply("I reviewed you on Google")).toBe("review_confirmed");
    expect(classifyReviewReply("just did it")).toBe("review_confirmed");
    expect(classifyReviewReply("I submitted the review")).toBe("review_confirmed");
  });

  // Positive
  it("classifies positive feedback", () => {
    expect(classifyReviewReply("It was great!")).toBe("positive");
    expect(classifyReviewReply("Amazing job, thank you!")).toBe("positive");
    expect(classifyReviewReply("The house looks spotless")).toBe("positive");
    expect(classifyReviewReply("We're very happy with the clean")).toBe("positive");
    expect(classifyReviewReply("good")).toBe("positive");
    expect(classifyReviewReply("👍")).toBe("positive");
  });

  // Negative
  it("classifies negative feedback", () => {
    expect(classifyReviewReply("I'm disappointed with the service")).toBe("negative");
    expect(classifyReviewReply("They missed the bathroom")).toBe("negative");
    expect(classifyReviewReply("Not happy at all")).toBe("negative");
    expect(classifyReviewReply("There was a problem with the cleaning")).toBe("negative");
  });

  // Unclear
  it("classifies unclear messages", () => {
    expect(classifyReviewReply("Maybe")).toBe("unclear");
    expect(classifyReviewReply("I'll think about it")).toBe("unclear");
    expect(classifyReviewReply("What's the link?")).toBe("unclear");
  });
});

// ─── Message templates ────────────────────────────────────────────────────────
describe("Review message templates", () => {
  it("REVIEW_INITIAL_MESSAGE includes the customer's first name", () => {
    const msg = REVIEW_INITIAL_MESSAGE("Sarah");
    expect(msg).toContain("Sarah");
    expect(msg).toContain("feedback");
  });

  it("REVIEW_POSITIVE_RESPONSE includes Google review URL and discount", () => {
    const msg = REVIEW_POSITIVE_RESPONSE("Sarah");
    expect(msg).toContain("Sarah");
    expect(msg).toContain(GOOGLE_REVIEW_URL);
    expect(msg).toContain("10%");
  });

  it("REVIEW_POSITIVE_RESPONSE does NOT include the review link before positive reply", () => {
    // The initial message should NOT contain the Google link
    const initial = REVIEW_INITIAL_MESSAGE("Sarah");
    expect(initial).not.toContain(GOOGLE_REVIEW_URL);
  });

  it("REVIEW_NEGATIVE_RESPONSE does NOT include Google review URL", () => {
    const msg = REVIEW_NEGATIVE_RESPONSE("Sarah");
    expect(msg).not.toContain(GOOGLE_REVIEW_URL);
    expect(msg).not.toContain("10%");
    expect(msg).toContain("Sarah");
  });

  it("REVIEW_CONFIRMED_RESPONSE includes discount confirmation", () => {
    const msg = REVIEW_CONFIRMED_RESPONSE("Sarah");
    expect(msg).toContain("Sarah");
    expect(msg).toContain("10%");
  });

  it("GOOGLE_REVIEW_URL is the correct URL", () => {
    expect(GOOGLE_REVIEW_URL).toBe("https://share.google/Tm468dywmXkUnBQBL");
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
describe("classifyReviewReply edge cases", () => {
  it("handles empty string as unclear", () => {
    expect(classifyReviewReply("")).toBe("unclear");
  });

  it("handles whitespace-only as unclear", () => {
    expect(classifyReviewReply("   ")).toBe("unclear");
  });

  it("prioritizes review_confirmed over positive when both match", () => {
    // "I left a great review" — should be review_confirmed (checked first)
    expect(classifyReviewReply("I left a great review")).toBe("review_confirmed");
  });

  it("handles mixed case for opt-out", () => {
    expect(classifyReviewReply("Stop")).toBe("opt_out");
    expect(classifyReviewReply("STOP")).toBe("opt_out");
  });
});
