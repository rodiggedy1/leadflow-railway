import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as reschedule from "../shared/bookingReschedule";
import * as dialog from "../client/src/components/ui/dialog";

/**
 * OFFLINE ONLY. Execute current TSX with an explicit import allowlist. All query
 * data and mutations are synthetic; application startup and provider/DB clients
 * are never imported. A bounded hook simulator tests real workspace callbacks
 * across renders. This is not a DOM/focus or Radix portal-lifecycle test.
 */
const root = resolve(import.meta.dirname, "..");
const workspacePath = "client/src/components/NativeBookingsWorkspace.tsx";
const crmPath = "client/src/pages/BookingsCRMExactLive.tsx";
const CONTROL_COMMIT = "dc96460b1129c981c5cab2e9fb9c3b23f4330fc2";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const parse = (source: string) => ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
function find<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  function visit(child: ts.Node) { if (predicate(child)) matches.push(child); ts.forEachChild(child, visit); }
  visit(node);
  return matches;
}
function execute(source: string, imports: Record<string, unknown>, scope: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, {
    ...scope, module, exports: module.exports, Date, Intl, Error,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".css")) return {};
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Offline client test rejected import: ${id}`);
    },
  });
  return module.exports;
}
const choicePath = "client/src/components/BookingRescheduleChoice.tsx";
const { BookingRescheduleChoice } = execute(read(choicePath), { "@/components/ui/dialog": dialog });
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement(tree)
  ? text((tree.props as any).children) : tree == null ? "" : String(tree);
const button = (tree: any, label: string) => {
  const matches = elements(tree).filter(node => node.type === "button" && text(node) === label);
  expect(matches, `unique button ${label}`).toHaveLength(1);
  return matches[0];
};
const scheduleButton = (tree: any) => {
  const fields = elements(tree).find(node => node.props.className === "bcr-schedule-fields");
  expect(fields, "CRM schedule fields").toBeDefined();
  const buttons = elements(fields).filter(node => node.type === "button");
  expect(buttons).toHaveLength(1);
  return buttons[0];
};

/** Only hook scheduling is substituted; no schedule handler is reimplemented. */
function hookRuntime() {
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  let effects: Array<() => void> = [];
  const changed = (a: any[] | undefined, b: any[] | undefined) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
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
    useEffect(effect: () => void, dependencies?: any[]) {
      const index = cursor++;
      if (changed(slots[index], dependencies)) { slots[index] = dependencies; effects.push(effect); }
    },
  };
  return {
    hooks,
    render<T>(component: () => T, flushEffects = true): T {
      for (let pass = 0; pass < 12; pass++) {
        cursor = 0; dirty = false;
        const result = component();
        if (!flushEffects) return result;
        const queued = effects; effects = []; queued.forEach(effect => effect());
        if (!dirty) return result;
      }
      throw new Error("Synthetic workspace did not settle in 12 renders");
    },
  };
}
const sources = ["booking", "funnel", "portal", "leadflow"] as const;
type Source = typeof sources[number];
const mutationPath = { booking: "bookings.updateDetails", funnel: "bookingFunnel.updateSchedule", portal: "bookings.updateStaffRequestSchedule", leadflow: "leadflowJobs.update" };
const OLD_DATE = "2026-11-10", OLD_TIME = "09:00", NEW_DATE = "2026-11-17", NEW_TIME = "14:35";
function workspace(source: Source = "booking", recurrence: string | null = "one-time", origin = "launch27_import", sourceCode = read(workspacePath)) {
  const runtime = hookRuntime();
  const queries: Record<string, any> = {};
  const mutations: Record<string, any> = {};
  const common = { id: 41, customerName: "Synthetic Customer", customerPhone: "+15555550141", customerEmail: null,
    status: "confirmed", requestedLocalDate: OLD_DATE, requestedLocalTime: OLD_TIME, recurrence,
    extras: [], specialRequestNotes: [], assignmentStatus: "unassigned", assignedTeamName: null,
    bedrooms: 2, bathrooms: 1, firstCleaningTotalCents: 15000, futureVisitTotalCents: 14000,
    companyNotes: null, paymentStatus: "not_started" };
  queries["bookings.list"] = source === "booking" ? [common] : [];
  queries["bookings.get"] = source === "booking" ? common : undefined;
  const funnel = { ...common, stage: "booked", source: "staff", bookingId: null };
  queries["bookingFunnel.list"] = source === "funnel" ? [funnel] : [];
  queries["bookingFunnel.get"] = source === "funnel" ? funnel : undefined;
  queries["bookings.staffRequests"] = source === "portal" ? [common] : [];
  queries["leadflowJobs.list"] = source === "leadflow" ? [{ ...common, bookingId: null, origin,
    launch27BookingId: origin === "launch27_import" ? 141 : null, bookingStatus: "confirmed", jobDate: OLD_DATE,
    serviceDateTime: `${OLD_DATE}T14:00:00.000Z`, frequency: recurrence, jobTotalCents: 15000 }] : [];
  const refetch = vi.fn();
  const trpc = new Proxy({}, { get: (_target, router: string) => new Proxy({}, { get: (_target, procedure: string) => {
    const key = `${router}.${procedure}`;
    return {
      useQuery: () => ({ data: queries[key], refetch, isLoading: false, isError: false }),
      useMutation: () => mutations[key] ??= { mutate: vi.fn(), isPending: false },
    };
  } }) });
  const stub = () => null;
  const icons = new Proxy({}, { get: () => stub });
  const Component = execute(sourceCode, {
    react: runtime.hooks, "react-dom": { createPortal: stub }, "lucide-react": icons,
    "@/lib/trpc": { trpc }, "@/hooks/useOpsStream": { useOpsStream: stub },
    "@/components/BookingRescheduleChoice": { BookingRescheduleChoice },
    "@shared/bookingReschedule": reschedule,
    "@shared/bookingWidgetConfig": { BOOKING_WIDGET_PRICED_EXTRAS: [] },
    "@/components/BookingPaymentActions": { BookingPaymentActions: stub },
    "@/components/PortalRequestPaymentActions": { PortalRequestPaymentActions: stub },
    "@/pages/InternalBooking": { InternalBooking: stub },
  }).default;
  let model: any, tree: any;
  const render = (flushEffects = true) => {
    tree = runtime.render(() => Component({ realtimeEnabled: false, render: (value: any) => { model = value; return null; } }), flushEffects);
    return model;
  };
  render(); model.setDate(OLD_DATE); render();
  const key = source === "leadflow" ? "leadflow:job:41" : `${source}:41`;
  model.setActiveKey(key); render();
  expect(model.active?.key).toBe(key);
  const result = {
    get model() { return model; }, render, mutations, queries, refetch,
    get choice() { return elements(tree).find(node => node.type === BookingRescheduleChoice)?.props; },
    draft(date = NEW_DATE, time = NEW_TIME) { model.setRescheduleDate(date); model.setRescheduleTime(time); render(); },
    savedRow(field: "requestedLocalDate" | "requestedLocalTime", value: string) {
      if (source === "booking") queries["bookings.get"] = { ...queries["bookings.get"], [field]: value };
      else if (source === "funnel") queries["bookingFunnel.get"] = { ...queries["bookingFunnel.get"], [field]: value };
      else if (source === "portal") queries["bookings.staffRequests"] = queries["bookings.staffRequests"].map((row: any) => ({ ...row, [field]: value }));
      else queries["leadflowJobs.list"] = queries["leadflowJobs.list"].map((row: any) => ({ ...row,
        ...(field === "requestedLocalDate" ? { jobDate: value } : { serviceDateTime: `${OLD_DATE}T${value}:00-05:00` }) }));
    },
  };
  return result;
}
const schedulePayload = (source: Source, mode: string) => source === "leadflow"
  ? { jobId: 41, jobDate: NEW_DATE, jobTime: NEW_TIME, rescheduleMode: mode }
  : { [source === "booking" ? "bookingId" : "id"]: 41, requestedLocalDate: NEW_DATE, requestedLocalTime: NEW_TIME, rescheduleMode: mode };

/** Execute the actual full drawer function and helpers, but not its child components. */
function drawer(model: any, commercialDraft: any = null) {
  const file = parse(read(crmPath));
  const named = (name: string) => {
    const nodes = find(file, ts.isFunctionDeclaration).filter(node => node.name?.text === name);
    expect(nodes).toHaveLength(1);
    return printer.printNode(ts.EmitHint.Unspecified, nodes[0], file);
  };
  const helpers = file.statements.filter(ts.isVariableStatement).filter(statement => statement.declarationList.declarations.some(node => ts.isIdentifier(node.name) && ["AVATAR_COLORS", "initialsFor", "avatarColorFor", "displayDate", "displayTime", "labelStatus", "labelRecurrence", "labelPaymentMethod"].includes(node.name.text)));
  const icons = ["X", "CalendarDays", "MapPin", "CreditCard", "ImageIcon", "Loader2", "Copy", "MessageCircle"];
  const stub = () => null;
  const scope = Object.fromEntries([...icons, "NativeBookingCommercialEditor", "BookingPayrollPanel", "BookingPaymentActions", "PortalRequestPaymentActions"].map(name => [name, stub]));
  const { BookingDetailDrawer } = execute(`${helpers.map(node => printer.printNode(ts.EmitHint.Unspecified, node, file)).join("\n")}\n${named("BookingDetailDrawer")}\nmodule.exports = { BookingDetailDrawer };`, {}, {
    ...scope, useState: () => [commercialDraft, vi.fn()],
  });
  return BookingDetailDrawer({ model });
}

describe("booking reschedule — actual client source, offline", () => {
  it("untouched control commit reproduces the missing time exports and disabled CRM save", () => {
    const controlSource = execFileSync("git", ["-c", `safe.directory=${root}`, "show", `${CONTROL_COMMIT}:${workspacePath}`], {
      cwd: root, encoding: "utf8", env: { PATH: process.env.PATH },
    });
    const h = workspace("booking", "one-time", "launch27_import", controlSource);
    expect(h.model.rescheduleTime).toBeUndefined();
    expect(h.model.setRescheduleTime).toBeUndefined();
    h.model.setRescheduleDate(NEW_DATE); h.render();
    expect(button(drawer(h.model), "Save schedule").props.disabled).toBe(true);
  });

  it.each(sources)("exports working time state/setter and a usable CRM Save schedule for %s", source => {
    const h = workspace(source);
    expect(h.model.rescheduleTime).toBe(OLD_TIME);
    expect(h.model.setRescheduleTime).toBeTypeOf("function");
    const original = drawer(h.model);
    expect(button(original, "Save schedule").props.disabled).toBe(true);
    const input = elements(original).find(node => node.type === "input" && node.props["aria-label"] === "Booking time");
    input.props.onChange({ target: { value: NEW_TIME } }); h.render();
    expect(h.model.rescheduleTime).toBe(NEW_TIME);
    const save = button(drawer(h.model), "Save schedule");
    expect(save.props.disabled).toBe(false);
    expect(save.props.onClick).toBe(h.model.updateActiveRecordSchedule);
  });

  it.each(sources)("one-time %s sends new date AND time immediately, with visit mode", source => {
    const h = workspace(source); h.draft();
    button(drawer(h.model), "Save schedule").props.onClick(); h.render();
    expect(h.choice.open).toBe(false);
    const mutate = h.mutations[mutationPath[source]].mutate;
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual(schedulePayload(source, "visit"));
  });

  it.each(sources.filter(source => source !== "portal"))("recurring %s captures the draft and cannot mutate until explicit scope choice", source => {
    const h = workspace(source, "biweekly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    expect(h.choice).toMatchObject({ open: true, date: NEW_DATE, time: NEW_TIME });
    expect(h.mutations[mutationPath[source]].mutate).not.toHaveBeenCalled();
    // A changed editor draft must not alter the captured mutation closure.
    h.draft("2026-12-03", "18:00"); h.choice.onChoose("subsequent"); h.render();
    expect(h.mutations[mutationPath[source]].mutate).toHaveBeenCalledTimes(1);
    expect(h.mutations[mutationPath[source]].mutate.mock.calls[0][0]).toEqual(schedulePayload(source, "subsequent"));
    expect(h.choice.open).toBe(false);
  });

  it.each(sources.filter(source => source !== "portal"))("canceling recurring %s scope choice writes nothing", source => {
    const h = workspace(source, "Weekly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    h.choice.onCancel(); h.render();
    expect(h.choice.open).toBe(false);
    expect(h.mutations[mutationPath[source]].mutate).not.toHaveBeenCalled();
  });

  it("a second save while scope choice is open cannot replace the captured draft", () => {
    const h = workspace("booking", "weekly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    h.draft("2026-12-03", "18:00"); h.model.updateActiveRecordSchedule(); h.render();
    expect(h.choice).toMatchObject({ date: NEW_DATE, time: NEW_TIME });
    h.choice.onChoose("visit"); h.render();
    expect(h.mutations["bookings.updateDetails"].mutate.mock.calls[0][0]).toEqual(schedulePayload("booking", "visit"));
    expect(h.mutations["bookings.updateDetails"].mutate).toHaveBeenCalledTimes(1);
  });

  it("cadence-only saves retain the existing schedule and do not ask a reschedule choice", () => {
    const h = workspace("booking", "weekly");
    h.model.updateActiveBookingSchedule({ recurrence: "monthly" }); h.render();
    expect(h.choice.open).toBe(false);
    expect(h.mutations["bookings.updateDetails"].mutate.mock.calls[0][0]).toEqual({ bookingId: 41, recurrence: "monthly" });
  });

  it.each(["launch27_import", "recurring", "native"])("LeadFlow origin %s has the same recurring confirmation and complete payload", origin => {
    const h = workspace("leadflow", "Tri-weekly", origin); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    expect(h.choice.open).toBe(true); expect(h.mutations["leadflowJobs.update"].mutate).not.toHaveBeenCalled();
    h.choice.onChoose("visit"); h.render();
    expect(h.mutations["leadflowJobs.update"].mutate.mock.calls[0][0]).toEqual(schedulePayload("leadflow", "visit"));
  });

  it.each(["selection", "saved date", "saved time"])("stale %s aborts confirmation before effects have run", change => {
    const h = workspace("booking", "monthly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    if (change === "selection") h.model.setActiveKey("portal:999");
    else h.savedRow(change === "saved date" ? "requestedLocalDate" : "requestedLocalTime", change === "saved date" ? "2026-11-11" : "10:00");
    h.render(false); h.choice.onChoose("subsequent"); h.render();
    expect(h.mutations["bookings.updateDetails"].mutate).not.toHaveBeenCalled();
    expect(h.choice.open).toBe(false);
    expect(h.model.importSummary).toContain("booking changed");
  });

  it("changing active selection also closes pending choice during effect settling", () => {
    const h = workspace("booking", "weekly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    h.model.setActiveKey(null); h.render();
    expect(h.choice.open).toBe(false); expect(h.mutations["bookings.updateDetails"].mutate).not.toHaveBeenCalled();
  });

  it.each(sources)("invalid date/time prevents %s schedule mutation", source => {
    const h = workspace(source);
    for (const [date, time] of [["2026-02-30", NEW_TIME], [NEW_DATE, "24:00"], ["", NEW_TIME], [NEW_DATE, "9:00"]]) {
      h.draft(date, time); h.model.updateActiveRecordSchedule(); h.render();
      expect(h.mutations[mutationPath[source]].mutate).not.toHaveBeenCalled();
      expect(h.choice.open).toBe(false);
    }
    expect(h.model.importSummary).toContain("valid booking date and time");
  });

  it.each(sources)("pending mutation blocks duplicate %s schedule saves", source => {
    const h = workspace(source); h.draft(); h.mutations[mutationPath[source]].isPending = true; h.render();
    const save = scheduleButton(drawer(h.model));
    expect(text(save)).toBe("Saving…");
    expect(save.props.disabled).toBe(true);
    h.model.updateActiveRecordSchedule();
    expect(h.mutations[mutationPath[source]].mutate).not.toHaveBeenCalled();
  });

  it.each(["date", "time", "both"])("commercial footer includes %s-dirty schedule and preserves price/extras/notes", changed => {
    const h = workspace("booking", "weekly");
    h.draft(changed === "time" ? OLD_DATE : NEW_DATE, changed === "date" ? OLD_TIME : NEW_TIME);
    const commercial = { bookingKey: "booking:41", firstCleaningTotalCents: 22222,
      extras: [{ id: "oven", label: "Oven", quantity: 2 }], companyNotes: "Internal synthetic note", isSaveable: true };
    const save = button(drawer(h.model, commercial), "Save booking updates");
    expect(save.props.disabled).toBe(false); save.props.onClick(); h.render();
    expect(h.choice.open).toBe(true); expect(h.mutations["bookings.updateDetails"].mutate).not.toHaveBeenCalled();
    h.choice.onChoose("subsequent"); h.render();
    expect(h.mutations["bookings.updateDetails"].mutate.mock.calls[0][0]).toEqual({ bookingId: 41,
      requestedLocalDate: changed === "time" ? OLD_DATE : NEW_DATE,
      requestedLocalTime: changed === "date" ? OLD_TIME : NEW_TIME, rescheduleMode: "subsequent",
      firstCleaningTotalCents: 22222, extras: [{ id: "oven", quantity: 2 }], companyNotes: "Internal synthetic note" });
  });

  it("commercial-only footer preserves schedule/cadence and does not open recurring choice", () => {
    const h = workspace("booking", "weekly");
    button(drawer(h.model), "Save booking updates").props.onClick(); h.render();
    expect(h.choice.open).toBe(false);
    const mutate = h.mutations["bookings.updateDetails"].mutate;
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ bookingId: 41, extras: [], firstCleaningTotalCents: 15000, companyNotes: null });
  });

  it("commercial footer cancellation performs no mutation", () => {
    const h = workspace("booking", "weekly"); h.draft();
    button(drawer(h.model), "Save booking updates").props.onClick(); h.render(); h.choice.onCancel(); h.render();
    expect(h.mutations["bookings.updateDetails"].mutate).not.toHaveBeenCalled();
  });

  it("schedule success tracks the captured target date and announces its time", () => {
    const h = workspace("leadflow", "weekly"); h.draft(); h.model.updateActiveRecordSchedule(); h.render();
    h.choice.onChoose("visit"); h.render();
    h.mutations["leadflowJobs.update"].mutate.mock.calls[0][1].onSuccess(); h.render();
    expect(h.model.date).toBe(NEW_DATE); expect(h.model.importSummary).toContain(`${NEW_DATE} at ${NEW_TIME}`);
    expect(h.refetch).toHaveBeenCalled();
  });
});

describe("real BookingRescheduleChoice props and callbacks (not DOM lifecycle)", () => {
  it("uses the actual Radix-backed Dialog wrapper and has explicit visit/subsequent/cancel callbacks", () => {
    const onChoose = vi.fn(), onCancel = vi.fn();
    const tree = BookingRescheduleChoice({ open: true, date: NEW_DATE, time: NEW_TIME, pending: false, onChoose, onCancel });
    expect(tree.type).toBe(dialog.Dialog);
    const content = elements(tree).find(node => node.type === dialog.DialogContent);
    expect(content).toBeDefined();
    button(tree, "Move only this visitKeep subsequent visits on their original dates and times.").props.onClick();
    button(tree, "Shift subsequent visitsMove subsequent scheduled visits by the same number of calendar days and use the new time. Keep the recurring interval.").props.onClick();
    expect(onChoose.mock.calls).toEqual([["visit"], ["subsequent"]]);
    button(tree, "Cancel").props.onClick(); expect(onCancel).toHaveBeenCalledTimes(1);
    tree.props.onOpenChange(false); expect(onCancel).toHaveBeenCalledTimes(2);
    tree.props.onOpenChange(true); expect(onCancel).toHaveBeenCalledTimes(2);
    expect(text(tree)).toContain(`${NEW_DATE} at ${NEW_TIME}`);
    // SSR of the real closed Radix root proves compatibility, not mounted focus/portal behavior.
    expect(renderToStaticMarkup(React.createElement(BookingRescheduleChoice, { open: false, date: NEW_DATE, time: NEW_TIME, pending: false, onChoose, onCancel }))).toBe("");
  });

  it("while saving, every visible action is disabled and dismiss/Escape cannot cancel", () => {
    const onChoose = vi.fn(), onCancel = vi.fn();
    const tree = BookingRescheduleChoice({ open: true, date: NEW_DATE, time: NEW_TIME, pending: true, onChoose, onCancel });
    const buttons = elements(tree).filter(node => node.type === "button");
    expect(buttons).toHaveLength(3); expect(buttons.every(node => node.props.disabled)).toBe(true);
    tree.props.onOpenChange(false); expect(onCancel).not.toHaveBeenCalled();
    const preventDefault = vi.fn(); elements(tree).find(node => node.type === dialog.DialogContent).props.onEscapeKeyDown({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(onChoose).not.toHaveBeenCalled();
  });
});
