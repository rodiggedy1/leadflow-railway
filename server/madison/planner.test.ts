/**
 * planner.test.ts
 *
 * Tests for createReadinessPlan() and the OpenAI JSON schema.
 *
 * Goals:
 *   1. Assert root schema is type: "object" — no bare anyOf at root (OpenAI strict mode).
 *   2. Assert every property is in required (strict mode).
 *   3. Assert normalizeFlatPlan() converts flat responses to the internal union shape.
 *   4. Assert createReadinessPlan() parses well-formed LLM responses correctly.
 *   5. Assert createReadinessPlan() throws PLAN_FAILED on LLM error.
 *   6. Assert createReadinessPlan() throws PLAN_INVALID on malformed JSON.
 *   7. Planner integration tests: query and action plan paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  READINESS_PLAN_JSON_SCHEMA,
  READINESS_PLAN_ZOD_SCHEMA,
  normalizeFlatPlan,
  type FlatPlanResponse,
} from "./schema/readinessPlanSchema";
import { MadisonError } from "./types";

// ── Mock invokeLLM so tests never make real API calls ─────────────────────────

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "../_core/llm";
import { createReadinessPlan } from "./planner";

const mockInvokeLLM = vi.mocked(invokeLLM);

function makeLLMResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

// ── Helper: flat plan builder ─────────────────────────────────────────────────

function makeQueryFlat(overrides: Partial<FlatPlanResponse> = {}): FlatPlanResponse {
  return {
    type: "query",
    dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
    filters: {
      timeOfDay: null, startTime: null, endTime: null, exactTime: null,
      dimension: "all", onlyNeedsAttention: null, minimumFlagCount: null,
    },
    sort: "service_time",
    action: null,
    targetReference: null,
    serviceDate: null,
    ...overrides,
  };
}

function makeActionFlat(overrides: Partial<FlatPlanResponse> = {}): FlatPlanResponse {
  return {
    type: "action",
    dateScope: null,
    filters: null,
    sort: null,
    action: "acknowledge_readiness",
    targetReference: { kind: "context_selection" },
    serviceDate: "2026-07-24",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OpenAI JSON schema structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("READINESS_PLAN_JSON_SCHEMA — OpenAI strict mode compliance", () => {
  it("root schema is type: object (not bare anyOf)", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
  });

  it("root schema has additionalProperties: false", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
  });

  it("every root property is listed in required", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    const props = Object.keys(schema.properties as Record<string, unknown>);
    const required = schema.required as string[];
    const missing = props.filter((k) => !required.includes(k));
    expect(missing).toHaveLength(0);
  });

  it("required array contains all expected fields", () => {
    const required = READINESS_PLAN_JSON_SCHEMA.required as unknown as string[];
    expect(required).toContain("type");
    expect(required).toContain("dateScope");
    expect(required).toContain("filters");
    expect(required).toContain("sort");
    expect(required).toContain("action");
    expect(required).toContain("targetReference");
    expect(required).toContain("serviceDate");
  });

  /**
   * Recursively validates that every object in the schema satisfies
   * OpenAI strict mode requirements.
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
          errors.push(`${path}: missing required array`);
        } else {
          const missing = propKeys.filter((k) => !required.includes(k));
          if (missing.length > 0) {
            errors.push(`${path}: required missing keys: ${missing.join(", ")}`);
          }
        }
        for (const [key, value] of Object.entries(props)) {
          const child = value as Record<string, unknown>;
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

    if (schema.anyOf) {
      for (let i = 0; i < (schema.anyOf as unknown[]).length; i++) {
        errors.push(
          ...validateStrictObject(
            (schema.anyOf as Record<string, unknown>[])[i],
            `${path}[anyOf[${i}]]`
          )
        );
      }
    }

    return errors;
  }

  it("satisfies all OpenAI strict mode requirements recursively", () => {
    const errors = validateStrictObject(
      READINESS_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      "root"
    );
    if (errors.length > 0) {
      throw new Error(
        `JSON schema violates OpenAI strict mode:\n${errors.map((e) => `  - ${e}`).join("\n")}`
      );
    }
  });

  it("filters object includes exactTime in required", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    const filtersAnyOf = (schema.properties as Record<string, unknown>).filters as {
      anyOf: Array<{ required?: string[] }>;
    };
    const filtersObj = filtersAnyOf.anyOf[0];
    expect(filtersObj.required).toContain("exactTime");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeFlatPlan()
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeFlatPlan()", () => {
  it("converts flat query response to internal query shape", () => {
    const flat = makeQueryFlat();
    const normalized = normalizeFlatPlan(flat) as Record<string, unknown>;
    expect(normalized.type).toBe("query");
    expect(normalized.dateScope).toBeDefined();
    expect(normalized.action).toBeUndefined();
    expect(normalized.targetReference).toBeUndefined();
  });

  it("converts flat action response to internal action shape", () => {
    const flat = makeActionFlat();
    const normalized = normalizeFlatPlan(flat) as Record<string, unknown>;
    expect(normalized.type).toBe("action");
    expect(normalized.action).toBe("acknowledge_readiness");
    expect((normalized.targetReference as Record<string, unknown>).kind).toBe("context_selection");
    expect(normalized.dateScope).toBeUndefined();
  });

  it("converts explicit targetReference correctly", () => {
    const flat = makeActionFlat({
      targetReference: { kind: "explicit", itemIds: ["abc:2026-07-24:UNASSIGNED"] },
    });
    const normalized = normalizeFlatPlan(flat) as Record<string, unknown>;
    const ref = normalized.targetReference as Record<string, unknown>;
    expect(ref.kind).toBe("explicit");
    expect(ref.itemIds).toHaveLength(1);
  });

  it("throws on contradictory type=query with action set", () => {
    const flat = makeQueryFlat({ action: "acknowledge_readiness" });
    expect(() => normalizeFlatPlan(flat)).toThrow("Contradictory");
  });

  it("throws on contradictory type=action with dateScope set", () => {
    const flat = makeActionFlat({
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
    });
    expect(() => normalizeFlatPlan(flat)).toThrow("Contradictory");
  });

  it("throws on action plan missing targetReference", () => {
    const flat = makeActionFlat({ targetReference: null });
    expect(() => normalizeFlatPlan(flat)).toThrow("targetReference");
  });

  it("throws on unknown plan type", () => {
    expect(() => normalizeFlatPlan({ type: "unknown" } as unknown as FlatPlanResponse)).toThrow(
      "Unknown plan type"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. createReadinessPlan() — integration tests (mocked LLM)
// ─────────────────────────────────────────────────────────────────────────────

describe("createReadinessPlan()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("'What is needed tomorrow?' → query plan parses successfully", async () => {
    const flat = makeQueryFlat({
      filters: {
        timeOfDay: null, startTime: null, endTime: null, exactTime: null,
        dimension: "all", onlyNeedsAttention: true, minimumFlagCount: null,
      },
      sort: "risk",
    });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));

    const result = await createReadinessPlan("What is needed tomorrow?");
    expect(result.type).toBe("query");
    if (result.type === "query") {
      expect(result.dateScope.startDate).toBe("2026-07-24");
      expect(result.filters?.onlyNeedsAttention).toBe(true);
    }
  });

  it("'Which jobs have no cleaner tomorrow?' → query plan parses successfully", async () => {
    const flat = makeQueryFlat({
      filters: {
        timeOfDay: null, startTime: null, endTime: null, exactTime: null,
        dimension: "assignment", onlyNeedsAttention: true, minimumFlagCount: null,
      },
      sort: "risk",
    });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));

    const result = await createReadinessPlan("Which jobs have no cleaner tomorrow?");
    expect(result.type).toBe("query");
    if (result.type === "query") {
      expect(result.filters?.dimension).toBe("assignment");
    }
  });

  it("'Acknowledge those.' → action plan parses successfully", async () => {
    const flat = makeActionFlat();
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));

    const result = await createReadinessPlan("Acknowledge those.");
    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.action).toBe("acknowledge_readiness");
      expect(result.targetReference.kind).toBe("context_selection");
    }
  });

  it("parses action plan with explicit targetReference", async () => {
    const flat = makeActionFlat({
      targetReference: { kind: "explicit", itemIds: ["123:2026-07-24:UNASSIGNED"] },
    });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));

    const result = await createReadinessPlan("acknowledge job 123");
    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.targetReference.kind).toBe("explicit");
      if (result.targetReference.kind === "explicit") {
        expect(result.targetReference.itemIds).toContain("123:2026-07-24:UNASSIGNED");
      }
    }
  });

  it("parses null filters gracefully (query)", async () => {
    const flat = makeQueryFlat({ filters: null });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));

    const result = await createReadinessPlan("are we ready for tomorrow");
    expect(result.type).toBe("query");
    if (result.type === "query") {
      expect(result.filters).toBeNull();
    }
  });

  it("throws PLAN_FAILED when invokeLLM rejects", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("LLM unavailable"));
    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_FAILED",
    });
  });

  it("throws PLAN_FAILED when LLM returns non-JSON", async () => {
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse("Sorry, I cannot help."));
    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_FAILED",
    });
  });

  it("throws PLAN_INVALID when LLM returns JSON missing required type field", async () => {
    const bad = { dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" } };
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(bad)));
    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_INVALID",
    });
  });

  it("throws PLAN_INVALID when dateScope has wrong date format", async () => {
    const flat = makeQueryFlat({
      dateScope: { type: "service_date", startDate: "July 24 2026", endDate: "July 24 2026" },
    });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));
    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_INVALID",
    });
  });

  it("throws PLAN_INVALID on contradictory response (type=query with action set)", async () => {
    const flat = makeQueryFlat({ action: "acknowledge_readiness" });
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(JSON.stringify(flat)));
    await expect(createReadinessPlan("are we ready for tomorrow")).rejects.toMatchObject({
      code: "PLAN_INVALID",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Zod schema validates correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("READINESS_PLAN_ZOD_SCHEMA", () => {
  it("accepts a complete valid query plan", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "query",
      dateScope: { type: "service_date", startDate: "2026-07-24", endDate: "2026-07-24" },
      filters: {
        timeOfDay: "morning", startTime: null, endTime: null, exactTime: null,
        dimension: "all", onlyNeedsAttention: true, minimumFlagCount: null,
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
        timeOfDay: null, startTime: null, endTime: null, exactTime: "08:30",
        dimension: null, onlyNeedsAttention: null, minimumFlagCount: null,
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
        timeOfDay: null, startTime: null, endTime: null, exactTime: "8:30 AM",
        dimension: null, onlyNeedsAttention: null, minimumFlagCount: null,
      },
      sort: "service_time",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid action plan with context_selection", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "action",
      action: "acknowledge_readiness",
      targetReference: { kind: "context_selection" },
      serviceDate: "2026-07-24",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid action plan with explicit targetReference", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "action",
      action: "acknowledge_readiness",
      targetReference: { kind: "explicit", itemIds: ["123:2026-07-24:UNASSIGNED"] },
      serviceDate: "2026-07-24",
    });
    expect(result.success).toBe(true);
  });

  it("rejects action plan with unknown action type", () => {
    const result = READINESS_PLAN_ZOD_SCHEMA.safeParse({
      type: "action",
      action: "delete_jobs",
      targetReference: { kind: "context_selection" },
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
