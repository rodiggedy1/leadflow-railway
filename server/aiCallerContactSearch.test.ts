import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTRPC } from "@trpc/server";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect, QueryBuilder, type AnyMySqlColumn, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { readFileSync } from "node:fs";
import { bookings, cleanerProfiles, completedJobs, leadflowJobs, quoteLeads } from "../drizzle/schema";
import { matchesCallerContactSearch, normalizeContactSearchQuery } from "../shared/aiCallerContactSearch";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  return { agentProcedure: initTRPC.create().procedure };
});
import { aiCallerContactSearch } from "./aiCallerContactSearch";

const router = initTRPC.create().router({ searchContacts: aiCallerContactSearch });
const search = (query: string) => router.createCaller({} as never).searchContacts({ query });
const dialect = new MySqlDialect();
const tables = {
  history: getTableName(completedJobs), owned: getTableName(leadflowJobs),
  bookings: getTableName(bookings),
  leads: getTableName(quoteLeads), teams: getTableName(cleanerProfiles),
};
type Row = Record<string, string | number | null>;
type Compiled = ReturnType<MySqlDialect["sqlToQuery"]>;

/** Evaluate bound literal LIKE patterns, independently of the production helpers. */
function matchesLike(value: unknown, pattern: string, escape = "!"): boolean {
  if (typeof value !== "string") return false;
  let expression = "";
  const literal = (character: string) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === escape && index + 1 < pattern.length) expression += literal(pattern[++index]);
    else expression += character === "%" ? ".*" : character === "_" ? "." : literal(character);
  }
  return new RegExp(`^${expression}$`, "s").test(value);
}

/** Builds genuine dialect SQL, but has no database connection or runtime import. */
function offline(rows: Record<string, Row[]> = {}, failTable?: string) {
  const queries: Array<{ table: string; fields: string[]; where: Compiled; statement: Compiled; limit: number }> = [];
  const forbidden = () => { throw new Error("Unexpected write or raw execution in contact search"); };
  const db = {
    insert: vi.fn(forbidden), update: vi.fn(forbidden), delete: vi.fn(forbidden), execute: vi.fn(forbidden),
    select: vi.fn((projection: Record<string, AnyMySqlColumn>) => ({
      from(table: AnyMySqlTable) {
        const tableName = getTableName(table);
        expect(Object.values(tables)).toContain(tableName);
        const builder = new QueryBuilder(dialect).select(projection).from(table);
        let condition: Compiled | undefined;
        const chain = {
          where(predicate: SQL) {
            condition = dialect.sqlToQuery(predicate);
            builder.where(predicate);
            return chain;
          },
          orderBy(...order: SQL[]) { builder.orderBy(...order); return chain; },
          async limit(limit: number) {
            builder.limit(limit);
            if (!condition) throw new Error("Unbounded contact search");
            const statement = dialect.sqlToQuery(builder.getSQL());
            queries.push({ table: tableName, fields: Object.keys(projection), where: condition, statement, limit });
            if (tableName === failTable) throw new Error("Synthetic database failure");
            const params = condition.params;
            const selected = (rows[tableName] ?? []).filter(row => {
              const name = row[projection.name.name];
              if (matchesLike(typeof name === "string" ? name.toLowerCase() : name, String(params[0]))) return true;
              if (params.length < 2) return false;
              let phone = row[projection.phone.name];
              if (typeof phone !== "string") return false;
              for (const punctuation of params.slice(1, -1)) phone = phone.split(String(punctuation)).join("");
              return matchesLike(phone, String(params.at(-1)));
            }).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
            return selected.slice(0, limit).map(row => Object.fromEntries(
              Object.entries(projection).map(([alias, column]) => [alias, row[column.name] ?? null]),
            ));
          },
        };
        return chain;
      },
    })),
  };
  mocks.getDb.mockResolvedValue(db);
  return { db, queries };
}

function assertReadOnly(work: ReturnType<typeof offline>) {
  for (const method of ["insert", "update", "delete", "execute"] as const) expect(work.db[method]).not.toHaveBeenCalled();
  expect(work.queries.map(q => q.table)).toEqual([tables.history, tables.owned, tables.bookings, tables.leads, tables.teams]);
  expect(work.queries.map(q => q.limit)).toEqual([8, 8, 8, 5, 5]);
  for (const query of work.queries) {
    expect(query.statement.sql).toMatch(/^select /i);
    expect(query.statement.sql).not.toMatch(/\b(insert|update|delete|join|regexp|current_date|now)\b/i);
    expect(query.where.sql).not.toMatch(/jobDate|bookingStatus|status|isActive|bookingId|teamId|Eligible|assigned/i);
    expect(query.statement.params.at(-1)).toBe(query.limit);
  }
}

beforeEach(() => { vi.clearAllMocks(); });

describe("caller contact pure search helpers", () => {
  it("normalizes case, leading/trailing spaces and repeated query whitespace", () => {
    expect(normalizeContactSearchQuery("  SyNtHeTiC\t\n Jane   ")).toBe("synthetic jane");
    expect(matchesCallerContactSearch({ name: "Synthetic   Jane", phone: null }, " SYNTHETIC\tJANE ")).toBe(true);
    expect(matchesCallerContactSearch({ name: "Synthetic Jane", phone: null }, "  ")).toBe(true);
    expect(matchesCallerContactSearch({ name: null, phone: null }, "Jane")).toBe(false);
  });
  it("matches ordered name tokens across saved whitespace and middle names, not reversed names", () => {
    for (const name of ["Rohan   Example", "Rohan\tExample", "Rohan G Example"]) {
      expect(matchesCallerContactSearch({ name, phone: null }, "  ROHAN   EXAMPLE ")).toBe(true);
    }
    expect(matchesCallerContactSearch({ name: "Example Rohan", phone: null }, "Rohan Example")).toBe(false);
    expect(matchesCallerContactSearch({ name: "Rohan Another", phone: null }, "Rohan Example")).toBe(false);
  });
  it.each(["3025551234", "(302) 555-1234", "+1 (302) 555.1234", "302 555 1234", "555-1234"])(
    "matches formatted local and synthetic contact phones for %s", query => {
      expect(matchesCallerContactSearch({ name: "Synthetic", phone: "+1 [302]/555—1234" }, query)).toBe(true);
      expect(matchesCallerContactSearch({ name: "Synthetic", phone: "+130255591234" }, query === "555-1234" ? "3025551234" : query)).toBe(false);
    },
  );
  it("supports optional local type/location without a saved contact or job", () => {
    expect(matchesCallerContactSearch({ name: "Team Indigo", phone: null, type: "Cleaner", location: "North District" }, "CLEANER")).toBe(true);
    expect(matchesCallerContactSearch({ name: "Team Indigo", phone: null, location: "North District" }, "north\t district")).toBe(true);
    expect(matchesCallerContactSearch({ name: "Typed number", phone: "(302) 555-1234" }, "3025551234")).toBe(true);
    expect(matchesCallerContactSearch({ name: "Elsewhere", phone: "+13025551234" }, "Team 2")).toBe(false);
  });
  it("treats SQL wildcards and backslashes as literal text locally", () => {
    expect(matchesCallerContactSearch({ name: "100%_\\ Sale!", phone: null }, "100%_\\ sale!")).toBe(true);
    expect(matchesCallerContactSearch({ name: "100XYZ Sale!", phone: null }, "100%_\\ sale!")).toBe(false);
  });
});

describe("aiCallerContactSearch — mocked MySqlDialect SELECTs only", () => {
  it("returns real all-date owned customer, historical, lead and team contracts with no eligibility filters", async () => {
    const work = offline({
      [tables.history]: [{ id: 7, name: "Synthetic History", phone: "+13025551001", address: "7 Synthetic Way", serviceType: "Deep Clean", jobDate: "2025-04-01", status: "OPTED_OUT" }],
      [tables.owned]: [
        { id: 42, customerName: "Synthetic Past", customerPhone: "(302) 555-1002", jobAddress: "42 Synthetic Road", serviceName: "Standard", jobDate: "2026-10-31", bookingStatus: "cancelled" },
        { id: 43, customerName: "Synthetic Future", customerPhone: null, jobAddress: "43 Synthetic Road", serviceName: "Move Out", jobDate: "2027-01-08", bookingStatus: "pending" },
      ],
      [tables.leads]: [{ id: 9, name: "Synthetic New Lead", phone: "+13025551003", serviceType: "Deep Clean" }],
      [tables.teams]: [{ id: 12, name: "Synthetic Team", phone: null, isActive: 0 }],
    });
    expect(await search("SyNtHeTiC")).toEqual([
      { id: "job-7", source: "customer", name: "Synthetic History", phone: "+13025551001", context: "Deep Clean · 7 Synthetic Way · 2025-04-01" },
      { id: "leadflow-job-42", source: "customer", name: "Synthetic Past", phone: "(302) 555-1002", context: "Standard · 42 Synthetic Road · 2026-10-31" },
      { id: "leadflow-job-43", source: "customer", name: "Synthetic Future", phone: null, context: "Move Out · 43 Synthetic Road · 2027-01-08" },
      { id: "lead-9", source: "lead", name: "Synthetic New Lead", phone: "+13025551003", context: "Lead · Deep Clean" },
      { id: "cleaner-12", source: "cleaner", name: "Synthetic Team", phone: null, context: "Cleaner" },
    ]);
    expect(work.queries[1].fields).toEqual(["id", "name", "phone", "address", "serviceType", "jobDate"]);
    assertReadOnly(work);
  });

  it("finds native booking customers across past and future dates regardless of booking status", async () => {
    const work = offline({
      [tables.bookings]: [
        { id: 71, customerName: "Rohan   Example", customerPhone: "(302) 555-1071", address: "71 Example Street", serviceName: "Hourly Cleaning", requestedLocalDate: "2026-10-01", status: "cancelled" },
        { id: 72, customerName: "Rohan G Example", customerPhone: "+13025551072", address: "72 Example Street", serviceName: "Standard Cleaning", requestedLocalDate: "2027-01-03", status: "needs_attention" },
      ],
    });
    expect(await search(" ROHAN  EXAMPLE ")).toEqual([
      { id: "booking-71", source: "customer", name: "Rohan   Example", phone: "(302) 555-1071", context: "Hourly Cleaning · 71 Example Street · 2026-10-01" },
      { id: "booking-72", source: "customer", name: "Rohan G Example", phone: "+13025551072", context: "Standard Cleaning · 72 Example Street · 2027-01-03" },
    ]);
    expect(work.queries[2].where.sql).not.toMatch(/requestedLocalDate|status|source/);
    assertReadOnly(work);
  });

  it.each(["Rohan Example", "3025551234"])("uses identical name/phone matching for imported and native bookings: %s", async query => {
    const work = offline({
      [tables.owned]: [{ id: 81, customerName: "Rohan G Example", customerPhone: "+1 (302) 555-1234", jobDate: "2027-01-02" }],
      [tables.bookings]: [{ id: 82, customerName: "Rohan   Example", customerPhone: "302.555.1234", requestedLocalDate: "2026-10-02" }],
    });
    const result = await search(query);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "customer", phone: "+1 (302) 555-1234" });
    expect(work.queries[1].where.params).toEqual(work.queries[2].where.params);
    expect(work.queries[1].limit).toBe(work.queries[2].limit);
    assertReadOnly(work);
  });

  it("finds a booking-only customer's formatted phone without requiring any job or lead record", async () => {
    const work = offline({ [tables.bookings]: [{ id: 91, customerName: "Booking Only", customerPhone: "+1 (302) 555-1234", requestedLocalDate: "2027-04-01" }] });
    expect(await search("3025551234")).toEqual([{ id: "booking-91", source: "customer", name: "Booking Only", phone: "+1 (302) 555-1234", context: "2027-04-01" }]);
    assertReadOnly(work);
  });

  it("collapses input whitespace and searches names case-insensitively in every source", async () => {
    const work = offline({
      [tables.history]: [{ id: 1, name: "SYNTHETIC Jane", phone: null }],
      [tables.owned]: [{ id: 2, customerName: "Synthetic JANE", customerPhone: null }],
      [tables.leads]: [{ id: 3, name: "synthetic Jane", phone: "short" }],
      [tables.teams]: [{ id: 4, name: "synthetic jane team", phone: null }],
    });
    expect(await search(" \t SYNTHETIC\n   Jane  ")).toHaveLength(4);
    for (const query of work.queries) {
      expect(query.where.sql).toContain("lower(");
      expect(query.where.params).toEqual(["%synthetic%jane%"]);
    }
    assertReadOnly(work);
  });

  it("matches ordered name tokens across saved whitespace and middle names in all authorized sources", async () => {
    const work = offline({
      [tables.history]: [{ id: 1, name: "Rohan   Example", phone: null }, { id: 2, name: "Example Rohan", phone: null }],
      [tables.owned]: [{ id: 3, customerName: "Rohan G Example", customerPhone: null }],
      [tables.leads]: [{ id: 4, name: "Rohan\tExample", phone: "short" }],
      [tables.teams]: [{ id: 5, name: "Rohan Team Example", phone: null }, { id: 6, name: "Rohan Another", phone: null }],
    });
    const result = await search(" \t ROHAN   EXAMPLE ");
    expect(result.map(row => row.id)).toEqual(["job-1", "leadflow-job-3", "lead-4", "cleaner-5"]);
    for (const query of work.queries) expect(query.where.params).toEqual(["%rohan%example%"]);
    assertReadOnly(work);
  });

  it.each(["3025551234", "(302) 555-1234", "+1 (302) 555.1234", "302\t555 1234", "555-1234"])(
    "finds phones across all sources without punctuation or digit-interleaving false positives for %s", async query => {
      const work = offline({
        [tables.history]: [{ id: 1, name: "History", phone: "(302) 555-1234" }],
        [tables.owned]: [{ id: 2, customerName: "Owned", customerPhone: "+1 [302]/555—1234" }],
        [tables.leads]: [{ id: 3, name: "Lead", phone: "302.555.1234" }],
        [tables.teams]: [{ id: 4, name: "Team", phone: "302 555 1234" }, { id: 5, name: "Wrong digits", phone: "302 555 9 1234" }],
      });
      const result = await search(query);
      expect(result[0]).toMatchObject({ id: "job-1", name: "History", phone: "(302) 555-1234" });
      expect(result.map(row => row.id)).not.toContain("cleaner-5");
      for (const compiled of work.queries) {
        expect(compiled.where.sql).toContain("replace(");
        expect(compiled.where.sql).not.toContain("302");
        expect(compiled.where.params.at(-1)).toBe(query === "555-1234" ? "%5551234%" : "%3025551234%");
      }
      assertReadOnly(work);
    },
  );

  it("binds and escapes %, _, backslashes, ! and injection text as literal names", async () => {
    const name = "Synthetic 100%_\\ Sale! ' OR 1=1 --";
    const work = offline({
      [tables.history]: [{ id: 1, name, phone: null }, { id: 2, name: "Synthetic 100XYZ Sale!", phone: null }],
      [tables.owned]: [{ id: 3, customerName: name, customerPhone: null }],
      [tables.leads]: [{ id: 4, name, phone: "short" }],
      [tables.teams]: [{ id: 5, name, phone: null }],
    });
    expect(await search(name)).toHaveLength(4);
    for (const query of work.queries) {
      expect(query.where.sql).toContain("like ? escape '!'");
      expect(query.where.sql).not.toContain("Sale");
      expect(query.where.sql).not.toContain("1=1");
      expect(query.where.params).toEqual(["%synthetic%100!%!_!\\%sale!!%'%or%1=1%--%"]);
    }
    assertReadOnly(work);
  });

  it("deduplicates valid formatted phones without altering identity/phone or merging missing/invalid contacts", async () => {
    const work = offline({
      [tables.history]: [{ id: 1, name: "Synthetic Original", phone: "(302) 555-1234" }],
      [tables.owned]: [{ id: 2, customerName: "Synthetic Duplicate", customerPhone: "+13025551234" }, { id: 3, customerName: "Synthetic No Phone", customerPhone: null }],
      [tables.leads]: [{ id: 4, name: "Synthetic Duplicate", phone: "302.555.1234" }, { id: 5, name: "Synthetic Invalid One", phone: "123" }, { id: 6, name: "Synthetic Invalid Two", phone: "456" }],
      [tables.teams]: [{ id: 7, name: "Synthetic No Phone Team", phone: null }],
    });
    const result = await search("Synthetic");
    expect(result.map(row => row.id)).toEqual(["job-1", "leadflow-job-3", "lead-5", "lead-6", "cleaner-7"]);
    expect(result[0]).toMatchObject({ name: "Synthetic Original", phone: "(302) 555-1234" });
    assertReadOnly(work);
  });

  it("preserves Unknown for genuinely unnamed history rather than inventing a customer name", async () => {
    const work = offline({ [tables.history]: [{ id: 3, name: null, phone: "(302) 555-1234", jobDate: "2024-01-01" }] });
    expect(await search("3025551234")).toEqual([{ id: "job-3", source: "customer", name: "Unknown", phone: "(302) 555-1234", context: "2024-01-01" }]);
    assertReadOnly(work);
  });

  it("retains per-source 8/8/8/5/5 bounds and the total ten-result cap", async () => {
    const work = offline({
      [tables.history]: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Synthetic history ${index}`, phone: null })),
      [tables.owned]: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, customerName: `Synthetic owned ${index}`, customerPhone: null })),
      [tables.leads]: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Synthetic lead ${index}`, phone: `short-${index}` })),
      [tables.teams]: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Synthetic team ${index}`, phone: null })),
    });
    const result = await search("synthetic");
    expect(result).toHaveLength(10);
    expect(result.filter(row => row.id.startsWith("job-"))).toHaveLength(8);
    expect(result.filter(row => row.id.startsWith("leadflow-job-"))).toHaveLength(2);
    assertReadOnly(work);
  });

  it("returns a genuine empty result only after all five bounded SELECTs succeed", async () => {
    const work = offline();
    expect(await search("No match")).toEqual([]);
    assertReadOnly(work);
  });

  it("rejects empty/whitespace-only and excessive inputs before acquiring storage", async () => {
    offline();
    for (const query of ["", " \t\n ", "x".repeat(101)]) await expect(search(query)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("throws when the database is unavailable rather than reporting no contacts", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(search("Synthetic")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  });

  it.each(Object.values(tables))("propagates a read failure from %s rather than returning partial/empty matches", async table => {
    const work = offline({}, table);
    await expect(search("Synthetic")).rejects.toThrow("Synthetic database failure");
    for (const method of ["insert", "update", "delete", "execute"] as const) expect(work.db[method]).not.toHaveBeenCalled();
  });

  it("keeps new server imports limited to authorized tables and a query-only procedure", () => {
    const source = readFileSync(new URL("./aiCallerContactSearch.ts", import.meta.url), "utf8");
    expect(source).toContain("import { bookings, cleanerProfiles, completedJobs, leadflowJobs, quoteLeads } from");
    expect(source).toContain("export const aiCallerContactSearch = agentProcedure");
    expect(source).toContain(".query(");
    expect(source).not.toMatch(/\.(mutation|insert|update|delete|execute)\(/);
    expect(source).not.toMatch(/\bfetch\(|cron|vapi|launch27|bookingId|new Date|Date\.now/i);
  });
});
