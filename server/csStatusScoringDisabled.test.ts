import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));

import { enqueueScoring, scoreAndCacheStatus } from "./csStatusScorer";

function databaseMock() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue(databaseMock());
  mocks.invokeLLM.mockResolvedValue({
    choices: [{ message: { content: '{"status":"scheduling"}' } }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background status scoring disabled", () => {
  it.each([
    [101, false, "customer"],
    [102, true, "team"],
  ])(
    "does no database or AI work for %s (%s, %s)",
    async (sessionId, isTeam) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      expect(enqueueScoring(sessionId, isTeam)).toBeUndefined();
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.invokeLLM).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );

  it("does not build a backlog when repeatedly called by polling or incoming-message paths", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    for (let index = 0; index < 1_200; index++) {
      enqueueScoring(100_000 + index, index % 2 === 0);
      enqueueScoring(101, false);
    }
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("leaves previously saved AI labels and cache metadata untouched", async () => {
    const saved = {
      csStatusTier: "hot_lead",
      csStatusTieredAt: 123,
      csStatusMsgLen: 5,
    };
    const db = databaseMock();
    mocks.getDb.mockResolvedValue(db);

    enqueueScoring(103, false);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(db.update).not.toHaveBeenCalled();
    expect(saved).toEqual({
      csStatusTier: "hot_lead",
      csStatusTieredAt: 123,
      csStatusMsgLen: 5,
    });
  });

  it("keeps both existing background callers wired to the inert queue entry point", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const webhook = fs.readFileSync(
      path.join(root, "server/webhooks.ts"),
      "utf8"
    );
    const router = fs.readFileSync(
      path.join(root, "server/routers.ts"),
      "utf8"
    );
    expect(webhook).toContain(
      'import { enqueueScoring } from "./csStatusScorer";'
    );
    expect(webhook).toContain("enqueueScoring(resolvedSessionId, isCleaner)");
    expect(router).toContain(
      'import("./csStatusScorer").then(({ enqueueScoring })'
    );
    expect(router).toContain("enqueueScoring(s.id, isTeam)");
  });
});

describe("existing direct scorer behavior preserved", () => {
  it("retains its cache-hit short circuit", async () => {
    await scoreAndCacheStatus(
      104,
      false,
      [{ role: "user", content: "Hello" }],
      1,
      "hot_lead",
      1
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });

  it("retains its terminal-ack rule without invoking AI", async () => {
    const db = databaseMock();
    mocks.getDb.mockResolvedValue(db);
    await scoreAndCacheStatus(
      105,
      false,
      [{ role: "user", content: "Thanks" }],
      1,
      null,
      null
    );
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ csStatusTier: "solved", csStatusMsgLen: 1 })
    );
  });

  it("retains the existing AI prompt and cache write for explicit non-background calls", async () => {
    const db = databaseMock();
    mocks.getDb.mockResolvedValue(db);
    await scoreAndCacheStatus(
      106,
      false,
      [{ role: "user", content: "Can we book Tuesday?" }],
      1,
      null,
      null
    );
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
    expect(mocks.invokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining(
              "Classify this conversation into exactly one status key."
            ),
          }),
        ]),
      })
    );
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ csStatusTier: "scheduling", csStatusMsgLen: 1 })
    );
  });
});
