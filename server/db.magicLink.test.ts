/**
 * Tests for getOrCreateCleanerMagicLink helper in server/db.ts
 *
 * Strategy: mock drizzle at the module level so the real getDb() returns
 * a controlled mock DB instance. This avoids the circular-mock issue where
 * vi.mock("./db") can't intercept calls made from within the same module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mock state so it's available before module evaluation ───────────────
const { mockSelect, mockInsert, mockLimit } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockSelect = vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: mockLimit,
  }));
  const mockInsert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  return { mockSelect, mockInsert, mockLimit };
});

// Mock drizzle so getDb() returns our controlled mock
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
}));

// Ensure DATABASE_URL is set so getDb() doesn't bail out early
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";

// Import AFTER mocks are set up
import { getOrCreateCleanerMagicLink } from "./db";

const BASE_URL = "https://quote.maidinblack.com";
const CALLBACK_PATH = "/auth/cleaner-callback?token=";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the DB singleton between tests so drizzle() is called fresh
  // We can't import resetDb directly without circular issues, so we re-mock
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: mockLimit,
  });
  mockInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
});

describe("getOrCreateCleanerMagicLink", () => {
  it("returns the existing token URL when a valid token exists in DB", async () => {
    const existingToken = "abc123def456existingtoken0000000000000000000000000000000000000000";
    mockLimit.mockResolvedValueOnce([{ token: existingToken }]);

    const url = await getOrCreateCleanerMagicLink(5);

    expect(url).toBe(`${BASE_URL}${CALLBACK_PATH}${existingToken}`);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates a new token and returns its URL when no valid token exists", async () => {
    mockLimit.mockResolvedValueOnce([]); // no existing token

    let capturedToken = "";
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockImplementation((data: { token: string }) => {
        capturedToken = data.token;
        return Promise.resolve(undefined);
      }),
    });

    const url = await getOrCreateCleanerMagicLink(5);

    expect(url).toMatch(new RegExp(`^${BASE_URL.replace(/\./g, "\\.")}${CALLBACK_PATH.replace(/\?/g, "\\?")}[0-9a-f]{64}$`));
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(capturedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses the existing token on repeated calls without inserting", async () => {
    const existingToken = "reuse_token_00000000000000000000000000000000000000000000000000000000";
    mockLimit.mockResolvedValue([{ token: existingToken }]);

    const url1 = await getOrCreateCleanerMagicLink(7);
    const url2 = await getOrCreateCleanerMagicLink(7);

    expect(url1).toBe(url2);
    expect(url1).toContain(existingToken);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("generates a 64-character hex token for new entries", async () => {
    mockLimit.mockResolvedValueOnce([]);

    let capturedToken = "";
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockImplementation((data: { token: string }) => {
        capturedToken = data.token;
        return Promise.resolve(undefined);
      }),
    });

    await getOrCreateCleanerMagicLink(99);

    expect(capturedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the cleanerProfileId in the new token record", async () => {
    mockLimit.mockResolvedValueOnce([]);

    let capturedProfileId: number | null = null;
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockImplementation((data: { cleanerProfileId: number }) => {
        capturedProfileId = data.cleanerProfileId;
        return Promise.resolve(undefined);
      }),
    });

    await getOrCreateCleanerMagicLink(42);

    expect(capturedProfileId).toBe(42);
  });
});
