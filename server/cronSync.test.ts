/**
 * Tests for cronSync.ts
 *
 * We test the HTTP endpoint security and the runNightlySync helper in isolation
 * by mocking the Launch27 connector and the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---- Mock dependencies before importing cronSync ----

vi.mock("./launch27", () => ({
  getCompletedBookingsForDate: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./routers", () => ({
  extractUSDigits: vi.fn((phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    if (digits.length === 10) return digits;
    return null;
  }),
  isValidUSPhone: vi.fn((digits: string) => {
    if (!digits || digits.length !== 10) return false;
    const areaCode = digits[0];
    const exchange = digits[3];
    return areaCode >= "2" && exchange >= "2";
  }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { registerCronRoutes, runNightlySync } from "./cronSync";
import { getCompletedBookingsForDate } from "./launch27";
import { getDb } from "./db";

// ---- Helper to build a minimal Express app with the cron route ----
function buildApp(cronSecret?: string): express.Application {
  const originalEnv = process.env.CRON_SECRET;
  if (cronSecret !== undefined) {
    process.env.CRON_SECRET = cronSecret;
  } else {
    delete process.env.CRON_SECRET;
  }
  const app = express();
  app.use(express.json());
  registerCronRoutes(app);
  // Restore after registration (env is read at request time, not at registration time)
  if (originalEnv !== undefined) {
    process.env.CRON_SECRET = originalEnv;
  } else {
    delete process.env.CRON_SECRET;
  }
  return app;
}

describe("POST /api/cron/nightly-sync — security", () => {
  it("returns 503 when CRON_SECRET is not set", async () => {
    const savedSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    const app = express();
    app.use(express.json());
    registerCronRoutes(app);

    const res = await request(app).post("/api/cron/nightly-sync").send({});
    expect(res.status).toBe(503);

    if (savedSecret) process.env.CRON_SECRET = savedSecret;
  });

  it("returns 401 when X-Cron-Secret header is wrong", async () => {
    const savedSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "correct-secret";

    const app = express();
    app.use(express.json());
    registerCronRoutes(app);

    const res = await request(app)
      .post("/api/cron/nightly-sync")
      .set("x-cron-secret", "wrong-secret")
      .send({});
    expect(res.status).toBe(401);

    if (savedSecret) process.env.CRON_SECRET = savedSecret;
    else delete process.env.CRON_SECRET;
  });

  it("returns 200 when correct X-Cron-Secret is provided", async () => {
    const savedSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret-abc";

    // Mock DB and Launch27 for a successful empty-result sync
    (getCompletedBookingsForDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      date: "2026-03-15",
      fetched: 0,
      bookings: [],
    });

    const app = express();
    app.use(express.json());
    registerCronRoutes(app);

    const res = await request(app)
      .post("/api/cron/nightly-sync")
      .set("x-cron-secret", "test-secret-abc")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    if (savedSecret) process.env.CRON_SECRET = savedSecret;
    else delete process.env.CRON_SECRET;
  });
});

describe("runNightlySync — logic", () => {
  beforeEach(() => {
    // resetAllMocks resets call history but preserves implementations set in vi.mock factories
    vi.resetAllMocks();
  });

  it("returns empty result when Launch27 returns no bookings", async () => {
    // DB is called first to check availability
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    (getCompletedBookingsForDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      date: "2026-03-15",
      fetched: 0,
      bookings: [],
    });

    const result = await runNightlySync("2026-03-15");
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.batchId).toBeNull();
    expect(result.message).toContain("No completed bookings");
  });

  it("returns error message when Launch27 returns an error", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    (getCompletedBookingsForDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      date: "2026-03-15",
      fetched: 0,
      bookings: [],
      error: "Network timeout",
    });

    const result = await runNightlySync("2026-03-15");
    expect(result.inserted).toBe(0);
    // The error is wrapped in "Launch27 error: ..."
    expect(result.message).toContain("Launch27 error");
  });

  it("returns error message when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await runNightlySync("2026-03-15");
    expect(result.inserted).toBe(0);
    expect(result.message).toContain("DB unavailable");
  });

  it("skips bookings with invalid/non-US phone numbers", async () => {
    // The invalid phone test: all bookings have invalid phones so validBookings is empty
    // runNightlySync returns early with "All X bookings had invalid/non-US phone numbers"
    // DB is still needed for the initial getDb() call
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    (getCompletedBookingsForDate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      date: "2026-03-15",
      fetched: 1,
      bookings: [
        {
          id: 2,
          phone: "0770748959", // Uganda number — starts with 0, invalid US
          firstName: "Bob",
          lastName: "Jones",
          fullName: "Bob Jones",
          email: "",
          serviceDate: "2026-03-15T10:00:00Z",
          frequency: "One-time",
          address: "",
          totalRevenue: 100,
          bookingStatus: "completed",
        },
      ],
    });

    const result = await runNightlySync("2026-03-15");
    expect(result.inserted).toBe(0);
    // The function returns early with a message about invalid phones
    // skipped count equals the number of invalid bookings
    expect(result.skipped).toBe(1);
    expect(result.message).toContain("invalid");
  });
});
