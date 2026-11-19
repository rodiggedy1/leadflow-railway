import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_BOOKING_PRICED_EXTRAS } from "../shared/publicBookingPricing";
import type { UpdateNativeBookingManualAmountResult } from "../shared/nativeBookingManualAmounts";

// Actual component source + stable synthetic props/hooks only. No router, DB,
// browser, auth/provider, network, payment, message or model imports/calls.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const amountSource = read("client/src/components/NativeBookingAmountEditor.tsx");
const page = read("client/src/pages/BookingsCRMExactLive.tsx");
const workspaceSource = read("client/src/components/NativeBookingsWorkspace.tsx");
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const amountCode = compile(amountSource);
const ast = ts.createSourceFile("BookingsCRMExactLive.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const componentSource = (name: string) => ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(ast);

type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => elements(tree).find(node => node.type === "button" && text(node) === label)!;
const amountInput = (tree: unknown) => elements(tree).find(node => node.type === "input" && node.props.inputMode === "decimal")!;
const radio = (tree: unknown, value: string) => elements(tree).find(node => node.type === "input" && node.props.type === "radio" && node.props.value === value)!;
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
const REQUEST = "00000000-0000-4000-8000-000000000071";
const active = {
  key: "booking:71", source: "booking", id: 71, requestedLocalDate: "2026-11-20",
  recurrence: "weekly", firstCleaningTotalCents: 17549, futureVisitTotalCents: 15000,
  originalFirstCleaningTotalCents: 22000, originalFutureVisitTotalCents: 18000,
  manualAmountRevision: 3, extras: [], companyNotes: "Original note",
};
const drawerActive = {
  ...active, status: "confirmed", requestedLocalTime: "09:00", serviceName: "Synthetic cleaning",
  specialRequestNotes: [], customerName: "Synthetic customer", customerPhone: "+15555550171",
  publicNumber: "BK-71", assignedTeamName: "Synthetic team", assignedTeamId: 9, bedrooms: 1, bathrooms: 1,
};
const amountIdentity = (selection: typeof active) => JSON.stringify([selection.key, selection.source, selection.id, selection.requestedLocalDate, selection.firstCleaningTotalCents, selection.manualAmountRevision ?? 0, selection.recurrence]);
const response = (overrides: Partial<UpdateNativeBookingManualAmountResult> = {}): UpdateNativeBookingManualAmountResult => ({
  bookingId: 71, selectedDate: "2026-11-20", selectedJobId: 501,
  selectedChanged: true, selectedAmountCents: 18001, manualAmountRevision: 4,
  changedVisitCount: 1, changedJobCount: 1, protectedVisitCount: 0,
  protectedVisits: [], futureRuleChanged: false, replayed: false, ...overrides,
});
function hooksRuntime() {
  const slots: Array<{ value?: any; deps?: any[]; cleanup?: () => void }> = [];
  let cursor = 0;
  let dirty = false;
  let effects: Array<() => void> = [];
  const changed = (slot: typeof slots[number] | undefined, deps?: any[]) => !deps || !slot?.deps || deps.length !== slot.deps.length || deps.some((v, i) => !Object.is(v, slot.deps![i]));
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, (next: any) => { const value = typeof next === "function" ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) dirty = true; slots[i].value = value; }]; },
    useRef(initial: any) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value; },
    useMemo(factory: () => any, deps: any[]) { const i = cursor++; if (changed(slots[i], deps)) slots[i] = { value: factory(), deps }; return slots[i].value; },
    useEffect(effect: () => void | (() => void), deps?: any[]) { const i = cursor++; if (changed(slots[i], deps)) { const cleanup = slots[i]?.cleanup; slots[i] = { deps, cleanup }; effects.push(() => { cleanup?.(); const next = effect(); slots[i].cleanup = typeof next === "function" ? next : undefined; }); } },
  };
  let lastPasses = 0;
  const render = (renderComponent: () => any) => {
    for (let pass = 1; pass <= 12; pass++) {
      dirty = false; cursor = 0;
      const tree = renderComponent();
      const pending = effects; effects = []; pending.forEach(run => run());
      if (!dirty) { lastPasses = pass; return tree; }
    }
    throw new Error("Synthetic component did not settle with stable props");
  };
  return { hooks, render, passes: () => lastPasses, unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}
function harness(options: { mutation?: any; result?: UpdateNativeBookingManualAmountResult; initial?: typeof active; reload?: () => unknown } = {}) {
  const runtime = hooksRuntime();
  const mutation = options.mutation ?? { isPending: false, mutateAsync: vi.fn(async () => options.result ?? response()) };
  const onAmountUpdated = vi.fn();
  const onReload = vi.fn(options.reload ?? (() => {}));
  const saveControlRef = { current: null as null | { identity: string; dirty: boolean; canSave: boolean; save: (options?: { deferRefresh?: boolean }) => Promise<boolean> } };
  const onSaveStateChange = vi.fn();
  const uuid = vi.fn(() => REQUEST);
  const useMutation = vi.fn(() => mutation);
  const module = { exports: {} as { NativeBookingAmountEditor: (props: any) => Element; parseNativeBookingAmount: (value: string) => number | null; formatNativeBookingAmount: (value: number) => string } };
  runInNewContext(amountCode, { module, exports: module.exports, React, crypto: { randomUUID: uuid }, Error,
    require: (id: string) => {
      if (id === "react") return { ...React, ...runtime.hooks };
      if (id === "@/lib/trpc") return { trpc: { bookings: { updateManualAmount: { useMutation } } } };
      throw new Error(`Unexpected import: ${id}`);
    },
  }, { timeout: 1500 });
  let props = { active: options.initial ?? active, disabled: false, onAmountUpdated, onReload, saveControlRef, onSaveStateChange };
  const render = () => runtime.render(() => module.exports.NativeBookingAmountEditor(props));
  const edit = (value: string) => amountInput(render()).props.onChange({ target: { value } });
  const choose = (value: string) => radio(render(), value).props.onChange();
  const controller = () => { render(); return saveControlRef.current!; };
  const save = (options?: { deferRefresh?: boolean }) => controller().save(options);
  return { render, edit, choose, save, controller, saveControlRef, onSaveStateChange, mutation, uuid, onAmountUpdated, onReload, useMutation,
    replace: (overrides: Record<string, unknown>) => { props = { ...props, active: { ...props.active, ...overrides } as typeof active }; return render(); },
    disable: (disabled: boolean) => { props = { ...props, disabled }; return render(); },
    unmount: runtime.unmount, passes: runtime.passes, parse: module.exports.parseNativeBookingAmount, format: module.exports.formatNativeBookingAmount,
  };
}
function commercialHarness(selection: any = active) {
  const runtime = hooksRuntime();
  const onDraftChange = vi.fn();
  const amountSaveControlRef = { current: null };
  const onAmountSaveStateChange = vi.fn();
  const model = { updateBookingDetails: { isPending: false }, detailQuery: { isFetching: false, refetch: vi.fn(async () => ({})) }, scheduleSavePending: false, refreshBookingAndFunnelQueries: vi.fn() };
  const NativeBookingAmountEditor = (props: any) => React.createElement("amount-editor", props);
  const module = { exports: {} as { Editor: (props: any) => Element } };
  runInNewContext(compile(`${componentSource("NativeBookingCommercialEditor")}\nexports.Editor = NativeBookingCommercialEditor;`), {
    module, exports: module.exports, React, ...runtime.hooks, PUBLIC_BOOKING_PRICED_EXTRAS, NativeBookingAmountEditor,
    formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  });
  const props = { active: selection, model, onDraftChange, amountSaveControlRef, onAmountSaveStateChange };
  const render = () => runtime.render(() => module.exports.Editor(props));
  const draft = () => onDraftChange.mock.calls.at(-1)![0];
  return { render, draft, onDraftChange, model, amountSaveControlRef, onAmountSaveStateChange, amountType: NativeBookingAmountEditor, passes: runtime.passes };
}
function drawerHarness(selection: any, commercialDraft: any = null) {
  const runtime = hooksRuntime();
  const model = {
    active: selection, staffSignoffQuery: { data: null, isLoading: false },
    staffPhotosQuery: { isLoading: false }, beforePhotos: [], afterPhotos: [],
    staffMessagesQuery: { isLoading: false, isError: false }, staffMessages: [],
    assignBookingTeam: { isPending: false }, detailQuery: { isFetching: false },
    bookingTeamsQuery: { isLoading: false }, bookingTeams: [], customerMagicLink: { isPending: false },
    updateBookingDetails: { isPending: false }, updateLeadflowJob: { isPending: false },
    updateFunnelSchedule: { isPending: false }, updatePortalSchedule: { isPending: false },
    refreshLeadflowJobDetails: { isPending: false }, leadflowJobsQuery: { isLoading: false },
    rescheduleDate: selection.requestedLocalDate, rescheduleTime: "09:00",
    scheduleSavePending: false, bookingSavePending: false, cancellationPending: false, updateActiveBookingDetails: vi.fn(),
    copyCustomerMagicLink: vi.fn(), cancelActiveRecord: vi.fn(), updateActiveRecordSchedule: vi.fn(),
    refreshBookingAndFunnelQueries: vi.fn(), teamPortalLinkVersion: { current: 0 },
  };
  const icon = () => React.createElement("svg");
  const commercialType = (props: any) => React.createElement("commercial-editor", props);
  const components = Object.fromEntries(["BookingTeamMagicLink", "BookingPayrollPanel", "BookingPaymentActions", "PortalRequestPaymentActions"].map(name => [name, (props: any) => React.createElement(name, props)]));
  const module = { exports: {} as { Drawer: (props: any) => Element } };
  runInNewContext(compile(`${componentSource("BookingDetailDrawer")}\nexports.Drawer = BookingDetailDrawer;`), {
    module, exports: module.exports, React, ...runtime.hooks,
    NativeBookingCommercialEditor: commercialType, ...components,
    ...Object.fromEntries(["CalendarDays", "MapPin", "CreditCard", "ImageIcon", "Loader2", "Copy", "MessageCircle", "X"].map(name => [name, icon])),
    labelStatus: (value: string) => value, labelRecurrence: (value: string) => value,
    displayDate: (value: string) => value, displayTime: (value: string) => value,
    labelPaymentMethod: (value: string) => value, avatarColorFor: () => "#353535", initialsFor: () => "ST",
    getBookingArrivalWindowLabel: () => "9:00 AM",
  });
  const render = () => runtime.render(() => module.exports.Drawer({ model }));
  const commercial = () => elements(render()).find(node => node.type === commercialType)!;
  const setDraft = (draft: any) => { commercial().props.onDraftChange(draft); return render(); };
  const setAmountControl = (control: any) => {
    const editor = commercial(); editor.props.amountSaveControlRef.current = control;
    editor.props.onAmountSaveStateChange(control && { identity: control.identity, dirty: control.dirty, canSave: control.canSave });
    return render();
  };
  if (selection.source === "booking") {
    if (commercialDraft) setDraft(commercialDraft);
    setAmountControl({ identity: amountIdentity(selection), dirty: false, canSave: true, save: vi.fn(async () => true) });
  }
  return { render, model, commercialType, commercial, setDraft, setAmountControl, components, passes: runtime.passes };
}

describe("native booking manual amount editor", () => {
  it("renders the current effective cents and explicit first-only choice without making requests", () => {
    const h = harness(); const tree = h.render();
    expect(amountInput(tree).props.value).toBe("175.49");
    expect(radio(tree, "visit").props.checked).toBe(true);
    expect(radio(tree, "subsequent").props.checked).toBe(false);
    expect(text(tree)).toContain("This job only"); expect(text(tree)).toContain("This and future jobs");
    expect(text(tree)).toContain("Future visits remain $150.00");
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled(); expect(h.uuid).not.toHaveBeenCalled();
    expect(h.useMutation).toHaveBeenCalledWith({ retry: false });
    expect(elements(tree).filter(node => node.type === "button")).toHaveLength(0);
    expect(text(tree)).toContain("Use Save booking updates below");
    expect(text(tree)).not.toContain("Save amount");
    expect(h.controller()).toMatchObject({ dirty: false, canSave: true });
    expect(h.onSaveStateChange).toHaveBeenLastCalledWith({ identity: h.controller().identity, dirty: false, canSave: true });
    const stateNotifications = h.onSaveStateChange.mock.calls.length;
    for (let i = 0; i < 10; i++) { h.render(); expect(h.passes()).toBe(1); }
    expect(h.onSaveStateChange).toHaveBeenCalledTimes(stateNotifications);
  });

  it("reports dirty and invalid state to the footer without submitting on input or scope changes", () => {
    const h = harness(); h.render(); h.edit("180.01");
    expect(h.controller()).toMatchObject({ dirty: true, canSave: true });
    expect(h.onSaveStateChange).toHaveBeenLastCalledWith({ identity: h.controller().identity, dirty: true, canSave: true });
    h.edit("175.49"); expect(h.controller().dirty).toBe(false);
    h.choose("subsequent"); expect(h.controller().dirty).toBe(true);
    h.choose("visit"); expect(h.controller().dirty).toBe(false);
    h.edit("invalid"); expect(h.controller()).toMatchObject({ dirty: true, canSave: false });
    expect(h.onSaveStateChange).toHaveBeenLastCalledWith({ identity: h.controller().identity, dirty: true, canSave: false });
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled(); expect(h.uuid).not.toHaveBeenCalled();
    expect(h.onAmountUpdated).not.toHaveBeenCalled(); expect(h.onReload).not.toHaveBeenCalled();
  });

  it("lets a clean controller continue the footer save without an amount request", async () => {
    const h = harness(); expect(await h.save({ deferRefresh: true })).toBe(true);
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled(); expect(h.uuid).not.toHaveBeenCalled();
    expect(h.onAmountUpdated).not.toHaveBeenCalled(); expect(h.controller().dirty).toBe(false);
  });

  it.each(["visit", "subsequent"])("defers refresh for the footer while retaining the exact %s amount command and success notice", async scope => {
    const h = harness(); h.edit("180.01"); h.choose(scope);
    expect(await h.save({ deferRefresh: true })).toBe(true);
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, expectedDate: "2026-11-20", expectedAmountCents: 17549, expectedRevision: 3, amountCents: 18001, scope, requestId: REQUEST });
    expect(h.onAmountUpdated).not.toHaveBeenCalled(); expect(h.onReload).not.toHaveBeenCalled();
    expect(text(h.render())).toContain("This job's amount was saved as $180.01.");
    expect(h.controller().dirty).toBe(false);
    expect(await h.save({ deferRefresh: true })).toBe(true);
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("never skips a revert to stale cached cents after an acknowledged save whose refresh failed", async () => {
    const conflict = { message: "Refresh before saving the current amount.", data: { code: "CONFLICT" } };
    const mutation = { isPending: false, mutateAsync: vi.fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(conflict) };
    const h = harness({ mutation });
    h.edit("180.01"); expect(await h.save({ deferRefresh: true })).toBe(true);
    expect(h.controller().dirty).toBe(false);
    // Failed background refresh leaves the authoritative props at 17549/r3.
    h.edit("175.49");
    expect(h.controller()).toMatchObject({ dirty: true, canSave: true });
    expect(await h.save({ deferRefresh: true })).toBe(false);
    expect(mutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutation.mutateAsync).toHaveBeenLastCalledWith({ bookingId: 71, expectedDate: "2026-11-20",
      expectedAmountCents: 17549, expectedRevision: 3, amountCents: 17549, scope: "visit", requestId: REQUEST });
    expect(text(h.render())).toContain("Amount could not be saved");
    expect(text(h.render())).not.toContain("175.49 was saved");
    expect(h.controller()).toMatchObject({ dirty: true, canSave: false });
    expect(h.onAmountUpdated).not.toHaveBeenCalled();
  });

  it("clears the exposed save controller on unmount and rejects the captured controller", async () => {
    const h = harness(); h.edit("180.01"); const control = h.controller(); h.unmount();
    expect(h.saveControlRef.current).toBeNull(); expect(await control.save()).toBe(false);
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("contains no protected-visit policy copy in the actual amount component", () => {
    expect(amountSource).not.toMatch(/protected/i);
  });

  it.each(["confirmed", "paid", "completed", "captured", "invoiced", "authorized", "pending_payment", "cancelled", "canceled", "inactive", "paused", "missing", "pending_creation", "unknown"])("allows repeated 139 → 149 edits after authoritative refresh for past-date status %s", async status => {
    for (const scope of ["visit", "subsequent"]) {
      const selectedDate = "2000-01-01";
      const mutation = { isPending: false, mutateAsync: vi.fn(async (command: any) => response({ selectedDate, selectedAmountCents: command.amountCents, manualAmountRevision: command.expectedRevision + 1, futureRuleChanged: scope === "subsequent" })) };
      const h = harness({ mutation });
      h.replace({ status, requestedLocalDate: selectedDate });
      const expectEditable = (tree: unknown) => {
        expect(amountInput(tree).props.disabled).toBe(false);
        expect(amountInput(tree).props.readOnly).not.toBe(true);
        expect(elements(tree).find(node => node.type === "fieldset")!.props.disabled).toBe(false);
        expect(h.controller().canSave).toBe(true);
        expect(text(tree)).not.toMatch(/protected/i);
      };
      expectEditable(h.render());
      for (const [index, amountCents] of [13900, 14900].entries()) {
        h.edit((amountCents / 100).toFixed(2)); h.choose(scope);
        expectEditable(h.render());
        if (scope === "subsequent") expect(text(h.render())).toContain("Apply from this job forward.");
        await h.save();
        expect(mutation.mutateAsync).toHaveBeenNthCalledWith(index + 1, { bookingId: 71, expectedDate: selectedDate, expectedAmountCents: index === 0 ? 17549 : 13900, expectedRevision: 3 + index, amountCents, scope, requestId: REQUEST });
        expect(text(h.render())).toContain(`This job's amount was saved as $${(amountCents / 100).toFixed(2)}.`);
        expect(amountInput(h.render()).props.value).toBe((amountCents / 100).toFixed(2));
        h.replace({ firstCleaningTotalCents: amountCents, manualAmountRevision: 4 + index, ...(scope === "subsequent" ? { futureVisitTotalCents: amountCents } : {}) });
        expect(amountInput(h.render()).props.value).toBe((amountCents / 100).toFixed(2));
        expectEditable(h.render());
      }
      expect(mutation.mutateAsync).toHaveBeenCalledTimes(2);
      expect(h.onAmountUpdated).toHaveBeenCalledTimes(2); expect(h.uuid).toHaveBeenCalledTimes(2);
      expect(h.onReload).not.toHaveBeenCalled();
    }
  });

  it.each(["visit", "subsequent"])("sends only the exact independent %s amount command on one controller save", async scope => {
    const h = harness(); h.edit("180.01"); h.choose(scope); await h.save();
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ bookingId: 71, expectedDate: "2026-11-20", expectedAmountCents: 17549, expectedRevision: 3, amountCents: 18001, scope, requestId: REQUEST });
    expect(h.uuid).toHaveBeenCalledTimes(1); expect(h.onAmountUpdated).toHaveBeenCalledTimes(1);
    expect(amountInput(h.render()).props.value).toBe("180.01");
  });

  it("prevents duplicate controller requests synchronously, before mutation pending state rerenders", async () => {
    const pending = deferred<UpdateNativeBookingManualAmountResult>();
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(() => pending.promise) } });
    h.edit("180.01"); const save = h.controller().save;
    const first = save(); expect(await save()).toBe(false);
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1); expect(h.uuid).toHaveBeenCalledTimes(1);
    expect(amountInput(h.render()).props.disabled).toBe(true);
    expect(elements(h.render()).find(node => node.type === "fieldset")!.props.disabled).toBe(true);
    expect(h.controller().canSave).toBe(false);
    pending.resolve(response()); expect(await first).toBe(true);
  });

  it("blocks controller saves when externally pending or authoritative detail is fetching", async () => {
    const h = harness({ mutation: { isPending: true, mutateAsync: vi.fn() } });
    expect(h.controller().canSave).toBe(false); expect(await h.save()).toBe(false);
    expect(amountInput(h.render()).props.disabled).toBe(true); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
    const disabled = harness(); disabled.disable(true); expect(disabled.controller().canSave).toBe(false);
    expect(await disabled.save()).toBe(false); expect(amountInput(disabled.render()).props.disabled).toBe(true);
    expect(disabled.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(["", " ", "NaN", "Infinity", "-1", "1e2", ".50", "1.", "1.234", "1,000", "100000.01", "9007199254740993"])("rejects invalid decimal input %j without UUID or mutation", async value => {
    const h = harness(); h.edit(value); const tree = h.render();
    expect(amountInput(tree).props["aria-invalid"]).toBe(true);
    expect(h.controller().canSave).toBe(false);
    expect(await h.save()).toBe(false); expect(h.mutation.mutateAsync).not.toHaveBeenCalled(); expect(h.uuid).not.toHaveBeenCalled();
  });

  it.each([["0", 0], ["0.01", 1], ["1.1", 110], ["1.01", 101], ["100000.00", 10_000_000]])("parses %s into strict integer cents %i without adding a new cap", async (value, cents) => {
    const h = harness(); h.edit(value); await h.save();
    expect(h.mutation.mutateAsync.mock.calls[0][0].amountCents).toBe(cents);
    expect(h.parse(h.format(cents as number))).toBe(cents);
  });

  it("uses revision zero for native bookings without existing override metadata", async () => {
    const h = harness({ initial: { ...active, manualAmountRevision: undefined as any } });
    h.edit("180.01"); await h.save(); expect(h.mutation.mutateAsync.mock.calls[0][0].expectedRevision).toBe(0);
  });

  it("offers only this job for one-time service and cannot create recurrence", async () => {
    const h = harness({ initial: { ...active, recurrence: "one-time", futureVisitTotalCents: null as any } });
    expect(radio(h.render(), "subsequent")).toBeUndefined(); expect(text(h.render())).toContain("does not create recurring visits");
    h.edit("180.01"); await h.save(); expect(h.mutation.mutateAsync.mock.calls[0][0].scope).toBe("visit");
    expect(Object.keys(h.mutation.mutateAsync.mock.calls[0][0])).not.toContain("recurrence");
  });

  it.each(["leadflow", "funnel", "portal"])("renders nothing and executes nothing for nonnative source %s", source => {
    const h = harness(); h.replace({ source }); expect(h.render()).toBeNull(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it.each([{ key: "booking:72", id: 72 }, { requestedLocalDate: "2026-11-21" }, { manualAmountRevision: 4 }, { firstCleaningTotalCents: 17600 }])("suppresses a late save response after selection/date/revision/price changes: %j", async changed => {
    const pending = deferred<UpdateNativeBookingManualAmountResult>();
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(() => pending.promise) } });
    h.edit("180.01"); const click = h.save(); h.replace({ ...changed, firstCleaningTotalCents: 19000 });
    pending.resolve(response()); expect(await click).toBe(false);
    expect(amountInput(h.render()).props.value).toBe("190.00"); expect(text(h.render())).not.toContain("amount was saved");
    expect(h.onAmountUpdated).toHaveBeenCalledTimes(1);
  });

  it.each(["visit", "subsequent"])("accepts its own exact authoritative revision/amount refresh before the %s footer command resolves", async scope => {
    const pending = deferred<UpdateNativeBookingManualAmountResult>();
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(() => pending.promise) } });
    h.edit("180.01"); h.choose(scope); const saving = h.save({ deferRefresh: true });
    h.replace({ firstCleaningTotalCents: 18001, manualAmountRevision: 4, ...(scope === "subsequent" ? { futureVisitTotalCents: 18001 } : {}) });
    pending.resolve(response({ futureRuleChanged: scope === "subsequent" }));
    expect(await saving).toBe(true); expect(h.mutation.mutateAsync).toHaveBeenCalledOnce();
    expect(h.onAmountUpdated).not.toHaveBeenCalled();
    expect(amountInput(h.render()).props.value).toBe("180.01"); expect(h.controller().dirty).toBe(false);
    expect(text(h.render())).not.toContain("amount was saved");
  });

  it.each([{ firstCleaningTotalCents: 18001, manualAmountRevision: 5 }, { firstCleaningTotalCents: 19000, manualAmountRevision: 4 }, { firstCleaningTotalCents: 18001, manualAmountRevision: 4, recurrence: "monthly" }])("rejects an external authoritative refresh during a deferred footer save: %j", async changed => {
    const pending = deferred<UpdateNativeBookingManualAmountResult>();
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(() => pending.promise) } });
    h.edit("180.01"); const saving = h.save({ deferRefresh: true }); h.replace(changed);
    pending.resolve(response()); expect(await saving).toBe(false);
    expect(h.onAmountUpdated).not.toHaveBeenCalled(); expect(text(h.render())).not.toContain("amount was saved");
    expect(amountInput(h.render()).props.value).toBe((changed.firstCleaningTotalCents / 100).toFixed(2));
  });

  it("does not apply a response after switching away then returning, or after unmount", async () => {
    for (const unmount of [false, true]) {
      const pending = deferred<UpdateNativeBookingManualAmountResult>();
      const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(() => pending.promise) } });
      h.edit("180.01"); const click = h.save();
      if (unmount) h.unmount(); else { h.replace({ key: "booking:72", id: 72 }); h.replace({ key: "booking:71", id: 71 }); }
      pending.resolve(response()); expect(await click).toBe(false);
      expect(text(h.render())).not.toContain("amount was saved");
    }
  });

  it("ignores a captured old save controller after switching booking", async () => {
    const h = harness(); h.edit("180.01"); const oldController = h.controller();
    h.replace({ key: "booking:72", id: 72 });
    expect(h.controller().identity).not.toBe(oldController.identity);
    expect(await oldController.save()).toBe(false); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("resets series scope visibly when the selected booking changes", () => {
    const h = harness(); h.choose("subsequent"); h.replace({ key: "booking:72", id: 72 });
    expect(radio(h.render(), "visit").props.checked).toBe(true); expect(radio(h.render(), "subsequent").props.checked).toBe(false);
  });

  it("reports a stale-revision conflict with an explicit authoritative reload, never retries", async () => {
    const pendingReload = deferred<void>();
    const error = { message: "The cleaning amount was edited by someone else. Refresh before saving.", data: { code: "CONFLICT" } };
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(async () => { throw error; }) }, reload: () => pendingReload.promise });
    h.edit("180.01"); await h.save(); const tree = h.render();
    expect(text(tree)).toContain("The cleaning amount was edited by someone else."); expect(text(tree)).toContain("Reload booking");
    expect(h.onReload).not.toHaveBeenCalled(); expect(h.onAmountUpdated).not.toHaveBeenCalled();
    await h.save(); expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    const reload = button(h.render(), "Reload booking").props.onClick(); await h.save();
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1); expect(h.onReload).toHaveBeenCalledTimes(1);
    pendingReload.resolve(); await reload; h.choose("subsequent");
    expect(h.controller().canSave).toBe(true);
  });

  it("keeps the conflict visible when a requested authoritative reload fails", async () => {
    const h = harness({ mutation: { isPending: false, mutateAsync: vi.fn(async () => { throw { message: "Stale revision", data: { code: "CONFLICT" } }; }) }, reload: async () => { throw new Error("Synthetic reload failure"); } });
    h.edit("180.01"); await h.save(); await button(h.render(), "Reload booking").props.onClick();
    expect(text(h.render())).toContain("Stale revision"); expect(h.controller().canSave).toBe(false);
  });

  it("truthfully reports the selected amount and all three series visits changed without protected-visit policy copy", async () => {
    const h = harness({ result: response({ selectedChanged: true, selectedAmountCents: 18001, changedVisitCount: 3, changedJobCount: 2, protectedVisitCount: 0, protectedVisits: [], futureRuleChanged: true }) });
    h.edit("180.01"); h.choose("subsequent"); await h.save();
    expect(text(h.render())).toContain("This job's amount was saved as $180.01.");
    expect(text(h.render())).toContain("3 visits changed (2 existing jobs updated).");
    expect(text(h.render())).not.toMatch(/protected/i);
    expect(text(h.render())).toContain("future-visit amount rule was saved");
    expect(text(h.render())).not.toContain("all jobs"); expect(amountInput(h.render()).props.value).toBe("180.01");
    h.replace({ manualAmountRevision: 4, firstCleaningTotalCents: 18001, futureVisitTotalCents: 18001 });
    expect(text(h.render())).toContain("This job's amount was saved as $180.01.");
    expect(text(h.render())).not.toMatch(/protected/i);
    expect(text(h.render())).toContain("Future visits remain $180.01");
  });

  it("does not apply a mismatched response amount", async () => {
    const h = harness({ result: response({ bookingId: 72 }) }); h.edit("190.00"); await h.save();
    expect(text(h.render())).toContain("did not match this booking"); expect(amountInput(h.render()).props.value).toBe("190.00");
    expect(h.controller().canSave).toBe(false);
  });

  it("does not submit when authoritative selected date or cents are missing", async () => {
    for (const change of [{ requestedLocalDate: null }, { firstCleaningTotalCents: null }]) {
      const h = harness(); h.replace(change); await h.save(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
    }
  });
});

describe("separate legacy commercial draft and native amount display", () => {
  it("keeps notes-only and extras saves on original raw first cents, never effective manual first", () => {
    const h = commercialHarness(); const tree = h.render();
    expect(h.draft().firstCleaningTotalCents).toBe(22000); expect(text(tree)).toContain("$175.49 first visit");
    const notes = elements(tree).find(node => node.type === "textarea")!;
    notes.props.onChange({ target: { value: "Changed note" } }); h.render();
    expect(h.draft().companyNotes).toBe("Changed note"); expect(h.draft().firstCleaningTotalCents).toBe(22000);
    expect(h.model.refreshBookingAndFunnelQueries).not.toHaveBeenCalled();
    const embedded = elements(h.render()).find(node => node.type === h.amountType)!;
    expect(embedded.props.active.firstCleaningTotalCents).toBe(17549);
    expect(embedded.props.onAmountUpdated).toBe(h.model.refreshBookingAndFunnelQueries);
    expect(embedded.props.saveControlRef).toBe(h.amountSaveControlRef);
    expect(embedded.props.onSaveStateChange).toBe(h.onAmountSaveStateChange);
    expect(text(tree)).not.toContain("Save amount");
    for (let i = 0; i < 10; i++) { h.render(); expect(h.passes()).toBe(1); }
  });

  it.each([false, true])("preserves the existing extras quantity/raw delta engine with manual metadata = %s", manual => {
    const selection = { ...active, firstCleaningTotalCents: manual ? 17549 : 22000, manualAmountRevision: manual ? 3 : 0 };
    const h = commercialHarness(selection); const tree = h.render();
    const [id, extra] = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS)[0];
    elements(tree).find(node => node.props["aria-label"] === `Add ${extra.label}`)!.props.onClick(); h.render();
    expect(h.draft().extras).toEqual([{ id, label: extra.label, quantity: 1 }]);
    expect(h.draft().firstCleaningTotalCents).toBe(22000 + extra.unitPrice * 100);
    expect(h.model.refreshBookingAndFunnelQueries).not.toHaveBeenCalled();
    if (manual) expect(text(h.render())).toContain("$175.49 first visit");
    else expect(text(h.render())).toContain(`$${((22000 + extra.unitPrice * 100) / 100).toFixed(2)} first visit`);
  });

  it("keeps no-metadata legacy parity when the original field is absent", () => {
    const h = commercialHarness({ ...active, originalFirstCleaningTotalCents: undefined, manualAmountRevision: 0 });
    h.render(); expect(h.draft().firstCleaningTotalCents).toBe(17549);
  });

  it("uses effective manual total for the drawer header even with a raw commercial draft", () => {
    const rawDraft = { bookingKey: active.key, firstCleaningTotalCents: 26000, extras: [], companyNotes: "Draft note", isSaveable: true };
    const h = drawerHarness(drawerActive, rawDraft);
    const tree = h.render(); const serviceTitle = elements(tree).find(node => node.props.className === "bcr-section-title")!;
    expect(text(serviceTitle)).toContain("$175"); expect(text(serviceTitle)).not.toContain("$260");
    button(tree, "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).toHaveBeenCalledWith({ extras: [], firstCleaningTotalCents: 26000, companyNotes: "Draft note" }, { detailsChanged: true, beforeSubmit: undefined });
  });

  it.each([false, true])("coordinates amount and commercial drafts through the one footer, details changed = %s", async detailsChanged => {
    const draft = { bookingKey: active.key, firstCleaningTotalCents: detailsChanged ? 26000 : 22000, extras: [], companyNotes: detailsChanged ? "Draft note" : "Original note", isSaveable: true };
    const h = drawerHarness(drawerActive, draft);
    const control = { identity: amountIdentity(drawerActive), dirty: true, canSave: true, save: vi.fn(async () => true) };
    h.setAmountControl(control);
    const tree = h.render();
    expect(elements(tree).filter(node => node.type === "button" && text(node) === "Save booking updates")).toHaveLength(1);
    expect(button(tree, "Save amount")).toBeUndefined();
    expect(h.model.updateActiveBookingDetails).not.toHaveBeenCalled(); expect(control.save).not.toHaveBeenCalled();
    expect(button(tree, "Save booking updates").props.disabled).toBe(false);
    button(tree, "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).toHaveBeenCalledTimes(1);
    expect(h.model.updateActiveBookingDetails).toHaveBeenCalledWith({ extras: [], firstCleaningTotalCents: draft.firstCleaningTotalCents, companyNotes: draft.companyNotes }, { detailsChanged, beforeSubmit: expect.any(Function) });
    expect(control.save).not.toHaveBeenCalled();
    const options = h.model.updateActiveBookingDetails.mock.calls[0][1];
    expect(await options.beforeSubmit()).toBe(true);
    expect(control.save).toHaveBeenCalledOnce(); expect(control.save).toHaveBeenCalledWith({ deferRefresh: true });
  });

  it("captures the submitted amount controller while the existing schedule/details flow waits", async () => {
    const h = drawerHarness(drawerActive);
    const first = { identity: amountIdentity(drawerActive), dirty: true, canSave: true, save: vi.fn(async () => false) };
    const next = { identity: "next:72", dirty: true, canSave: true, save: vi.fn(async () => true) };
    h.setAmountControl(first); button(h.render(), "Save booking updates").props.onClick();
    const beforeSubmit = h.model.updateActiveBookingDetails.mock.calls[0][1].beforeSubmit;
    h.setAmountControl(next);
    expect(await beforeSubmit()).toBe(false);
    expect(first.save).toHaveBeenCalledWith({ deferRefresh: true }); expect(next.save).not.toHaveBeenCalled();
  });

  it("saves notes and canonical extras/raw cents without invoking a clean amount controller", () => {
    const extras = [{ id: "synthetic-extra", label: "Synthetic extra", quantity: 2 }];
    const h = drawerHarness(drawerActive, { bookingKey: active.key, firstCleaningTotalCents: 26000, extras, companyNotes: "Draft note", isSaveable: true });
    const control = { identity: amountIdentity(drawerActive), dirty: false, canSave: true, save: vi.fn() };
    h.setAmountControl(control); button(h.render(), "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).toHaveBeenCalledWith({ extras: [{ id: "synthetic-extra", quantity: 2 }], firstCleaningTotalCents: 26000, companyNotes: "Draft note" }, { detailsChanged: true, beforeSubmit: undefined });
    expect(control.save).not.toHaveBeenCalled();
  });

  it("does not treat extras order or trimmed existing notes as a commercial change", () => {
    const extras = [{ id: "a", label: "Extra A", quantity: 1 }, { id: "b", label: "Extra B", quantity: 2 }];
    const h = drawerHarness({ ...drawerActive, extras, companyNotes: " Original note " }, { bookingKey: active.key, firstCleaningTotalCents: 22000, extras: [...extras].reverse(), companyNotes: "Original note", isSaveable: true });
    button(h.render(), "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails.mock.calls[0][1]).toEqual({ detailsChanged: false, beforeSubmit: undefined });
  });

  it("blocks the footer for an invalid dirty amount and does not submit without a controller", () => {
    const h = drawerHarness(drawerActive);
    const invalid = { identity: amountIdentity(drawerActive), dirty: true, canSave: false, save: vi.fn() };
    h.setAmountControl(invalid);
    expect(button(h.render(), "Save booking updates").props.disabled).toBe(true);
    button(h.render(), "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).not.toHaveBeenCalled(); expect(invalid.save).not.toHaveBeenCalled();
    h.setAmountControl(null); button(h.render(), "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).not.toHaveBeenCalled();
  });

  it("rejects a controller whose authoritative booking identity no longer matches the drawer", () => {
    const h = drawerHarness(drawerActive);
    const stale = { identity: amountIdentity({ ...active, manualAmountRevision: 2 }), dirty: true, canSave: true, save: vi.fn() };
    h.setAmountControl(stale); button(h.render(), "Save booking updates").props.onClick();
    expect(h.model.updateActiveBookingDetails).not.toHaveBeenCalled(); expect(stale.save).not.toHaveBeenCalled();
  });

  it.each(["scheduleSavePending", "bookingSavePending", "detailFetching", "invalidDraft", "missingDate", "missingTime"])("keeps the footer disabled for %s", reason => {
    const h = drawerHarness(drawerActive);
    if (reason === "detailFetching") h.model.detailQuery.isFetching = true;
    else if (reason === "invalidDraft") h.setDraft({ bookingKey: active.key, firstCleaningTotalCents: 22000, extras: [], companyNotes: "Original note", isSaveable: false });
    else if (reason === "missingDate") h.model.rescheduleDate = "";
    else if (reason === "missingTime") h.model.rescheduleTime = "";
    else h.model[reason as "scheduleSavePending" | "bookingSavePending"] = true;
    const footerButton = elements(h.render()).find(node => node.props.className === "bcr-save-changes")!;
    expect(footerButton.props.disabled).toBe(true);
    if (reason === "bookingSavePending") expect(text(footerButton)).toBe("Saving…");
    expect(h.model.updateActiveBookingDetails).not.toHaveBeenCalled();
  });

  it.each([["card", "authorized"], ["cashapp", "captured"]])("preserves %s payment totals, payroll and existing team/customer link controls", (paymentMethod, paymentStatus) => {
    const h = drawerHarness({ ...drawerActive, paymentMethod, paymentStatus }); const tree = h.render();
    const payment = elements(tree).find(node => node.type === h.components.BookingPaymentActions)!;
    expect(payment.props).toMatchObject({ bookingId: 71, totalCents: 22000, paymentMethod, paymentStatus });
    if (paymentMethod === "card") expect(payment.props.holdTotalCents).toBe(17549);
    else expect(payment.props.holdTotalCents).toBeUndefined();
    const teamLink = elements(tree).find(node => node.type === h.components.BookingTeamMagicLink)!;
    expect(teamLink.props).toMatchObject({ source: "booking", id: 71, assignedTeamName: "Synthetic team", disabled: false });
    expect(teamLink.props.assignmentVersionRef).toBe(h.model.teamPortalLinkVersion);
    const payroll = elements(tree).find(node => node.type === h.components.BookingPayrollPanel)!;
    expect(payroll.props.active).toBe(h.model.active); expect(payroll.props.model).toBe(h.model);
    expect(button(tree, "Copy Customer My Home Link").props.onClick).toBe(h.model.copyCustomerMagicLink);
    expect(button(tree, "Cancel booking").props.onClick).toBe(h.model.cancelActiveRecord);
    expect(button(tree, "Save schedule").props.onClick).toBe(h.model.updateActiveRecordSchedule);
    expect(h.model.copyCustomerMagicLink).not.toHaveBeenCalled(); expect(h.model.cancelActiveRecord).not.toHaveBeenCalled();
  });

  it.each(["leadflow", "funnel", "portal"])("keeps native commercial/amount controls absent from %s drawer", source => {
    const h = drawerHarness({ ...active, source, status: "confirmed", serviceName: "Synthetic cleaning", specialRequestNotes: [], customerName: "Synthetic customer", publicNumber: "SYN-71", assignedTeamName: null, bedrooms: 1, bathrooms: 1 });
    expect(elements(h.render()).some(node => node.type === h.commercialType)).toBe(false);
    expect(button(h.render(), "Save booking updates")).toBeUndefined();
  });

  it("does not introduce old details, schedule, payment, provider or messaging mutations into the amount component", () => {
    expect(amountSource).toContain("trpc.bookings.updateManualAmount.useMutation");
    for (const marker of ["updateDetails", "updateActiveBookingDetails", "updateActiveBookingSchedule", "BookingPaymentActions", "cashapp", "sendMessage", "invokeLLM", "fetch("]) expect(amountSource).not.toContain(marker);
    expect(workspaceSource.match(/originalFirstCleaningTotalCents: booking.originalFirstCleaningTotalCents/g)).toHaveLength(2);
    expect(workspaceSource.match(/manualAmountRevision: booking.manualAmountRevision/g)).toHaveLength(2);
    expect(page).toContain("active.originalFirstCleaningTotalCents ?? active.firstCleaningTotalCents");
    const prohibitedTable = ["cleaner", "_jobs"].join(""); const prohibitedSymbol = ["cleaner", "Jobs"].join("");
    for (const source of [amountSource, page, workspaceSource]) { expect(source).not.toContain(prohibitedTable); expect(source).not.toContain(prohibitedSymbol); }
  });
});
