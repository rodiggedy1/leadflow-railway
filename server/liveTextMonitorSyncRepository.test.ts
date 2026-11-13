import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import type { DatabaseSync as SQLiteDatabase } from "node:sqlite";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { Pool } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leadflowJobs } from "../drizzle/schema";
import type { Launch27Booking } from "./launch27";
import { persistLiveTextSyncDate } from "./liveTextMonitorSyncRepository";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => dbMock);
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const openDatabases: SQLiteDatabase[] = [];
const DATE = "2026-11-13";
type Row = Record<string, unknown>;
type Values = Array<string | number | null>;
type Trace = { sql: string; values: Values; inTransaction: boolean };

beforeEach(() => {
  dbMock.getDb
    .mockReset()
    .mockRejectedValue(new Error("Live DB access forbidden in offline tests"));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Provider/network access forbidden in offline tests");
    })
  );
});
afterEach(() => {
  openDatabases.splice(0).forEach(db => db.close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function booking(
  id = 701,
  overrides: Partial<Launch27Booking> = {}
): Launch27Booking {
  return {
    id,
    phone: "+12025550123",
    firstName: "Source",
    lastName: "Owner",
    fullName: "Source Owner",
    email: "source@example.test",
    serviceDate: `${DATE}T14:00:00Z`,
    frequency: "Monthly",
    address: "Actual source address",
    city: "Washington",
    state: "DC",
    zip: "20001",
    totalRevenue: 239.45,
    baseRevenue: 200,
    bookingStatus: "assigned",
    completed: false,
    teams: [{ id: 12, title: "Source team", share: 55, bgColor: "#888" }],
    serviceNames: ["2 bedrooms"],
    bedrooms: 2,
    bathrooms: 1,
    extras: ["clean_inside_oven"],
    customerNotes: "Source notes",
    staffNotes: "Staff source notes",
    requestedTeam: null,
    hasStripeCard: true,
    stripeCustomerId: "cus_fixture",
    paymentBrand: "visa",
    paymentLast4: "4242",
    chargesOnHoldCents: 100,
    chargesOutstandingCents: 500,
    ...overrides,
  };
}

/**
 * OFFLINE ONLY: real drizzle(mysql2) SQL/parameters/result mapping and its actual
 * owned public lease transport run against an in-memory SQLite mysql2 driver fake.
 * FOR UPDATE is asserted in the trace, stripped only for SQLite execution. These
 * tests do NOT claim proof of production MySQL/TiDB locking or concurrent isolation.
 */
function fixture(options: { uniqueStableIds?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  openDatabases.push(sqlite);
  const columns = Object.values(getTableColumns(leadflowJobs));
  sqlite.exec(`CREATE TABLE leadflow_jobs (${columns
    .map(column => {
      if (column.name === "id") return "`id` INTEGER PRIMARY KEY AUTOINCREMENT";
      const defaults: Record<string, string> = {
        jobTotalCents: "0",
        hasStripeCard: "0",
        reviewCopied: "0",
        createdAt: "'2026-01-01 00:00:00'",
        updatedAt: "'2026-01-01 00:00:00'",
      };
      return `\`${column.name}\` ${column.getSQLType().includes("int") ? "INTEGER" : "TEXT"}${defaults[column.name] ? ` DEFAULT ${defaults[column.name]}` : ""}`;
    })
    .join(", ")}, payrollLocked INTEGER DEFAULT 0, workflowState TEXT);
  CREATE TABLE bookings (id INTEGER PRIMARY KEY, paymentStatus TEXT, firstCleaningTotalCents INTEGER);
  CREATE TABLE booking_assignments (id INTEGER PRIMARY KEY, bookingId INTEGER, teamId INTEGER);
  CREATE TABLE leadflow_job_payroll_adjustments (id INTEGER PRIMARY KEY, leadflowJobId INTEGER, amountCents INTEGER);
  CREATE TABLE cleaner_portal_job_progress (id INTEGER PRIMARY KEY, leadflowJobId INTEGER, jobStatus TEXT);
  CREATE TABLE leadflow_booking_messages (id INTEGER PRIMARY KEY, leadflowJobId INTEGER, message TEXT);
  INSERT INTO bookings VALUES (201, 'paid', 12345);
  INSERT INTO booking_assignments VALUES (1, 201, 8);
  INSERT INTO leadflow_job_payroll_adjustments VALUES (1, 41, 777);
  INSERT INTO cleaner_portal_job_progress VALUES (1, 41, 'completed');
  INSERT INTO leadflow_booking_messages VALUES (1, 41, 'untouched');
  CREATE UNIQUE INDEX uq_series_date ON leadflow_jobs(bookingSeriesId, jobDate);`);
  if (options.uniqueStableIds !== false)
    sqlite.exec(
      "CREATE UNIQUE INDEX uq_stable ON leadflow_jobs(launch27BookingId)"
    );
  const read = (sql: string, values: Values = []) =>
    sqlite.prepare(sql).all(...values) as Row[];
  const seed = (overrides: Row = {}) => {
    const values: Row = {
      id: 41,
      origin: "launch27_import",
      launch27BookingId: 701,
      bookingSeriesId: 91,
      bookingId: null,
      jobDate: "2026-11-12",
      serviceDateTime: "2026-11-12T14:00:00Z",
      customerName: "Old name",
      customerPhone: "+12025550123",
      customerEmail: "source@example.test",
      jobAddress: "Old address",
      serviceName: "Old service",
      bedrooms: 1,
      bathrooms: 2,
      extras: "[]",
      frequency: "Weekly",
      bookingStatus: "missing_from_launch27",
      teamName: "Old team",
      teamId: 8,
      customerNotes: "Local customer notes",
      jobTotalCents: 12345,
      hasStripeCard: 0,
      paymentBrand: "amex",
      paymentLast4: "1001",
      customerRating: 5,
      reviewChipsSelected: '["great"]',
      reviewFreeText: "Keep review",
      reviewDrafts: '["draft"]',
      reviewDraftPicked: 2,
      reviewDraftText: "Local draft",
      reviewCopied: 1,
      reviewThumbtackOpenedAt: "2026-11-12 18:00:00.000",
      reviewCompletionSmsClaimedAt: "2026-11-12 18:01:00.000",
      reviewCompletionSmsSentAt: "2026-11-12 18:02:00.000",
      missingFromLaunch27At: "2026-11-12 19:00:00.000",
      nextOccurrenceCreatedAt: "2026-11-12 20:00:00.000",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-11-12 20:00:00",
      payrollLocked: 1,
      workflowState: "completed",
      ...overrides,
    };
    sqlite
      .prepare(
        `INSERT INTO leadflow_jobs (${Object.keys(values)
          .map(key => `\`${key}\``)
          .join(",")}) VALUES (${Object.keys(values)
          .map(() => "?")
          .join(",")})`
      )
      .run(...(Object.values(values) as Values));
  };
  const tables = [
    "leadflow_jobs",
    "bookings",
    "booking_assignments",
    "leadflow_job_payroll_adjustments",
    "cleaner_portal_job_progress",
    "leadflow_booking_messages",
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map(table => [table, read(`SELECT * FROM ${table} ORDER BY id`)])
    );
  const trace: Trace[] = [];
  let inTransaction = false;
  let hook: ((call: Trace) => void) | undefined;
  let selectOverride: Row[] | undefined;
  let headerOverride: Row | undefined;
  const query = vi.fn(
    async (
      raw: string | { sql: string; rowsAsArray?: boolean; values?: unknown[]; timeout?: number },
      rawValues: unknown[] = []
    ) => {
      const sql = (typeof raw === "string" ? raw : raw.sql)
        .replace(/\s+/g, " ")
        .trim();
      if (typeof raw !== "string") {
        expect(raw.timeout).toBeGreaterThan(0);
        expect(raw.timeout).toBeLessThanOrEqual(15_000);
      }
      const values = (typeof raw === "string" ? rawValues : raw.values ?? rawValues) as Values;
      const call = { sql, values: [...values], inTransaction };
      trace.push(call);
      hook?.(call);
      if (sql === "begin") {
        sqlite.exec("BEGIN");
        inTransaction = true;
        return [{ affectedRows: 0 }, []];
      }
      if (sql === "commit" || sql === "rollback") {
        sqlite.exec(sql.toUpperCase());
        inTransaction = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!inTransaction)
        throw new Error("Repository query outside single transaction");
      const localSql = sql
        .replace(/ for update$/i, "")
        .replace(/\bdefault\b/gi, "null");
      const statement = sqlite.prepare(localSql);
      if (/^select/i.test(sql)) {
        if (selectOverride)
          return [
            selectOverride.map(row => [
              row.id,
              row.launch27BookingId,
              row.origin,
              row.bookingId,
            ]),
            [],
          ];
        if (typeof raw !== "string" && raw.rowsAsArray)
          statement.setReturnArrays(true);
        return [statement.all(...values), []];
      }
      const result = statement.run(...values);
      return [
        {
          affectedRows: Number(result.changes),
          insertId: Number(result.lastInsertRowid),
          ...headerOverride,
        },
        [],
      ];
    }
  );
  const release = vi.fn();
  const destroy = vi.fn(() => {
    // Socket close rolls back an open server transaction, without a new SQL call.
    if (inTransaction) { sqlite.exec("ROLLBACK"); inTransaction = false; }
  });
  const getConnection = vi.fn(async () => ({ query, release, destroy }));
  // Fake ONLY the public mysql2 lease; both pool DB and fresh owned mapper are
  // real drizzle(mysql2), including SQL parameters and rowsAsArray mapping.
  const db = drizzle({
    getConnection,
    query,
  } as unknown as Pool) as unknown as NonNullable<
    Parameters<typeof persistLiveTextSyncDate>[2]
  >;
  return {
    db,
    seed,
    snapshot,
    read,
    trace,
    query,
    release,
    destroy,
    getConnection,
    writes: () =>
      trace.filter(call => /^(insert|update|delete)/i.test(call.sql)),
    hook: (next: typeof hook) => {
      hook = next;
    },
    select: (next: Row[]) => {
      selectOverride = next;
    },
    header: (next: Row) => {
      headerOverride = next;
    },
  };
}
function assertOnlyJobWrites(h: ReturnType<typeof fixture>) {
  expect(h.writes().length).toBeGreaterThan(0);
  for (const call of h.writes()) {
    expect(call.sql).toMatch(/^(?:insert into|update) `leadflow_jobs`/i);
    expect(call.inTransaction).toBe(true);
  }
  expect(h.trace.filter(call => call.sql === "begin")).toHaveLength(1);
  expect(h.trace.at(-1)?.sql).toBe("commit");
  expect(h.getConnection).toHaveBeenCalledTimes(1);
  expect(h.release).toHaveBeenCalledTimes(1);
  expect(h.destroy).not.toHaveBeenCalled();
  expect(dbMock.getDb).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

describe("safe selected-date local monitor persistence — actual Drizzle, offline driver", () => {
  it("locks ALL stable-ID bindings before any write and preserves amount/card/series/review/workflow/payroll fields", async () => {
    const h = fixture();
    h.seed();
    const before = h.snapshot();
    const result = await persistLiveTextSyncDate(
      DATE,
      [booking(), booking(702)],
      h.db
    );
    expect(result).toEqual({
      created: 1,
      updated: 1,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [41, 42],
    });
    const after = h.snapshot();
    expect(after.leadflow_jobs[0]).toEqual({
      ...before.leadflow_jobs[0],
      jobDate: DATE,
      serviceDateTime: `${DATE}T14:00:00Z`,
      customerName: "Source Owner",
      jobAddress: "Actual source address",
      serviceName: "2 bedrooms",
      bedrooms: 2,
      bathrooms: 1,
      extras: '["clean_inside_oven"]',
      bookingStatus: "assigned",
      teamName: "Source team",
      teamId: 12,
      missingFromLaunch27At: null,
    });
    for (const table of Object.keys(before).filter(
      table => table !== "leadflow_jobs"
    ))
      expect(after[table]).toEqual(before[table]);
    const lock = h.trace.find(call => /^select/i.test(call.sql))!;
    expect(lock.sql).toMatch(
      /where `leadflow_jobs`\.`launch27BookingId` in \(\?, \?\) order by .* for update$/i
    );
    expect(lock.values).toEqual([701, 702]);
    expect(lock.sql).not.toMatch(/limit|customerName|customerPhone|jobDate/i);
    expect(h.trace.indexOf(lock)).toBeLessThan(h.trace.indexOf(h.writes()[0]));
    const update = h.writes()[0].sql;
    expect(update).toMatch(
      /where .*`launch27BookingId` = \? and .*`origin` = \? and .*`bookingId` is null/i
    );
    expect(update.split(" where ")[0]).not.toMatch(
      /jobTotalCents|payment|hasStripeCard|bookingSeriesId|nextOccurrence|review|frequency|customerNotes/i
    );
    assertOnlyJobWrites(h);
  });

  it.each([
    { origin: "launch27_import", bookingId: 201 },
    { origin: "leadflow_recurrence", bookingId: 201 },
    { origin: "leadflow_recurrence", bookingId: null },
    { origin: "native_booking", bookingId: null },
  ])(
    "preserves protected row $origin / native booking $bookingId while allowing unrelated source inserts",
    async protectedValues => {
      const h = fixture();
      h.seed(protectedValues);
      const before = h.snapshot();
      const result = await persistLiveTextSyncDate(
        DATE,
        [booking(), booking(702)],
        h.db
      );
      expect(result).toEqual({
        created: 1,
        updated: 0,
        protectedRecords: 1,
        complete: false,
        refreshedJobIds: [42],
      });
      expect(h.snapshot().leadflow_jobs[0]).toEqual(before.leadflow_jobs[0]);
      expect(h.writes()).toHaveLength(1);
      assertOnlyJobWrites(h);
    }
  );

  it("never scans/promotes/deletes household placeholders or names/contact matches when source IDs change", async () => {
    const h = fixture();
    h.seed({
      id: 41,
      origin: "leadflow_recurrence",
      launch27BookingId: null,
      bookingId: 201,
      jobDate: DATE,
      serviceDateTime: `${DATE}T14:00:00Z`,
      customerName: "Source Owner",
      jobAddress: "Actual source address",
      serviceName: "2 bedrooms",
    });
    h.seed({ id: 42, launch27BookingId: 700, bookingSeriesId: 92 });
    const before = h.snapshot();
    expect(await persistLiveTextSyncDate(DATE, [booking()], h.db)).toEqual({
      created: 1,
      updated: 0,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [43],
    });
    expect(h.snapshot().leadflow_jobs.slice(0, 2)).toEqual(
      before.leadflow_jobs
    );
    expect(h.trace.filter(call => /^select/i.test(call.sql))).toHaveLength(1);
    expect(
      h.trace.some(call =>
        /delete|customerPhone.*where|customerName.*where/i.test(call.sql)
      )
    ).toBe(false);
    assertOnlyJobWrites(h);
  });

  it("inserts normal actual source values with a validated receipt, never synthetic or canonical payment writes", async () => {
    const h = fixture();
    const before = h.snapshot();
    expect(await persistLiveTextSyncDate(DATE, [booking()], h.db)).toEqual({
      created: 1,
      updated: 0,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [1],
    });
    expect(h.snapshot().leadflow_jobs[0]).toMatchObject({
      id: 1,
      origin: "launch27_import",
      launch27BookingId: 701,
      bookingId: null,
      bookingSeriesId: null,
      jobDate: DATE,
      serviceDateTime: `${DATE}T14:00:00Z`,
      jobTotalCents: 23945,
      hasStripeCard: 1,
      paymentBrand: "visa",
      paymentLast4: "4242",
      nextOccurrenceCreatedAt: null,
    });
    for (const table of Object.keys(before).filter(
      table => table !== "leadflow_jobs"
    ))
      expect(h.snapshot()[table]).toEqual(before[table]);
    assertOnlyJobWrites(h);
  });

  it("zero response is a true no-op with an empty receipt and no connection acquisition", async () => {
    const h = fixture();
    h.seed();
    const before = h.snapshot();
    expect(await persistLiveTextSyncDate(DATE, [], h.db)).toEqual({
      created: 0,
      updated: 0,
      protectedRecords: 0,
      complete: true,
      refreshedJobIds: [],
    });
    expect(h.snapshot()).toEqual(before);
    expect(h.trace).toEqual([]);
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(await persistLiveTextSyncDate(DATE, [])).toMatchObject({
      refreshedJobIds: [],
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("detects duplicate existing stable bindings across origins/dates before even an earlier valid source write", async () => {
    const h = fixture({ uniqueStableIds: false });
    h.seed();
    h.seed({
      id: 42,
      bookingSeriesId: 92,
      origin: "leadflow_recurrence",
      bookingId: 201,
    });
    const before = h.snapshot();
    await expect(
      persistLiveTextSyncDate(DATE, [booking(702), booking()], h.db)
    ).rejects.toThrow("duplicate stable booking bindings");
    expect(h.writes()).toEqual([]);
    expect(h.snapshot()).toEqual(before);
    expect(h.trace.at(-1)?.sql).toBe("rollback");
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate source IDs before connection acquisition instead of silently deduplicating", async () => {
    const h = fixture();
    await expect(
      persistLiveTextSyncDate(DATE, [booking(), booking()], h.db)
    ).rejects.toThrow("duplicate stable booking IDs");
    expect(h.trace).toEqual([]);
    expect(h.getConnection).not.toHaveBeenCalled();
  });

  it.each([
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: 2_147_483_648 },
    { id: NaN },
    { id: "701" as unknown as number },
    { serviceDate: "2026-11-14T14:00:00Z" },
    { serviceDate: "2026-11-13T02:00:00Z" },
    { serviceDate: "2026-11-14T09:00:00" },
    { serviceDate: "2026-02-30T14:00:00Z" },
    { serviceDate: "" },
    { serviceDate: "2026-11-13T25:00:00Z" },
    { serviceDate: "2026-02-30T09:00:00" },
    { serviceDate: "2026-11-13T24:00:00" },
    { serviceDate: "2026-11-13T09:60:00" },
    { serviceDate: "2026-11-13T09:00:60" },
    { serviceDate: "2026-11-13T09:00:00.1234" },
    { serviceDate: "2026-11-13T09:00:00+14:01" },
    { serviceDate: "2026-11-13T09:00:00+15:00" },
    { serviceDate: "0000-11-13T09:00:00" },
    { serviceDate: "2026-11-13T09:00:00\0" },
    { totalRevenue: Infinity },
    { totalRevenue: -1 },
    { teams: [{ id: 0, title: "unsafe", share: 0, bgColor: "" }] },
    { serviceNames: [null as unknown as string] },
    { phone: "x".repeat(31) },
    { fullName: "x".repeat(256) },
    { extras: ["x".repeat(65_536)] },
  ])(
    "rejects malformed/wrong-date source %j before any write or connection",
    async overrides => {
      const h = fixture();
      await expect(
        persistLiveTextSyncDate(
          DATE,
          [booking(702), booking(701, overrides)],
          h.db
        )
      ).rejects.toThrow("source values");
      expect(h.trace).toEqual([]);
      expect(h.getConnection).not.toHaveBeenCalled();
    }
  );

  it.each(["2026-02-30", "2026-13-01", "2026-11-13x", "11/13/2026", ""])(
    "rejects impossible selected date %s",
    async date => {
      const h = fixture();
      await expect(persistLiveTextSyncDate(date, [], h.db)).rejects.toThrow(
        "source values"
      );
      expect(h.trace).toEqual([]);
    }
  );

  it.each(["2026-11-13", "2026-11-14T00:30:00Z", "2026-11-13T09:00:00-05:00", "2026-11-13T09:00:00", "2026-11-13 09:00:00.123", "2026-11-13T09:00"])(
    "uses actual source business date for %s instead of relabeling an instant",
    async serviceDate => {
      const h = fixture();
      await persistLiveTextSyncDate(
        DATE,
        [booking(701, { serviceDate })],
        h.db
      );
      expect(h.snapshot().leadflow_jobs[0]).toMatchObject({
        jobDate: DATE,
        serviceDateTime: serviceDate,
      });
      assertOnlyJobWrites(h);
    }
  );

  it.each(["select", "second-write", "commit"])(
    "rolls back the entire date on %s error without partial receipts",
    async phase => {
      const h = fixture();
      h.seed();
      const before = h.snapshot();
      let writes = 0;
      h.hook(call => {
        if (/^(insert|update)/i.test(call.sql)) writes++;
        if (
          (phase === "select" && /^select/i.test(call.sql)) ||
          (phase === "second-write" &&
            writes === 2 &&
            /^(insert|update)/i.test(call.sql)) ||
          (phase === "commit" && call.sql === "commit")
        )
          throw new Error("Injected offline DB failure");
      });
      // Failed query wrappers intentionally retain errors; no catch/retry in repo.
      await expect(
        persistLiveTextSyncDate(DATE, [booking(), booking(702)], h.db)
      ).rejects.toThrow();
      expect(h.snapshot()).toEqual(before);
      expect(h.trace.at(-1)?.sql).toBe(phase === "commit" ? "commit" : "rollback");
      expect(h.release).toHaveBeenCalledTimes(phase === "commit" ? 0 : 1);
      expect(h.destroy).toHaveBeenCalledTimes(phase === "commit" ? 1 : 0);
    }
  );

  it("duplicate-insert race aborts/rolls back earlier writes with no silent retry, merge or raced-row update", async () => {
    const h = fixture();
    h.seed();
    h.seed({ id: 42, launch27BookingId: 702, bookingSeriesId: 92 });
    const before = h.snapshot();
    h.select([
      {
        id: 41,
        launch27BookingId: 701,
        origin: "launch27_import",
        bookingId: null,
      },
    ]);
    await expect(
      persistLiveTextSyncDate(DATE, [booking(), booking(702)], h.db)
    ).rejects.toThrow();
    expect(h.snapshot()).toEqual(before);
    expect(h.writes()).toHaveLength(2);
    expect(h.trace.filter(call => /^select/i.test(call.sql))).toHaveLength(1);
    expect(h.trace.at(-1)?.sql).toBe("rollback");
  });

  it.each([0, -1, 1.5, NaN, "42", 2_147_483_648])(
    "invalid insert result ID %s rolls back all date writes",
    async insertId => {
      const h = fixture();
      h.seed();
      const before = h.snapshot();
      h.header({ insertId });
      await expect(
        persistLiveTextSyncDate(DATE, [booking(), booking(702)], h.db)
      ).rejects.toThrow("valid inserted job ID");
      expect(h.snapshot()).toEqual(before);
      expect(h.trace.at(-1)?.sql).toBe("rollback");
    }
  );

  it("a lost update guard fails closed without inventing a refreshed receipt", async () => {
    const h = fixture();
    h.seed();
    const before = h.snapshot();
    h.header({ affectedRows: 0 });
    await expect(
      persistLiveTextSyncDate(DATE, [booking()], h.db)
    ).rejects.toThrow("binding changed");
    expect(h.snapshot()).toEqual(before);
    expect(h.trace.at(-1)?.sql).toBe("rollback");
  });

  it("snapshots all source mapping before awaiting pool acquisition", async () => {
    const h = fixture();
    const source = booking();
    const result = persistLiveTextSyncDate(DATE, [source], h.db);
    source.id = 999;
    source.address = "Mutated after call";
    source.extras.push("later mutation");
    source.teams[0].title = "Mutated team";
    expect(await result).toMatchObject({ created: 1, refreshedJobIds: [1] });
    expect(h.snapshot().leadflow_jobs[0]).toMatchObject({
      launch27BookingId: 701,
      jobAddress: "Actual source address",
      extras: '["clean_inside_oven"]',
      teamName: "Source team",
    });
  });

  it("uses only existing getDb when no injected DB is supplied, and reports DB unavailability before transactions", async () => {
    const h = fixture();
    dbMock.getDb.mockResolvedValueOnce(h.db);
    expect(await persistLiveTextSyncDate(DATE, [booking()])).toMatchObject({
      created: 1,
      refreshedJobIds: [1],
    });
    expect(dbMock.getDb).toHaveBeenCalledTimes(1);
    dbMock.getDb.mockResolvedValueOnce(null);
    await expect(persistLiveTextSyncDate(DATE, [booking(702)])).rejects.toThrow(
      "DB unavailable"
    );
    expect(h.trace.filter(call => call.sql === "begin")).toHaveLength(1);
  });
  it("rejects more than 500 source bookings before acquiring a connection", async () => {
    const h = fixture();
    await expect(
      persistLiveTextSyncDate(
        DATE,
        Array.from({ length: 501 }, (_, index) => booking(1000 + index)),
        h.db
      )
    ).rejects.toThrow("500-booking safety limit");
    expect(h.getConnection).not.toHaveBeenCalled();
    expect(h.trace).toEqual([]);
  });
  it("bounds the largest accepted date to one preselect and 500 writes in one transaction", async () => {
    const h = fixture();
    const result = await persistLiveTextSyncDate(
      DATE,
      Array.from({ length: 500 }, (_, index) => booking(1000 + index)),
      h.db
    );
    expect(result).toMatchObject({ created: 500, updated: 0, complete: true });
    expect(result.refreshedJobIds).toHaveLength(500);
    expect(h.writes()).toHaveLength(500);
    expect(h.trace.filter(call => /^select/i.test(call.sql))).toHaveLength(1);
    expect(h.trace).toHaveLength(503); // BEGIN, SELECT, <=500 writes, COMMIT.
    assertOnlyJobWrites(h);
  });
  it.each(["select", "first-write", "last-write"])(
    "15s budget destroys the lease after delayed %s settles, with no further query/write/commit",
    async phase => {
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      const h = fixture();
      h.seed();
      const before = h.snapshot();
      let writes = 0;
      h.hook(call => {
        if (/^(insert|update)/i.test(call.sql)) writes++;
        if (
          (phase === "select" && /^select/i.test(call.sql)) ||
          (phase === "first-write" &&
            writes === 1 &&
            /^(insert|update)/i.test(call.sql)) ||
          (phase === "last-write" &&
            writes === 2 &&
            /^(insert|update)/i.test(call.sql))
        )
          now = 15_000;
      });
      await expect(
        persistLiveTextSyncDate(DATE, [booking(), booking(702)], h.db)
      ).rejects.toThrow("safety budget");
      expect(h.snapshot()).toEqual(before);
      expect(h.writes()).toHaveLength(
        phase === "select" ? 0 : phase === "first-write" ? 1 : 2
      );
      expect(h.trace.some(call => call.sql === "commit")).toBe(false);
      expect(h.trace.some(call => call.sql === "rollback")).toBe(false);
      expect(h.destroy).toHaveBeenCalledTimes(1);
      expect(h.release).not.toHaveBeenCalled();
    }
  );
  it("late getDb resolution is rejected before beginning a transaction, rather than racing detached writes", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = fixture();
    dbMock.getDb.mockImplementationOnce(async () => {
      now = 15_000;
      return h.db;
    });
    await expect(persistLiveTextSyncDate(DATE, [booking()])).rejects.toThrow(
      "safety budget"
    );
    expect(h.trace).toEqual([]);
    expect(h.getConnection).not.toHaveBeenCalled();
  });
  it("late pool acquisition/BEGIN is rejected on callback entry before preselect or writes", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = fixture();
    h.hook(call => {
      if (call.sql === "begin") now = 15_000;
    });
    await expect(
      persistLiveTextSyncDate(DATE, [booking()], h.db)
    ).rejects.toThrow("safety budget");
    expect(h.writes()).toEqual([]);
    expect(h.trace.map(call => call.sql)).toEqual(["begin"]);
    expect(h.destroy).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
  });
});
