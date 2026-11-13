import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/** Offline actual-page execution: synthetic queries only; every import is allowlisted. */
const root = resolve(import.meta.dirname, "..");
const pagePath = "client/src/pages/CleanerPortalConnected.tsx";
const control = "c41e77ecd3bacb0e17c4e8945835614492f74dcb";
const source = process.env.NOTES_TEST_CONTROL === "1"
  ? execFileSync("git", ["show", `${control}:${pagePath}`], { cwd: root, encoding: "utf8" })
  : readFileSync(resolve(root, pagePath), "utf8");

type Job = Record<string, any>;
const job = (overrides: Job = {}): Job => ({
  portalJobKey: "leadflow:701", customerName: "Synthetic Customer", customerPhone: "+12025550701",
  address: "701 Test Street", time: "12:30 PM", jobDate: "2026-11-13", serviceDateTime: "2026-11-13T17:30:00Z",
  bedrooms: 2, bathrooms: 1, extras: [], checklistItems: [], bookingStatus: "assigned", jobStatus: "assigned",
  jobIndex: 1, totalJobsToday: 1, basePay: 80, customerNotes: null, staffNotes: null, ...overrides,
});
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
function hooks() {
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  let effects: Array<() => void> = [];
  const changed = (left?: any[], right?: any[]) => !left || !right || left.length !== right.length || left.some((value, index) => !Object.is(value, right[index]));
  const runtime: any = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(factory: () => any, dependencies: any[]) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: factory() };
      return slots[index].value;
    },
    useCallback(callback: any, dependencies: any[]) { return runtime.useMemo(() => callback, dependencies); },
    useEffect(effect: () => void, dependencies?: any[]) {
      const index = cursor++;
      if (changed(slots[index], dependencies)) { slots[index] = dependencies; effects.push(effect); }
    },
  };
  return { runtime, render(component: () => any) {
    for (let pass = 0; pass < 12; pass++) {
      cursor = 0; dirty = false;
      const tree = component();
      const queued = effects; effects = []; queued.forEach(effect => effect());
      if (!dirty) return tree;
    }
    throw new Error("Synthetic portal failed to settle in 12 renders");
  } };
}
function execute(imports: Record<string, any>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, Date, Intl, URLSearchParams,
    window: { location: { search: "" } },
    require(id: string) {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".css")) return {};
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Offline portal rejected import: ${id}`);
    },
  });
  return module.exports.default;
}
function liveUpdates(react: any) {
  const load = (relative: string, globals: Record<string, any>) => {
    const module = { exports: {} as any };
    const text = readFileSync(resolve(root, relative), "utf8");
    const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, ...globals });
    return module.exports;
  };
  const writes: string[] = [];
  const broadcaster = load("server/cleanerPortalUpdates.ts", { setInterval: () => 0 });
  const streams: SyntheticStream[] = [];
  const timers: Array<() => void> = [];
  class SyntheticStream {
    listeners: Record<string, Array<(event: any) => void>> = {};
    onerror: (() => void) | null = null;
    unregister?: () => void;
    constructor(url: string, options: any) {
      expect(url).toBe("/api/cleaner-portal-stream");
      expect(options).toEqual({ withCredentials: true });
      streams.push(this);
    }
    addEventListener(name: string, callback: (event: any) => void) { (this.listeners[name] ??= []).push(callback); }
    emit(name: string, data: string) { this.listeners[name]?.forEach(callback => callback({ data })); }
    connect() {
      this.unregister = broadcaster.registerCleanerPortalClient({ write: (text: string) => {
        writes.push(text);
        const match = /^event: (.+)\ndata: (.+)\n\n$/.exec(text);
        if (match) this.emit(match[1], match[2]);
      }, flush: vi.fn() });
      this.emit("connected", "{}");
    }
    close() { this.unregister?.(); this.unregister = undefined; }
  }
  const hook = load("client/src/hooks/useCleanerPortalUpdates.ts", {
    EventSource: SyntheticStream, setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; }, clearTimeout: vi.fn(),
    require: (id: string) => { if (id === "react") return react; throw new Error(`Live hook rejected import: ${id}`); },
  });
  return { hook, writes, streams, broadcast: () => broadcaster.broadcastCleanerPortalJobsChanged(),
    connect: () => streams.at(-1)!.connect(),
    reconnect: () => { streams.at(-1)!.onerror?.(); const retry = timers.shift(); expect(retry).toBeDefined(); retry!(); streams.at(-1)!.connect(); },
  };
}
function portal(day: "today" | "tomorrow" = "today", automatic = false) {
  const runtime = hooks();
  const rows: Record<string, any> = {
    "cleaner.me": { id: 9, name: "Synthetic Cleaner", language: "en" },
    "cleanerPortalReadOnly.getMyJobsToday": [job()],
    "cleanerPortalReadOnly.getMyJobsTomorrow": [job({ portalJobKey: "leadflow:702", jobDate: "2026-11-14" })],
    "cleanerPortalReadOnly.getMyJobsWeek": [],
  };
  const savedRows: Record<string, any> = { ...rows };
  const live = automatic ? liveUpdates(runtime.runtime) : null;
  const refetches: Record<string, ReturnType<typeof vi.fn>> = {};
  const mutations: Record<string, any> = {};
  let updateCallbacks: { onJobsChanged: () => void };
  const trpc = new Proxy({}, { get(_target, router: string) {
    if (router === "useUtils") return () => ({});
    return new Proxy({}, { get(_target, procedure: string) {
      const key = `${router}.${procedure}`;
      return {
        useQuery: () => ({ data: rows[key], refetch: refetches[key] ??= vi.fn(async () => {
          if (automatic) rows[key] = savedRows[key];
          return { data: rows[key] };
        }), isLoading: false, isError: false }),
        useMutation: () => mutations[key] ??= { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
      };
    } });
  } });
  const imports = {
    react: runtime.runtime, "lucide-react": new Proxy({}, { get: () => () => null }),
    sonner: { toast: new Proxy({}, { get: () => vi.fn() }) }, "@/lib/trpc": { trpc },
    "@/hooks/useCleanerPortalUpdates": live?.hook ?? { useCleanerPortalUpdates: (callbacks: any) => { updateCallbacks = callbacks; } },
  };
  const Component = execute(imports);
  let tree: any;
  const render = () => tree = runtime.render(() => Component());
  render();
  if (day === "tomorrow") {
    const tab = elements(tree).find(node => node.type === "button" && node.props.role === "tab" && node.props.children?.[0] === "Tomorrow ");
    expect(tab).toBeDefined(); tab.props.onClick(); render();
  }
  const card = elements(tree).find(node => typeof node.type === "function" && node.type.name === "JobCard");
  expect(card).toBeDefined();
  if (day === "tomorrow") card.props.onViewTomorrowDetails(); else card.props.onOpen();
  render();
  const drawer = () => {
    const name = day === "tomorrow" ? "TomorrowJobDetailsDrawer" : "JobDrawer";
    const result = elements(tree).find(node => typeof node.type === "function" && node.type.name === name);
    expect(result).toBeDefined(); return result;
  };
  const listKey = `cleanerPortalReadOnly.getMyJobs${day === "today" ? "Today" : "Tomorrow"}`;
  return {
    rows, listKey, mutations, refetches, render, drawer, live, savedRows,
    async settle() { for (let count = 0; count < 6; count++) await Promise.resolve(); render(); },
    async refresh(values: Job[]) { rows[listKey] = values; updateCallbacks!.onJobsChanged(); await Promise.resolve(); await Promise.resolve(); render(); },
    markup() {
      // Render the actual drawer with real React hooks and the same synthetic queries.
      const Drawer = execute({ ...imports, react: React });
      void Drawer;
      const current = drawer();
      const module = { exports: {} as any };
      const name = day === "tomorrow" ? "TomorrowJobDetailsDrawer" : "JobDrawer";
      const code = ts.transpileModule(`${source}\nexport { ${name} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      runInNewContext(code, { module, exports: module.exports, Date, Intl, URLSearchParams,
        require(id: string) {
          if (id === "react/jsx-runtime") return jsxRuntime;
          if (id.endsWith(".css")) return {};
          if (id === "react") return React;
          if (Object.hasOwn(imports, id)) return (imports as any)[id];
          throw new Error(`Offline drawer rejected import: ${id}`);
        },
      });
      return renderToStaticMarkup(React.createElement(module.exports[name], current.props));
    },
  };
}

describe("open cleaner portal visit notes follow actual refreshed query data", () => {
  it("reproduces the two unrelated source-contract failures against the untouched released control", () => {
    const releasedRead = (absolute: string) => {
      const relative = absolute.slice(root.length + 1);
      if (!absolute.startsWith(root + "/") || relative.includes("..")) throw new Error("Rejected control source path");
      return execFileSync("git", ["show", `${control}:${relative}`], { cwd: root, encoding: "utf8" });
    };
    const failures: string[] = [];
    for (const file of ["server/cleanerPortalNativeOwnershipContract.test.ts", "server/cleanerPortalTomorrowViewContract.test.ts"]) {
      const cases: Array<{ name: string; run: () => void }> = [];
      const oldSource = releasedRead(resolve(root, file)).replaceAll("import.meta.dirname", JSON.stringify(resolve(root, "server")));
      const code = ts.transpileModule(oldSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      runInNewContext(code, { exports: {}, require(id: string) {
        if (id === "node:fs") return { readFileSync: releasedRead, default: { readFileSync: releasedRead } };
        if (id === "node:path") return { default: { resolve, join } };
        if (id === "vitest") return { describe: (_name: string, run: () => void) => run(), it: (name: string, run: () => void) => cases.push({ name, run }), expect };
        throw new Error(`Control rejected import: ${id}`);
      } });
      for (const test of cases) {
        try { test.run(); } catch { failures.push(test.name); }
      }
    }
    expect(failures).toEqual([
      "uses the same ownership resolver for reads and every native portal action",
      "uses an isolated read-only exact-tomorrow query with the authenticated cleaner's team ownership",
    ]);
  });
  it.each(["today", "tomorrow"] as const)("shows newly added notes in the already-open %s drawer after the existing refresh hint", async day => {
    const p = portal(day);
    const old = p.drawer().props.job;
    expect(old.customerNotes).toBeNull();
    const updated = { ...old, customerNotes: "Use the side entrance\nDog stays upstairs", staffNotes: "Synthetic dispatch detail" };
    await p.refresh([updated]);
    expect(p.drawer().props.job.customerNotes).toBe(updated.customerNotes);
    expect(p.drawer().props.job.staffNotes).toBe(updated.staffNotes);
    expect(p.refetches[p.listKey]).toHaveBeenCalledTimes(1);
    expect(p.markup()).toContain("Use the side entrance");
    expect(p.markup()).toContain("Dog stays upstairs");
    expect(p.markup()).toContain("Synthetic dispatch detail");
    for (const mutation of Object.values(p.mutations)) expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it.each(["today", "tomorrow"] as const)("replaces and clears notes in the open %s drawer without resurrecting the opening snapshot", async day => {
    const p = portal(day);
    const original = p.drawer().props.job;
    await p.refresh([{ ...original, customerNotes: "First saved note", staffNotes: "Staff note" }]);
    expect(p.drawer().props.job.customerNotes).toBe("First saved note");
    await p.refresh([{ ...original, customerNotes: "Replacement note", staffNotes: null }]);
    expect(p.drawer().props.job.customerNotes).toBe("Replacement note");
    expect(p.drawer().props.job.staffNotes).toBeNull();
    await p.refresh([{ ...original, customerNotes: null, staffNotes: null }]);
    expect(p.drawer().props.job.customerNotes).toBeNull();
    expect(p.drawer().props.job.staffNotes).toBeNull();
    expect(p.markup()).not.toContain("Visit notes");
  });
  it.each(["today", "tomorrow"] as const)("matches the exact portal key and changes only notes and extras for %s", async day => {
    const p = portal(day);
    const old = p.drawer().props.job;
    await p.refresh([
      { ...old, portalJobKey: "leadflow:999", customerNotes: "Another booking must not leak" },
      { ...old, customerNotes: "Correct exact visit", staffNotes: null, address: "Unrelated changed address", time: "9:00 AM", basePay: 999, jobStatus: "completed", extras: ["unrelated-extra"] },
    ]);
    expect(p.drawer().props.job).toEqual({ ...old, customerNotes: "Correct exact visit", staffNotes: null, extras: ["unrelated-extra"] });
    expect(p.markup()).not.toContain("Another booking must not leak");
    await p.refresh([{ ...old, portalJobKey: "leadflow:999", customerNotes: "No exact match" }]);
    expect(p.drawer().props.job).toEqual(old);
  });
  it("keeps the established local progress overlay while Today notes refresh", async () => {
    const p = portal();
    const old = p.drawer().props.job;
    p.drawer().props.onProgress({ jobStatus: "in_progress", etaTimestamp: 123, etaTimeStr: "12:45 PM" });
    p.render();
    await p.refresh([{ ...old, customerNotes: "Fresh instructions", jobStatus: "assigned" }]);
    expect(p.drawer().props.job).toMatchObject({ customerNotes: "Fresh instructions", jobStatus: "in_progress", etaTimestamp: 123, etaTimeStr: "12:45 PM" });
    expect(p.markup()).toContain("Fresh instructions");
    expect(p.markup()).toContain("Start job");
  });
});

describe("saved notes and services update through the actual live hint without manual refresh", () => {
  it.each(["today", "tomorrow"] as const)("updates additions, replacements and removals in the already-open %s booking", async day => {
    const p = portal(day, true);
    const opening = p.drawer().props.job;
    p.live!.connect(); await p.settle();
    for (const details of [
      { customerNotes: "Saved entry instructions", staffNotes: null, extras: ["inside-oven"] },
      { customerNotes: "Edited entry instructions", staffNotes: null, extras: ["inside-fridge", "carpet-cleaning"] },
      { customerNotes: null, staffNotes: null, extras: [] },
    ]) {
      p.savedRows[p.listKey] = [{ ...opening, ...details }];
      p.live!.broadcast(); await p.settle();
      expect(p.drawer().props.job).toEqual({ ...opening, ...details });
      if (details.customerNotes) expect(p.markup()).toContain(details.customerNotes);
      for (const extra of details.extras) expect(p.markup()).toContain(extra.replaceAll("_", " "));
    }
    expect(p.live!.writes).toHaveLength(3);
    for (const text of p.live!.writes) expect(text).toBe('event: cleaner_portal_update\ndata: {"type":"jobs_changed"}\n\n');
    for (const mutation of Object.values(p.mutations)) expect(mutation.mutate).not.toHaveBeenCalled();
    p.live!.streams.forEach(stream => stream.close());
  });
  it("catches a saved change before the first stream connection and catches missed changes on reconnect", async () => {
    const p = portal("today", true);
    const opening = p.drawer().props.job;
    p.savedRows[p.listKey] = [{ ...opening, customerNotes: "Saved before subscription", extras: ["inside-oven"] }];
    p.live!.broadcast();
    expect(p.drawer().props.job).toEqual(opening);
    p.live!.connect(); await p.settle();
    expect(p.drawer().props.job).toMatchObject({ customerNotes: "Saved before subscription", extras: ["inside-oven"] });
    p.live!.streams.at(-1)!.close();
    p.savedRows[p.listKey] = [{ ...opening, customerNotes: "Saved while disconnected", extras: ["inside-fridge"] }];
    p.live!.broadcast();
    p.live!.reconnect(); await p.settle();
    expect(p.drawer().props.job).toMatchObject({ customerNotes: "Saved while disconnected", extras: ["inside-fridge"] });
    p.live!.streams.forEach(stream => stream.close());
  });
});
