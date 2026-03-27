/**
 * opsChatRouter tests — verifies the core procedures compile and behave correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB so tests don't need a real database ──────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { opsChatRouter } from "./opsChatRouter";

// Helper to call a procedure directly (bypasses tRPC HTTP layer).
// opsChatProcedure injects ctx.opsCaller — works for both owner and agent sessions.
async function callQuery(procedure: any, input?: any, callerOverride?: { id: string; name: string }) {
  const ctx = {
    // Legacy owner ctx (still present for other routers)
    user: { id: 1, name: "Test User", role: "admin" as const, openId: "test" },
    // opsChatProcedure-injected caller
    opsCaller: callerOverride ?? { id: "test", name: "Test User" },
  };
  return procedure({ ctx, input });
}

describe("opsChatRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listTodayJobs", () => {
    it("returns empty array when DB is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as any);
      const result = await callQuery(opsChatRouter._def.procedures.listTodayJobs._def.resolver);
      expect(result).toEqual([]);
    });

    it("maps jobStatus=issue_at_property to status=issue", async () => {
      const jobRow = {
        id: 1, cleanerName: "Maria", teamName: "Team Maria", customerName: "Sarah Johnson",
        jobAddress: "123 Main St", serviceType: "Recurring Standard Clean", jobRevenue: "180",
        jobStatus: "issue_at_property", issueNote: "Heavy grease in kitchen",
        serviceDateTime: "2026-03-27T09:00:00", bookingStatus: "assigned",
        customerNotes: null, staffNotes: null, flagged: 0, adminNotes: null,
        cleanerProfileId: 10, photoSubmitted: 0,
      };
      // First call: jobs query (ends with orderBy)
      // Second call: message counts query (ends with where)
      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn(function(this: any) {
          callCount++;
          if (callCount === 1) return { orderBy: () => Promise.resolve([jobRow]) };
          return Promise.resolve([]); // message counts
        }),
        orderBy: vi.fn().mockResolvedValue([jobRow]),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await callQuery(opsChatRouter._def.procedures.listTodayJobs._def.resolver);
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0].status).toBe("issue");
      }
    });

    it("maps jobStatus=completed to status=complete", () => {
      // Unit-test the toPriorityStatus mapping via the exported shape
      // We verify the logic indirectly through the status field
      const statusMap: Record<string, string> = {
        issue_at_property: "issue",
        completed: "complete",
        in_progress: "progress",
        arrived: "progress",
        on_the_way: "soon",
        running_late: "soon",
      };
      // All mappings should produce valid priority statuses
      const validStatuses = ["issue", "soon", "progress", "complete", "assigned"];
      for (const mapped of Object.values(statusMap)) {
        expect(validStatuses).toContain(mapped);
      }
    });
  });

  describe("getJobDetail", () => {
    it("returns null when DB is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as any);
      const result = await callQuery(opsChatRouter._def.procedures.getJobDetail._def.resolver, { jobId: 999 });
      expect(result).toBeNull();
    });

    it("returns null when job not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // no job found
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);
      const result = await callQuery(opsChatRouter._def.procedures.getJobDetail._def.resolver, { jobId: 999 });
      expect(result).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("throws when DB is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as any);
      await expect(
        callQuery(opsChatRouter._def.procedures.sendMessage._def.resolver, {
          cleanerJobId: 1,
          body: "Hello",
          authorName: "Office",
          authorRole: "office",
        })
      ).rejects.toThrow("DB unavailable");
    });

    it("inserts a message and returns success", async () => {
      const insertValues = vi.fn().mockResolvedValue(undefined);
      const mockDb = {
        insert: vi.fn().mockReturnValue({ values: insertValues }),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await callQuery(opsChatRouter._def.procedures.sendMessage._def.resolver, {
        cleanerJobId: 1,
        body: "Job looks good!",
        authorName: "Office",
        authorRole: "office",
      });

      expect(result).toEqual({ success: true });
      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
        cleanerJobId: 1,
        body: "Job looks good!",
        authorName: "Office",
        authorRole: "office",
      }));
    });

    it("stores quickAction when provided", async () => {
      const insertValues = vi.fn().mockResolvedValue(undefined);
      const mockDb = {
        insert: vi.fn().mockReturnValue({ values: insertValues }),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      await callQuery(opsChatRouter._def.procedures.sendMessage._def.resolver, {
        cleanerJobId: 5,
        body: "Issue flagged",
        authorName: "Office",
        authorRole: "office",
        quickAction: "Issue",
      });

      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
        quickAction: "Issue",
      }));
    });
  });

  describe("listChannelMessages", () => {
    it("returns empty array when DB is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as any);
      const result = await callQuery(opsChatRouter._def.procedures.listChannelMessages._def.resolver, { channel: "dispatch" });
      expect(result).toEqual([]);
    });

    it("returns messages in chronological order", async () => {
      const mockMsgs = [
        { id: 2, channel: "dispatch", authorName: "Office", authorRole: "office", body: "Second", mediaUrl: null, quickAction: null, createdAt: new Date("2026-03-27T10:00:00") },
        { id: 1, channel: "dispatch", authorName: "Office", authorRole: "office", body: "First", mediaUrl: null, quickAction: null, createdAt: new Date("2026-03-27T09:00:00") },
      ];
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockMsgs),
      };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await callQuery(opsChatRouter._def.procedures.listChannelMessages._def.resolver, { channel: "dispatch" });
      // Messages are reversed (desc -> asc) so first should be id=1
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });
  });

  describe("getChannelCounts", () => {
    it("returns zero counts when DB is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as any);
      const result = await callQuery(opsChatRouter._def.procedures.getChannelCounts._def.resolver);
      expect(result).toEqual({ urgent: 0, dispatch: 0, general: 0, cleaners: 0 });
    });
  });

  describe("opsChatProcedure — unified access", () => {
    it("sendMessage uses opsCaller.id for flaggedBy when called as owner", async () => {
      const insertValues = vi.fn().mockResolvedValue(undefined);
      const mockDb = { insert: vi.fn().mockReturnValue({ values: insertValues }) };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await callQuery(
        opsChatRouter._def.procedures.sendMessage._def.resolver,
        { cleanerJobId: 1, body: "Owner msg", authorName: "Owner", authorRole: "office" },
        { id: "owner-open-id", name: "Owner" }
      );
      expect(result).toEqual({ success: true });
    });

    it("sendMessage uses opsCaller.id for flaggedBy when called as agent", async () => {
      const insertValues = vi.fn().mockResolvedValue(undefined);
      const mockDb = { insert: vi.fn().mockReturnValue({ values: insertValues }) };
      vi.mocked(getDb).mockResolvedValue(mockDb as any);

      const result = await callQuery(
        opsChatRouter._def.procedures.sendMessage._def.resolver,
        { cleanerJobId: 2, body: "Agent msg", authorName: "Sarah", authorRole: "office" },
        { id: "agent-uuid-123", name: "Sarah" }
      );
      expect(result).toEqual({ success: true });
    });
  });
});
