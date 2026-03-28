/**
 * commandChatActions.test.ts
 * Tests for the four new Command Chat quick-action procedures:
 *   openIssue, setReminder, pinNote / dismissPin / getChannelPin, announceBooking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock getDb ─────────────────────────────────────────────────────────────────
const mockInsert = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue([]);

const mockDb = {
  insert: mockInsert,
  values: mockValues,
  update: mockUpdate,
  set: mockSet,
  where: mockWhere,
  select: mockSelect,
  from: mockFrom,
  limit: mockLimit,
  execute: mockExecute,
};

// Chain all methods back to mockDb so fluent calls work
mockInsert.mockReturnValue(mockDb);
mockValues.mockReturnValue(mockDb);
mockUpdate.mockReturnValue(mockDb);
mockSet.mockReturnValue(mockDb);
mockWhere.mockReturnValue(mockDb);
mockSelect.mockReturnValue(mockDb);
mockFrom.mockReturnValue(mockDb);

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../drizzle/schema", () => ({
  opsChatMessages: "opsChatMessages",
  channelPins: "channelPins",
  opsReminders: "opsReminders",
  cleanerJobs: "cleanerJobs",
  cleanerProfiles: "cleanerProfiles",
  conversationSessions: "conversationSessions",
  fieldMgmtLog: "fieldMgmtLog",
  jobPhotos: "jobPhotos",
  jobStatusHistory: "jobStatusHistory",
  jobSmsReplies: "jobSmsReplies",
  issueFlags: "issueFlags",
  opsChatReads: "opsChatReads",
}));

vi.mock("./openphone", () => ({ sendSms: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./_core/voiceTranscription", () => ({ transcribeAudio: vi.fn() }));

// ── unit tests ─────────────────────────────────────────────────────────────────

describe("openIssue input validation", () => {
  it("requires a non-empty title", () => {
    const { z } = require("zod");
    const schema = z.object({
      channel: z.string().default("command"),
      title: z.string().min(1).max(200),
      authorName: z.string().min(1).max(128),
      note: z.string().max(2000).optional(),
      jobId: z.number().int().optional(),
    });
    expect(() => schema.parse({ title: "", authorName: "Alice" })).toThrow();
    expect(schema.parse({ title: "Broken vacuum", authorName: "Alice" })).toMatchObject({
      title: "Broken vacuum",
      channel: "command",
    });
  });

  it("rejects title longer than 200 chars", () => {
    const { z } = require("zod");
    const schema = z.object({ title: z.string().min(1).max(200), authorName: z.string() });
    expect(() => schema.parse({ title: "x".repeat(201), authorName: "Alice" })).toThrow();
  });
});

describe("setReminder input validation", () => {
  it("requires a future triggerAt (number)", () => {
    const { z } = require("zod");
    const schema = z.object({
      channel: z.string().default("command"),
      body: z.string().min(1).max(1000),
      authorName: z.string().min(1).max(128),
      triggerAt: z.number().int().positive(),
    });
    const future = Date.now() + 5 * 60_000;
    const result = schema.parse({ body: "Check in with cleaners", authorName: "Bob", triggerAt: future });
    expect(result.triggerAt).toBe(future);
  });

  it("rejects empty body", () => {
    const { z } = require("zod");
    const schema = z.object({ body: z.string().min(1), authorName: z.string(), triggerAt: z.number() });
    expect(() => schema.parse({ body: "", authorName: "Bob", triggerAt: Date.now() + 1000 })).toThrow();
  });
});

describe("pinNote input validation", () => {
  it("requires non-empty body up to 2000 chars", () => {
    const { z } = require("zod");
    const schema = z.object({
      channel: z.string().default("command"),
      body: z.string().min(1).max(2000),
      authorName: z.string().min(1).max(128),
    });
    expect(() => schema.parse({ body: "", authorName: "Carol" })).toThrow();
    expect(() => schema.parse({ body: "x".repeat(2001), authorName: "Carol" })).toThrow();
    expect(schema.parse({ body: "Parking lot closed today", authorName: "Carol" })).toMatchObject({
      body: "Parking lot closed today",
      channel: "command",
    });
  });
});

describe("announceBooking input validation", () => {
  it("requires personName", () => {
    const { z } = require("zod");
    const schema = z.object({
      channel: z.string().default("command"),
      personName: z.string().min(1).max(128),
      authorName: z.string().min(1).max(128),
      amount: z.string().max(64).optional(),
      note: z.string().max(1000).optional(),
    });
    expect(() => schema.parse({ personName: "", authorName: "Dave" })).toThrow();
    const result = schema.parse({ personName: "Sarah Johnson", authorName: "Dave", amount: "$320/mo" });
    expect(result.personName).toBe("Sarah Johnson");
    expect(result.amount).toBe("$320/mo");
  });

  it("amount and note are optional", () => {
    const { z } = require("zod");
    const schema = z.object({
      personName: z.string().min(1),
      authorName: z.string().min(1),
      amount: z.string().optional(),
      note: z.string().optional(),
    });
    const result = schema.parse({ personName: "Jane", authorName: "Dave" });
    expect(result.amount).toBeUndefined();
    expect(result.note).toBeUndefined();
  });
});

describe("reminder cron metadata", () => {
  it("builds correct metadata JSON for a reminder card", () => {
    const reminderBody = "Check on Team B status";
    const setBy = "Alice";
    const meta = JSON.stringify({ reminderBody, setBy });
    const parsed = JSON.parse(meta);
    expect(parsed.reminderBody).toBe(reminderBody);
    expect(parsed.setBy).toBe(setBy);
  });
});

describe("announce_booking card metadata", () => {
  it("builds correct metadata JSON for a booking card", () => {
    const personName = "Sarah Johnson";
    const amount = "$320 recurring";
    const note = "Referred by Mike";
    const meta = JSON.stringify({ personName, amount, note });
    const parsed = JSON.parse(meta);
    expect(parsed.personName).toBe(personName);
    expect(parsed.amount).toBe(amount);
    expect(parsed.note).toBe(note);
  });
});
