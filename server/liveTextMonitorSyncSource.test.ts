import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { launch27Subdomain: "offline-fixture", launch27BearerToken: "offline-test-token" },
}));

import { getCompletedBookingsForDate } from "./launch27";
import {
  LIVE_TEXT_SYNC_SOURCE_LIMITS,
  LiveTextSyncSourceError,
  readLiveTextSyncSource,
  type LiveTextSyncSourceDependencies,
  type LiveTextSyncSourceFailure,
} from "./liveTextMonitorSyncSource";

const DATE = "2026-11-13";
const originalGlobalFetch = globalThis.fetch;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const booking = (id = 1): Record<string, unknown> => ({
  id, service_date: "2026-11-13T10:00:00-05:00", booking_status: "assigned", completed: false,
  phone: "+1 202 555 0100",
  user: { id: 8, first_name: "Offline", last_name: "Fixture", name: "Offline Fixture", email: "fixture@example.invalid", is_stripe_card: true, stripe_customer_id: "cus_offline" },
  frequency: { id: 1, name: "Monthly (10%OFF)" },
  address: { full_address: "100 Fixture Street", city: "Washington", state: "DC", zip: "20001" },
  summary: { total: 215.25, revenue: 200.25, tip: 15 },
  teams: [{ id: 7, title: "Fixture Team", share: 55, bg_color: "#112233" }],
  services: [{ id: 1, name: "2 bedrooms", price: 200.25, extras: [{ id: 82, name: "Clean Inside Oven" }, { id: 999, name: "Custom add-on" }], pricing_parameters: [{ id: 4, name: "Bathrooms", quantity: 2, price: 10, total: 20 }, { id: 80, name: "Inside Empty Fridge", quantity: 1, price: 10, total: 10 }] }],
  customer_notes: "Offline customer note", staff_notes: "Offline staff note", preferred_cleaner: { id: 7, name: "Fixture Team" },
  payment_method_info: { brand: "visa", last4: "4242" },
  charges: { onhold: [{ id: 99, amount: 12.34 }, { id: 100, amount: 0.01 }], outstanding: 2.55 },
});
const fullPage = (start = 1) => Array.from({ length: 20 }, (_, index) => booking(start + index));
function transport(pages: unknown[]) {
  let index = 0;
  return vi.fn<typeof fetch>(async () => {
    if (index >= pages.length) throw new Error("unexpected extra request");
    return new Response(JSON.stringify(pages[index++]), { status: 200 });
  });
}

async function failure(pages: unknown[], expected: LiveTextSyncSourceFailure = "SOURCE_INCOMPLETE", dependencies: Omit<LiveTextSyncSourceDependencies, "request"> = {}) {
  const request = transport(pages);
  await expect(readLiveTextSyncSource(DATE, { request, ...dependencies })).rejects.toMatchObject({ name: "LiveTextSyncSourceError", code: expected, message: expected });
  return request;
}

afterEach(async () => {
  expect(globalThis.fetch).toBe(originalGlobalFetch);
  await tick();
});

describe("readLiveTextSyncSource offline all-or-nothing source", () => {
  it("uses only serial GETs with exact target day, pagination, abort and redirect guards", async () => {
    const request = transport([fullPage(), [booking(21)]]);
    const result = await readLiveTextSyncSource(DATE, { request });
    expect(result).toMatchObject({ date: DATE, fetched: 21 });
    expect(result.error).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    for (const [index, call] of request.mock.calls.entries()) {
      const [input, init] = call;
      const url = new URL(input as string);
      expect(url.origin).toBe("https://offline-fixture.launch27.com");
      expect(url.pathname).toBe("/v1/staff/bookings");
      expect(Object.fromEntries(url.searchParams)).toEqual({ from: DATE, to: DATE, limit: "20", offset: String(index * 20), sort: "asc" });
      expect(url.searchParams.has("options")).toBe(false);
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer offline-test-token" });
    }
  });

  it("returns the exact existing mapping, currency conversion and card metadata without provider writes", async () => {
    const raw = booking();
    const direct = await getCompletedBookingsForDate(DATE, { includeAll: true, request: transport([[raw]]) });
    const request = transport([[raw]]);
    const guarded = await readLiveTextSyncSource(DATE, { request });
    expect(guarded).toEqual(direct);
    expect(guarded.bookings[0]).toMatchObject({ id: 1, bedrooms: 2, bathrooms: 2, totalRevenue: 215.25, baseRevenue: 200.25, hasStripeCard: true, stripeCustomerId: "cus_offline", paymentBrand: "visa", paymentLast4: "4242", chargesOnHoldCents: 1235, chargesOutstandingCents: 255, extras: ["clean_inside_oven", "custom_add_on", "clean_inside_empty_fridge"] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).toBe("GET");
  });

  it("accepts a valid empty first page", async () => {
    const request = transport([[]]);
    await expect(readLiveTextSyncSource(DATE, { request })).resolves.toEqual({ date: DATE, fetched: 0, bookings: [] });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("accepts a terminal empty page after a full page at the row bound", async () => {
    const request = transport([fullPage(), []]);
    const result = await readLiveTextSyncSource(DATE, { request, limits: { maxRows: 20, maxPages: 2 } });
    expect(result.fetched).toBe(20);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([{}, null, "not an array", 7, false])("rejects a non-array first page: %j", async value => { await failure([value]); });
  it.each([{}, null, "not an array", 7, false])("rejects a non-array last page after valid rows: %j", async value => {
    const request = await failure([fullPage(), value]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429, 500])("sanitizes HTTP %s without reading or returning the server body and never retries", async status => {
    const text = vi.fn();
    const request = vi.fn<typeof fetch>(async () => {
      const response = new Response("SECRET_TOKEN fixture@example.invalid private server body", { status });
      response.text = text;
      return response;
    });
    await expect(readLiveTextSyncSource(DATE, { request })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", message: "SOURCE_UNAVAILABLE" });
    expect(text).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("discards valid earlier pages after an HTTP failure", async () => {
    let calls = 0;
    const request = vi.fn<typeof fetch>(async () => ++calls === 1 ? new Response(JSON.stringify(fullPage())) : new Response("private body", { status: 429 }));
    await expect(readLiveTextSyncSource(DATE, { request })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("sanitizes thrown network diagnostics and does not retry", async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error("SECRET_TOKEN fixture@example.invalid"); });
    try {
      await readLiveTextSyncSource(DATE, { request });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LiveTextSyncSourceError);
      expect((error as Error).message).toBe("SOURCE_UNAVAILABLE");
      expect(JSON.stringify(error)).not.toMatch(/SECRET_TOKEN|fixture@example|cause/);
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled fetch at its page deadline", async () => {
    let signal: AbortSignal | null | undefined;
    const request = vi.fn<typeof fetch>((_, init) => new Promise((_, reject) => {
      signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new Error("private abort detail")), { once: true });
    }));
    await expect(readLiveTextSyncSource(DATE, { request, limits: { pageTimeoutMs: 20 } })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(signal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled response body at the whole-read deadline", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("[")); } })));
    await expect(readLiveTextSyncSource(DATE, { request, limits: { totalTimeoutMs: 20 } })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("rejects another simultaneous read without making its request", async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
    const first = readLiveTextSyncSource(DATE, { request });
    const secondRequest = transport([[]]);
    await expect(readLiveTextSyncSource(DATE, { request: secondRequest })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(secondRequest).not.toHaveBeenCalled();
    finish(new Response("[]"));
    await expect(first).resolves.toMatchObject({ fetched: 0 });
  });

  it("keeps the concurrency guard until an abort-ignoring transport settles", async () => {
    let finish!: (response: Response) => void;
    const firstRequest = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
    await expect(readLiveTextSyncSource(DATE, { request: firstRequest, limits: { pageTimeoutMs: 20 } })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    const second = transport([[]]);
    await expect(readLiveTextSyncSource(DATE, { request: second })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(second).not.toHaveBeenCalled();
    finish(new Response("[]"));
    await tick();
    await expect(readLiveTextSyncSource(DATE, { request: second })).resolves.toMatchObject({ fetched: 0 });
  });

  it.each(["2026-02-29", "2026-11-31", "2026-13-01", "2026-00-10", "0000-01-01", "2026-1-13", " 2026-11-13", "2026-11-13T00:00:00Z"]) ("rejects strict calendar input %s before requests", async date => {
    const request = transport([[]]);
    await expect(readLiveTextSyncSource(date, { request })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts leap days and matches service instants to Eastern rather than their written day", async () => {
    const leap = { id: 1, service_date: "2028-02-29T10:00:00-05:00", booking_status: "completed" };
    await expect(readLiveTextSyncSource("2028-02-29", { request: transport([[leap]]) })).resolves.toMatchObject({ fetched: 1 });
    const crossUtcMidnight = { ...booking(), service_date: "2026-11-14T01:00:00Z" };
    await expect(readLiveTextSyncSource(DATE, { request: transport([[crossUtcMidnight]]) })).resolves.toMatchObject({ fetched: 1 });
    const summer = { id: 2, service_date: "2026-07-06T03:30:00Z", booking_status: "assigned" };
    await expect(readLiveTextSyncSource("2026-07-05", { request: transport([[summer]]) })).resolves.toMatchObject({ fetched: 1 });
  });

  it.each(["2026-11-13", "2026-11-13T10:00", "2026-11-13T10:00:00", "2026-11-13T10:00:00.000", "2026-11-13 10:00:00"])("preserves exact valid date-only/local Eastern source %s without guessing offset/time", async service_date => {
    const result = await readLiveTextSyncSource(DATE, { request: transport([[{ ...booking(), service_date }]]) });
    expect(result.bookings[0].serviceDate).toBe(service_date);
  });

  it.each([undefined, null, "2026-11-14", "2026-11-14T10:00", "2026-11-14T10:00:00-05:00", "2026-11-13T00:00:00Z", "2026-02-30T10:00:00Z", "2026-11-13T24:00:00Z", "2026-11-13T10:00:00+15:00", "2026-11-13T10:60:00Z", "2026-11-13T24:00", "2026-11-13T10:60", "2026-02-30", "2026-11-13T10:00:60", "2026-11-13T1:00"]) ("rejects missing, malformed or wrong-Eastern-day service_date %j", async service_date => { await failure([[{ ...booking(), service_date }]]); });

  it.each([undefined, null, "", "invented", 1, "ASSIGNED"]) ("rejects missing or unknown booking_status %j, never using mapper defaults", async booking_status => { await failure([[{ ...booking(), booking_status }]]); });

  it.each([0, -1, 1.2, "1", null, undefined, Number.MAX_SAFE_INTEGER + 1])("rejects invalid booking IDs %j", async id => { await failure([[{ ...booking(), id }]]); });
  it("rejects repeated IDs within and across pages", async () => {
    await failure([[booking(1), booking(1)]]);
    const request = await failure([fullPage(), [booking(20)]]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { user: [] }, { user: "bad" }, { user: { first_name: 1 } }, { user: { is_stripe_card: "true" } }, { user: { stripe_customer_id: {} } },
    { address: false }, { address: { zip: 20001 } }, { frequency: 7 }, { preferred_cleaner: [] }, { completed: "false" },
    { phone: 2025550100 }, { customer_notes: {} }, { staff_notes: [] }, { summary: [] }, { summary: { total: "215.25" } },
    { summary: { revenue: {} } }, { teams: {} }, { teams: [null] }, { teams: [{ id: 7, title: 42 }] }, { teams: [{ id: "7", title: "bad" }] },
    { teams: [{ id: 7, title: "bad", share: "55" }] }, { services: {} }, { services: [null] }, { services: [{ id: 1, name: 2 }] },
    { services: [{ id: 1, name: "service", pricing_parameters: "[]" }] }, { services: [{ id: 1, name: "service", pricing_parameters: [null] }] },
    { services: [{ id: 1, name: "service", pricing_parameters: [{ name: 4 }] }] }, { services: [{ id: 1, name: "service", pricing_parameters: [{ name: "Bathroom", quantity: "2" }] }] },
    { services: [{ id: 1, name: "service", extras: true }] }, { services: [{ id: 1, name: "service", extras: [null] }] }, { services: [{ id: 1, name: "service", extras: [{ id: "82" }] }] },
    { payment_method_info: [] }, { payment_method_info: { brand: 1 } }, { payment_method_info: { last4: 4242 } }, { payment_method_info: { last4: "42" } },
    { charges: "bad" }, { charges: { onhold: {} } }, { charges: { onhold: [null] } }, { charges: { onhold: [{ amount: "12.34" }] } },
    { charges: { outstanding: "2.55" } }, { charges: { outstanding: Number.MAX_VALUE } },
  ])("rejects mapper-unsafe optional structure or coercive metadata %j", async override => { await failure([[{ ...booking(), ...override }]]); });

  it("rejects malformed JSON and nonfinite JSON numeric literals", async () => {
    for (const text of ["[", "[] trailing", '[{"id":1,"service_date":"2026-11-13T10:00:00-05:00","booking_status":"assigned","summary":{"total":1e400}}]']) {
      const request = vi.fn<typeof fetch>(async () => new Response(text));
      await expect(readLiveTextSyncSource(DATE, { request })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
    }
  });

  it("rejects numeric overflow in parsed bedrooms, summed bathrooms and on-hold cents", async () => {
    await failure([[{ ...booking(), services: [{ id: 1, name: `${"9".repeat(400)} bedrooms` }] }]]);
    await failure([[{ ...booking(), services: [{ id: 1, name: "service", pricing_parameters: [{ name: "Bathroom", quantity: Number.MAX_VALUE }, { name: "Bathroom", quantity: Number.MAX_VALUE }] }] }]]);
    await failure([[{ ...booking(), charges: { onhold: [{ amount: Number.MAX_VALUE }] } }]]);
  });

  it.each(["Clean inside oven", '[{"id":82}]', { first: { id: 82 } }])("preserves accepted label/JSON/object extras encoding %j", async extras => {
    const raw = { ...booking(), services: [{ id: 1, name: "service", extras }] };
    const direct = await getCompletedBookingsForDate(DATE, { includeAll: true, request: transport([[raw]]) });
    await expect(readLiveTextSyncSource(DATE, { request: transport([[raw]]) })).resolves.toEqual(direct);
  });

  it("permits genuinely absent/null optional metadata without changing valid defaults", async () => {
    const minimal = { id: 1, service_date: "2026-11-13T10:00:00-05:00", booking_status: "unassigned", user: null, services: null, teams: null, charges: null, payment_method_info: null };
    const result = await readLiveTextSyncSource(DATE, { request: transport([[minimal]]) });
    expect(result.bookings[0]).toMatchObject({ bookingStatus: "unassigned", serviceDate: minimal.service_date, teams: [], serviceNames: [], hasStripeCard: false, paymentLast4: null, chargesOnHoldCents: 0 });
  });

  it("bounds page rows and total rows", async () => {
    await failure([[...fullPage(), booking(21)]]);
    const request = await failure([fullPage(), [booking(21)]], "SOURCE_INCOMPLETE", { limits: { maxRows: 20 } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the same 500-source-booking limit as persistence and requires its terminal page", async () => {
    expect(LIVE_TEXT_SYNC_SOURCE_LIMITS.maxRows).toBe(500);
    expect(LIVE_TEXT_SYNC_SOURCE_LIMITS.maxPages).toBe(26);
    const pages = Array.from({ length: 25 }, (_, index) => fullPage(1 + index * 20));
    const request = transport([...pages, []]);
    const result = await readLiveTextSyncSource(DATE, { request });
    expect(result.fetched).toBe(500); expect(result.bookings).toHaveLength(500);
    expect(request).toHaveBeenCalledTimes(26);
  });
  it("discards the entire 500-row prefix when the next page contains a 501st source booking", async () => {
    const pages = Array.from({ length: 25 }, (_, index) => fullPage(1 + index * 20));
    const request = await failure([...pages, [booking(501)]]);
    expect(request).toHaveBeenCalledTimes(26);
  });

  it("bounds page count without requesting another page or declaring partial success", async () => {
    const request = await failure([fullPage()], "SOURCE_INCOMPLETE", { limits: { maxPages: 1 } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds each serialized body, including an untrusted huge body that is not parsed", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(" ".repeat(256) + "[]"));
    await expect(readLiveTextSyncSource(DATE, { request, limits: { maxPageBytes: 128 } })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
  });

  it("bounds total serialized bytes across pages", async () => {
    const first = fullPage();
    const maxTotalBytes = new TextEncoder().encode(JSON.stringify(first)).byteLength + 1;
    const request = await failure([first, []], "SOURCE_INCOMPLETE", { limits: { maxTotalBytes } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("measures UTF-8 bytes rather than string character counts", async () => {
    const text = JSON.stringify([{ ...booking(), staff_notes: "é".repeat(100) }]);
    const request = vi.fn<typeof fetch>(async () => new Response(text));
    await expect(readLiveTextSyncSource(DATE, { request, limits: { maxPageBytes: text.length } })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
  });

  it("cannot increase or disable production limits", async () => {
    for (const value of [0, -1, 1.5, Infinity, LIVE_TEXT_SYNC_SOURCE_LIMITS.maxPages + 1]) {
      const request = transport([[]]);
      await expect(readLiveTextSyncSource(DATE, { request, limits: { maxPages: value } })).rejects.toMatchObject({ code: "SOURCE_INCOMPLETE" });
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("has no DB/provider write dependencies, global patching, retries or service triggers", () => {
    const source = readFileSync(new URL("./liveTextMonitorSyncSource.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:db|Router|stripe|openphone|cron|scheduler)[^"']*["']/i);
    expect(source).not.toMatch(/global(?:This)?\.fetch\s*=|\bdb\.(?:insert|update|delete)\(|method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/);
    expect(source).toContain("getCompletedBookingsForDate(date, { includeAll: true, request: validatedFetch })");
  });
});
