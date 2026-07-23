/**
 * planner.test.ts
 *
 * Tests for createReadinessPlan().
 *
 * Goals:
 *   1. Verify the OpenAI JSON schema is structurally valid (strict mode rules).
 *   2. Verify createReadinessPlan() parses a well-formed LLM response correctly.
 *   3. Verify createReadinessPlan() throws PLAN_FAILED on LLM error.
 *   4. Verify createReadinessPlan() throws PLAN_INVALID on malformed LLM JSON.
 *   5. Verify the schema rejects a response that omits a required field.
 *   6. Verify action plan variant parses correctly.
 *
 * If any of these fail after a schema edit, the schema is broken and must be fixed
 * before deploying — this is the CI guard against the PLAN_FAILED regression.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { READINESS_PLAN_JSON_SCHEMA, READINESS_PLAN_ZOD_SCHEMA } from "./schema/readinessPlanSchema";
import { MadisonError } from "./types";

// ── Mock invokeLLM so tests never make real API calls ─────────────────────────

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// Import after mock is set up
import { invokeLLM } from "../_core/llm";
import { createReadinessPlan } from "./planner";

const mockInvokeLLM = vi.mocked(invokeLLM);

// ── Helper: build a fake LLM response ────────────────────────────────────────

function makeLLMResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

// ── Schema structural validation ──────────────────────────────────────────────

describe("READINESS_PLAN_JSON_SCHEMA — OpenAI strict mode compliance", () => {
  /**
   * Recursively validates that every object in the JSON schema satisfies
   * OpenAI strict mode requirements:
   *   - additionalProperties: false
   *   - required lists every key in properties
   */
  function validateStrictObject(schema: Record<string, unknown>, path: string): string[] {
    const errors: string[] = [];

    if (schema.type === "object" || schema.properties) {
      if (schema.additionalProperties !== false) {
        errors.push(`${path}: missing additionalProperties: false`);
      }

      const props = schema.properties as Record<string, unknown> | undefined;
      const required = schema.required as string[] | undefined;

      if (props) {
        const propKeys = Object.keys(props);
        if (!required) {
          errors.push(`${path}: missing required array (must list all keys: ${propKeys.join(", ")})`);
        } else {
          const missingFromRequired = propKeys.filter((k) => !required.includes(k));
          if (missingFromRequired.length > 0) {
            errors.push(
              `${path}: required array is missing keys: ${missingFromRequired.join(", ")}`
            );
          }
        }

        // Recurse into each property
        for (const [key, value] of Object.entries(props)) {
          const child = value as Record<string, unknown>;
          // Handle anyOf — recurse into each branch
          if (child.anyOf) {
            for (const branch of child.anyOf as Record<string, unknown>[]) {
              errors.push(...validateStrictObject(branch, `${path}.${key}[anyOf]`));
            }
          } else {
            errors.push(...validateStrictObject(child, `${path}.${key}`));
          }
        }
      }
    }

    // Recurse into anyOf branches at the current level
    if (schema.anyOf) {
      for (let i = 0; i < (schema.anyOf as unknown[]).length; i++) {
        errors.push(...validateStrictObject((schema.anyOf as Record<string, unknown>[])[i], `${path}[anyOf[${i}]]`));
      }
    }

    return errors;
  }

  it("satisfies all OpenAI strict mode requirements", () => {
    const errors = validateStrictObject(
      READINESS_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      "root"
    );
    if (errors.length > 0) {
      throw new Error(
        `JSON schema violates OpenAI strict mode:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\n` +
        `Fix server/madison/schema/readinessPlanSchema.ts`
      );
    }
  });

  it("has type field in query variant required array", () => {
    const queryVariant = READINESS_PLAN_JSON_SCHEMA.anyOf[0] as { required: string[] };
    expect(queryVariant.required).toContain("type");
    expect(queryVariant.required).toContain("dateScope");
    expect(queryVariant.required).toContain("filters");
    expect(queryVariant.required).toContain("sort");
  });

  it("has required array in query variant dateScope", () => {
    const queryVariant = READINESS_PLAN_JSON_SCHEMA.anyOf[0] as { properties: { dateScope: { required: string[] } } };
    const dateScope = queryVariant.properties.dateScope;
    expect(dateScope.required).toContain("type");
    expect(dateScope.required).toContain("startDate");
    expect(dateScope.required).toContain("endDate");
  });

  it("has type field in action variant required array", () => {
    const actionVariant = READINESS_PLAN_JSON_SCHEMA.anyOf[1] as { required: string[] };
    expect(actionVariant.required).toContain("type");
    expect(actionVariant.required).toContain("action");
    expect(actionVariant.required).toContain("targetIds");
    expect(actionVariant.required).toContain("serviceDate");
  });
});

// ── createReadinessPlan() integration tests ───────────────────────────────────

describe("createReadinessPlan()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a well-formed tomorrow readiness response (query)", async () => {
    const validPlan = {
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: { timeOfDay: null, startTime: null, endTime: null, exactTime: null, dimension: "all", onlyNeedsAttention: null, minimumFlagCount: null },
      sort: "service_time",
    };
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(validPlan)));

    const result = await createReadinessPlan("are we ready for tomorrow");

    expect(result.type).toBe("query");
    if (result.type === "query") {
      expect(result.dateScope.startDate).toBe("2026-07-24");
      expect(result.dateScope.type).toBe("service_date");
      expect(result.sort).toBe("service_time");
    }
  });

  it("parses a response with null filters gracefully (query)", async () => {
    const planWithNullFilters = {
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: null,
      sort: null,
    };
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(planWithNullFilters)));

    const result = await createReadinessPlan("are we ready for tomorrow");

    expect(result.type).toBe("query");
    if (result.type === "query") {
      expect(result.dateScope.startDate).toBe("2026-07-24");
      expect(result.filters).toBeNull();
      expect(result.sort).toBeNull();
    }
  });

  it("parses a well-formed action plan (acknowledge_readiness)", async () => {
    const actionPlan = {
      type: "action",
      action: "acknowledge_readiness",
      targetIds: ["123:2026-07-24:UNASSIGNED", "456:2026-07-24:CUSTOMER_UNCONFIRMED"],
      serviceDate: "2026-07-24",
    };
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(actionPlan)));

    const result = await createReadinessPlan("acknowledge those unassigned jobs");

    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.action).toBe("acknowledge_readiness");
      expect(result.targetIds).toHaveLength(2);
      expect(result.serviceDate).toBe("2026-07-24");
    }
  });

  it("throws PLAN_FAILED when invokeLLM rejects", async () => {
    const openAiError = new Error(
      'LLM invoke failed: 400 Bad Request – {"error":{"message":"Invalid schema","type":"invalid_request_error","code":null}}'
    );
    mockInvokeLLM.mockRejectedValueOnce(openAiError);

    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_FAILED",
    });
  });

  it("throws PLAN_FAILED when LLM returns non-JSON", async () => {
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse("Sorry, I cannot help with that."));

    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_FAILED",
    });
  });

  it("throws PLAN_INVALID when LLM returns JSON missing required type field", async () => {
    const badPlan = { dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" }, sort: "service_time" }; // missing type
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(badPlan)));

    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_INVALID",
    });
  });

  it("throws PLAN_INVALID when dateScope has wrong date format", async () => {
    const badPlan = {
      type: "query",
      dateScope: { type: "service_date", startDate: "July 24 2026", endDate: "July 24 2026" },
      filters: null,
      sort: null,
    };
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(badPlan)));

    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_INVALID",
    });
  });
});

// ── Zod schema validates correctly ───────────────────────────────────────────

describe("READINESS_PLAN_ZOD_SCHEMA", () => {
  it("accepts a complete valid query plan", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: {
        timeOfDay: "morning",
        startTime: null,
        endTime: null,
        exactTime: null,
        dimension: "all",
        onlyNeedsAttention: true,
        minimumFlagCount: null,
      },
      sort: "risk",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null filters in query plan", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: null,
      sort: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format in startDate", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "24-07-2026", endDate: "2026-07-24" },
      filters: null,
      sort: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown dimension value", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: { dimension: "unknown_dimension" },
      sort: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactTime in HH:MM format", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-23", endDate: "2026-07-23" },
      filters: {
        timeOfDay: null,
        startTime: null,
        endTime: null,
        exactTime: "08:30",
        dimension: null,
        onlyNeedsAttention: null,
        minimumFlagCount: null,
      },
      sort: "service_time",
    });
    expect(result.success).toBe(true);
  });

  it("rejects exactTime in non-HH:MM format", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-23", endDate: "2026-07-23" },
      filters: {
        timeOfDay: null,
        startTime: null,
        endTime: null,
        exactTime: "8:30 AM",
        dimension: null,
        onlyNeedsAttention: null,
        minimumFlagCount: null,
      },
      sort: "service_time",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid action plan", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "action",
      action: "acknowledge_readiness",
      targetIds: ["123:2026-07-24:UNASSIGNED"],
      serviceDate: "2026-07-24",
    });
    expect(result.success).toBe(true);
  });

  it("rejects action plan with unknown action type", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "action",
      action: "delete_jobs",
      targetIds: ["123:2026-07-24:UNASSIGNED"],
      serviceDate: "2026-07-24",
    });
    expect(result.success).toBe(false);
  });

  it("rejects plan with unknown type", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "unknown",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
    });
    expect(result.success).toBe(false);
  });
});

// ── JSON schema includes exactTime in filters.required ────────────────────────

describe("READINESS_PLAN_JSON_SCHEMA — exactTime field", () => {
  it("includes exactTime in query variant filters required array", () => {
    const queryVariant = READINESS_PLAN_JSON_SCHEMA.anyOf[0] as {
      properties: { filters: { anyOf: Array<{ required?: string[] }> } };
    };
    const filtersSchema = queryVariant.properties.filters.anyOf[0];
    expect(filtersSchema.required).toContain("exactTime");
  });
});
