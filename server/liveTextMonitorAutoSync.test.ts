import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  AuditCandidate,
  AuditMessage,
  AuditRecord,
} from "../shared/dailyActionAudit";
import type {
  LiveTextCheck,
  LiveTextContext,
  LiveTextSyncInput,
  LiveTextSyncResult,
} from "../shared/liveTextMonitor";
// All external boundaries are offline; the actual checker/verifier and manual wrapper run.
vi.mock("./liveTextMonitorData", () => ({
  readLiveTextContext: vi.fn(),
  readLiveTextFeed: vi.fn(),
}));
vi.mock("./dailyActionAuditData", () => ({
  readLeadFlowAuditRecords: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./liveTextMonitorSyncSource", () => ({
  readLiveTextSyncSource: vi.fn(),
}));
vi.mock("./liveTextMonitorSyncRepository", () => ({
  persistLiveTextSyncDate: vi.fn(),
}));
import {
  checkLiveText,
  createLiveTextInterpretCache,
  type LiveTextMonitorDependencies,
} from "./liveTextMonitorService";
import { LIVE_TEXT_PRE_SOURCE_STALE_CAUSE, syncAndCheckLiveText } from "./liveTextMonitorSync";
import {
  checkAndSyncLiveText,
  createLiveTextAutoSyncCache,
} from "./liveTextMonitorAutoSync";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";

const DATE = "2026-11-16";
const AT = "2026-11-13T18:00:00.000Z";
const key = (label: string) =>
  `session-text:${createHash("sha256").update(label).digest("hex")}`;
const input = (id = 7) => ({ sessionId: id, messageKey: key(`row:${id}`) });
function row(id = 7): LiveTextContext {
  const message: AuditMessage = {
    key: input(id).messageKey,
    sessionId: id,
    customerPhone: `+1301555${String(id).padStart(4, "0")}`,
    businessPhone: "+13015550456",
    direction: "inbound",
    text: `Please move LF-${id} to November 16, 2026 at 9am.`,
    occurredAt: "2026-11-12T15:00:00.000Z",
    observedAt: null,
    timeBasis: "history",
    delivery: "received",
    source: "conversation_history",
  };
  return {
    row: {
      key: message.key,
      sessionId: id,
      revision: `revision:${id}`,
      customerName: `Fixture ${id}`,
      message,
      identityAmbiguous: false,
    },
    messages: [message],
    partial: false,
  };
}
function record(
  id = 7,
  date = DATE,
  overrides: Partial<AuditRecord> = {}
): AuditRecord {
  return {
    key: `job:${id}`,
    source: "leadflow_jobs",
    bookingId: id,
    jobId: id,
    publicBookingNumber: `LF-${id}`,
    seriesId: null,
    customerPhone: row(id).row.message.customerPhone,
    customerName: `Fixture ${id}`,
    date,
    time: "09:00",
    timeZone: "America/New_York",
    status: "confirmed",
    address: null,
    serviceName: null,
    extras: [],
    teamName: null,
    recurrence: "one-time",
    paymentStatus: null,
    paidAmountCents: null,
    ...overrides,
  };
}
function candidate(
  context: LiveTextContext,
  threadKey: string,
  date: string | null = DATE,
  overrides: Partial<AuditCandidate> = {}
): AuditCandidate {
  return {
    id: `action:${context.row.sessionId}:${date}`,
    threadKey,
    action: "reschedule",
    agreement: "requested",
    anchorMessageKey: context.row.key,
    evidenceKeys: [context.row.key],
    explanation: "Synthetic explicit service date",
    confidence: 0.95,
    supersededByMessageKey: null,
    ambiguous: false,
    expected: {
      bookingReference: `LF-${context.row.sessionId}`,
      date,
      originalDate: null,
      time: "09:00",
      timeKind: "exact",
      windowEnd: null,
      scope: "visit",
      address: null,
      serviceName: null,
      extras: null,
      teamName: null,
      amountCents: null,
    },
    ...overrides,
  };
}
function harness(ids = [7]) {
  let clock = new Date(AT).getTime();
  const contexts = new Map(ids.map(id => [id, row(id)]));
  const records = new Map(ids.map(id => [id, [record(id)]]));
  const dates = new Map(ids.map(id => [id, [DATE] as Array<string | null>]));
  const overrides = new Map<number, Partial<AuditCandidate>>();
  const now = () => new Date(clock);
  const context = vi.fn(
    async (sessionId: number) => contexts.get(sessionId) ?? null
  );
  const read = vi.fn(async ({ threads }: any) => ({
    records: Array.from(records.values())
      .flat()
      .filter(r => r.customerPhone === threads[0].customerPhone),
    warnings: [],
    truncated: false,
    incompleteThreadKeys: [],
  }));
  const interpret = vi.fn(async (request: any) => {
    const thread = request.threads[0];
    const ctx = contexts.get(thread.messages[0].sessionId)!;
    return {
      candidates: (dates.get(ctx.row.sessionId) ?? []).map(date =>
        candidate(ctx, thread.key, date, overrides.get(ctx.row.sessionId))
      ),
      warnings: [],
      threadsAnalyzed: 1,
    };
  });
  const monitor: Partial<LiveTextMonitorDependencies> = {
    context,
    records: read,
    interpret,
    model: vi.fn(),
    verify: verifyAuditCandidates,
    now,
    cache: createLiveTextInterpretCache(),
  };
  const check = vi.fn((value: ReturnType<typeof input>) =>
    checkLiveText(value, monitor)
  );
  const source = vi.fn(async (date: string) => ({
    date,
    fetched: ids.length,
    bookings: ids.map(id => ({ id })) as any[],
  }));
  const persist = vi.fn(async () => ({
    complete: true,
    created: 0,
    updated: ids.length,
    protectedRecords: 0,
    refreshedJobIds: [...ids],
  }));
  const sync = vi.fn((value: LiveTextSyncInput) =>
    syncAndCheckLiveText(value, {
      check,
      context,
      source,
      persist,
      now,
      locks: new Set(),
    })
  );
  const deps = { check, sync, now, cache: createLiveTextAutoSyncCache() };
  return {
    deps,
    contexts,
    records,
    dates,
    overrides,
    check,
    source,
    persist,
    context,
    read,
    interpret,
    monitor,
    sync,
    advance: (ms: number) => {
      clock += ms;
    },
    setClock: (value: string) => {
      clock = new Date(value).getTime();
    },
  };
}
function fixture(id = 7, date = DATE): LiveTextCheck {
  return {
    rowKey: input(id).messageKey,
    revision: `revision:${id}`,
    required: "yes",
    verified: "yes",
    summary: "Synthetic request",
    evidence: "Synthetic evidence",
    actions: [
      {
        id: `action:${id}:${date}`,
        type: "reschedule",
        syncServiceDate: date,
        summary: "Synthetic request",
        verified: "yes",
        evidence: "Synthetic evidence",
        records: [record(id, date)],
        links: [],
      },
    ],
    conversation: [row(id).row.message],
    checkedAt: AT,
  };
}
function fakeSync(value: LiveTextSyncInput): LiveTextSyncResult {
  return {
    sync: {
      date: value.serviceDate,
      complete: true,
      fetched: 1,
      updated: 1,
      created: 0,
      protectedRecords: 0,
      checkedAt: AT,
    },
    refreshedJobIds: [value.sessionId],
    check: fixture(value.sessionId, value.serviceDate),
  };
}

describe("Foreground automatic future date sync using actual read-only checks", () => {
  it("runs initial check, complete source/commit, and an independent final row check", async () => {
    const h = harness();
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(result.verified).toBe("yes");
    expect(result.syncs).toMatchObject([
      { date: DATE, complete: true, updated: 1 },
    ]);
    expect(h.source).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(h.check).toHaveBeenCalledTimes(4);
    expect(h.read).toHaveBeenCalledTimes(4);
    expect(h.interpret).toHaveBeenCalledTimes(1);
    expect(h.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        ...input(),
        revision: "revision:7",
        serviceDate: DATE,
      })
    );
  });
  it("coalesces concurrent rows and later cache hits, but reads each customer's current records separately", async () => {
    const h = harness([7, 8]);
    let finish!: (value: any) => void;
    h.source.mockImplementation(
      () =>
        new Promise(done => {
          finish = done;
        })
    );
    const first = checkAndSyncLiveText(input(7), h.deps);
    const second = checkAndSyncLiveText(input(8), h.deps);
    await vi.waitFor(() => expect(h.source).toHaveBeenCalledTimes(1));
    h.records.get(8)![0].time = "11:00";
    finish({ date: DATE, fetched: 2, bookings: [{ id: 7 }, { id: 8 }] });
    const [a, b] = await Promise.all([first, second]);
    expect(a.verified).toBe("yes");
    expect(b.verified).toBe("no");
    expect(b.rowKey).toBe(input(8).messageKey);
    expect(b.conversation).toEqual([row(8).row.message]);
    expect(JSON.stringify(b)).not.toContain(row(7).row.message.customerPhone);
    expect(b.actions[0].records[0].time).toBe("11:00");
    expect(h.check).toHaveBeenCalledTimes(6);
    expect(h.read).toHaveBeenCalledTimes(6);
    const third = await checkAndSyncLiveText(input(8), h.deps);
    expect(third.verified).toBe("no");
    expect(h.source).toHaveBeenCalledTimes(1);
    expect(h.check).toHaveBeenCalledTimes(8);
    const cacheEntry = await h.deps.cache.get(DATE)!.promise;
    expect(Object.keys(cacheEntry).sort()).toEqual(["refreshedJobIds", "sync"]);
    expect(JSON.stringify(cacheEntry)).not.toMatch(
      /Fixture|revision|customerPhone|conversation|action:/
    );
  });
  it("returns fresh 11 AM No instead of the initial 9 AM Yes", async () => {
    const h = harness();
    h.persist.mockImplementation(async () => {
      h.records.get(7)![0].time = "11:00";
      return {
        complete: true,
        created: 0,
        updated: 1,
        protectedRecords: 0,
        refreshedJobIds: [7],
      };
    });
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(result.verified).toBe("no");
    expect(result.actions[0].records[0].time).toBe("11:00");
  });
  it.each(["2026-11-12", "2026-11-13", null, "tomorrow", "2026-02-30"])(
    "does not sync past/today/unresolved/invalid target %s",
    async date => {
      const h = harness();
      h.dates.set(7, [date]);
      const result = await checkAndSyncLiveText(input(), h.deps);
      expect(h.source).not.toHaveBeenCalled();
      expect(h.persist).not.toHaveBeenCalled();
      expect(h.check).toHaveBeenCalledTimes(1);
      expect(result.syncs).toBeUndefined();
    }
  );
  it.each([
    ["2026-11-14T04:59:59.000Z", true],
    ["2026-11-14T05:00:00.000Z", false],
    ["2026-07-14T03:59:59.000Z", true],
    ["2026-07-14T04:00:00.000Z", false],
  ] as const)(
    "uses Eastern midnight rather than UTC at %s",
    async (at, shouldSync) => {
      const h = harness();
      const date = at.slice(0, 10);
      h.setClock(at);
      h.dates.set(7, [date]);
      h.records.get(7)![0].date = date;
      await checkAndSyncLiveText(input(), h.deps);
      expect(h.source).toHaveBeenCalledTimes(shouldSync ? 1 : 0);
    }
  );
  it.each([
    { ambiguous: true },
    { confidence: 0.79 },
    { agreement: "declined" as const },
    { agreement: "unclear" as const },
  ])(
    "leaves confidence/declined/ambiguous targets plain read-only %j",
    async override => {
      const h = harness();
      h.overrides.set(7, override);
      const result = await checkAndSyncLiveText(input(), h.deps);
      expect(result.actions[0].syncServiceDate).toBeNull();
      expect(h.source).not.toHaveBeenCalled();
      expect(h.check).toHaveBeenCalledTimes(1);
    }
  );
  it("ignores a literal future date in an irrelevant historical summary and keeps No action required unchanged", async () => {
    const h = harness();
    h.dates.set(7, []);
    h.contexts.get(7)!.row.message.text =
      "Thanks! November 16, 2026 was mentioned in context.";
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(result).toMatchObject({
      required: "no",
      verified: "not_applicable",
      actions: [],
    });
    expect(h.source).not.toHaveBeenCalled();
    expect(h.check).toHaveBeenCalledTimes(1);
    const checked = fixture();
    checked.actions[0].syncServiceDate = null;
    checked.summary = "Irrelevant future date 2026-11-16";
    const plain = vi.fn(async () => checked);
    const sync = vi.fn(async value => fakeSync(value));
    expect(
      await checkAndSyncLiveText(input(), { ...h.deps, check: plain, sync })
    ).toBe(checked);
    expect(sync).not.toHaveBeenCalled();
  });
  it.each([{ refreshedJobIds: [] }, { refreshedJobIds: [99] }])(
    "cannot certify untouched imported 9 AM Yes with receipt %j",
    async ({ refreshedJobIds }) => {
      const h = harness();
      h.persist.mockResolvedValue({
        complete: true,
        created: 0,
        updated: 0,
        protectedRecords: 0,
        refreshedJobIds,
      });
      const result = await checkAndSyncLiveText(input(), h.deps);
      expect(result.verified).toBe("review");
      expect(result.actions[0].records).toEqual([]);
      expect(result.syncs![0].failure).toBe("SOURCE_INCOMPLETE");
    }
  );
  it("a cached receipt for another job cannot certify a second customer's imported job", async () => {
    const h = harness([7, 8]);
    h.persist.mockResolvedValue({
      complete: true,
      created: 0,
      updated: 1,
      protectedRecords: 0,
      refreshedJobIds: [7],
    });
    expect((await checkAndSyncLiveText(input(7), h.deps)).verified).toBe("yes");
    const result = await checkAndSyncLiveText(input(8), h.deps);
    expect(result.verified).toBe("review");
    expect(result.actions[0].records).toEqual([]);
    expect(h.source).toHaveBeenCalledTimes(1);
  });
  it("permits an authoritative fresh canonical booking without an imported-job receipt", async () => {
    const h = harness();
    h.overrides.set(7, {
      action: "address",
      expected: {
        ...candidate(row(), "thread").expected,
        time: null,
        timeKind: "unspecified",
        address: "Fixture address",
      },
    });
    h.records.set(7, [
      record(7, DATE, {
        key: "booking:7",
        source: "bookings",
        jobId: null,
        address: "Fixture address",
      }),
    ]);
    h.persist.mockResolvedValue({
      complete: true,
      created: 0,
      updated: 0,
      protectedRecords: 0,
      refreshedJobIds: [],
    });
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(result.verified).toBe("yes");
    expect(result.syncs![0].complete).toBe(true);
    expect(result.actions[0].records[0].source).toBe("bookings");
  });
  it("successful empty source and missing target records remain Review", async () => {
    const h = harness();
    h.records.set(7, []);
    h.source.mockResolvedValue({ date: DATE, fetched: 0, bookings: [] });
    h.persist.mockResolvedValue({
      complete: true,
      created: 0,
      updated: 0,
      protectedRecords: 0,
      refreshedJobIds: [],
    });
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(result.verified).toBe("review");
    expect(result.syncs![0].failure).toBe("SOURCE_INCOMPLETE");
  });
  it.each(["SOURCE_UNAVAILABLE"])(
    "coalesces fixed %s failures for 60 seconds with no retry timer",
    async code => {
      const h = harness([7, 8]);
      h.source.mockRejectedValue(
        Object.assign(new Error("PRIVATE SQL TOKEN customer payload"), { code })
      );
      const a = await checkAndSyncLiveText(input(7), h.deps);
      const b = await checkAndSyncLiveText(input(8), h.deps);
      expect(a.verified).toBe("review");
      expect(b.verified).toBe("review");
      expect(b.syncs![0].failure).toBe(code);
      expect(h.source).toHaveBeenCalledTimes(1);
      expect(h.persist).not.toHaveBeenCalled();
      expect(JSON.stringify([a, b])).not.toMatch(/PRIVATE|TOKEN|payload/);
      h.advance(59_999);
      await checkAndSyncLiveText(input(8), h.deps);
      expect(h.source).toHaveBeenCalledTimes(1);
      h.advance(1);
      await checkAndSyncLiveText(input(8), h.deps);
      expect(h.source).toHaveBeenCalledTimes(2);
    }
  );
  it("evicts pre-source R1 to R2 stale revision so another customer's same-date action reaches source", async () => {
    const h = harness([7, 8]);
    let ownerContextCalls = 0;
    h.context.mockImplementation(async id => {
      if (id === 7 && ++ownerContextCalls === 2)
        h.contexts.get(7)!.row.revision = "revision:7:R2";
      return h.contexts.get(id) ?? null;
    });
    const a = await checkAndSyncLiveText(input(7), h.deps);
    expect((await h.check.mock.results[0].value).revision).toBe("revision:7");
    expect((await h.check.mock.results[1].value).revision).toBe("revision:7:R2");
    await expect(h.sync.mock.results[0].value).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The stored text changed. Check it again before syncing.",
    });
    expect((await h.sync.mock.results[0].value.catch(error => error)).cause).toBe(
      LIVE_TEXT_PRE_SOURCE_STALE_CAUSE
    );
    expect(a.verified).toBe("review");
    expect(a.syncs![0].failure).toBe("STALE_TEXT");
    expect(a.actions[0].records).toEqual([]);
    expect(h.source).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.deps.cache.size).toBe(0);
    const b = await checkAndSyncLiveText(input(8), h.deps);
    expect(b.verified).toBe("yes");
    expect(b.syncs![0].complete).toBe(true);
    expect(b.conversation).toEqual([row(8).row.message]);
    expect(JSON.stringify([a, b])).not.toContain("LIVE_TEXT_PRE_SOURCE_STALE");
    expect(JSON.stringify(b)).not.toContain(row(7).row.message.customerPhone);
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.source).toHaveBeenCalledTimes(1);
    expect(h.source).toHaveBeenCalledWith(DATE);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await h.deps.cache.get(DATE)!.promise)).not.toMatch(
      /Fixture|conversation|customerPhone|revision/
    );
  });
  it("retains actual lock-contention CONFLICT as a safe date failure for 60 seconds", async () => {
    const h = harness([7, 8]);
    const locks = new Set([DATE]);
    h.sync.mockImplementation(value =>
      syncAndCheckLiveText(value, {
        check: h.check,
        context: h.context,
        source: h.source,
        persist: h.persist,
        now: h.deps.now,
        locks,
      })
    );
    const a = await checkAndSyncLiveText(input(7), h.deps);
    await expect(h.sync.mock.results[0].value).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A date sync is already running. Try again after it finishes.",
    });
    expect((await h.sync.mock.results[0].value.catch(error => error)).cause).not.toBe(
      LIVE_TEXT_PRE_SOURCE_STALE_CAUSE
    );
    expect(a.verified).toBe("review");
    expect(a.syncs![0].failure).toBe("SYNC_UNAVAILABLE");
    expect(h.source).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.deps.cache.size).toBe(1);
    expect(await h.deps.cache.get(DATE)!.promise).toMatchObject({
      sync: { complete: false, failure: "SYNC_UNAVAILABLE" },
      refreshedJobIds: [],
    });
    locks.delete(DATE);
    const b = await checkAndSyncLiveText(input(8), h.deps);
    expect(b.verified).toBe("review");
    expect(b.syncs![0].failure).toBe("SYNC_UNAVAILABLE");
    expect(b.actions[0].records).toEqual([]);
    h.advance(59_999);
    await checkAndSyncLiveText(input(8), h.deps);
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.source).not.toHaveBeenCalled();
    h.advance(1);
    expect((await checkAndSyncLiveText(input(8), h.deps)).verified).toBe("yes");
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.source).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
  });
  it("a stale first owner does not poison a different customer's same-date refresh", async () => {
    const h = harness([7, 8]);
    let contextCalls = 0;
    h.context.mockImplementation(async id => {
      contextCalls++;
      return contextCalls === 3 ? null : (h.contexts.get(id) ?? null);
    });
    const a = await checkAndSyncLiveText(input(7), h.deps);
    expect(a.syncs![0].failure).toBe("STALE_TEXT");
    expect(h.deps.cache.size).toBe(0);
    const b = await checkAndSyncLiveText(input(8), h.deps);
    expect(b.verified).toBe("yes");
    expect(b.syncs![0].complete).toBe(true);
    expect(b.conversation).toEqual([row(8).row.message]);
    expect(JSON.stringify(b)).not.toContain(row(7).row.message.customerPhone);
    expect(h.source).toHaveBeenCalledTimes(2);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await h.deps.cache.get(DATE)!.promise)).not.toMatch(
      /Fixture|conversation|customerPhone|revision/
    );
  });
  it("a first owner's absent imported job receipt does not prevent another customer's valid fresh proof", async () => {
    const h = harness([7, 8]);
    h.persist.mockResolvedValue({
      complete: true,
      created: 0,
      updated: 1,
      protectedRecords: 0,
      refreshedJobIds: [8],
    });
    const a = await checkAndSyncLiveText(input(7), h.deps);
    expect(a.verified).toBe("review");
    expect(a.syncs![0].failure).toBe("SOURCE_INCOMPLETE");
    expect(h.deps.cache.size).toBe(0);
    const b = await checkAndSyncLiveText(input(8), h.deps);
    expect(b.verified).toBe("yes");
    expect(b.actions[0].records[0].jobId).toBe(8);
    expect(h.source).toHaveBeenCalledTimes(2);
  });
  it("incomplete source errors with no committed receipt are not retained as global date failures", async () => {
    const h = harness([7, 8]);
    h.source.mockRejectedValueOnce(
      Object.assign(new Error("PRIVATE"), { code: "SOURCE_INCOMPLETE" })
    );
    expect((await checkAndSyncLiveText(input(7), h.deps)).verified).toBe(
      "review"
    );
    expect(h.deps.cache.size).toBe(0);
    expect((await checkAndSyncLiveText(input(8), h.deps)).verified).toBe("yes");
    expect(h.source).toHaveBeenCalledTimes(2);
  });
  it("protected and uncommitted database failures become fixed target-only Review", async () => {
    for (const mode of ["protected", "commit"] as const) {
      const h = harness();
      if (mode === "protected")
        h.persist.mockResolvedValue({
          complete: false,
          created: 0,
          updated: 0,
          protectedRecords: 1,
          refreshedJobIds: [],
        });
      else h.persist.mockRejectedValue(new Error("SECRET SQL connection"));
      const result = await checkAndSyncLiveText(input(), h.deps);
      expect(result.verified).toBe("review");
      expect(result.actions[0].records).toEqual([]);
      expect(result.syncs![0].failure).toBe(
        mode === "protected" ? "PROTECTED_RECORDS" : "SYNC_UNAVAILABLE"
      );
      expect(JSON.stringify(result)).not.toMatch(/SECRET|connection/);
    }
  });
});

describe("Automatic wrapper bounded calls, drift and strict receipt identity", () => {
  it("syncs every unambiguous future date before the final check, failing only target actions", async () => {
    const h = harness();
    const date2 = "2026-11-17";
    h.dates.set(7, [DATE, date2]);
    h.records.get(7)!.push(record(7, date2, { key: "job:70", jobId: 70 }));
    h.persist.mockResolvedValue({
      complete: true,
      created: 0,
      updated: 2,
      protectedRecords: 0,
      refreshedJobIds: [7, 70],
    });
    h.source.mockImplementation(async date => {
      if (date === date2)
        throw Object.assign(new Error("PRIVATE"), {
          code: "SOURCE_UNAVAILABLE",
        });
      return { date, fetched: 1, bookings: [{ id: 7 }] as any[] };
    });
    const result = await checkAndSyncLiveText(input(), h.deps);
    expect(h.source.mock.calls.map(call => call[0])).toEqual([DATE, date2]);
    expect(result.verified).toBe("review");
    expect(result.actions.map(a => a.verified)).toEqual(["yes", "review"]);
    expect(result.actions[0].records).not.toEqual([]);
    expect(result.actions[1].records).toEqual([]);
    expect(result.syncs).toMatchObject([
      { date: DATE, complete: true },
      { date: date2, complete: false, failure: "SOURCE_UNAVAILABLE" },
    ]);
    expect(h.check).toHaveBeenCalledTimes(5);
  });
  it("distinct dates have distinct failure receipts and never borrow another date's successful proof", async () => {
    const cache = createLiveTextAutoSyncCache();
    let date = DATE;
    const check = vi.fn(async () => fixture(7, date));
    const sync = vi.fn(async (value: LiveTextSyncInput) => {
      if (value.serviceDate === "2026-11-17")
        throw Object.assign(new Error("PRIVATE"), {
          code: "SOURCE_UNAVAILABLE",
        });
      return fakeSync(value);
    });
    const deps = { check, sync, cache, now: () => new Date(AT) };
    expect((await checkAndSyncLiveText(input(), deps)).verified).toBe("yes");
    date = "2026-11-17";
    expect((await checkAndSyncLiveText(input(), deps)).verified).toBe("review");
    expect((await checkAndSyncLiveText(input(), deps)).verified).toBe("review");
    date = DATE;
    expect((await checkAndSyncLiveText(input(), deps)).verified).toBe("yes");
    expect(sync).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });
  it("deduplicates multiple actions on the same date and does not disturb past-date actions", async () => {
    const initial = fixture();
    initial.actions.push(
      { ...initial.actions[0], id: "second" },
      {
        ...initial.actions[0],
        id: "past",
        syncServiceDate: "2026-11-12",
        verified: "no",
      }
    );
    const check = vi.fn(async () => structuredClone(initial));
    const sync = vi.fn(async value => fakeSync(value));
    const result = await checkAndSyncLiveText(input(), {
      check,
      sync,
      cache: createLiveTextAutoSyncCache(),
      now: () => new Date(AT),
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(result.actions.map(a => a.verified)).toEqual(["yes", "yes", "no"]);
  });
  it("limits source dates to four per check and marks unattempted target actions Review", async () => {
    const initial = fixture();
    initial.actions = Array.from(
      { length: 6 },
      (_, i) => fixture(7, `2026-11-${16 + i}`).actions[0]
    );
    const check = vi.fn(async () => structuredClone(initial));
    const sync = vi.fn(async value => fakeSync(value));
    const result = await checkAndSyncLiveText(input(), {
      check,
      sync,
      cache: createLiveTextAutoSyncCache(),
      now: () => new Date(AT),
    });
    expect(sync).toHaveBeenCalledTimes(4);
    expect(result.actions.map(a => a.verified)).toEqual([
      "yes",
      "yes",
      "yes",
      "yes",
      "review",
      "review",
    ]);
  });
  it("honors the 45s cooperative budget between calls without racing in-flight writes", async () => {
    const h = harness();
    const checked = fixture();
    checked.actions.push(fixture(7, "2026-11-17").actions[0]);
    const check = vi.fn(async () => checked);
    const sync = vi.fn(async value => {
      h.advance(45_000);
      return fakeSync(value);
    });
    const result = await checkAndSyncLiveText(input(), {
      ...h.deps,
      check,
      sync,
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.verified).toBe("review");
    expect(result.actions.every(a => a.records.length === 0)).toBe(true);
  });
  it("does not start sync after the initial check has consumed the cooperative budget", async () => {
    const h = harness();
    const check = vi.fn(async () => {
      h.advance(45_000);
      return fixture();
    });
    const sync = vi.fn(async value => fakeSync(value));
    const result = await checkAndSyncLiveText(input(), {
      ...h.deps,
      check,
      sync,
    });
    expect(sync).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.verified).toBe("review");
  });
  it("checks expiry again after a slow initial read, never accepting an over-TTL settled receipt", async () => {
    const h = harness();
    const check = vi.fn(async () => fixture());
    const sync = vi.fn(async value => fakeSync(value));
    const deps = { ...h.deps, check, sync };
    await checkAndSyncLiveText(input(), deps);
    h.advance(59_000);
    check.mockImplementationOnce(async () => {
      h.advance(2_000);
      return fixture();
    });
    await checkAndSyncLiveText(input(), deps);
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it.each(["revision", "missing", "duplicate", "date", "null", "new-target"])(
    "fresh %s drift is Review and never starts another automatic loop",
    async mode => {
      const initial = fixture();
      const fresh = fixture();
      if (mode === "revision") fresh.revision = "revision:changed";
      if (mode === "missing") fresh.actions = [];
      if (mode === "duplicate") fresh.actions.push({ ...fresh.actions[0] });
      if (mode === "date") fresh.actions[0].syncServiceDate = "2026-11-17";
      if (mode === "null") fresh.actions[0].syncServiceDate = null;
      if (mode === "new-target")
        fresh.actions.push(fixture(7, "2026-11-17").actions[0]);
      const check = vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(fresh);
      const sync = vi.fn(async value => fakeSync(value));
      const result = await checkAndSyncLiveText(input(), {
        check,
        sync,
        cache: createLiveTextAutoSyncCache(),
        now: () => new Date(AT),
      });
      expect(result.verified).toBe("review");
      expect(sync).toHaveBeenCalledTimes(1);
      expect(result.actions.some(a => a.verified === "review")).toBe(true);
    }
  );
  it.each(["wrong-date", "unknown-source", "null-id", "string-id"])(
    "rejects uncertified fresh imported identity %s",
    async mode => {
      const initial = fixture();
      const fresh = fixture();
      const job = fresh.actions[0].records[0];
      if (mode === "wrong-date") job.date = "2026-11-17";
      if (mode === "unknown-source") (job as any).source = "unknown";
      if (mode === "null-id") job.jobId = null;
      if (mode === "string-id") (job as any).jobId = "7";
      const check = vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(fresh);
      const result = await checkAndSyncLiveText(input(), {
        check,
        sync: async value => fakeSync(value),
        cache: createLiveTextAutoSyncCache(),
        now: () => new Date(AT),
      });
      expect(result.verified).toBe("review");
      expect(result.actions[0].records).toEqual([]);
      expect(result.syncs![0].failure).toBe("SOURCE_INCOMPLETE");
    }
  );
  it("fresh read failures cannot restore an old Yes or leak SQL", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(fixture())
      .mockRejectedValueOnce(new Error("SECRET SQL"));
    const result = await checkAndSyncLiveText(input(), {
      check,
      sync: async value => fakeSync(value),
      cache: createLiveTextAutoSyncCache(),
      now: () => new Date(AT),
    });
    expect(result.verified).toBe("review");
    expect(result.actions[0].records).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("bounds settled cache to 100 and removes expired entries on the next invocation", async () => {
    let clock = new Date(AT).getTime();
    const cache = createLiveTextAutoSyncCache();
    let date = DATE;
    const check = vi.fn(async () => fixture(7, date));
    const sync = vi.fn(async value => fakeSync(value));
    const deps = { check, sync, cache, now: () => new Date(clock) };
    for (let i = 0; i < 105; i++) {
      date = new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10);
      await checkAndSyncLiveText(input(), deps);
    }
    expect(cache.size).toBe(100);
    clock += 60_000;
    date = DATE;
    await checkAndSyncLiveText(input(), deps);
    expect(cache.size).toBe(1);
  });
  it("pending entries are neither TTL-restarted nor evicted under capacity pressure", async () => {
    let clock = new Date(AT).getTime();
    const cache = createLiveTextAutoSyncCache();
    let date = DATE;
    const check = vi.fn(async () => fixture(7, date));
    let finish!: (value: LiveTextSyncResult) => void;
    const sync = vi.fn(
      (value: LiveTextSyncInput) =>
        new Promise<LiveTextSyncResult>(done => {
          finish = done;
        })
    );
    const deps = { check, sync, cache, now: () => new Date(clock) };
    const first = checkAndSyncLiveText(input(), deps);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    clock += 61_000;
    const second = checkAndSyncLiveText(input(), deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    finish(
      fakeSync({
        ...input(),
        revision: "revision:7",
        actionId: "action",
        serviceDate: DATE,
      })
    );
    await Promise.all([first, second]);
    expect(cache.size).toBe(1);
  });
  it("refuses a new date when all 100 receipt entries are pending instead of evicting live work", async () => {
    const cache = createLiveTextAutoSyncCache();
    const sync = vi.fn(async value => fakeSync(value));
    for (let i = 0; i < 100; i++)
      cache.set(`pending:${i}`, { sync, promise: new Promise(() => {}) });
    const result = await checkAndSyncLiveText(input(), {
      check: async () => fixture(),
      sync,
      cache,
      now: () => new Date(AT),
    });
    expect(result.verified).toBe("review");
    expect(sync).not.toHaveBeenCalled();
    expect(cache.size).toBe(100);
    expect(result.syncs![0].failure).toBe("SYNC_UNAVAILABLE");
  });
  it("retains actual commit failures for 60 seconds without another source attempt", async () => {
    const h = harness([7, 8]);
    h.persist.mockRejectedValue(new Error("PRIVATE SQL"));
    const a = await checkAndSyncLiveText(input(7), h.deps);
    const b = await checkAndSyncLiveText(input(8), h.deps);
    expect(a.verified).toBe("review");
    expect(b.verified).toBe("review");
    expect(b.syncs![0].failure).toBe("SYNC_UNAVAILABLE");
    expect(h.source).toHaveBeenCalledTimes(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
  });
  it("injects/reset caches without reusing another dependency's receipt", async () => {
    const check = vi.fn(async () => fixture());
    const a = vi.fn(async value => fakeSync(value));
    const b = vi.fn(async value => fakeSync(value));
    const deps = {
      check,
      sync: a,
      cache: createLiveTextAutoSyncCache(),
      now: () => new Date(AT),
    };
    await checkAndSyncLiveText(input(), deps);
    await checkAndSyncLiveText(input(), { ...deps, sync: b });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await checkAndSyncLiveText(input(), {
      ...deps,
      cache: createLiveTextAutoSyncCache(),
    });
    expect(a).toHaveBeenCalledTimes(2);
  });
  it("sanitizes arbitrary sync errors and malformed summaries to fixed shared failure codes", async () => {
    const check = vi.fn(async () => fixture());
    const now = () => new Date(AT);
    for (const sync of [
      async () => {
        throw Object.assign(new Error("PRIVATE SQL"), { code: "SECRET" });
      },
      async () =>
        ({
          ...fakeSync({
            ...input(),
            revision: "r",
            actionId: "a",
            serviceDate: DATE,
          }),
          sync: { date: "WRONG", fetched: "PRIVATE" },
        }) as any,
    ]) {
      const result = await checkAndSyncLiveText(input(), {
        check,
        sync,
        now,
        cache: createLiveTextAutoSyncCache(),
      });
      expect(result.verified).toBe("review");
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|WRONG/);
    }
  });
  it("rejects untrusted input before check and fixes initial read failure messages", async () => {
    const check = vi.fn(async () => fixture());
    for (const value of [
      null,
      { ...input(), serviceDate: DATE },
      { ...input(), sessionId: 0 },
      { ...input(), messageKey: "invalid" },
    ]) {
      await expect(
        checkAndSyncLiveText(value as any, { check })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(check).not.toHaveBeenCalled();
    check.mockRejectedValueOnce(new Error("PRIVATE SQL"));
    await expect(
      checkAndSyncLiveText(input(), { check })
    ).rejects.toMatchObject({ message: "Captured text could not be checked." });
  });
  it("contains no timers, unrelated data reads, messages, direct database writes or side-effect races", () => {
    const source = readFileSync(
      new URL("./liveTextMonitorAutoSync.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /setTimeout|setInterval|Promise\.race|sendSms|notifyOwner|invokeLLM|\.insert\(|\.update\(|readLeadFlowAuditDay|collectAuditDaySms/
    );
    expect(source).not.toMatch(
      new RegExp(
        ["cleaner", "Jobs"].join("") + "|" + ["cleaner", "jobs"].join("_")
      )
    );
  });
});
