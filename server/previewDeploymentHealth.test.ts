import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const base = "5231f45e90fa83761ecb3c68245c601c4f9ccc42";
const source = (file: string) => readFileSync(path.join(root, file), "utf8");
const original = (file: string) => execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" });
const config = JSON.parse(source("railway.json"));
const healthPath = config.environments.preview.deploy.healthcheckPath;

// Execute actual existing modules, replacing only unused external boundaries.
// No application bootstrap, database, provider or network request is loaded.
function load(file: string, imports: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  const code = transformSync(source(file), { loader: "ts", format: "cjs", target: "node22" }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, Date, TextEncoder, process,
    console: { log() {}, warn() {}, error() {} },
    require(name: string) {
      if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    },
  }, { filename: file });
  return module.exports;
}

function fixture() {
  const blocked = vi.fn(() => { throw new Error("Unexpected database/provider access"); });
  const timing = {
    beginInboxTimingRequest: () => null,
    observeInboxContext: (_batch: unknown, run: () => unknown) => run(),
    inboxTimingStage: (_name: string, run: () => unknown) => run(),
    serializeInboxTiming: (data: unknown, serialize: (value: unknown) => unknown) => serialize(data),
  };
  const sdk = load("server/_core/sdk.ts", {
    "@shared/const": { COOKIE_NAME: "health-fixture-session", AXIOS_TIMEOUT_MS: 1000 },
    "@shared/_core/errors": { ForbiddenError: (message: string) => new Error(message) },
    axios: { __esModule: true, default: { create: () => ({ post: blocked }) } },
    cookie: { parse: blocked },
    jose: { SignJWT: blocked, jwtVerify: blocked },
    "../db": new Proxy({}, { get: () => blocked }),
    "./env": { ENV: { oAuthServerUrl: "https://unused.invalid" } },
  });
  const context = load("server/_core/context.ts", {
    "./sdk": sdk,
    "./agentAuth": { getAgentFromRequest: blocked },
    "./commandChatInboxTiming": timing,
  });
  const trpc = load("server/_core/trpc.ts", {
    "@shared/const": { UNAUTHED_ERR_MSG: "not authenticated", NOT_ADMIN_ERR_MSG: "not admin" },
    "@trpc/server": { initTRPC, TRPCError },
    superjson: { __esModule: true, default: superjson },
    "./agentAuth": { getAgentFromRequest: blocked },
    "./cleanerAuth": { getCleanerFromRequest: blocked },
    "./commandChatInboxTiming": timing,
  });
  const system = load("server/_core/systemRouter.ts", {
    zod: { z },
    "./notification": { notifyOwner: blocked },
    "./trpc": trpc,
    "./env": { ENV: {} },
  });
  const router = trpc.router({ system: system.systemRouter });
  async function request(urlPath: string) {
    // Fetch adapter processes an in-memory Request; it never performs fetch().
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(`http://healthcheck.railway.app${urlPath}`),
      router,
      createContext: () => context.createContext({ req: { path: urlPath.split("?")[0], headers: {} }, res: { setHeader: blocked } }),
    });
  }
  return { request, blocked };
}

describe("Preview deployment liveness reuses the existing system health procedure", () => {
  it("changes only Preview health while leaving all root Production and startup settings unchanged", () => {
    const before = JSON.parse(original("railway.json"));
    const { environments, ...rootConfig } = config;
    expect(rootConfig).toEqual(before);
    expect(environments).toEqual({ preview: { deploy: { healthcheckPath: healthPath } } });
    expect(rootConfig.deploy.healthcheckPath).toBe("/api/health");
    expect(healthPath).not.toBe(rootConfig.deploy.healthcheckPath);
  });

  it("uses the exact existing public procedure and its Superjson input without authentication or batching", () => {
    const url = new URL(healthPath, "http://healthcheck.railway.app");
    expect(url.pathname).toBe("/api/trpc/system.health");
    expect(superjson.deserialize(JSON.parse(url.searchParams.get("input")!))).toEqual({ timestamp: 0 });
    expect([...url.searchParams.keys()]).toEqual(["input"]);
    expect(source("server/routers.ts")).toContain("system: systemRouter");
  });

  it("returns HTTP 200 through actual existing context and tRPC middleware, with zero database/provider calls", async () => {
    const { request, blocked } = fixture();
    const response = await request(healthPath);
    expect(response.status).toBe(200);
    expect(superjson.deserialize((await response.json()).result.data)).toEqual({ ok: true });
    expect(blocked).not.toHaveBeenCalled();
  });

  it.each(["true", "false"])("does not depend on cron state when PREVIEW_MODE=%s", async (mode) => {
    const prior = process.env.PREVIEW_MODE;
    process.env.PREVIEW_MODE = mode;
    try {
      const { request, blocked } = fixture();
      expect((await request(healthPath)).status).toBe(200);
      expect(blocked).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.PREVIEW_MODE;
      else process.env.PREVIEW_MODE = prior;
    }
  });

  it("rejects malformed input instead of returning a static success page", async () => {
    const { request, blocked } = fixture();
    const bad = "/api/trpc/system.health?input=" + encodeURIComponent(JSON.stringify(superjson.serialize({ timestamp: -1 })));
    expect((await request(bad)).status).toBe(400);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("does not treat an unregistered procedure as healthy", async () => {
    const { request } = fixture();
    expect((await request("/api/trpc/system.noSuchHealth")).status).toBe(404);
  });

  it("keeps the existing cron health handler, server setup, public form and payment paths byte-identical", () => {
    for (const file of [
      "server/_core/index.ts", "server/_core/context.ts", "server/_core/sdk.ts", "server/_core/trpc.ts",
      "server/_core/systemRouter.ts", "server/routers.ts", "server/bookingPaymentEngine.ts",
      "server/bookingCashAppEngine.ts", "client/src/pages/Book.tsx",
      "server/versioned-migrations/manifest.json", "drizzle/schema.ts",
    ]) expect(source(file), file).toBe(original(file));
  });
});
