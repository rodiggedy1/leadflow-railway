import React from "react";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_BOOKING_PRICED_EXTRAS } from "../shared/publicBookingPricing";
import { bookingRescheduleDateSchema, bookingRescheduleTimeSchema, isRecurringBookingFrequency } from "../shared/bookingReschedule";

// Offline: execute actual UI/controller source with synthetic hooks and mutation
// spies, never importing a router, provider, database, browser or live service.
const BASELINE = "24dcd1b821b2f74392cd581a838e2590e21fc144";
const workspacePath = "client/src/components/NativeBookingsWorkspace.tsx";
const pagePath = "client/src/pages/BookingsCRMExactLive.tsx";
const amountPath = "client/src/components/NativeBookingAmountEditor.tsx";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const parse = (path: string, source = read(path)) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspaceAst = parse(workspacePath);
const pageAst = parse(pagePath);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
function findNode<T extends ts.Node>(ast: ts.Node, predicate: (node: ts.Node) => node is T): T {
  const found: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  if (found.length !== 1) throw new Error(`Expected one actual source node, found ${found.length}`);
  return found[0];
}
const variable = (ast: ts.SourceFile, name: string) => findNode(ast, (node): node is ts.VariableDeclaration =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
const arrow = (ast: ts.SourceFile, name: string) => {
  const initializer = variable(ast, name).initializer;
  if (!initializer || !ts.isArrowFunction(initializer)) throw new Error(`${name} must be the actual arrow`);
  return initializer.getText(ast);
};
const component = (name: string) => findNode(pageAst, (node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === name).getText(pageAst);
const cancelSchedule = findNode(variable(workspaceAst, "rescheduleChoice"), (node): node is ts.JsxAttribute =>
  ts.isJsxAttribute(node) && node.name.getText(workspaceAst) === "onCancel").initializer;
if (!cancelSchedule || !ts.isJsxExpression(cancelSchedule) || !cancelSchedule.expression) throw new Error("Missing actual modal cancellation handler");
const workspaceCode = compile([
  ...["requestScheduleSave", "confirmScheduleSave", "scheduleSaved", "updateActiveBookingDetails"].map(name => `const ${name} = ${arrow(workspaceAst, name)};`),
  "exports.save = updateActiveBookingDetails; exports.confirm = confirmScheduleSave;",
  `exports.cancel = ${cancelSchedule.expression.getText(workspaceAst)};`,
].join("\n"));
const amountCode = compile(read(amountPath));
const drawerCode = compile(`${component("NativeBookingCommercialEditor")}\n${component("BookingDetailDrawer")}\nexports.Commercial = NativeBookingCommercialEditor; exports.Drawer = BookingDetailDrawer;`);

const active = {
  key: "booking:71", source: "booking", id: 71, customerName: "Synthetic customer",
  customerPhone: "+15555550171", customerEmail: null, publicNumber: "BK-71",
  requestedLocalDate: "2026-11-20", requestedLocalTime: "09:00", recurrence: "weekly",
  firstCleaningTotalCents: 17549, originalFirstCleaningTotalCents: 22000,
  futureVisitTotalCents: 15000, manualAmountRevision: 3, companyNotes: "Original note",
  extras: [] as Array<{ id: string; label: string; quantity: number }>, specialRequestNotes: [],
  status: "confirmed", serviceName: "Synthetic cleaning", bedrooms: 1, bathrooms: 1,
  assignedTeamId: 9, assignedTeamName: "Synthetic team", paymentMethod: "card", paymentStatus: "authorized",
};
const input = { extras: [{ id: "synthetic-extra", quantity: 2 }], firstCleaningTotalCents: 26000, companyNotes: "Changed note" };
const amountResult = (command: any) => ({
  bookingId: command.bookingId, selectedDate: command.expectedDate, selectedJobId: 501,
  selectedChanged: true, selectedAmountCents: command.amountCents, manualAmountRevision: command.expectedRevision + 1,
  changedVisitCount: 1, changedJobCount: 1, protectedVisitCount: 0, protectedVisits: [],
  futureRuleChanged: command.scope === "subsequent", replayed: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function workspaceHarness(selection = { ...active }) {
  const events: string[] = [];
  const details = { isPending: false, mutateAsync: vi.fn(async (_command: any) => { events.push("details"); return {}; }) };
  const refresh = vi.fn(() => { events.push("refresh"); });
  const summary = vi.fn();
  const module = { exports: {} as { save: (input: any, options?: any) => void; confirm: (mode: string) => void; cancel: () => void } };
  let pendingState: { value: any } | undefined;
  const context: Record<string, any> = {
    exports: module.exports, Error, React, active: selection, activeSaveSelection: { current: selection },
    rescheduleDate: selection.requestedLocalDate, rescheduleTime: selection.requestedLocalTime,
    scheduleSavePending: false, pendingReschedule: null, bookingSaveInFlight: { current: false },
    updateBookingDetails: details, bookingRescheduleDateSchema, bookingRescheduleTimeSchema, isRecurringBookingFrequency,
    setBookingSavePending: vi.fn((pending: boolean) => { context.scheduleSavePending = pending; }),
    setPendingReschedule: vi.fn((pending: any) => { pendingState = { value: pending }; }),
    setImportSummary: summary, setDate: vi.fn(), refreshBookingAndFunnelQueries: refresh,
  };
  runInNewContext(workspaceCode, context, { timeout: 1500, filename: workspacePath });
  // React state setters do not overwrite the current event's closure snapshot.
  const event = (fn: (...args: any[]) => void, ...args: any[]) => {
    try { fn(...args); }
    finally { if (pendingState) { context.pendingReschedule = pendingState.value; pendingState = undefined; } }
  };
  return { save: (input: any, options?: any) => event(module.exports.save, input, options),
    confirm: (mode: string) => event(module.exports.confirm, mode), cancel: () => event(module.exports.cancel),
    context, details, refresh, summary, events,
    setTarget: (date: string, time: string) => { context.rescheduleDate = date; context.rescheduleTime = time; },
    select: (patch: Record<string, unknown>) => {
      context.active = { ...context.active, ...patch }; context.activeSaveSelection.current = context.active;
    },
  };
}

type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => elements(tree).find(node => node.type === "button" && text(node) === label)!;
// Stable setters and effect cleanup; each real component has its own hook slots.
function hooksRuntime() {
  const slots: Array<{ value?: any; setter?: (value: any) => void; deps?: any[]; cleanup?: () => void }> = [];
  let cursor = 0, dirty = false;
  let effects: Array<() => void> = [];
  const changed = (slot: typeof slots[number] | undefined, deps?: any[]) => !deps || !slot?.deps || deps.length !== slot.deps.length || deps.some((value, i) => !Object.is(value, slot.deps![i]));
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial,
        setter: next => { const value = typeof next === "function" ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) dirty = true; slots[index].value = value; },
      };
      return [slots[index].value, slots[index].setter];
    },
    useRef(initial: any) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(effect: () => void | (() => void), deps?: any[]) {
      const index = cursor++;
      if (changed(slots[index], deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps, cleanup };
        effects.push(() => { cleanup?.(); const next = effect(); slots[index].cleanup = typeof next === "function" ? next : undefined; });
      }
    },
  };
  return { hooks, begin: () => { cursor = 0; dirty = false; }, dirty: () => dirty,
    flush: () => { const pending = effects; effects = []; pending.forEach(run => run()); } };
}
function integrationHarness(selection = { ...active }, options: { amount?: (command: any) => Promise<any>; details?: (command: any) => Promise<any> } = {}) {
  const workspace = workspaceHarness(selection);
  if (options.details) workspace.details.mutateAsync.mockImplementation(options.details);
  const amountMutation = { isPending: false, mutateAsync: vi.fn(async (command: any) => {
    workspace.events.push("amount"); return options.amount ? options.amount(command) : amountResult(command);
  }) };
  const useMutation = vi.fn(() => amountMutation);
  const onEarlyRefresh = vi.fn(() => workspace.refresh());
  const runtimes = { drawer: hooksRuntime(), commercial: hooksRuntime(), amount: hooksRuntime() };
  const amountModule = { exports: {} as { NativeBookingAmountEditor: (props: any) => Element } };
  runInNewContext(amountCode, { exports: amountModule.exports, React, Error, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000071" },
    require: (id: string) => {
      if (id === "react") return { ...React, ...runtimes.amount.hooks };
      if (id === "@/lib/trpc") return { trpc: { bookings: { updateManualAmount: { useMutation } } } };
      throw new Error(`Unexpected live import: ${id}`);
    },
  }, { timeout: 1500 });
  // Drawer and commercial editor resolve different hook slots even though both
  // functions are extracted into the same VM, just as separate React instances.
  let currentHooks = runtimes.drawer.hooks;
  const components = Object.fromEntries(["BookingTeamMagicLink", "BookingPayrollPanel", "BookingPaymentActions", "PortalRequestPaymentActions"].map(name => [name, (props: any) => React.createElement(name, props)]));
  const icon = () => React.createElement("svg");
  const drawerModule = { exports: {} as { Drawer: (props: any) => Element; Commercial: (props: any) => Element } };
  runInNewContext(drawerCode, { exports: drawerModule.exports, React, Error,
    useState: (initial: any) => currentHooks.useState(initial), useRef: (initial: any) => currentHooks.useRef(initial),
    useEffect: (effect: any, deps?: any[]) => currentHooks.useEffect(effect, deps),
    NativeBookingAmountEditor: amountModule.exports.NativeBookingAmountEditor, PUBLIC_BOOKING_PRICED_EXTRAS, ...components,
    ...Object.fromEntries(["CalendarDays", "MapPin", "CreditCard", "ImageIcon", "Loader2", "Copy", "MessageCircle", "X"].map(name => [name, icon])),
    formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
    labelStatus: (value: string) => value, labelRecurrence: (value: string) => value, labelPaymentMethod: (value: string) => value,
    displayDate: (value: string) => value, displayTime: (value: string) => value,
    avatarColorFor: () => "#353535", initialsFor: () => "ST", getBookingArrivalWindowLabel: () => "9:00 AM",
  }, { timeout: 1500 });
  const model = {
    active: selection, staffSignoffQuery: { data: null, isLoading: false }, staffPhotosQuery: { isLoading: false },
    beforePhotos: [], afterPhotos: [], staffMessagesQuery: { isLoading: false }, staffMessages: [],
    assignBookingTeam: { isPending: false }, bookingTeamsQuery: { isLoading: false }, bookingTeams: [],
    customerMagicLink: { isPending: false }, detailQuery: { isFetching: false, refetch: vi.fn(async () => ({})) },
    updateBookingDetails: workspace.details, updateLeadflowJob: { isPending: false }, updateFunnelSchedule: { isPending: false },
    updatePortalSchedule: { isPending: false }, scheduleSavePending: false, bookingSavePending: false, cancellationPending: false,
    teamPortalLinkVersion: { current: 0 }, portalPaymentAvailable: false,
    rescheduleDate: selection.requestedLocalDate, rescheduleTime: selection.requestedLocalTime,
    updateActiveBookingDetails: vi.fn(workspace.save), copyCustomerMagicLink: vi.fn(), cancelActiveRecord: vi.fn(),
    updateActiveRecordSchedule: vi.fn(), refreshBookingAndFunnelQueries: onEarlyRefresh,
  };
  let drawerTree: Element, commercialTree: Element, amountTree: Element;
  const render = () => {
    model.active = workspace.context.active;
    model.rescheduleDate = workspace.context.rescheduleDate; model.rescheduleTime = workspace.context.rescheduleTime;
    model.scheduleSavePending = workspace.context.scheduleSavePending;
    for (let pass = 0; pass < 12; pass++) {
      Object.values(runtimes).forEach(runtime => runtime.begin());
      currentHooks = runtimes.drawer.hooks; drawerTree = drawerModule.exports.Drawer({ model });
      const commercial = elements(drawerTree).find(node => node.type === drawerModule.exports.Commercial)!;
      currentHooks = runtimes.commercial.hooks; commercialTree = drawerModule.exports.Commercial(commercial.props);
      const amount = elements(commercialTree).find(node => node.type === amountModule.exports.NativeBookingAmountEditor)!;
      amountTree = amountModule.exports.NativeBookingAmountEditor(amount.props);
      Object.values(runtimes).forEach(runtime => runtime.flush());
      if (!Object.values(runtimes).some(runtime => runtime.dirty())) return [drawerTree, commercialTree, amountTree];
    }
    throw new Error("Actual component integration did not settle");
  };
  const editAmount = (value: string) => {
    render(); elements(amountTree).find(node => node.type === "input" && node.props.inputMode === "decimal")!.props.onChange({ target: { value } }); render();
  };
  const editNotes = (value: string) => {
    render(); elements(commercialTree).find(node => node.type === "textarea")!.props.onChange({ target: { value } }); render();
  };
  const chooseAmountScope = (scope: string) => {
    render(); elements(amountTree).find(node => node.type === "input" && node.props.value === scope)!.props.onChange(); render();
  };
  const click = () => button(render(), "Save booking updates").props.onClick();
  return { workspace, model, amountMutation, useMutation, onEarlyRefresh, render, editAmount, editNotes, chooseAmountScope, click, components };
}

describe("one footer save executes actual workspace source", () => {
  it("preserves the default existing details mutation when callers omit options", async () => {
    const h = workspaceHarness(); h.save(input); await flush();
    expect(h.details.mutateAsync).toHaveBeenCalledOnce();
    expect(h.details.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, ...input });
    expect(h.events).toEqual(["details", "refresh"]);
    expect(h.summary).toHaveBeenLastCalledWith("Synthetic customer's booking updates were saved.");
  });

  it("runs amount-only beforeSubmit but ZERO legacy details mutations", async () => {
    const h = workspaceHarness(); const amount = vi.fn(async () => { h.events.push("amount"); return true; });
    h.save(input, { detailsChanged: false, beforeSubmit: amount }); await flush();
    expect(amount).toHaveBeenCalledOnce(); expect(h.details.mutateAsync).not.toHaveBeenCalled();
    expect(h.events).toEqual(["amount", "refresh"]);
  });

  it("does not mutate either amount or details for a no-op", async () => {
    const h = workspaceHarness(); h.save(input, { detailsChanged: false }); await flush();
    expect(h.details.mutateAsync).not.toHaveBeenCalled(); expect(h.events).not.toContain("amount");
  });

  it.each(["false", "throw"])("amount %s stops details and never reports success", async failure => {
    const h = workspaceHarness(); const amount = vi.fn(async () => { if (failure === "throw") throw new Error("Synthetic amount failure"); return false; });
    h.save(input, { detailsChanged: true, beforeSubmit: amount }); await flush();
    expect(amount).toHaveBeenCalledOnce(); expect(h.details.mutateAsync).not.toHaveBeenCalled();
    expect(h.summary.mock.calls.map(([message]) => message).join(" ")).not.toContain("were saved");
    expect(h.summary.mock.calls.at(-1)![0]).toMatch(/stopped|could not be saved/);
    expect(h.context.bookingSaveInFlight.current).toBe(false); expect(h.context.scheduleSavePending).toBe(false);
  });

  it("rejects duplicate clicks synchronously before React or mutation pending rerenders", async () => {
    const pending = deferred<boolean>(); const h = workspaceHarness(); const amount = vi.fn(() => pending.promise);
    h.save(input, { detailsChanged: true, beforeSubmit: amount });
    // Leave render-derived pending false: the synchronous ref must own the guard.
    h.context.scheduleSavePending = false;
    h.save(input, { detailsChanged: true, beforeSubmit: amount });
    expect(amount).toHaveBeenCalledOnce(); expect(h.details.mutateAsync).not.toHaveBeenCalled();
    pending.resolve(true); await flush(); expect(h.details.mutateAsync).toHaveBeenCalledOnce();
  });

  it.each([{ key: "booking:72", id: 72 }, { requestedLocalDate: "2026-11-21" }, { requestedLocalTime: "10:00" }])("blocks details after amount when selection/date/time shifts: %j", async patch => {
    const pending = deferred<boolean>(); const h = workspaceHarness(); const amount = vi.fn(() => pending.promise);
    h.save(input, { detailsChanged: true, beforeSubmit: amount }); h.select(patch); pending.resolve(true); await flush();
    expect(amount).toHaveBeenCalledOnce(); expect(h.details.mutateAsync).not.toHaveBeenCalled();
    expect(h.summary).toHaveBeenLastCalledWith("Amount saved. Other updates stopped because the selected booking changed.");
    expect(h.context.bookingSaveInFlight.current).toBe(false);
  });

  it("recurring schedule scope defers ALL writes; cancelling the actual modal writes nothing", async () => {
    const h = workspaceHarness(); const amount = vi.fn(async () => true);
    h.setTarget("2026-11-23", "14:30"); h.save(input, { detailsChanged: true, beforeSubmit: amount });
    expect(h.context.pendingReschedule).toMatchObject({ key: active.key, date: "2026-11-23", time: "14:30" });
    expect(amount).not.toHaveBeenCalled(); expect(h.details.mutateAsync).not.toHaveBeenCalled();
    h.cancel(); h.confirm("subsequent"); await flush();
    expect(h.context.pendingReschedule).toBeNull(); expect(amount).not.toHaveBeenCalled();
    expect(h.details.mutateAsync).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });

  it.each(["visit", "subsequent"])("approved recurring %s saves amount first and uses captured target date/time/mode", async mode => {
    const h = workspaceHarness(); const amount = vi.fn(async () => { h.events.push("amount"); return true; });
    h.setTarget("2026-11-23", "14:30"); h.save(input, { detailsChanged: false, beforeSubmit: amount });
    expect(h.events).toEqual([]);
    h.setTarget("2026-12-01", "18:00"); h.confirm(mode); await flush();
    expect(h.details.mutateAsync).toHaveBeenCalledOnce();
    expect(h.details.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, ...input, requestedLocalDate: "2026-11-23", requestedLocalTime: "14:30", rescheduleMode: mode });
    expect(h.events).toEqual(["amount", "details", "refresh"]);
    expect(h.context.setDate).toHaveBeenCalledWith("2026-11-23");
    expect(h.summary).toHaveBeenLastCalledWith("Synthetic customer's schedule was saved: 2026-11-23 at 14:30.");
  });
});

describe("actual drawer + commercial editor + amount controller integration", () => {
  it.each(["visit", "subsequent"])("one footer preserves arbitrary past completed booking %s amount edits without details writes", async scope => {
    const h = integrationHarness({ ...active, requestedLocalDate: "2000-01-01", status: "completed", paymentStatus: "captured" });
    const tree = h.render();
    expect(elements(tree).filter(node => node.type === "button" && text(node) === "Save booking updates")).toHaveLength(1);
    expect(button(tree, "Save amount")).toBeUndefined();
    h.editAmount("149.00"); h.chooseAmountScope(scope);
    expect(button(h.render(), "Save booking updates").props.disabled).toBe(false);
    expect(h.amountMutation.mutateAsync).not.toHaveBeenCalled();
    h.click(); await flush();
    expect(h.amountMutation.mutateAsync).toHaveBeenCalledOnce();
    expect(h.amountMutation.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, expectedDate: "2000-01-01", expectedAmountCents: 17549, expectedRevision: 3, amountCents: 14900, scope, requestId: "00000000-0000-4000-8000-000000000071" });
    expect(h.model.updateActiveBookingDetails.mock.calls[0][1]).toMatchObject({ detailsChanged: false, beforeSubmit: expect.any(Function) });
    expect(h.workspace.details.mutateAsync).not.toHaveBeenCalled(); expect(h.onEarlyRefresh).not.toHaveBeenCalled();
    expect(h.workspace.events).toEqual(["amount", "refresh"]); expect(h.useMutation).toHaveBeenCalledWith({ retry: false });
    expect(text(h.render())).toContain("This job's amount was saved as $149.00.");
  });

  it("mixed footer save waits for real amount completion, then details, then one refresh", async () => {
    const amountPending = deferred<any>(), detailsPending = deferred<any>();
    const h = integrationHarness({ ...active }, {
      amount: () => amountPending.promise,
      details: async () => { h.workspace.events.push("details"); return detailsPending.promise; },
    });
    h.editAmount("180.01"); h.editNotes("Changed note");
    const click = button(h.render(), "Save booking updates").props.onClick;
    click(); click();
    expect(h.amountMutation.mutateAsync).toHaveBeenCalledOnce(); expect(h.workspace.details.mutateAsync).not.toHaveBeenCalled();
    expect(h.workspace.refresh).not.toHaveBeenCalled(); expect(h.onEarlyRefresh).not.toHaveBeenCalled();
    amountPending.resolve(amountResult(h.amountMutation.mutateAsync.mock.calls[0][0])); await flush();
    expect(h.workspace.details.mutateAsync).toHaveBeenCalledOnce();
    expect(h.workspace.details.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, extras: [], firstCleaningTotalCents: 22000, companyNotes: "Changed note" });
    expect(h.workspace.refresh).not.toHaveBeenCalled(); expect(h.onEarlyRefresh).not.toHaveBeenCalled();
    detailsPending.resolve({}); await flush();
    expect(h.workspace.events).toEqual(["amount", "details", "refresh"]); expect(h.workspace.refresh).toHaveBeenCalledOnce();
  });

  it("details failure after real amount success truthfully reports partial failure without retrying", async () => {
    const h = integrationHarness({ ...active }, { details: async () => { throw new Error("Synthetic details failure"); } });
    h.editAmount("180.01"); h.editNotes("Changed note"); h.click(); await flush();
    expect(h.amountMutation.mutateAsync).toHaveBeenCalledOnce(); expect(h.workspace.details.mutateAsync).toHaveBeenCalledOnce();
    expect(h.workspace.summary).toHaveBeenLastCalledWith("Amount saved, but other booking updates could not be saved: Synthetic details failure");
    expect(h.workspace.summary.mock.calls.map(([message]) => message).join(" ")).not.toContain("were saved");
    expect(h.onEarlyRefresh).not.toHaveBeenCalled(); expect(h.workspace.refresh).toHaveBeenCalledOnce();
    expect(text(h.render())).toContain("This job's amount was saved as $180.01.");
    expect(h.workspace.context.bookingSaveInFlight.current).toBe(false);
  });

  it("actual recurring drawer writes neither draft until schedule approval, then amount before captured schedule", async () => {
    const h = integrationHarness(); h.editAmount("180.01"); h.editNotes("Changed note");
    h.workspace.setTarget("2026-11-23", "14:30"); h.click();
    expect(h.amountMutation.mutateAsync).not.toHaveBeenCalled(); expect(h.workspace.details.mutateAsync).not.toHaveBeenCalled();
    h.workspace.setTarget("2026-12-01", "18:00"); h.workspace.confirm("subsequent"); await flush();
    expect(h.amountMutation.mutateAsync.mock.calls[0][0]).toMatchObject({ expectedDate: "2026-11-20", amountCents: 18001, scope: "visit" });
    expect(h.workspace.details.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, extras: [], firstCleaningTotalCents: 22000, companyNotes: "Changed note", requestedLocalDate: "2026-11-23", requestedLocalTime: "14:30", rescheduleMode: "subsequent" });
    expect(h.workspace.events).toEqual(["amount", "details", "refresh"]); expect(h.onEarlyRefresh).not.toHaveBeenCalled();
  });

  it("actual clean drawer no-op calls no amount or details mutation", async () => {
    const h = integrationHarness(); h.click(); await flush();
    expect(h.amountMutation.mutateAsync).not.toHaveBeenCalled(); expect(h.workspace.details.mutateAsync).not.toHaveBeenCalled();
    expect(h.model.updateActiveBookingDetails.mock.calls[0][1]).toEqual({ detailsChanged: false, beforeSubmit: undefined });
  });
});

describe("protected owners remain byte-preserved from the approved baseline", () => {
  const baseline = (path: string) => execFileSync("git", ["show", `${BASELINE}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
  it("preserves copied-link, payment, server, pricing, and schema owner files exactly", () => {
    for (const path of ["client/src/components/BookingTeamMagicLink.tsx", "client/src/components/BookingPaymentActions.tsx", "client/src/components/PortalRequestPaymentActions.tsx", "server/bookingsRouter.ts", "shared/nativeBookingManualAmounts.ts", "shared/publicBookingPricing.ts", "shared/bookingReschedule.ts", "drizzle/schema.ts"]) {
      expect(readFileSync(new URL(`../${path}`, import.meta.url)).equals(baseline(path)), path).toBe(true);
    }
    const changedOwners = execFileSync("git", ["diff", "--name-only", BASELINE, "--", "server", "drizzle", "shared"], { encoding: "utf8" }).trim().split("\n").filter(path => path && !/\.(test|spec)\.ts$/.test(path));
    expect(changedOwners).toEqual([]);
  });

  it("preserves existing copied-link controller and payment/payroll/link JSX byte-for-byte", () => {
    const oldWorkspace = parse(workspacePath, baseline(workspacePath).toString());
    for (const name of ["customerMagicLink", "copyCustomerMagicLink"]) {
      expect(variable(workspaceAst, name).getText(workspaceAst)).toBe(variable(oldWorkspace, name).getText(oldWorkspace));
    }
    const oldPage = parse(pagePath, baseline(pagePath).toString());
    const nodes = (ast: ts.SourceFile, tag: string) => {
      const found: string[] = [];
      const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === tag) found.push(node.getText(ast)); ts.forEachChild(node, visit); };
      visit(ast); return found;
    };
    for (const tag of ["BookingPaymentActions", "PortalRequestPaymentActions", "BookingTeamMagicLink", "BookingPayrollPanel"]) {
      expect(nodes(pageAst, tag), tag).toEqual(nodes(oldPage, tag)); expect(nodes(pageAst, tag).length).toBeGreaterThan(0);
    }
  });
});
