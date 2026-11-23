import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import React from "react";
import * as ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({ getDb: async () => dbMock.db }));
vi.mock("./_core/env", () => ({ ENV: { vapiPrivateKey: "test-only-placeholder" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, agentProcedure: t.procedure };
});

import { leadflowCallMatrixRouter } from "./leadflowCallMatrixRouter";

const dialect = new MySqlDialect();
const caller = () => leadflowCallMatrixRouter.createCaller({ agent: { name: "history-test" } } as any);

function querySql(value: unknown) {
  return dialect.sqlToQuery(value as any);
}

describe("AI caller history ordering contract", () => {
  beforeEach(() => {
    dbMock.db = null;
  });

  it("keeps the EST display string while returning year-aware UTC milliseconds and existing query guards", async () => {
    const createdAt = new Date("2026-11-22T02:25:00.000Z");
    const row = {
      id: "outbound-1", step: "ai_matrix_customer", calledPhone: "+12025550123", outcome: "completed",
      durationSeconds: 42, transcript: "Ava: Hello\nCustomer: Hi", summary: "Reached customer", endedReason: null,
      recordingUrl: "https://recording.test/call-1", createdAt, vapiCallId: "vapi-1",
    };
    const where: any[] = [];
    const chain: any = {
      from: () => chain,
      where: (condition: unknown) => { where.push(condition); return chain; },
      orderBy: (condition: unknown) => { where.push(condition); return chain; },
      limit: async () => [row],
    };
    dbMock.db = { select: vi.fn(() => chain) };

    const result = await caller().getCallHistory({ limit: 7 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: row.id, transcript: row.transcript, recordingUrl: row.recordingUrl,
      createdAt: "Nov 21, 9:25 PM EST", createdAtMs: createdAt.getTime(),
    });
    expect(typeof result[0].createdAtMs).toBe("number");
    expect(querySql(where[0]).sql).toContain("`step` like ?");
    expect(querySql(where[0]).params).toEqual(["ai_matrix%"]);
    expect(dbMock.db.select).toHaveBeenCalledTimes(1);
  });

  it("retains the no-database guard", async () => {
    expect(await caller().getCallHistory({ limit: 50 })).toEqual([]);
  });
});

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "client/src/pages/AiCallerLive.tsx"), "utf8");

function compileLive(options: {
  outbound: any[]; inbound: any[]; session: any; invalidate: ReturnType<typeof vi.fn>;
  starts: ReturnType<typeof vi.fn>; polls: ReturnType<typeof vi.fn>; retries: any[];
}) {
  const module = { exports: {} as any };
  const captured: { props?: any } = {};
  const useQuery = vi.fn((input: any, queryOptions: any) => {
    options.retries.push(queryOptions?.retry);
    if (input?.limit === 50 && input?.offset === undefined) return { data: options.outbound, isLoading: false, error: null, refetch: vi.fn() };
    if (input?.offset === 0) return { data: { calls: options.inbound }, isLoading: false, error: null, refetch: vi.fn() };
    if (input?.date) return { data: { customers: [], cleaners: [] }, isLoading: false, error: null };
    return { data: [], isLoading: false, error: null };
  });
  const trpc = {
    leadflowJobs: { callMatrix: {
      searchContacts: { useQuery }, getPeople: { useQuery }, getTemplates: { useQuery },
      getCallHistory: { useQuery }, startCall: { useMutation: vi.fn(() => ({ mutateAsync: options.starts })) },
    } },
    voice: { listCalls: { useQuery } },
    useUtils: () => ({ leadflowJobs: { callMatrix: { pollCall: { fetch: options.polls }, getCallHistory: { invalidate: options.invalidate } } } }),
  };
  const hooks = {
    ...React,
    useState: (initial: any) => [typeof initial === "function" ? initial() : initial, vi.fn()],
    useMemo: (factory: () => any) => factory(),
    useRef: (initial: any) => ({ current: initial }),
    useEffect: (effect: () => void | (() => void)) => { effect(); },
  };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, React: hooks, Date, Intl, Error,
    require: (id: string) => {
      if (id === "react") return hooks;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@/lib/utils") return { proxyRecordingUrl: (url: string | null) => url ? `proxy:${url}` : null };
      if (id === "@/hooks/useAiCallerSession") return { useAiCallerSession: () => ({ session: options.session, startCall: options.starts, dismissSession: vi.fn() }) };
      if (id === "./AiCallsExactLive") return { SCENARIOS: { customer: [], cleaner: [] }, SCENARIO_SLUG: {}, customerToItem: (x: any) => x, cleanerToItem: (x: any) => x, buildScript: vi.fn(), applyMergeFields: vi.fn() };
      if (id === "@/components/AiCallerWorkspace") return { AiCallerWorkspace: (props: any) => { captured.props = props; return null; } };
      throw new Error(`Unexpected UI import: ${id}`);
    },
  }, { timeout: 1500 });
  captured.props = module.exports.default().props;
  return captured.props;
}

describe("AiCallerLive actual-source recent ordering", () => {
  it.each([
    ["2026-11-23T02:15:00Z", ["outbound-1", "outbound-2", "inbound-3"]],
    ["2026-11-23T02:23:00Z", ["outbound-1", "inbound-3", "outbound-2"]],
    ["2026-11-23T02:30:00Z", ["inbound-3", "outbound-1", "outbound-2"]],
  ])("preserves actual chronology with inbound time %s and unchanged preview data", (inboundTime, expectedOrder) => {
    const invalidate = vi.fn(); const starts = vi.fn(); const polls = vi.fn(); const retries: any[] = [];
    const outbound = [
      { id: 1, calledPhone: "+12025550101", step: "ai_matrix_customer", outcome: "completed", durationSeconds: 10, createdAt: "Nov 22, 9:25 PM EST", createdAtMs: Date.parse("2026-11-23T02:25:00Z"), transcript: "out-new", summary: "new", recordingUrl: "rec-new" },
      { id: 2, calledPhone: "+12025550102", step: "ai_matrix_cleaner", outcome: "no_answer", durationSeconds: 0, createdAt: "Nov 22, 9:20 PM EST", createdAtMs: Date.parse("2026-11-23T02:20:00Z"), transcript: "out-old", summary: "old", recordingUrl: null },
    ];
    const inbound = [{ id: 3, callerPhone: "+12025550103", callerName: "Inbound", outcome: "completed", durationSeconds: 8, createdAt: inboundTime, transcript: "in-new", summary: "in", recordingUrl: "rec-in" }];
    const session = { vapiCallId: "terminal-1", phase: "terminal", status: "completed", customerName: "Terminal", phone: "+12025550109", scenario: "Test", outcome: { transcript: "terminal-transcript", summary: "terminal-summary", recordingUrl: "terminal-rec", durationSeconds: 4 } };
    const props = compileLive({ outbound, inbound, session, invalidate, starts, polls, retries });
    expect(props.recent.map((row: any) => row.id)).toEqual(expectedOrder);
    expect(props.recent.find((row: any) => row.id === "outbound-1")).toMatchObject({ time: outbound[0].createdAt, transcript: "out-new", summary: "new", recordingUrl: "proxy:rec-new", reason: "Customer call" });
    expect(props.recent.find((row: any) => row.id === "outbound-2")).toMatchObject({ time: outbound[1].createdAt, transcript: "out-old", recordingUrl: null, reason: "Team call" });
    expect(props.session.outcome.recordingUrl).toBe("proxy:terminal-rec");
    expect(starts).not.toHaveBeenCalled(); expect(polls).not.toHaveBeenCalled(); expect(invalidate).toHaveBeenCalledTimes(1);
    expect(retries).toEqual([false, undefined, undefined, undefined, undefined]);
  });
});
