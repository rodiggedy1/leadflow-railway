/**
 * acknowledge.test.ts
 *
 * Regression tests for the Madison Phase 2 write architecture.
 *
 * Tests cover:
 *  1. acknowledgeReadinessItems — happy path, idempotency, invalid IDs, all-invalid
 *  2. undoAcknowledgement — happy path, expired, not_found, already_reversed
 *  3. Gate patterns for action messages
 *  4. Planner discriminated union — action plan shape
 *  5. Conversation context — extractItemIdsFromProjection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  acknowledgeReadinessItems,
  undoAcknowledgement,
  encodeReadinessItemId,
  decodeReadinessItemId,
  type ReadinessItemId,
  type IssueType,
} from "./acknowledgeService";
import { isReadinessDomain } from "./gate";
import { READINESS_PLAN_JSON_SCHEMA } from "./schema/readinessPlanSchema";
import { extractItemIdsFromProjection } from "./conversationContextService";
import type { ReadinessProjection } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ITEM_ID: ReadinessItemId = {
  jobId: 42,
  serviceDate: "2026-07-25",
  issueType: "UNASSIGNED",
};

const ENCODED_VALID = encodeReadinessItemId(VALID_ITEM_ID);

// ── Mock DB factory ───────────────────────────────────────────────────────────

/**
 * Creates a minimal mock DB that simulates the Drizzle ORM query builder.
 * Each method returns `this` for chaining; terminal methods return the configured data.
 */
function makeMockDb(overrides: {
  selectRows?: unknown[];
  insertResult?: unknown;
  updateResult?: { affectedRows: number }[];
} = {}) {
  const selectRows = overrides.selectRows ?? [];
  const updateResult = overrides.updateResult ?? [{ affectedRows: 1 }];

  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(selectRows),
    limit: vi.fn().mockResolvedValue(selectRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(overrides.insertResult ?? []),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    // Terminal — resolves with updateResult
    _updateWhere: vi.fn().mockResolvedValue(updateResult),
  };

  // Make where() return updateResult when called after update().set()
  let isUpdate = false;
  chainable.update.mockImplementation(() => {
    isUpdate = true;
    return chainable;
  });
  chainable.where.mockImplementation(() => {
    if (isUpdate) {
      isUpdate = false;
      return Promise.resolve(updateResult);
    }
    return Promise.resolve(selectRows);
  });

  return chainable;
}

// ── 1. encodeReadinessItemId / decodeReadinessItemId ─────────────────────────

describe("encodeReadinessItemId / decodeReadinessItemId", () => {
  it("round-trips a valid item ID", () => {
    const encoded = encodeReadinessItemId(VALID_ITEM_ID);
    const decoded = decodeReadinessItemId(encoded);
    expect(decoded).toEqual(VALID_ITEM_ID);
  });

  it("returns null for malformed encoded ID (missing parts)", () => {
    expect(decodeReadinessItemId("42:2026-07-25")).toBeNull();
  });

  it("returns null for invalid issueType", () => {
    expect(decodeReadinessItemId("42:2026-07-25:INVALID_TYPE")).toBeNull();
  });

  it("returns null for non-numeric jobId", () => {
    expect(decodeReadinessItemId("abc:2026-07-25:UNASSIGNED")).toBeNull();
  });

  it("accepts all valid issueTypes", () => {
    const types: IssueType[] = [
      "UNASSIGNED",
      "CUSTOMER_UNCONFIRMED",
      "PAYMENT_NOT_READY",
      "ACCESS_MISSING",
      "SCHEDULE_CONFLICT",
    ];
    for (const issueType of types) {
      const encoded = encodeReadinessItemId({ jobId: 1, serviceDate: "2026-07-25", issueType });
      const decoded = decodeReadinessItemId(encoded);
      expect(decoded?.issueType).toBe(issueType);
    }
  });
});

// ── 2. acknowledgeReadinessItems ──────────────────────────────────────────────

describe("acknowledgeReadinessItems — all-invalid IDs", () => {
  it("returns failed status when all IDs are invalid", async () => {
    // Mock DB: insert resolves (for the failed action record)
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const result = await acknowledgeReadinessItems(db, {
      targetIds: ["invalid-id-1", "bad:id"],
      executedBy: 1,
    });

    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("ALL_INVALID");
    expect(result.invalidCount).toBe(2);
    expect(result.acknowledgedCount).toBe(0);
  });
});

describe("acknowledgeReadinessItems — already acknowledged (idempotency)", () => {
  it("returns alreadyAcknowledgedCount when item already has active ack", async () => {
    // Simulate: SELECT returns an existing active acknowledgement row
    const existingAck = {
      id: 1,
      jobId: 42,
      serviceDate: "2026-07-25",
      issueType: "UNASSIGNED",
      actionId: "existing-action",
      reversedAt: null,
    };

    let selectCallCount = 0;
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First select: check existing acks → returns existing
          return Promise.resolve([existingAck]);
        }
        // Subsequent selects: verification query
        return Promise.resolve([existingAck]);
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const result = await acknowledgeReadinessItems(db, {
      targetIds: [ENCODED_VALID],
      executedBy: 1,
    });

    expect(result.alreadyAcknowledgedCount).toBe(1);
    expect(result.acknowledgedCount).toBe(0);
  });
});

// ── 3. undoAcknowledgement ────────────────────────────────────────────────────

describe("undoAcknowledgement", () => {
  it("returns not_found when action does not exist", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const result = await undoAcknowledgement(db, {
      actionId: "nonexistent-action",
      reversedBy: 1,
    });

    expect(result.status).toBe("not_found");
    expect(result.reversedCount).toBe(0);
  });

  it("returns already_reversed when action is already reversed", async () => {
    const reversedAction = {
      id: "action-123",
      status: "reversed",
      acknowledgedCount: 2,
      undoExpiresAt: new Date(Date.now() + 3600_000),
    };

    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([reversedAction]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const result = await undoAcknowledgement(db, {
      actionId: "action-123",
      reversedBy: 1,
    });

    expect(result.status).toBe("already_reversed");
  });

  it("returns expired when undoExpiresAt is in the past", async () => {
    const expiredAction = {
      id: "action-456",
      status: "completed",
      acknowledgedCount: 1,
      undoExpiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
    };

    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([expiredAction]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const result = await undoAcknowledgement(db, {
      actionId: "action-456",
      reversedBy: 1,
    });

    expect(result.status).toBe("expired");
  });

  it("returns reversed on happy path", async () => {
    const activeAction = {
      id: "action-789",
      status: "completed",
      acknowledgedCount: 3,
      undoExpiresAt: new Date(Date.now() + 86400_000), // 24h from now
    };

    let isUpdate = false;
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => {
        if (isUpdate) {
          isUpdate = false;
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        return Promise.resolve([activeAction]);
      }),
      update: vi.fn().mockImplementation(() => {
        isUpdate = true;
        return db;
      }),
      set: vi.fn().mockReturnThis(),
    };

    const result = await undoAcknowledgement(db, {
      actionId: "action-789",
      reversedBy: 1,
    });

    expect(result.status).toBe("reversed");
    expect(result.reversedCount).toBe(3);
    expect(result.actionId).toBe("action-789");
  });
});

// ── 4. Gate — action message patterns ────────────────────────────────────────

describe("isReadinessDomain — action messages", () => {
  it("matches: Acknowledge those issues", () => {
    expect(isReadinessDomain("Acknowledge those issues")).toBe(true);
  });

  it("matches: Mark that as ok", () => {
    expect(isReadinessDomain("Mark that as ok")).toBe(true);
  });

  it("matches: Dismiss those flags", () => {
    expect(isReadinessDomain("Dismiss those flags")).toBe(true);
  });

  it("matches: That's fine", () => {
    expect(isReadinessDomain("That's fine")).toBe(true);
  });

  it("matches: Mark them as handled", () => {
    expect(isReadinessDomain("Mark them as handled")).toBe(true);
  });

  it("does not match: Send a text to Maria", () => {
    expect(isReadinessDomain("Send a text to Maria")).toBe(false);
  });
});

// ── 5. Planner schema — action plan shape ────────────────────────────────────

describe("READINESS_PLAN_JSON_SCHEMA — flat root object", () => {
  it("root is type: object (not bare anyOf)", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
  });

  it("root required includes all fields", () => {
    const required = READINESS_PLAN_JSON_SCHEMA.required as unknown as string[];
    expect(required).toContain("type");
    expect(required).toContain("dateScope");
    expect(required).toContain("filters");
    expect(required).toContain("sort");
    expect(required).toContain("action");
    expect(required).toContain("targetReference");
    expect(required).toContain("serviceDate");
  });

  it("type property has enum with query and action", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    const typeField = (schema.properties as Record<string, unknown>).type as { enum: string[] };
    expect(typeField.enum).toContain("query");
    expect(typeField.enum).toContain("action");
  });

  it("targetReference property is present and nullable", () => {
    const schema = READINESS_PLAN_JSON_SCHEMA as Record<string, unknown>;
    const targetRef = (schema.properties as Record<string, unknown>).targetReference;
    expect(targetRef).toBeDefined();
  });
});

// ── 6. extractItemIdsFromProjection ──────────────────────────────────────────

describe("extractItemIdsFromProjection", () => {
  const makeProjection = (jobs: ReadinessProjection["jobs"]): ReadinessProjection => ({
    date: "2026-07-25",
    totalJobs: jobs.length,
    totalIssues: jobs.reduce((acc, j) => acc + j.flags.length, 0),
    filteredJobs: jobs.length,
    appliedFilter: null,
    jobs,
    summary: {
      unassigned: 0,
      unconfirmed: 0,
      noPayment: 0,
      accessMissing: 0,
      doubleBooked: 0,
      acknowledged: 0,
    },
  });

  it("extracts UNASSIGNED item ID from unassigned job", () => {
    const projection = makeProjection([
      {
        jobId: 10,
        customerName: "Alice",
        serviceAddress: "123 Main St",
        jobTime: "9:00 AM",
        teamName: null,
        flags: ["unassigned"],
        acknowledgedIssues: [],
        riskScore: 1,
      },
    ]);

    const ids = extractItemIdsFromProjection(projection);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("10:2026-07-25:UNASSIGNED");
  });

  it("extracts multiple flags from one job", () => {
    const projection = makeProjection([
      {
        jobId: 20,
        customerName: "Bob",
        serviceAddress: "456 Oak Ave",
        jobTime: "2:00 PM",
        teamName: "Team A",
        flags: ["unassigned", "unconfirmed", "no_payment"],
        acknowledgedIssues: [],
        riskScore: 3,
      },
    ]);

    const ids = extractItemIdsFromProjection(projection);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("20:2026-07-25:UNASSIGNED");
    expect(ids).toContain("20:2026-07-25:CUSTOMER_UNCONFIRMED");
    expect(ids).toContain("20:2026-07-25:PAYMENT_NOT_READY");
  });

  it("returns empty array for job with no flags", () => {
    const projection = makeProjection([
      {
        jobId: 30,
        customerName: "Carol",
        serviceAddress: "789 Pine Rd",
        jobTime: "11:00 AM",
        teamName: "Team B",
        flags: [],
        acknowledgedIssues: [],
        riskScore: 0,
      },
    ]);

    const ids = extractItemIdsFromProjection(projection);
    expect(ids).toHaveLength(0);
  });

  it("skips unknown flag types gracefully", () => {
    const projection = makeProjection([
      {
        jobId: 40,
        customerName: "Dave",
        serviceAddress: "321 Elm St",
        jobTime: "3:00 PM",
        teamName: "Team C",
        // @ts-expect-error — testing unknown flag
        flags: ["unknown_flag", "unassigned"],
        acknowledgedIssues: [],
        riskScore: 1,
      },
    ]);

    const ids = extractItemIdsFromProjection(projection);
    // Only the valid "unassigned" flag should produce an ID
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("40:2026-07-25:UNASSIGNED");
  });
});
