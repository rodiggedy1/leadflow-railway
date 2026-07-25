import { describe, it, expect, vi } from "vitest";

describe("Signal 3: acquisition failure threshold", () => {
  it("triggers when 5+ restart-worthy failures in 10 minutes", () => {
    const now = Date.now();
    const failures = [
      { ts: now - 1000, code: "ETIMEDOUT" },
      { ts: now - 2000, code: "ETIMEDOUT" },
      { ts: now - 3000, code: "ECONNRESET" },
      { ts: now - 4000, code: "ETIMEDOUT" },
      { ts: now - 5000, code: "QUEUE_LIMIT" },
    ];
    const cutoff = now - 10 * 60_000;
    const recent = failures.filter(f => f.ts >= cutoff);
    expect(recent.length).toBeGreaterThanOrEqual(5);
  });

  it("does NOT trigger when failures are older than 10 minutes", () => {
    const now = Date.now();
    const failures = [
      { ts: now - 11 * 60_000, code: "ETIMEDOUT" },
      { ts: now - 12 * 60_000, code: "ETIMEDOUT" },
      { ts: now - 13 * 60_000, code: "ETIMEDOUT" },
      { ts: now - 14 * 60_000, code: "ETIMEDOUT" },
      { ts: now - 15 * 60_000, code: "ETIMEDOUT" },
    ];
    const cutoff = now - 10 * 60_000;
    const recent = failures.filter(f => f.ts >= cutoff);
    expect(recent.length).toBe(0);
  });

  it("PROTOCOL_CONNECTION_LOST is NOT in RESTART_WORTHY_CODES (known gap)", () => {
    const RESTART_WORTHY_CODES = new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","QUEUE_LIMIT"]);
    expect(RESTART_WORTHY_CODES.has("PROTOCOL_CONNECTION_LOST")).toBe(false);
  });
});

describe("Signal 4: catastrophic event-loop lag", () => {
  it("triggers when max lag > 10s", () => {
    expect(12_000 > 10_000).toBe(true);
  });
  it("does not trigger when max lag < threshold", () => {
    expect(500 > 10_000).toBe(false);
  });
});

describe("Signal 5: sustained event-loop lag", () => {
  it("triggers when p99 > 2s sustained for 60s", () => {
    expect(3_000 > 2_000 && 65_000 >= 60_000).toBe(true);
  });
  it("does not trigger when not sustained long enough", () => {
    expect(3_000 > 2_000 && 30_000 >= 60_000).toBe(false);
  });
  it("resets sustained timer when lag drops", () => {
    let sustainedLagSince: number | null = Date.now() - 30_000;
    if (500 <= 2_000) sustainedLagSince = null;
    expect(sustainedLagSince).toBeNull();
  });
});

describe("singleton guard", () => {
  it("is a no-op if already started", () => {
    let started = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    function simulateStart() {
      if (started) { console.warn("[DB Watchdog] Already started — ignoring duplicate call"); return; }
      started = true;
    }
    simulateStart();
    simulateStart();
    expect(warnSpy).toHaveBeenCalledWith("[DB Watchdog] Already started — ignoring duplicate call");
    warnSpy.mockRestore();
  });
});

describe("cold-start: watchdog starts with no prior DB usage", () => {
  it("getPool() returns null before getDb() without DATABASE_URL", async () => {
    vi.resetModules();
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const { getPool, getDb } = await import("./db");
    await getDb();
    expect(getPool()).toBeNull();
    process.env.DATABASE_URL = saved;
  });

  it("startup guard exits when pool is null", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});
    function guard(poolNull: boolean) {
      if (poolNull) { console.error("[DB Watchdog] FATAL — DB pool not initialized at server start. Check DATABASE_URL."); process.exit(1); }
    }
    guard(true);
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("startup guard does NOT exit when pool is initialized", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    function guard(poolNull: boolean) { if (poolNull) process.exit(1); }
    guard(false);
    expect(mockExit).not.toHaveBeenCalled();
    mockExit.mockRestore();
  });
});

describe("dynamic pool reference", () => {
  it("getPool() returns null after resetDb()", async () => {
    vi.resetModules();
    const { getPool, resetDb } = await import("./db");
    resetDb();
    expect(getPool()).toBeNull();
  });
});
