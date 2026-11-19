import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../client/src/components/BookingTeamMagicLink.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../client/src/main.tsx", import.meta.url), "utf8");
const freshnessOptions = '{ enabled, staleTime: 0, refetchOnMount: "always" }';
const originalOptions = "{ enabled }";
const origin = "https://quote.maidinblack.com";
type BookingSource = "booking" | "leadflow";
type Profile = { source: BookingSource; id: number; cleanerProfileId: number; teamName: string };
type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const button = (tree: Element) => elements(tree).find(node => node.type === "button")!;
const urlFields = (tree: Element) => elements(tree).filter(node => node.type === "a" || node.type === "input");
const text = (tree: unknown): string => typeof tree === "string" ? tree : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";

function transpile(input: string) {
  return ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
}

// Evaluate only the application's QueryClient options, not main.tsx or its side effects.
// Keep the real inherited retry policy, including its existing no-retry 403 branch;
// do not introduce retry tuning, fake clocks, timer advances or alternate query defaults.
function applicationQueryOptions(): ConstructorParameters<typeof QueryClient>[0] {
  const file = ts.createSourceFile("main.tsx", main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "queryClient" && node.initializer && ts.isNewExpression(node.initializer)) {
      expression = node.initializer.arguments?.[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!expression) throw new Error("Application QueryClient options not found");
  const module = { exports: {} };
  runInNewContext(transpile(`module.exports = ${expression.getText(file)};`), { module, exports: module.exports, TRPCClientError }, { timeout: 1500 });
  return module.exports;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Bounded event-loop drains: no browser, polling timer, retry-delay override or clock mutation.
async function settleUntil(predicate: () => boolean) {
  for (let turn = 0; turn < 30; turn++) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(predicate(), "QueryObserver did not settle within 30 event-loop turns").toBe(true);
}

function harness(bookingSource: BookingSource, componentSource = source) {
  const client = new QueryClient(applicationQueryOptions());
  const assignmentVersionRef = { current: 0 };
  const props = { source: bookingSource, id: 71, assignedTeamName: "Same-name team", assignmentVersionRef };
  const input = { source: bookingSource, id: 71 };
  const queryKey = [["bookings", "teamPortalProfile"], { input, type: "query" }] as const;
  const oldProfile: Profile = { ...input, cleanerProfileId: 501, teamName: props.assignedTeamName };
  const freshProfile: Profile = { ...oldProfile, cleanerProfileId: 502 };
  const refresh = deferred<Profile>();
  let authoritativeProfile = 501;
  const profileRead = vi.fn(() => authoritativeProfile === 501 ? Promise.resolve(oldProfile) : refresh.promise);
  const clipboard = { writeText: vi.fn(async (_url: string) => {}) };
  const open = vi.fn();
  const mutation = {
    isPending: false,
    mutateAsync: vi.fn(async (payload: { cleanerProfileId: number; origin: string }) => ({
      url: `https://synthetic.invalid/profile/${payload.cleanerProfileId}`,
      cleanerName: "Same-name team",
    })),
  };
  const queryCalls: Array<{ input: unknown; options: unknown }> = [];
  const mounts: Array<{ unmount: () => void }> = [];
  const output = transpile(componentSource);

  function mount() {
    let observer: QueryObserver<Profile> | undefined;
    let unsubscribe: (() => void) | undefined;
    let unmounted = false;
    const slots: any[] = [];
    const cleanups: Array<() => void> = [];
    let cursor = 0;
    let renders = 0;
    const hooks = { ...React,
      useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next: any) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      // The actual component's only effect is its [] mount/unmount guard.
      useEffect(create: () => (() => void) | void, deps: unknown[]) {
        if (deps.length !== 0) throw new Error("Harness supports only the actual component's mount effect");
        const i = cursor++;
        if (!(i in slots)) { slots[i] = true; const cleanup = create(); if (cleanup) cleanups.push(cleanup); }
      },
    };
    const useQuery = (actualInput: typeof input, actualOptions: any) => {
      expect(actualInput).toEqual(input);
      queryCalls.push({ input: actualInput, options: actualOptions });
      // Crucial correction to the confirmed repro: the component's actual options
      // drive the installed observer on creation AND on each subsequent render.
      const observerOptions = { queryKey, queryFn: profileRead, ...actualOptions };
      if (!observer) {
        observer = new QueryObserver<Profile>(client, observerOptions);
        unsubscribe = observer.subscribe(() => {});
      } else {
        observer.setOptions(observerOptions);
      }
      return observer.getCurrentResult();
    };
    const module = { exports: {} as { BookingTeamMagicLink: (p: typeof props) => Element } };
    runInNewContext(output, { module, exports: module.exports, React, Error,
      navigator: { clipboard }, window: { open },
      require: (id: string) => {
        if (id === "react") return hooks;
        if (id === "lucide-react") return { Copy: () => null, Loader2: () => null, ExternalLink: () => null };
        // Only synthetic profile read and the unchanged cleaner engine are available.
        if (id === "@/lib/trpc") return { trpc: {
          bookings: { teamPortalProfile: { useQuery } },
          cleaner: { getMagicLink: { useMutation: () => mutation } },
        } };
        throw new Error(`Unexpected import: ${id}`);
      },
    }, { timeout: 1500 });
    const mounted = {
      render() {
        if (unmounted || ++renders > 30) throw new Error("Invalid/unbounded component render");
        cursor = 0;
        return module.exports.BookingTeamMagicLink(props);
      },
      snapshot() { if (!observer) throw new Error("Render before taking a snapshot"); return observer.getCurrentResult(); },
      unmount() { if (!unmounted) { unmounted = true; cleanups.forEach(cleanup => cleanup()); unsubscribe?.(); } },
    };
    mounts.push(mounted);
    return mounted;
  }

  return {
    client, queryKey, input, oldProfile, freshProfile, props, refresh, profileRead, clipboard, mutation, open, queryCalls, mount,
    reassign() {
      // Native assignment changes its version; imported list/key remount keeps
      // the same displayed name. Neither scenario invalidates this query here.
      if (bookingSource === "booking") assignmentVersionRef.current++;
      authoritativeProfile = 502;
    },
    cleanup() { mounts.forEach(mounted => mounted.unmount()); client.clear(); },
  };
}

async function seedThenRemount(h: ReturnType<typeof harness>) {
  expect(h.client.getDefaultOptions().queries?.staleTime).toBe(120000);
  const first = h.mount();
  expect(button(first.render()).props.disabled).toBe(true);
  await settleUntil(() => !first.snapshot().isFetching);
  expect(first.snapshot().data).toEqual(h.oldProfile);
  expect(button(first.render()).props.disabled).toBe(false);
  expect(h.profileRead).toHaveBeenCalledTimes(1);
  first.unmount();
  h.reassign();
  const cached = h.client.getQueryCache().find({ queryKey: h.queryKey })!;
  expect(Date.now() - cached.state.dataUpdatedAt).toBeLessThan(120000);
  expect(cached.isStaleByTime(120000)).toBe(false);
  expect(cached.state.data).toEqual(h.oldProfile);
  const second = h.mount();
  return { second, tree: second.render() };
}

async function expectBlocked(h: ReturnType<typeof harness>, tree: Element) {
  expect(button(tree).props.disabled).toBe(true);
  // Even direct invocation of the disabled control cannot enter the cleaner engine.
  await button(tree).props.onClick();
  expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  expect(h.clipboard.writeText).not.toHaveBeenCalled();
  expect(h.open).not.toHaveBeenCalled();
  expect(urlFields(tree)).toHaveLength(0);
}

function originalOptionControl() {
  expect(source.split(freshnessOptions)).toHaveLength(2);
  const control = source.replace(freshnessOptions, originalOptions);
  // The control differs ONLY in the approved query freshness options.
  expect(control.replace(originalOptions, freshnessOptions)).toBe(source);
  return control;
}

describe("Assigned-team portal account cache remount regression (actual component + installed query observer)", () => {
  it("limits the query-options edit to exact freshness, without incidental retry or other link-flow changes", () => {
    const control = originalOptionControl();
    expect(source).toContain(`useQuery({ source, id }, ${freshnessOptions})`);
    expect(control).toContain(`useQuery({ source, id }, ${originalOptions})`);
  });

  it.each(["booking", "leadflow"] as const)("%s remount reads fresh account 502 inside the inherited 120000ms cache window and blocks Copy while refresh is held", async bookingSource => {
    const h = harness(bookingSource);
    try {
      const { second, tree } = await seedThenRemount(h);
      expect(h.profileRead).toHaveBeenCalledTimes(2);
      expect(h.queryCalls.at(-1)).toEqual({ input: h.input, options: { enabled: true, staleTime: 0, refetchOnMount: "always" } });
      expect(second.snapshot().data?.cleanerProfileId).toBe(501);
      expect(second.snapshot().isFetching).toBe(true);
      await expectBlocked(h, tree);
      await expectBlocked(h, second.render());
      expect(h.profileRead).toHaveBeenCalledTimes(2);
      h.refresh.resolve(h.freshProfile);
      await settleUntil(() => !second.snapshot().isFetching);
      expect(second.snapshot().data).toEqual(h.freshProfile);
      expect(second.snapshot().error).toBeNull();
      const fresh = second.render();
      expect(urlFields(fresh)).toHaveLength(0);
      expect(button(fresh).props.disabled).toBe(false);
      await button(fresh).props.onClick();
      expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
      expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ cleanerProfileId: 502, origin });
      expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(h.clipboard.writeText).toHaveBeenCalledWith("https://synthetic.invalid/profile/502");
      const displayed = second.render();
      const anchor = elements(displayed).find(node => node.type === "a")!;
      expect(anchor.props.href).toBe("https://synthetic.invalid/profile/502");
      expect(anchor.props.target).toBe("_blank");
      expect(anchor.props.rel).toBe("noopener noreferrer");
      expect(text(anchor)).toBe("Open portal");
      expect(elements(displayed).find(node => node.type === "input")?.props.value).toBe("https://synthetic.invalid/profile/502");
      expect(text(displayed)).not.toContain("profile/501");
      expect(h.open).not.toHaveBeenCalled();
      expect(h.profileRead).toHaveBeenCalledTimes(2);
    } finally { h.cleanup(); }
  });

  it.each(["booking", "leadflow"] as const)("%s failed remount refresh retains cached 501 but never enables Copy, cleaner engine, clipboard or Open URL", async bookingSource => {
    const h = harness(bookingSource);
    try {
      const { second, tree } = await seedThenRemount(h);
      expect(h.profileRead).toHaveBeenCalledTimes(2);
      expect(second.snapshot().isFetching).toBe(true);
      await expectBlocked(h, tree);
      // Application's real 403 policy stops retry; no test-level retry/timer tuning.
      const error = new TRPCClientError("Synthetic assigned-team profile refresh denied", { result: { error: { data: { httpStatus: 403 } } } } as any);
      h.refresh.reject(error);
      await settleUntil(() => !second.snapshot().isFetching);
      expect(second.snapshot().isFetching).toBe(false);
      expect(second.snapshot().error).toBe(error);
      expect(second.snapshot().data).toEqual(h.oldProfile);
      expect(h.client.getQueryData(h.queryKey)).toEqual(h.oldProfile);
      expect(h.profileRead).toHaveBeenCalledTimes(2);
      const failed = second.render();
      expect(text(failed)).toContain(error.message);
      await expectBlocked(h, failed);
      await expectBlocked(h, second.render());
      expect(h.profileRead).toHaveBeenCalledTimes(2);
    } finally { h.cleanup(); }
  });

  it.each(["booking", "leadflow"] as const)("%s original-options-only source control reproduces the wrong cached 501 account rather than accidentally hardcoding candidate observer options", async bookingSource => {
    const h = harness(bookingSource, originalOptionControl());
    try {
      const { second, tree } = await seedThenRemount(h);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(h.queryCalls.at(-1)).toEqual({ input: h.input, options: { enabled: true } });
      expect(h.profileRead).toHaveBeenCalledTimes(1);
      expect(second.snapshot().isFetching).toBe(false);
      expect(second.snapshot().data?.cleanerProfileId).toBe(501);
      expect(button(tree).props.disabled).toBe(false);
      await button(tree).props.onClick();
      expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
      expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ cleanerProfileId: 501, origin });
      expect(h.clipboard.writeText).toHaveBeenCalledWith("https://synthetic.invalid/profile/501");
      expect(elements(second.render()).find(node => node.type === "a")?.props.href).toBe("https://synthetic.invalid/profile/501");
      expect(h.open).not.toHaveBeenCalled();
    } finally { h.cleanup(); }
  });
});
