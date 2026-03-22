/**
 * messageTemplateRouter.test.ts
 * Tests for the message template seed data and variable substitution logic.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_TEMPLATES } from "./messageTemplateRouter";

// ─── Seed data integrity ──────────────────────────────────────────────────────

describe("DEFAULT_TEMPLATES", () => {
  it("should contain exactly 11 templates", () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(11);
  });

  it("should have 6 reactivation templates", () => {
    const reactivation = DEFAULT_TEMPLATES.filter(t => t.flowType === "reactivation");
    expect(reactivation).toHaveLength(6);
  });

  it("should have 5 review templates", () => {
    const review = DEFAULT_TEMPLATES.filter(t => t.flowType === "review");
    expect(review).toHaveLength(5);
  });

  it("should have unique stepKeys", () => {
    const keys = DEFAULT_TEMPLATES.map(t => t.stepKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("should have non-empty body for every template", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.trim().length).toBeGreaterThan(10);
    }
  });

  it("should have non-empty label and triggerLabel for every template", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.triggerLabel.trim().length).toBeGreaterThan(0);
    }
  });

  it("should lock opt-out templates (isEditable = 0)", () => {
    const optOuts = DEFAULT_TEMPLATES.filter(t => t.stepKey.endsWith("_opt_out"));
    expect(optOuts.length).toBeGreaterThan(0);
    for (const t of optOuts) {
      expect(t.isEditable).toBe(0);
    }
  });

  it("should have isEditable = 1 for all non-opt-out templates", () => {
    const editable = DEFAULT_TEMPLATES.filter(t => !t.stepKey.endsWith("_opt_out"));
    for (const t of editable) {
      expect(t.isEditable).toBe(1);
    }
  });

  it("variables should be valid JSON arrays", () => {
    for (const t of DEFAULT_TEMPLATES) {
      const parsed = JSON.parse(t.variables);
      expect(Array.isArray(parsed)).toBe(true);
    }
  });
});

// ─── Variable coverage ────────────────────────────────────────────────────────

describe("Template variable coverage", () => {
  it("reactivation_initial should use [Name] and [Discount]", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_initial")!;
    expect(t.body).toContain("[Name]");
    expect(t.body).toContain("[Discount]");
  });

  it("reactivation_price_question should use [LastPrice] and [DiscountedPrice]", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_price_question")!;
    expect(t.body).toContain("[LastPrice]");
    expect(t.body).toContain("[DiscountedPrice]");
  });

  it("reactivation_time_ask should exist and be non-empty", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_time_ask")!;
    expect(t).toBeDefined();
    expect(t.body.trim().length).toBeGreaterThan(10);
    expect(t.isEditable).toBe(1);
  });

  it("reactivation_closing should use [Name]", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_closing")!;
    expect(t).toBeDefined();
    expect(t.body).toContain("[Name]");
    expect(t.isEditable).toBe(1);
  });

  it("review_initial should use [Name]", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "review_initial")!;
    expect(t.body).toContain("[Name]");
  });

  it("review_positive_response should use [GoogleReviewUrl]", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "review_positive_response")!;
    expect(t.body).toContain("[GoogleReviewUrl]");
  });

  it("opt-out templates should NOT contain [Name] or other variables", () => {
    const optOuts = DEFAULT_TEMPLATES.filter(t => t.stepKey.endsWith("_opt_out"));
    for (const t of optOuts) {
      expect(t.body).not.toContain("[Name]");
      const vars = JSON.parse(t.variables) as string[];
      expect(vars).toHaveLength(0);
    }
  });
});

// ─── Variable substitution (mirrors MessageFlowPanel logic) ──────────────────

function substituteVars(body: string, vars: Record<string, string>): string {
  let result = body;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(key, val);
  }
  return result;
}

describe("substituteVars", () => {
  const sampleVars = {
    "[Name]": "Sarah",
    "[Discount]": "10",
    "[LastPrice]": "150",
    "[DiscountedPrice]": "135",
    "[GoogleReviewUrl]": "https://g.page/r/test/review",
  };

  it("substitutes [Name] correctly", () => {
    const result = substituteVars("Hi [Name]! Welcome.", sampleVars);
    expect(result).toBe("Hi Sarah! Welcome.");
  });

  it("substitutes all variables in reactivation_initial", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_initial")!;
    const result = substituteVars(t.body, sampleVars);
    expect(result).not.toContain("[Name]");
    expect(result).not.toContain("[Discount]");
    expect(result).toContain("Sarah");
    expect(result).toContain("10%");
  });

  it("substitutes all variables in reactivation_price_question", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "reactivation_price_question")!;
    const result = substituteVars(t.body, sampleVars);
    expect(result).not.toContain("[LastPrice]");
    expect(result).not.toContain("[DiscountedPrice]");
    expect(result).toContain("$150");
    expect(result).toContain("$135");
  });

  it("substitutes [GoogleReviewUrl] in review_positive_response", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "review_positive_response")!;
    const result = substituteVars(t.body, sampleVars);
    expect(result).not.toContain("[GoogleReviewUrl]");
    expect(result).toContain("https://g.page/r/test/review");
  });

  it("leaves opt-out messages unchanged (no variables to substitute)", () => {
    const t = DEFAULT_TEMPLATES.find(t => t.stepKey === "review_opt_out")!;
    const result = substituteVars(t.body, sampleVars);
    expect(result).toBe(t.body);
  });
});
