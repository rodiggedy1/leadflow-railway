import express, { type Express, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import {
  registerWebsiteHeroLeadRoute,
  saveWebsiteHeroLead,
  WEBSITE_HERO_SOURCE,
} from "./websiteHeroLeadRoute";

// Never import the real database implementation (and its environment/pool code).
const database = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: database.getDb }));

type SaveInput = Parameters<typeof saveWebsiteHeroLead>[0];
type RouteOptions = NonNullable<Parameters<typeof registerWebsiteHeroLeadRoute>[1]>;
const endpoint = "/api/leads/website-hero";
const approvedOrigins = [
  "https://maidsweb-uhd9bbhv.manus.space",
  "https://maidsinblack.com",
  "https://www.maidsinblack.com",
  "https://wordpress-1428546-5340884.cloudwaysapps.com",
  "https://8328-iayvzs65tb8u6ytl8foku-0986f185.us5.manus.computer",
] as const;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const validBody = () => ({
  firstName: "  Jamie  ",
  phone: "(703) 555-1234",
  bedrooms: 2,
  bathrooms: 3,
  requestId,
  website: "",
  utmSource: "google",
  utmMedium: "cpc",
  utmCampaign: "spring-clean",
  utmContent: "hero-a",
  gclid: "local-test-click",
});
const success = { success: true, saved: true };
const errorBody = (error: string) => ({ success: false, saved: false, error });
let nextIp = 0;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Exercise Express Router.handle directly. No app.listen, HTTP server, supertest,
 * socket, DB connection, frontend, or application startup is involved.
 */
function harness(options: RouteOptions = {}, useRealSave = false) {
  const router = express.Router();
  const save = vi.fn<(input: SaveInput) => Promise<void>>().mockResolvedValue(undefined);
  const globalCors = vi.fn((_req: Request, _res: Response, next: () => void) => next());
  const globalParser = vi.fn((_req: Request, _res: Response, next: () => void) => next());
  registerWebsiteHeroLeadRoute(router as unknown as Express, {
    ...(!useRealSave ? { save } : {}),
    ...options,
  });
  // Existing global middleware must not receive requests owned by this route.
  router.use(globalCors);
  router.use(globalParser);

  function start(input: {
    method?: string;
    body?: unknown;
    raw?: string | Buffer;
    chunks?: Buffer[];
    origin?: string | null;
    contentType?: string | null;
    headers?: Record<string, string>;
    ip?: string;
    url?: string;
  } = {}) {
    const finished = deferred<void>();
    const headers: Record<string, string> = {};
    const responseHeaders: Record<string, string> = {};
    const origin = input.origin === undefined ? approvedOrigins[0] : input.origin;
    if (origin !== null) headers.origin = origin;
    const contentType = input.contentType === undefined ? "application/json" : input.contentType;
    if (contentType !== null) headers["content-type"] = contentType;
    for (const [key, value] of Object.entries(input.headers ?? {})) headers[key.toLowerCase()] = value;
    const payload = input.raw ?? JSON.stringify(input.body === undefined ? validBody() : input.body);
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (!("content-length" in headers) && !("transfer-encoding" in headers)) {
      headers["content-length"] = String(bytes.length);
    }
    const chunks = input.chunks ?? [bytes];
    const req = new Readable({
      read() {
        for (const chunk of chunks) this.push(chunk);
        this.push(null);
      },
    }) as Readable & Request;
    const ip = input.ip ?? `198.51.100.${++nextIp}`;
    Object.assign(req, {
      method: input.method ?? "POST", url: input.url ?? endpoint,
      originalUrl: input.url ?? endpoint, baseUrl: "", headers,
      query: {},
      rawHeaders: Object.entries(headers).flat(),
      socket: { remoteAddress: ip }, connection: { remoteAddress: ip },
      ip, ips: [], httpVersion: "1.1", httpVersionMajor: 1, httpVersionMinor: 1,
      get: (name: string) => headers[name.toLowerCase()],
      header: (name: string) => headers[name.toLowerCase()],
      is: express.request.is,
    });
    const capture = { status: 200, body: undefined as unknown, ended: false, headers: responseHeaders };
    const response = {
      locals: {}, statusCode: 200, headersSent: false, writableEnded: false,
      setHeader(name: string, value: unknown) { responseHeaders[name.toLowerCase()] = String(value); return this; },
      getHeader(name: string) { return responseHeaders[name.toLowerCase()]; },
      removeHeader(name: string) { delete responseHeaders[name.toLowerCase()]; },
      set(name: string | Record<string, unknown>, value?: unknown) {
        if (typeof name === "string") this.setHeader(name, value);
        else for (const [key, val] of Object.entries(name)) this.setHeader(key, val);
        return this;
      },
      header(name: string, value: unknown) { return this.setHeader(name, value); },
      get(name: string) { return this.getHeader(name); },
      vary(value: string) {
        const values = new Set((responseHeaders.vary ?? "").split(/,\s*/).filter(Boolean));
        values.add(value); responseHeaders.vary = [...values].join(", "); return this;
      },
      status(value: number) { this.statusCode = value; capture.status = value; return this; },
      json(body: unknown) { capture.body = body; return this.end(); },
      send(body?: unknown) { capture.body = body; return this.end(); },
      sendStatus(value: number) { this.status(value); return this.end(); },
      end(body?: unknown) {
        if (body !== undefined) capture.body = body;
        capture.status = this.statusCode;
        capture.ended = true; this.headersSent = true; this.writableEnded = true;
        finished.resolve(); return this;
      },
      on() { return this; }, once() { return this; }, emit() { return true; },
    };
    Object.assign(req, { res: response });
    Object.assign(response, { req });
    router.handle(req, response as unknown as Response, (error?: unknown) => {
      if (error) finished.reject(error);
      else if (!capture.ended) { capture.status = 599; capture.ended = true; finished.resolve(); }
    });
    return { capture, done: finished.promise, req };
  }
  async function request(input: Parameters<typeof start>[0] = {}) {
    const pending = start(input); await pending.done; return pending.capture;
  }
  return { save, request, start, globalCors, globalParser };
}

interface InsertRecord { table: unknown; values: Record<string, unknown> }
function transactionFake(options: {
  firstGate?: Promise<unknown>;
  secondGate?: Promise<unknown>;
  commitGate?: Promise<unknown>;
  failInsert?: number;
  failCommit?: boolean;
  sessionId?: number;
} = {}) {
  const staged: InsertRecord[] = [];
  const committed: InsertRecord[] = [];
  const state = { rollbacks: 0, commits: 0 };
  let inserted = 0;
  const insert = vi.fn((table: unknown) => ({
    values(values: Record<string, unknown>) {
      const index = ++inserted;
      staged.push({ table, values });
      const result = async () => {
        if (index === 1) await options.firstGate;
        if (index === 2) await options.secondGate;
        if (index === options.failInsert) throw new Error("LOCAL_TEST_INSERT_FAILURE");
        return [{ insertId: index === 1 ? options.sessionId ?? 781 : 990, affectedRows: 1 }, []];
      };
      // Support either Drizzle's awaited ResultSetHeader or $returningId API.
      return {
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => result().then(resolve, reject),
        $returningId: async () => {
          await result(); return [{ id: index === 1 ? options.sessionId ?? 781 : 990 }];
        },
      };
    },
  }));
  const transaction = vi.fn(async (callback: (tx: { insert: typeof insert }) => Promise<unknown>) => {
    const offset = staged.length;
    try {
      const result = await callback({ insert });
      await options.commitGate;
      if (options.failCommit) throw new Error("LOCAL_TEST_COMMIT_FAILURE");
      committed.push(...staged.slice(offset)); state.commits++;
      return result;
    } catch (error) { state.rollbacks++; throw error; }
  });
  database.getDb.mockResolvedValue({ transaction });
  return { insert, transaction, staged, committed, state };
}

beforeEach(() => { database.getDb.mockReset(); });

function expectError(response: Awaited<ReturnType<ReturnType<typeof harness>["request"]>>, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual(errorBody(code));
  const serialized = JSON.stringify(response.body);
  for (const value of ["Jamie", "703", requestId, "spring-clean", "local-test-click"]) {
    expect(serialized).not.toContain(value);
  }
}

 describe("website hero accepted captures", () => {
  it("trims name, normalizes the shared valid-US phone, and preserves every collected field", async () => {
    const h = harness(); const response = await h.request();
    expect(response.status).toBe(200); expect(response.body).toEqual(success);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0]).toMatchObject({ ...validBody(), firstName: "Jamie", phone: "+17035551234" });
    expect(h.globalCors).not.toHaveBeenCalled(); expect(h.globalParser).not.toHaveBeenCalled();
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it("does not send success while injected persistence is pending", async () => {
    const gate = deferred(); const save = vi.fn().mockReturnValue(gate.promise);
    const h = harness({ save }); const pending = h.start();
    await turn(); expect(save).toHaveBeenCalledTimes(1); expect(pending.capture.ended).toBe(false);
    gate.resolve(); await pending.done;
    expect(pending.capture.status).toBe(200); expect(pending.capture.body).toEqual(success);
  });

  it("returns only generic failure when save rejects, with no PII in response or logs", async () => {
    const logs = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {})];
    try {
      const h = harness({ save: vi.fn().mockRejectedValue(new Error(`Jamie +17035551234 ${requestId}`)) });
      expectError(await h.request(), 503, "SAVE_FAILED");
      const logText = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
      expect(logText).not.toContain("Jamie"); expect(logText).not.toContain("17035551234"); expect(logText).not.toContain(requestId);
    } finally { logs.forEach((spy) => spy.mockRestore()); }
  });

  it("accepts the exact same requestId and body repeatedly, invoking save each time", async () => {
    const h = harness(); const ip = "192.0.2.10";
    expect((await h.request({ ip })).body).toEqual(success);
    expect((await h.request({ ip })).body).toEqual(success);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("accepts the same requestId with different collected data, without conflict semantics", async () => {
    const h = harness();
    expect((await h.request()).body).toEqual(success);
    expect((await h.request({ body: { ...validBody(), bedrooms: 4 } })).body).toEqual(success);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce parallel duplicate attempts", async () => {
    const gate = deferred(); const save = vi.fn().mockReturnValue(gate.promise);
    const h = harness({ save }); const first = h.start(); const second = h.start();
    await turn(); expect(save).toHaveBeenCalledTimes(2);
    gate.resolve(); await Promise.all([first.done, second.done]);
    expect(first.capture.body).toEqual(success); expect(second.capture.body).toEqual(success);
  });

  it("allows a fresh save attempt after a rejected attempt with the same requestId", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("local failure")).mockResolvedValueOnce(undefined);
    const h = harness({ save });
    expectError(await h.request(), 503, "SAVE_FAILED");
    expect((await h.request()).body).toEqual(success); expect(save).toHaveBeenCalledTimes(2);
  });

  it.each(["7035551234", "703-555-1234", "+17035551234", "17035551234"])("normalizes accepted shared phone format %s", async (phone) => {
    const h = harness(); expect((await h.request({ body: { ...validBody(), phone } })).body).toEqual(success);
    expect(h.save.mock.calls[0][0].phone).toBe("+17035551234");
  });

  it("accepts minimum fields and every inclusive upper bound", async () => {
    const h = harness();
    const minimal = { firstName: "A", phone: "7035551234", bedrooms: 1, bathrooms: 1, requestId };
    expect((await h.request({ body: minimal })).body).toEqual(success);
    const maximal = { ...minimal, firstName: "A".repeat(100), phone: "7035551234" + " ".repeat(30), bedrooms: 4, bathrooms: 4, utmSource: "s".repeat(100), utmMedium: "m".repeat(100), utmCampaign: "c".repeat(255), utmContent: "t".repeat(255), gclid: "g".repeat(255) };
    expect((await h.request({ body: maximal })).body).toEqual(success);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
});

describe("website hero real save function with fully mocked getDb", () => {
  it("inserts one ordinary session and one existing new_lead card atomically, linking the inserted ID", async () => {
    const fake = transactionFake({ sessionId: 781 }); const h = harness({}, true);
    expect((await h.request()).body).toEqual(success);
    expect(fake.transaction).toHaveBeenCalledTimes(1); expect(fake.insert).toHaveBeenCalledTimes(2);
    expect(fake.committed).toHaveLength(2); expect(fake.state).toEqual({ commits: 1, rollbacks: 0 });
    const session = fake.committed.find((row) => row.table === conversationSessions)!.values;
    expect(WEBSITE_HERO_SOURCE).toBe("Website hero section");
    expect(session).toMatchObject({ leadName: "Jamie", leadPhone: "+17035551234", stage: "WIDGET_SIZING", bedrooms: "2 Bedrooms", bathrooms: "3 Bathrooms", leadSource: WEBSITE_HERO_SOURCE, messageHistory: "[]", aiMode: 0, utmSource: "google", utmMedium: "cpc", utmCampaign: "spring-clean", utmContent: "hero-a", gclid: "local-test-click" });
    expect(session.id).toBeUndefined();
    for (const field of ["email", "serviceType", "quotedPrice", "address", "selectedSlot", "bookedAt", "bookedAmount", "quoteLeadId", "lastAiMessageAt", "lastProcessedMessageId", "lastCustomerReplyAt", "lastMessageText"]) {
      expect(session[field] == null).toBe(true);
    }
    expect(session.stage).not.toBe("RESOLVED");
    const card = fake.committed.find((row) => row.table === opsChatMessages)!.values;
    expect(card.quickAction).toBe("new_lead");
    const metadata = typeof card.metadata === "string" ? JSON.parse(card.metadata) : card.metadata;
    expect(metadata).toMatchObject({ sessionId: 781 });
    expect(JSON.stringify(card)).toContain(WEBSITE_HERO_SOURCE);
    expect(h.globalCors).not.toHaveBeenCalled(); expect(h.globalParser).not.toHaveBeenCalled();
  });

  it("does not return success until both awaited inserts and transaction commit finish", async () => {
    const first = deferred(); const second = deferred(); const commit = deferred();
    const fake = transactionFake({ firstGate: first.promise, secondGate: second.promise, commitGate: commit.promise });
    const h = harness({}, true); const pending = h.start();
    await turn(); expect(fake.insert).toHaveBeenCalledTimes(1); expect(pending.capture.ended).toBe(false);
    first.resolve(); await turn(); expect(fake.insert).toHaveBeenCalledTimes(2); expect(pending.capture.ended).toBe(false);
    second.resolve(); await turn(); expect(fake.committed).toHaveLength(0); expect(pending.capture.ended).toBe(false);
    commit.resolve(); await pending.done;
    expect(pending.capture.body).toEqual(success); expect(fake.committed).toHaveLength(2);
  });

  it.each([1, 2])("rolls back the mocked transaction and returns no success when insert %i fails", async (failInsert) => {
    const fake = transactionFake({ failInsert }); const h = harness({}, true);
    expectError(await h.request(), 503, "SAVE_FAILED");
    expect(fake.committed).toHaveLength(0); expect(fake.state).toEqual({ commits: 0, rollbacks: 1 });
  });

  it("returns failure when transaction commit fails after both insert statements", async () => {
    const fake = transactionFake({ failCommit: true }); const h = harness({}, true);
    expectError(await h.request(), 503, "SAVE_FAILED");
    expect(fake.insert).toHaveBeenCalledTimes(2); expect(fake.committed).toHaveLength(0);
    expect(fake.state).toEqual({ commits: 0, rollbacks: 1 });
  });

  it("preserves singular room labels without fabricated service or price", async () => {
    const fake = transactionFake(); const h = harness({}, true);
    expect((await h.request({ body: { ...validBody(), bedrooms: 1, bathrooms: 1 } })).body).toEqual(success);
    const session = fake.committed.find((row) => row.table === conversationSessions)!.values;
    expect(session).toMatchObject({ bedrooms: "1 Bedroom", bathrooms: "1 Bathroom", stage: "WIDGET_SIZING" });
    const card = fake.committed.find((row) => row.table === opsChatMessages)!.values;
    expect(JSON.parse(card.metadata as string)).toMatchObject({ bedrooms: "1 Bedroom", bathrooms: "1 Bathroom", size: "1 Bedroom / 1 Bathroom" });
    expect(session.serviceType).toBeUndefined(); expect(session.quotedPrice).toBeUndefined();
  });

  it("handles an unavailable mocked database without pretending the capture was saved", async () => {
    database.getDb.mockResolvedValue(null); const h = harness({}, true);
    expectError(await h.request(), 503, "SAVE_FAILED");
  });

  it("performs new insert-only transactions for accepted duplicates, with no latest-phone lookup or update", async () => {
    const fake = transactionFake(); const h = harness({}, true);
    expect((await h.request()).body).toEqual(success); expect((await h.request()).body).toEqual(success);
    expect(fake.transaction).toHaveBeenCalledTimes(2); expect(fake.insert).toHaveBeenCalledTimes(4);
    expect(fake.committed.filter((row) => row.table === conversationSessions)).toHaveLength(2);
    expect(fake.committed.filter((row) => row.table === opsChatMessages)).toHaveLength(2);
  });
});

describe("website hero strict validation", () => {
  const invalid: Array<[string, unknown]> = [
    ["missing firstName", { ...validBody(), firstName: undefined }],
    ["blank firstName", { ...validBody(), firstName: "  " }],
    ["overlong firstName", { ...validBody(), firstName: "a".repeat(101) }],
    ["non-string firstName", { ...validBody(), firstName: 12 }],
    ["missing phone", { ...validBody(), phone: undefined }],
    ["numeric phone", { ...validBody(), phone: 7035551234 }],
    ["international phone", { ...validBody(), phone: "+442071234567" }],
    ["short phone", { ...validBody(), phone: "703555123" }],
    ["invalid area code", { ...validBody(), phone: "1035551234" }],
    ["invalid exchange", { ...validBody(), phone: "7031551234" }],
    ["phone exceeding 40 characters", { ...validBody(), phone: " ".repeat(31) + "7035551234" }],
    ["missing requestId", { ...validBody(), requestId: undefined }],
    ["bad UUID", { ...validBody(), requestId: "not-a-uuid" }],
    ["number requestId", { ...validBody(), requestId: 1 }],
    ["nonempty trap", { ...validBody(), website: "https://example.com" }],
    ["whitespace trap", { ...validBody(), website: " " }],
    ["non-string trap", { ...validBody(), website: false }],
    ["source override", { ...validBody(), source: "bark" }],
    ["leadSource override", { ...validBody(), leadSource: "widget" }],
    ["unknown field", { ...validBody(), extra: true }],
    ["array body", []],
    ...["bedrooms", "bathrooms"].flatMap((field) => [undefined, null, 0, 5, 1.5, "2", true, [], {}].map((value): [string, unknown] => [`${field} rejects ${JSON.stringify(value)}`, { ...validBody(), [field]: value }])),
    ...["utmSource", "utmMedium", "utmCampaign", "utmContent", "gclid"].flatMap((field) => {
      const max = field === "utmSource" || field === "utmMedium" ? 100 : 255;
      return [
        [`overlong ${field}`, { ...validBody(), [field]: "x".repeat(max + 1) }],
        [`non-string ${field}`, { ...validBody(), [field]: 123 }],
        [`null ${field}`, { ...validBody(), [field]: null }],
      ] as Array<[string, unknown]>;
    }),
  ];
  it.each(invalid)("rejects %s before persistence", async (_name, body) => {
    const h = harness(); expectError(await h.request({ body }), 400, "INVALID_INPUT");
    expect(h.save).not.toHaveBeenCalled(); expect(database.getDb).not.toHaveBeenCalled();
    expect(h.globalCors).not.toHaveBeenCalled(); expect(h.globalParser).not.toHaveBeenCalled();
  });

  it.each(["{", '{"firstName":', "not json", "null", '"hello"', "1"])("rejects malformed or strict-parser JSON %j without exposing parser detail", async (raw) => {
    const h = harness(); expectError(await h.request({ raw }), 400, "INVALID_JSON"); expect(h.save).not.toHaveBeenCalled();
  });

  it("enforces the 4KiB declared payload limit", async () => {
    const h = harness();
    expectError(await h.request({ headers: { "content-length": "4097" } }), 413, "PAYLOAD_TOO_LARGE");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("enforces the streamed byte limit without a declared content length", async () => {
    const h = harness(); const raw = " ".repeat(4097);
    expectError(await h.request({ raw, chunks: [Buffer.from(raw.slice(0, 2048)), Buffer.from(raw.slice(2048))], headers: { "transfer-encoding": "chunked" } }), 413, "PAYLOAD_TOO_LARGE");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("bounds bytes rather than Unicode code points", async () => {
    const h = harness(); const raw = JSON.stringify({ ...validBody(), padding: "界".repeat(1400) });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(4096);
    expectError(await h.request({ raw, headers: { "transfer-encoding": "chunked" } }), 413, "PAYLOAD_TOO_LARGE");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("allows a valid JSON payload exactly at 4096 bytes", async () => {
    const h = harness(); const json = JSON.stringify(validBody()); const raw = json + " ".repeat(4096 - Buffer.byteLength(json));
    expect(Buffer.byteLength(raw)).toBe(4096); expect((await h.request({ raw })).body).toEqual(success);
  });

  it.each([null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp"])("requires JSON Content-Type, rejecting %s", async (contentType) => {
    const h = harness(); expectError(await h.request({ contentType }), 415, "JSON_REQUIRED"); expect(h.save).not.toHaveBeenCalled();
  });

  it("accepts JSON with an explicit charset", async () => {
    const h = harness(); expect((await h.request({ contentType: "application/json; charset=utf-8" })).body).toEqual(success);
  });
});

describe("website hero restrictive local CORS and methods", () => {
  it.each(approvedOrigins)("accepts exact approved Origin %s", async (origin) => {
    const h = harness(); const response = await h.request({ origin });
    expect(response.body).toEqual(success); expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect((response.headers.vary ?? "").toLowerCase()).toContain("origin");
  });

  it.each([null, "null", "https://evil.example", "http://maidsinblack.com", "https://maidsinblack.com:444", "https://maidsinblack.com/", "https://maidsinblack.com.evil.example", "https://evilmaidsinblack.com", "https://maidsinblack.com@evil.example", "https://MAIDSINBLACK.com", "https://maidsinblack.com, https://evil.example"])("rejects non-exact or absent Origin %s", async (origin) => {
    const h = harness(); const response = await h.request({ origin });
    expectError(response, 403, "ORIGIN_NOT_ALLOWED"); expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled(); expect(h.globalCors).not.toHaveBeenCalled();
  });

  it("permits an explicitly configured future origin but not a matching suffix", async () => {
    const origin = "https://future-staging.example"; const h = harness({ additionalOrigins: [origin] });
    expect((await h.request({ origin })).body).toEqual(success);
    expectError(await h.request({ origin: `${origin}.evil.example` }), 403, "ORIGIN_NOT_ALLOWED");
    expectError(await harness().request({ origin }), 403, "ORIGIN_NOT_ALLOWED");
  });

  it.each(approvedOrigins)("handles valid POST/Content-Type preflight locally for %s", async (origin) => {
    const h = harness(); const response = await h.request({ method: "OPTIONS", origin, headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(response.status).toBe(204); expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-methods"]?.split(/,\s*/)).toContain("POST");
    expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toBe("content-type");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(h.save).not.toHaveBeenCalled(); expect(h.globalCors).not.toHaveBeenCalled(); expect(h.globalParser).not.toHaveBeenCalled();
  });

  it("handles case-insensitive Content-Type preflight header name", async () => {
    const h = harness(); const response = await h.request({ method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "Content-Type" } });
    expect(response.status).toBe(204); expect(h.save).not.toHaveBeenCalled();
  });

  it.each(["PUT", "GET", "DELETE"])("rejects unsupported preflight method %s", async (method) => {
    const h = harness(); const response = await h.request({ method: "OPTIONS", headers: { "access-control-request-method": method, "access-control-request-headers": "content-type" } });
    expectError(response, 403, "PREFLIGHT_NOT_ALLOWED"); expect(h.save).not.toHaveBeenCalled();
  });

  it.each(["authorization", "x-request-id", "content-type, authorization", "x-custom"])("rejects unapproved preflight header %s", async (headers) => {
    const h = harness(); const response = await h.request({ method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": headers } });
    expectError(response, 403, "PREFLIGHT_NOT_ALLOWED"); expect(h.save).not.toHaveBeenCalled();
  });

  it("rejects forbidden-origin preflight without reflecting its Origin", async () => {
    const h = harness(); const response = await h.request({ method: "OPTIONS", origin: "https://evil.example", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expectError(response, 403, "ORIGIN_NOT_ALLOWED"); expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD"])("rejects direct unsupported method %s locally", async (method) => {
    const h = harness(); const response = await h.request({ method });
    expectError(response, 405, "METHOD_NOT_ALLOWED"); expect(h.save).not.toHaveBeenCalled();
    expect(h.globalCors).not.toHaveBeenCalled(); expect(h.globalParser).not.toHaveBeenCalled();
  });

  it("leaves unrelated existing routes to their original global middleware", async () => {
    const h = harness(); const response = await h.request({ url: "/api/unrelated-existing-route" });
    expect(response.status).toBe(599); expect(h.globalCors).toHaveBeenCalledTimes(1); expect(h.globalParser).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled(); expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("website hero process-local best-effort rate limiting (not durable or distributed)", () => {
  it("allows five POST attempts per IP and rejects attempt six, then resets after 60 seconds", async () => {
    let now = 1_000_000; const h = harness({ now: () => now }); const ip = "192.0.2.30";
    for (let i = 0; i < 5; i++) expect((await h.request({ ip })).body).toEqual(success);
    expectError(await h.request({ ip }), 429, "RATE_LIMITED"); expect(h.save).toHaveBeenCalledTimes(5);
    now += 60_001;
    expect((await h.request({ ip })).body).toEqual(success); expect(h.save).toHaveBeenCalledTimes(6);
  });

  it("counts invalid POST attempts, not just successful saves", async () => {
    const h = harness({ now: () => 2_000_000 }); const ip = "192.0.2.31";
    for (let i = 0; i < 5; i++) expectError(await h.request({ ip, body: {} }), 400, "INVALID_INPUT");
    expectError(await h.request({ ip }), 429, "RATE_LIMITED"); expect(h.save).not.toHaveBeenCalled();
  });

  it("counts unsupported-content POST attempts", async () => {
    const h = harness({ now: () => 2_100_000 }); const ip = "192.0.2.34";
    for (let i = 0; i < 5; i++) expectError(await h.request({ ip, contentType: "text/plain" }), 415, "JSON_REQUIRED");
    expectError(await h.request({ ip }), 429, "RATE_LIMITED"); expect(h.save).not.toHaveBeenCalled();
  });

  it("tracks independent client IPs and does not accept spoofed forwarded headers as a fresh IP", async () => {
    const h = harness({ now: () => 3_000_000 }); const ip = "192.0.2.32";
    for (let i = 0; i < 5; i++) await h.request({ ip });
    expectError(await h.request({ ip, headers: { "x-forwarded-for": "203.0.113.1" } }), 429, "RATE_LIMITED");
    expect((await h.request({ ip: "192.0.2.33" })).body).toEqual(success);
  });

  it("does not consume POST allowance on OPTIONS preflights", async () => {
    const h = harness({ now: () => 4_000_000 }); const ip = "192.0.2.35";
    for (let i = 0; i < 6; i++) expect((await h.request({ ip, method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } })).status).toBe(204);
    for (let i = 0; i < 5; i++) expect((await h.request({ ip })).body).toEqual(success);
    expectError(await h.request({ ip }), 429, "RATE_LIMITED"); expect(h.save).toHaveBeenCalledTimes(5);
  });
});

describe("website hero capture-only dependency boundary", () => {
  it("keeps the exact client source label and puts hero cards in the existing web queue without importing the page", () => {
    const source = readFileSync(new URL("../client/src/pages/CommandChatExactLive.tsx", import.meta.url), "utf8");
    const labelHelper = source.slice(source.indexOf("function displayLeadSource("), source.indexOf("function nativeValue("));
    expect(labelHelper).toContain('if (normalized === "website hero section") return "Website hero section";');
    const cardHelper = source.slice(source.indexOf("function leadFromCommandMessage("), source.indexOf("function normalizedLeadPhone("));
    expect(cardHelper).toContain('"quote_form", "website hero section"].includes(sourceKey)');
    expect(cardHelper).toContain('sourceKey === "website hero section" ? "Website hero section"');
    expect(cardHelper).toContain('queue: isIncoming ? "incoming" : "web"');
  });

  it("imports only route infrastructure, schema, shared phone helpers, and the mocked DB entry point", () => {
    const source = readFileSync(new URL("./websiteHeroLeadRoute.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const allowed = new Set(["express", "zod", "./db", "../drizzle/schema", "./utils/phone", "node:crypto", "crypto"]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((name) => !allowed.has(name))).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    for (const forbidden of ["cleaner" + "Jobs", "cleaner" + "_jobs", "sendSms", "sendEmail", "invokeLLM", "broadcast", "processWidgetLead", "processQuoteLead", "alwaysOnEnrollments"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("declares a bounded 10,000-entry in-process map rather than claiming distributed replay protection", () => {
    const source = readFileSync(new URL("./websiteHeroLeadRoute.ts", import.meta.url), "utf8");
    expect(source).toMatch(/(?:10_000|10000)/);
    expect(source).toMatch(/\bnew Map\b/);
    expect(source).toMatch(/\.delete\(/);
  });
});
