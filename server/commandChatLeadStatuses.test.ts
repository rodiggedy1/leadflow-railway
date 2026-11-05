// Offline only: real client/cache and mounted hook; no server runtime or HTTP links.
import { createRequire } from 'node:module';
import { createElement, StrictMode, Suspense } from 'react';
import { useCommandChatLeadStatuses, type CommandChatLeadStatus } from '../client/src/hooks/useCommandChatLeadStatuses';
import { trpc } from '../client/src/lib/trpc';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = (() => { throw new Error('Network prohibited in offline status tests'); }) as typeof fetch;
  if (process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.OPENAI_API_KEY) {
    throw new Error('Credential-bearing environment prohibited');
  }
});
// Supply a test-only matching renderer externally; no application dependency is added.
const renderer: any = createRequire(import.meta.url)(process.env.COMMAND_CHAT_TEST_RENDERER_PATH || 'react-test-renderer');
const act: (callback: () => void | Promise<void>) => Promise<void> = renderer.act;
const mounted: any[] = [];

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, QueryClientProvider, useQuery, hashKey } from '@tanstack/react-query';
import { createTRPCClient, TRPCClientError } from '@trpc/client';
import { createTRPCReact, createTRPCQueryUtils, getQueryKey } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import { initTRPC } from '@trpc/server';
import { allocateStatusAuthScope as allocateAuthScope, canonicalSessionIds, cleanupStatusAuthScope as cleanupAuthScope, scopedStatusRetry, statusQueryOptions, type StatusAuthScope as AuthScope } from '../client/src/hooks/useCommandChatLeadStatuses';
type StatusRow = CommandChatLeadStatus;

// Type contract fixture only; no listener, request handler, or DB connection.
const fixture = initTRPC.create();
const fixtureRouter = fixture.router({ opsChat: fixture.router({
  getLeadSessionStatuses: fixture.procedure.input((input: unknown) => input as { sessionIds: number[] })
    .query(() => [] as StatusRow[]),
}) });
type FixtureRouter = typeof fixtureRouter;
const api = createTRPCReact<FixtureRouter>();
const scope: AuthScope = { identity: 70001, epoch: 1 };
const clients: QueryClient[] = [];
const unsubscribers: (() => void)[] = [];
const range = (n: number, start = 1) => Array.from({ length: n }, (_, i) => start + i);
const baseKey = (ids: number[]) => getQueryKey(api.opsChat.getLeadSessionStatuses, { sessionIds: canonicalSessionIds(ids) }, 'query');
const row = (id: number, label = 'Synthetic agent'): StatusRow => ({
  id, isBooked: id % 2 === 0, bookedAt: id % 2 === 0 ? 100000 + id : null,
  bookedByAgentName: id % 2 === 0 ? label : null, bookedAmount: id % 2 === 0 ? 200 + id : null,
  stage: id % 3 === 0 ? 'LOST' : 'NEW', lostReason: id % 3 === 0 ? 'synthetic-only' : null,
});
const failure = (code: string, httpStatus: number, message = 'Synthetic failure') => TRPCClientError.from({
  error: { code: -32600, message, data: { code, httpStatus, path: 'opsChat.getLeadSessionStatuses' } },
});

// Existing main.tsx policy reproduced as a fixture, never imported/executed.
const existingRetry = vi.fn((count: number, error: unknown) => {
  if (error instanceof TRPCClientError) {
    if (error.message === 'Rate exceeded.' || [429, 401, 403].includes(error.data?.httpStatus)) return false;
  }
  return count < 1;
});
function client() {
  const c = new QueryClient({ defaultOptions: { queries: {
    retry: existingRetry, retryDelay: 0, staleTime: 120000,
    refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: Infinity,
  } } });
  clients.push(c);
  return c;
}
function transport(handler: (ids: number[], call: number) => Promise<StatusRow[]> | StatusRow[]) {
  const inputs: number[][] = [];
  const signals: unknown[] = [];
  let active = 0, peak = 0;
  const rpc = createTRPCClient<FixtureRouter>({ links: [() => ({ op }) => observable((sink) => {
    const ids = (op.input as { sessionIds: number[] }).sessionIds;
    const call = inputs.length;
    inputs.push([...ids]); signals.push(op.signal);
    active += 1; peak = Math.max(peak, active);
    Promise.resolve().then(() => handler(ids, call)).then((data) => {
      active -= 1;
      sink.next({ result: { data } }); sink.complete();
    }, (error) => { active -= 1; sink.error(error); });
    return () => {}; // Mock transport deliberately drains even after cancellation.
  })] });
  return { rpc, inputs, signals, get active() { return active; }, get peak() { return peak; } };
}
function options(c: QueryClient, t: ReturnType<typeof transport>, ids: number[], auth = scope, enabled = true) {
  return statusQueryOptions({ queryClient: c, baseKey: baseKey(ids), scope: auth,
    sessionIds: ids, enabled,
    request: (input) => t.rpc.opsChat.getLeadSessionStatuses.query(input) as Promise<StatusRow[]>,
  });
}
function observe(c: QueryClient, opts: ReturnType<typeof options>) {
  const observer = new QueryObserver(c, opts);
  const states: ReturnType<typeof observer.getCurrentResult>[] = [];
  const unsub = observer.subscribe((state) => states.push(state));
  unsubscribers.push(unsub);
  return { observer, states, unsub };
}
async function until(condition: () => boolean) {
  await vi.waitFor(() => expect(condition()).toBe(true), { timeout: 2000, interval: 1 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((root) => root.unmount()); });
  unsubscribers.splice(0).forEach((unsub) => unsub());
  clients.splice(0).forEach((c) => c.clear());
  existingRetry.mockClear();
  vi.useRealTimers();
});

describe('cohort and immutable mapping', () => {
  it('canonicalizes duplicates/order with no cap and preserves every lead mapping', async () => {
    const ids = [...range(137).reverse(), ...range(137), 1, 52];
    const leads = [...ids.map((id, index) => ({ card: `lead-${index}`, sessionId: id })), { card: 'no-session', sessionId: null }];
    const normalized = canonicalSessionIds(leads.map((lead) => lead.sessionId));
    expect(normalized).toEqual(range(137));
    expect(hashKey(baseKey(normalized))).toBe(hashKey(baseKey(ids)));
    const c = client(), t = transport((batch) => batch.slice().reverse().map((id) => row(id)));
    const data = await c.fetchQuery(options(c, t, normalized));
    const byId = new Map(data.map((status) => [status.id, status]));
    const mapped = leads.map((lead) => ({ ...lead, status: lead.sessionId === null ? undefined : byId.get(lead.sessionId) }));
    expect(mapped).toHaveLength(leads.length);
    expect(mapped.filter((lead) => lead.status)).toHaveLength(ids.length);
    expect(mapped.slice(0, -1).every((lead) => lead.status?.id === lead.sessionId)).toBe(true);
    expect(t.inputs.map((batch) => batch.length)).toEqual([50, 50, 37]);
    expect(t.inputs.flat()).toEqual(range(137));
    expect(t.peak).toBe(1);
    expect(data.find((status) => status.id === 102)).toEqual(row(102));
    expect(Object.keys(data[0]).sort()).toEqual(['id','isBooked','bookedAt','bookedByAgentName','bookedAmount','stage','lostReason'].sort());
  });
  it.each([1, 50, 51, 100, 101, 501])('fetches all %i unique IDs with only bounded serial calls', async (count) => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const data = await c.fetchQuery(options(c, t, range(count)));
    expect(data.map((r) => r.id)).toEqual(range(count));
    expect(t.inputs.every((batch) => batch.length > 0 && batch.length <= 50)).toBe(true);
    expect(t.inputs).toHaveLength(Math.ceil(count / 50));
    expect(t.peak).toBe(1);
  });
  it('does not fetch empty or auth-disabled cohorts', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const a = observe(c, options(c, t, []));
    const b = observe(c, options(c, t, range(70), scope, false));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.inputs).toHaveLength(0);
    expect(a.observer.getCurrentResult().data).toBeUndefined();
    expect(b.observer.getCurrentResult().data).toBeUndefined();
  });
  it('does not invent missing rows or turn server-empty success into booked data', async () => {
    const c = client(), t = transport((ids) => ids.filter((id) => id !== 75).map((id) => row(id)));
    const result = await c.fetchQuery(options(c, t, range(105)));
    expect(result).toHaveLength(104);
    expect(result.some((r) => r.id === 75)).toBe(false);
    const emptyTransport = transport(() => []);
    const empty = await c.fetchQuery(options(c, emptyTransport, [90001]));
    expect(empty).toEqual([]);
    expect(emptyTransport.inputs).toEqual([[90001]]);
  });
});

describe('complete sweep publication and retry scope', () => {
  it('middle-chunk BAD_REQUEST publishes no partial snapshot and never calls the last chunk', async () => {
    const c = client(), t = transport((ids, call) => { if (call === 1) throw failure('BAD_REQUEST', 400); return ids.map((id) => row(id)); });
    const observed = observe(c, options(c, t, range(121)));
    await until(() => observed.observer.getCurrentResult().isError);
    expect(t.inputs.map((ids) => ids.length)).toEqual([50, 50]);
    expect(observed.states.some((state) => state.data !== undefined)).toBe(false);
    expect(c.getQueryData(options(c, t, range(121)).queryKey)).toBeUndefined();
    expect(existingRetry).not.toHaveBeenCalled();
  });
  it('keeps the previous complete snapshot only for the same cohort/auth scope after refetch failure', async () => {
    const c = client(); let broken = false;
    const t = transport((ids) => { if (broken && ids[0] === 51) throw failure('BAD_REQUEST', 400); return ids.map((id) => row(id)); });
    const opts = options(c, t, range(121));
    const observed = observe(c, opts);
    await until(() => observed.observer.getCurrentResult().isSuccess);
    const complete = observed.observer.getCurrentResult().data;
    broken = true;
    await observed.observer.refetch();
    expect(observed.observer.getCurrentResult().isRefetchError).toBe(true);
    expect(observed.observer.getCurrentResult().data).toBe(complete);
    expect(complete).toHaveLength(121);
    const changed = options(c, t, range(122));
    observed.observer.setOptions(changed);
    expect(observed.observer.getCurrentResult().data).toBeUndefined();
    await until(() => observed.observer.getCurrentResult().isError);
    expect(observed.observer.getCurrentResult().data).toBeUndefined();
    expect(c.getQueryData(opts.queryKey)).toBe(complete);
  });
  it('transient failure retries one full sweep, retaining original tRPC errors in the cache', async () => {
    const c = client(), error = failure('INTERNAL_SERVER_ERROR', 500);
    const t = transport((ids, call) => { if (call === 1) throw error; return ids.map((id) => row(id)); });
    const result = await c.fetchQuery(options(c, t, range(105)));
    expect(result).toHaveLength(105);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 51, 1, 51, 101]);
    expect(existingRetry).toHaveBeenCalledWith(0, error);
    expect(t.peak).toBe(1);
  });
  it.each([
    ['UNAUTHORIZED', 401, 'Synthetic failure'], ['FORBIDDEN', 403, 'Synthetic failure'],
    ['TOO_MANY_REQUESTS', 429, 'Synthetic failure'], ['INTERNAL_SERVER_ERROR', 500, 'Rate exceeded.'],
  ])('delegates %s/%i to the unchanged auth/rate-limit policy', async (code, httpStatus, message) => {
    const c = client(), error = failure(code, httpStatus, message);
    const t = transport(() => { throw error; });
    const opts = options(c, t, [1]);
    await expect(c.fetchQuery(opts)).rejects.toBe(error);
    expect(t.inputs).toHaveLength(1);
    expect(existingRetry).toHaveBeenCalledWith(0, error);
    expect(c.getQueryState(opts.queryKey)?.error).toBe(error);
    expect(c.getQueryState(opts.queryKey)?.error).toBeInstanceOf(TRPCClientError);
  });
  it('wraps the actual effective per-key default and does not change unrelated queries', async () => {
    const c = client(), t = transport(() => { throw failure('BAD_REQUEST', 400); });
    const special = vi.fn(() => true);
    c.setQueryDefaults(getQueryKey(api.opsChat.getLeadSessionStatuses), { retry: special });
    const opts = options(c, t, [1]);
    expect(opts.retry(0, failure('BAD_REQUEST', 400))).toBe(false);
    expect(special).not.toHaveBeenCalled();
    expect(opts.retry(3, failure('INTERNAL_SERVER_ERROR', 500))).toBe(true);
    expect(special).toHaveBeenCalledTimes(1);
    let calls = 0;
    await expect(c.fetchQuery({ queryKey: ['unrelated-prototype'], queryFn: async () => { calls++; throw failure('BAD_REQUEST', 400); } })).rejects.toBeInstanceOf(TRPCClientError);
    expect(calls).toBe(2); // Unrelated original retry remains unchanged.
  });
  it.each([false, true, 0, 2])('preserves supported retry option %s except deterministic BAD_REQUEST', (policy) => {
    const retry = scopedStatusRetry(policy);
    expect(retry(0, failure('BAD_REQUEST', 400))).toBe(false);
    expect(retry(0, new Error('Synthetic transient'))).toBe(policy === true || typeof policy === 'number' && policy > 0);
  });
});

describe('global serial gate, key changes, auth cleanup, and real tRPC invalidation', () => {
  it('allocates a new auth key across same-identity re-entry without resetting on component remount', () => {
    const c = client();
    const first = allocateAuthScope(c, 70001);
    const other = allocateAuthScope(c, 70002);
    const relogged = allocateAuthScope(c, 70001);
    expect([first.epoch, other.epoch, relogged.epoch]).toEqual([1, 2, 3]);
    const t = transport(() => []);
    expect(hashKey(options(c, t, [1], first).queryKey)).not.toBe(hashKey(options(c, t, [1], relogged).queryKey));
  });
  it('cohort observer change cancels publication/future chunks, drains current request, then starts the latest cohort', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const oldOpts = options(c, t, range(105));
    const observed = observe(c, oldOpts);
    await until(() => t.inputs.length === 1);
    const newOpts = options(c, t, range(73, 1001));
    observed.observer.setOptions(newOpts);
    expect(observed.observer.getCurrentResult().data).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id)));
    await until(() => observed.observer.getCurrentResult().isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 1001, 1051]);
    expect(t.peak).toBe(1);
    expect(t.signals.every((signal) => signal === null || signal === undefined)).toBe(true);
    expect(c.getQueryData(oldOpts.queryKey)).toBeUndefined();
    expect(observed.observer.getCurrentResult().data?.map((r) => r.id)).toEqual(range(73, 1001));
  });
  it('logout removes old auth cache; same-identity relogin waits for drain and never receives old rows', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id, 'Relogged synthetic')));
    const oldOpts = options(c, t, range(80));
    const old = observe(c, oldOpts);
    await until(() => t.inputs.length === 1);
    old.unsub();
    await cleanupAuthScope(c, scope);
    const newScope = { identity: scope.identity, epoch: 2 };
    const latest = observe(c, options(c, t, range(80), newScope));
    expect(latest.observer.getCurrentResult().data).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id, 'Old synthetic')));
    await until(() => latest.observer.getCurrentResult().isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 1, 51]);
    expect(t.peak).toBe(1);
    expect(c.getQueryState(oldOpts.queryKey)).toBeUndefined();
    expect(latest.observer.getCurrentResult().data?.find((r) => r.id === 2)?.bookedByAgentName).toBe('Relogged synthetic');
  });
  it('auth cleanup removes previously successful data but leaves another identity cache isolated', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const first = options(c, t, [1,2]);
    const other = options(c, t, [1,2], { identity: 70002, epoch: 10 });
    await c.fetchQuery(first); await c.fetchQuery(other);
    await cleanupAuthScope(c, scope);
    expect(c.getQueryState(first.queryKey)).toBeUndefined();
    expect(c.getQueryData(other.queryKey)).toHaveLength(2);
    expect(hashKey(first.queryKey)).not.toBe(hashKey(other.queryKey));
  });
  it('rapid cohort changes skip obsolete queued work and never overlap across keys', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const observed = observe(c, options(c, t, range(70)));
    await until(() => t.inputs.length === 1);
    observed.observer.setOptions(options(c, t, range(65, 2001)));
    await Promise.resolve();
    observed.observer.setOptions(options(c, t, range(65, 3001)));
    held.resolve(range(50).map((id) => row(id)));
    await until(() => observed.observer.getCurrentResult().isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 3001, 3051]);
    expect(t.peak).toBe(1);
  });
  it('same-cohort concurrent fetches share one TanStack promise rather than starting duplicate sweeps', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const opts = options(c, t, range(83));
    const a = c.fetchQuery(opts), b = c.fetchQuery(opts);
    await until(() => t.inputs.length === 1);
    held.resolve(range(50).map((id) => row(id)));
    const [left, right] = await Promise.all([a,b]);
    expect(left).toBe(right);
    expect(t.inputs.map((ids) => ids.length)).toEqual([50,33]);
    expect(t.peak).toBe(1);
  });
  it('default cancel-and-refetch invalidation still waits for drain before restarting a loaded cohort', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 2 ? held.promise : ids.map((id) => row(id)));
    const opts = options(c, t, range(60));
    const observed = observe(c, opts);
    await until(() => observed.observer.getCurrentResult().isSuccess);
    const firstRefetch = observed.observer.refetch();
    await until(() => t.inputs.length === 3);
    const invalidate = c.invalidateQueries({ queryKey: opts.queryKey });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.inputs).toHaveLength(3);
    held.resolve(range(50).map((id) => row(id)));
    await Promise.all([firstRefetch, invalidate]);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1,51,1,1,51]);
    expect(t.peak).toBe(1);
    expect(observed.observer.getCurrentResult().data).toHaveLength(60);
  });
  it('poll ticks during a held request deduplicate rather than overlap or queue repeated sweeps', async () => {
    vi.useFakeTimers();
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const observed = observe(c, options(c, t, range(65)));
    await vi.advanceTimersByTimeAsync(90000);
    expect(t.inputs).toHaveLength(1);
    expect(t.active).toBe(1);
    held.resolve(range(50).map((id) => row(id)));
    await vi.advanceTimersByTimeAsync(1);
    expect(observed.observer.getCurrentResult().data).toHaveLength(65);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 51]);
    expect(t.peak).toBe(1);
  });
  it('logout while a newer cohort waits in the gate cancels that queued cohort without issuing transport calls', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const observed = observe(c, options(c, t, range(75)));
    await until(() => t.inputs.length === 1);
    observed.observer.setOptions(options(c, t, range(75, 2001)));
    await Promise.resolve();
    observed.unsub();
    await cleanupAuthScope(c, scope);
    held.resolve(range(50).map((id) => row(id)));
    await until(() => t.active === 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.inputs).toHaveLength(1);
    expect(t.peak).toBe(1);
    expect(c.getQueryCache().findAll()).toHaveLength(0);
  });
  it('real tRPC exact-input invalidation matches aggregate suffix, preserves other cohort cache, and refreshes all chunks', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const observed = observe(c, options(c, t, range(105)));
    await until(() => observed.observer.getCurrentResult().isSuccess);
    const other = options(c, t, [9001]);
    await c.fetchQuery(other);
    const utils = createTRPCQueryUtils({ queryClient: c, client: t.rpc });
    const before = t.inputs.length;
    await utils.opsChat.getLeadSessionStatuses.invalidate({ sessionIds: range(105) });
    expect(t.inputs.length - before).toBe(3);
    expect(c.getQueryState(other.queryKey)?.isInvalidated).toBe(false);
    await utils.opsChat.getLeadSessionStatuses.invalidate();
    expect(c.getQueryState(other.queryKey)?.isInvalidated).toBe(true);
    expect(t.peak).toBe(1);
    expect(observed.observer.getCurrentResult().data).toHaveLength(105);
  });
  it('30-second observer polling restarts a full sweep with no overlapping calls', async () => {
    vi.useFakeTimers();
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const observed = observe(c, options(c, t, range(55)));
    await vi.advanceTimersByTimeAsync(1);
    expect(observed.observer.getCurrentResult().data).toHaveLength(55);
    await vi.advanceTimersByTimeAsync(30000);
    expect(t.inputs).toHaveLength(4);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 51, 1, 51]);
    expect(t.peak).toBe(1);
    expect(options(c, t, range(55)).refetchInterval).toBe(30000);
    expect(options(c, t, range(55)).refetchIntervalInBackground).toBe(false);
  });
});

type HookInput = Parameters<typeof useCommandChatLeadStatuses>[0];
type HookResult = ReturnType<typeof useCommandChatLeadStatuses>;
function authOf(key: readonly unknown[]): AuthScope | null {
  return (key[key.length - 1] as { commandChatLeadStatuses: AuthScope | null }).commandChatLeadStatuses;
}
function mountHook(c: QueryClient, t: ReturnType<typeof transport>, initial: HookInput, strict = false) {
  let latest!: HookResult;
  let root: any;
  const renders: { input: HookInput; result: HookResult }[] = [];
  function Probe(props: HookInput) {
    latest = useCommandChatLeadStatuses(props);
    renders.push({ input: props, result: latest });
    return createElement('div', null, 'inbox-rendered-without-status');
  }
  const tree = (input: HookInput) => createElement(strict ? StrictMode : Suspense,
    strict ? null : { fallback: 'must-not-suspend' },
    createElement(QueryClientProvider, { client: c },
      createElement(trpc.Provider, { client: t.rpc as any, queryClient: c, children: createElement(Probe, input) })));
  return {
    async start() {
      await act(async () => { root = renderer.create(tree(initial)); });
      mounted.push(root);
    },
    async update(input: HookInput) { await act(async () => { root.update(tree(input)); }); },
    async stop() {
      await act(async () => { root.unmount(); });
      const index = mounted.indexOf(root);
      if (index >= 0) mounted.splice(index, 1);
    },
    get latest() { return latest; },
    get root() { return root; },
    renders,
  };
}
async function mountedUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2)); });
    if (condition()) return;
  }
  expect(condition()).toBe(true);
}
const input = (sessionIds: readonly (number | null)[], identity: number | null = 70001, enabled = true): HookInput => ({ sessionIds, identity, enabled });

describe('mounted React adapter lifecycle (actual providers/client/cache)', () => {
  it('StrictMode replay owns a fresh committed scope; old asynchronous cleanup cannot remove it', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const hook = mountHook(c, t, input(range(65)), true);
    await hook.start();
    await mountedUntil(() => t.inputs.length === 1);
    const current = authOf(hook.latest.queryKey)!;
    expect(current).toEqual({ identity: 70001, epoch: 2 });
    expect(hook.renders[0].result.data).toBeUndefined();
    expect(hook.renders[0].result.isFetching).toBe(false);
    expect(hook.root.toJSON()).toMatchObject({ type: 'div', children: ['inbox-rendered-without-status'] });
    held.resolve(range(50).map((id) => row(id)));
    await mountedUntil(() => hook.latest.isSuccess);
    expect(hook.latest.data).toHaveLength(65);
    expect(authOf(hook.latest.queryKey)).toEqual(current);
    expect(c.getQueryData(hook.latest.queryKey)).toHaveLength(65);
    expect(c.getQueryCache().findAll().filter((q) => authOf(q.queryKey)?.epoch === 1)).toHaveLength(0);
    expect(t.peak).toBe(1);
  });
  it('disabled-to-enabled and reordered duplicate inputs keep one auth scope without disabled requests', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const hook = mountHook(c, t, input([3, 1, 3, null, 2], 70001, false));
    await hook.start();
    expect(t.inputs).toHaveLength(0);
    const key = hashKey(hook.latest.queryKey), current = authOf(hook.latest.queryKey);
    expect(hook.latest.canonicalIds).toEqual([1, 2, 3]);
    await hook.update(input([2, null, 1, 3, 1], 70001, true));
    await mountedUntil(() => hook.latest.isSuccess);
    expect(hashKey(hook.latest.queryKey)).toBe(key);
    expect(authOf(hook.latest.queryKey)).toEqual(current);
    expect(t.inputs).toEqual([[1, 2, 3]]);
    await hook.update(input([3, 2, 1], 70001, false));
    expect(hook.latest.data).toBeUndefined();
    await hook.update(input([1, 2, 3], 70001, true));
    expect(authOf(hook.latest.queryKey)).toEqual(current);
    expect(hook.latest.data).toHaveLength(3);
    expect(t.inputs).toHaveLength(1);
  });
  it('preserves zero, negative and fractional non-null IDs without invented eligibility', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const hook = mountHook(c, t, input([0, -2, 1.5, null, -2]));
    await hook.start();
    await mountedUntil(() => hook.latest.isSuccess);
    expect(hook.latest.canonicalIds).toEqual([-2, 0, 1.5]);
    expect(t.inputs).toEqual([[-2, 0, 1.5]]);
  });
  it('null identity hides successful rows on every render; same identity relogin gets a fresh epoch', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 1 ? held.promise : ids.map((id) => row(id)));
    const hook = mountHook(c, t, input([1, 2]));
    await hook.start();
    await mountedUntil(() => hook.latest.isSuccess);
    const oldKey = hook.latest.queryKey, oldScope = authOf(oldKey)!;
    await hook.update(input([1, 2], null));
    expect(hook.latest.data).toBeUndefined();
    expect(authOf(hook.latest.queryKey)).toBeNull();
    expect(hook.renders.filter((r) => r.input.identity === null).every((r) => r.result.data === undefined)).toBe(true);
    expect(c.getQueryState(oldKey)).toBeUndefined();
    await hook.update(input([1, 2]));
    await mountedUntil(() => t.inputs.length === 2);
    expect(hook.latest.data).toBeUndefined();
    expect(authOf(hook.latest.queryKey)!.epoch).toBeGreaterThan(oldScope.epoch);
    held.resolve([row(1, 'Relogged'), row(2, 'Relogged')]);
    await mountedUntil(() => hook.latest.isSuccess);
    expect(hook.latest.data?.[1].bookedByAgentName).toBe('Relogged');
    expect(c.getQueryState(oldKey)).toBeUndefined();
  });
  it('new identity waits for old transport drain and never displays or publishes old rows', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id, 'New identity')));
    const hook = mountHook(c, t, input(range(80)));
    await hook.start();
    await mountedUntil(() => t.inputs.length === 1);
    const oldKey = hook.latest.queryKey;
    await hook.update(input(range(80), 70002));
    expect(hook.latest.data).toBeUndefined();
    expect(t.inputs).toHaveLength(1);
    expect(hook.renders.filter((r) => r.input.identity === 70002).every((r) => r.result.data === undefined)).toBe(true);
    held.resolve(range(50).map((id) => row(id, 'Old identity')));
    await mountedUntil(() => hook.latest.isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 1, 51]);
    expect(t.peak).toBe(1);
    expect(t.signals.every((signal) => signal === null || signal === undefined)).toBe(true);
    expect(c.getQueryState(oldKey)).toBeUndefined();
    expect(hook.latest.data?.[1].bookedByAgentName).toBe('New identity');
  });
  it('rapid mounted cohort changes skip obsolete queued sweeps without partial publication', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const hook = mountHook(c, t, input(range(80)));
    await hook.start();
    await mountedUntil(() => t.inputs.length === 1);
    const oldKey = hook.latest.queryKey, current = authOf(oldKey);
    await hook.update(input(range(65, 2001)));
    await hook.update(input(range(75, 3001)));
    expect(hook.latest.data).toBeUndefined();
    expect(authOf(hook.latest.queryKey)).toEqual(current);
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id)));
    await mountedUntil(() => hook.latest.isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 3001, 3051]);
    expect(hook.latest.data?.map((status) => status.id)).toEqual(range(75, 3001));
    expect(c.getQueryData(oldKey)).toBeUndefined();
    expect(t.peak).toBe(1);
  });
  it('unmount disposes a queued cohort without issuing it and removes that scope cache', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const hook = mountHook(c, t, input(range(75)));
    await hook.start();
    await mountedUntil(() => t.inputs.length === 1);
    await hook.update(input(range(75, 2001)));
    await hook.stop();
    held.resolve(range(50).map((id) => row(id)));
    await mountedUntil(() => t.active === 0);
    expect(t.inputs).toHaveLength(1);
    expect(c.getQueryCache().findAll().filter((q) => authOf(q.queryKey) !== null)).toHaveLength(0);
    expect(t.peak).toBe(1);
  });
  it('gate survives StrictMode unmount/remount same identity while old transport remains active', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id, 'Remounted')));
    const old = mountHook(c, t, input(range(70)), true);
    await old.start();
    await mountedUntil(() => t.inputs.length === 1);
    const oldKey = old.latest.queryKey, oldScope = authOf(oldKey)!;
    await old.stop();
    const current = mountHook(c, t, input(range(70)), true);
    await current.start();
    expect(current.latest.data).toBeUndefined();
    expect(authOf(current.latest.queryKey)!.epoch).toBeGreaterThan(oldScope.epoch);
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id, 'Unmounted')));
    await mountedUntil(() => current.latest.isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 1, 51]);
    expect(t.peak).toBe(1);
    expect(c.getQueryState(oldKey)).toBeUndefined();
    expect(current.latest.data?.[1].bookedByAgentName).toBe('Remounted');
  });
  it('mounted refetch failure keeps same-cohort full last-good data only, never fabricating missing rows', async () => {
    const c = client(); let broken = false;
    const t = transport((ids) => {
      if (broken && ids[0] === 51) throw failure('BAD_REQUEST', 400);
      return ids.filter((id) => id !== 75).map((id) => row(id));
    });
    const hook = mountHook(c, t, input(range(121)));
    await hook.start();
    await mountedUntil(() => hook.latest.isSuccess);
    const good = hook.latest.data;
    expect(good).toHaveLength(120);
    expect(good?.some((status) => status.id === 75)).toBe(false);
    broken = true;
    await act(async () => { await hook.latest.refetch(); });
    await mountedUntil(() => hook.latest.isRefetchError);
    expect(hook.latest.data).toBe(good);
    await hook.update(input(range(122)));
    expect(hook.latest.data).toBeUndefined();
    await mountedUntil(() => hook.latest.isError);
    expect(hook.latest.data).toBeUndefined();
    expect(hook.renders.filter((r) => r.input.sessionIds.length === 122).every((r) => r.result.data === undefined)).toBe(true);
    expect(existingRetry).not.toHaveBeenCalled();
  });
  it('genuine prefix mutation invalidation refreshes every mounted chunk and inherits effective defaults', async () => {
    const c = client(), t = transport((ids) => ids.map((id) => row(id)));
    const policy = vi.fn(() => false);
    c.setQueryDefaults(getQueryKey(trpc.opsChat.getLeadSessionStatuses), { retry: policy, staleTime: 85000 });
    const hook = mountHook(c, t, input(range(105)));
    await hook.start();
    await mountedUntil(() => hook.latest.isSuccess);
    const opts = c.getQueryCache().find({ queryKey: hook.latest.queryKey, exact: true })!.options as any;
    expect(opts.staleTime).toBe(85000);
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(opts.refetchOnReconnect).toBe(false);
    expect(opts.retryDelay).toBe(0);
    expect(opts.refetchInterval).toBe(30000);
    expect(opts.refetchIntervalInBackground).toBe(false);
    expect(opts.retry(0, failure('BAD_REQUEST', 400))).toBe(false);
    expect(policy).not.toHaveBeenCalled();
    expect(opts.retry(0, failure('INTERNAL_SERVER_ERROR', 500))).toBe(false);
    expect(policy).toHaveBeenCalledOnce();
    const utils = createTRPCQueryUtils({ queryClient: c, client: t.rpc });
    await act(async () => { await utils.opsChat.getLeadSessionStatuses.invalidate(); });
    await mountedUntil(() => !hook.latest.isFetching);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 51, 101, 1, 51, 101]);
    expect(hook.latest.data).toHaveLength(105);
    expect(t.peak).toBe(1);
  });
  it('primary inbox renders before disabled statuses; held enabled statuses never suspend its usable data', async () => {
    const c = client(), inbox = deferred<string[]>(), held = deferred<StatusRow[]>();
    const t = transport(() => held.promise);
    let status!: HookResult;
    let primary!: ReturnType<typeof useQuery<string[]>>;
    function Inbox() {
      primary = useQuery<string[]>({ queryKey: ['synthetic-primary-inbox'], queryFn: () => inbox.promise });
      status = useCommandChatLeadStatuses(input([1, 2], 70001, primary.isFetched));
      return createElement('div', null, primary.data?.join(',') ?? 'inbox-loading-independently');
    }
    let root: any;
    await act(async () => {
      root = renderer.create(createElement(QueryClientProvider, { client: c },
        createElement(trpc.Provider, { client: t.rpc as any, queryClient: c,
          children: createElement(Suspense, { fallback: 'must-not-suspend' }, createElement(Inbox)) })));
    });
    mounted.push(root);
    expect(root.toJSON()).toMatchObject({ children: ['inbox-loading-independently'] });
    expect(t.inputs).toHaveLength(0);
    const before = authOf(status.queryKey);
    inbox.resolve(['usable-primary-inbox']);
    await mountedUntil(() => primary.isSuccess && t.inputs.length === 1);
    expect(root.toJSON()).toMatchObject({ children: ['usable-primary-inbox'] });
    expect(status.isFetching).toBe(true);
    expect(status.data).toBeUndefined();
    expect(authOf(status.queryKey)).toEqual(before);
    held.resolve([row(1), row(2)]);
    await mountedUntil(() => status.isSuccess);
    expect(root.toJSON()).toMatchObject({ children: ['usable-primary-inbox'] });
  });
  it('mounted 30-second polling deduplicates held sweeps and stops on unmount', async () => {
    vi.useFakeTimers();
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id)));
    const hook = mountHook(c, t, input(range(55)));
    await hook.start();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id)));
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(hook.latest.data).toHaveLength(55);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 51, 1, 51]);
    expect(t.peak).toBe(1);
    await hook.stop();
    await vi.advanceTimersByTimeAsync(90000);
    expect(t.inputs).toHaveLength(4);
  });
});

describe('mounted logout/reentry drain', () => {
  it('null-to-same identity while transport is held cancels later old chunks and serializes the fresh epoch', async () => {
    const c = client(), held = deferred<StatusRow[]>();
    const t = transport((ids, call) => call === 0 ? held.promise : ids.map((id) => row(id, 'Fresh auth entry')));
    const hook = mountHook(c, t, input(range(85)), true);
    await hook.start();
    await mountedUntil(() => t.inputs.length === 1);
    const oldKey = hook.latest.queryKey, firstScope = authOf(oldKey)!;
    await hook.update(input(range(85), null));
    expect(hook.latest.data).toBeUndefined();
    expect(authOf(hook.latest.queryKey)).toBeNull();
    expect(c.getQueryState(oldKey)).toBeUndefined();
    await hook.update(input(range(85)));
    expect(hook.latest.data).toBeUndefined();
    expect(authOf(hook.latest.queryKey)!.epoch).toBeGreaterThan(firstScope.epoch);
    expect(t.inputs).toHaveLength(1);
    held.resolve(range(50).map((id) => row(id, 'Retired auth entry')));
    await mountedUntil(() => hook.latest.isSuccess);
    expect(t.inputs.map((ids) => ids[0])).toEqual([1, 1, 51]);
    expect(t.peak).toBe(1);
    expect(c.getQueryState(oldKey)).toBeUndefined();
    expect(hook.latest.data?.[1].bookedByAgentName).toBe('Fresh auth entry');
  });
});
