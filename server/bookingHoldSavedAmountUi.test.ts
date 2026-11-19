import React from "react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// OFFLINE ONLY: execute actual component/caller JSX with mock tRPC hooks and
// window.confirm, using React.createElement. No app, auth, DB, provider or model.
const root = resolve(import.meta.dirname, "..");
const componentPath = "client/src/components/BookingPaymentActions.tsx";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const head = (path: string) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" });
const icon = () => null;
type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements)
  : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
function button(tree: unknown, label: string) {
  const found = elements(tree).find(node => node.type === "button" && text(node) === label);
  if (!found) throw new Error(`Actual button missing: ${label}`);
  return found;
}
type Props = { bookingId: number; totalCents: number; holdTotalCents?: number; paymentStatus: string; paymentMethod?: string | null };
type Authorization = { id: number; status: string; amountCents: number };
const base: Props = { bookingId: 7, totalCents: 12000, holdTotalCents: 13900, paymentStatus: "card_on_file", paymentMethod: "card" };
function harness(options: { authorizations?: Authorization[]; source?: string; loading?: boolean; noProfile?: boolean; confirm?: boolean } = {}) {
  const confirm = vi.fn(() => options.confirm ?? true);
  const refetch = vi.fn(async () => undefined);
  const getInvalidate = vi.fn(async () => undefined);
  const listInvalidate = vi.fn(async () => undefined);
  const mutationNames = ["placeHold", "captureHold", "cancelHold", "chargeSavedCard"] as const;
  const mutations = Object.fromEntries(mutationNames.map(name => [name, { mutate: vi.fn(), isPending: false, error: null as null | { message: string } }])) as Record<typeof mutationNames[number], { mutate: ReturnType<typeof vi.fn>; isPending: boolean; error: null | { message: string } }>;
  const mutationOptions: Record<string, { onSuccess: () => void }> = {};
  const detail = { data: { profile: options.noProfile ? null : { stripePaymentMethodId: "pm_synthetic", cardBrand: "Visa", cardLast4: "4242" }, authorizations: options.authorizations ?? [] }, isLoading: options.loading ?? false, refetch };
  const query = vi.fn(() => detail);
  const trpc = {
    useUtils: () => ({ bookings: { get: { invalidate: getInvalidate }, list: { invalidate: listInvalidate } } }),
    bookingPaymentAdmin: {
      getForBooking: { useQuery: query },
      ...Object.fromEntries(mutationNames.map(name => [name, { useMutation: (input: { onSuccess: () => void }) => { mutationOptions[name] = input; return mutations[name]; } }])),
    },
  };
  const module = { exports: {} as { BookingPaymentActions: (props: Props) => Element } };
  const output = ts.transpileModule(options.source ?? read(componentPath), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, React, window: { confirm },
    require: (id: string) => {
      if (id === "lucide-react") return { CreditCard: icon, Loader2: icon };
      if (id === "@/lib/trpc") return { trpc };
      if (id === "react") return React;
      throw new Error(`Unexpected booking payment UI import: ${id}`);
    },
  }, { filename: componentPath, timeout: 1500 });
  return { render: (props: Props = base) => module.exports.BookingPaymentActions(props), confirm, mutations, mutationOptions, detail, query, refetch, getInvalidate, listInvalidate };
}

// Execute only the existing payment conditional JSX expression in each actual
// caller, not its whole page/component (which would mount unrelated app hooks).
function caller(path: string) {
  const source = read(path);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const candidates: ts.JsxExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression) {
      const value = node.expression.getText(file);
      if ((value.match(/<BookingPaymentActions\b/g) ?? []).length === 2 && value.includes('"cashapp"') && value.includes('"invoice"')) candidates.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  candidates.sort((a, b) => a.end - a.pos - (b.end - b.pos));
  if (!candidates[0]?.expression) throw new Error(`Actual native payment branch missing: ${path}`);
  const expression = candidates[0].expression.getText(file);
  const NativeCard = (_props: Props) => null;
  const PortalCard = () => null;
  const module = { exports: {} as { render: (active: Record<string, unknown>, model: Record<string, unknown>) => Element } };
  const output = ts.transpileModule(`exports.render = (active, model) => (${expression});`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, React, BookingPaymentActions: NativeCard,
    PortalRequestPaymentActions: PortalCard, CreditCard: icon, labelPaymentMethod: (value: string) => value,
  }, { filename: path, timeout: 1500 });
  const active = { source: "booking", id: 7, firstCleaningTotalCents: 13900, originalFirstCleaningTotalCents: 12000, paymentStatus: "card_on_file", paymentMethod: "card" };
  return {
    render: (overrides: Record<string, unknown> = {}) => module.exports.render({ ...active, ...overrides }, { portalPaymentAvailable: false }),
    nativeProps: (tree: unknown) => elements(tree).filter(node => node.type === NativeCard).map(node => node.props as Props),
  };
}

describe("actual BookingPaymentActions saved-amount hold confirmation", () => {
  it("confirms saved $139.00 and sends 13900, while leaving Charge $120 untouched", () => {
    const ui = harness(); const tree = ui.render();
    expect(button(tree, "Place hold").props.disabled).toBe(false);
    expect(button(tree, "Charge $120")).toBeDefined();
    expect(ui.confirm).not.toHaveBeenCalled();
    for (const mutation of Object.values(ui.mutations)) expect(mutation.mutate).not.toHaveBeenCalled();
    button(tree, "Place hold").props.onClick();
    expect(ui.confirm.mock.calls).toEqual([["Place a $139.00 hold on the saved card for this booking?"]]);
    expect(ui.mutations.placeHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true, expectedAmountCents: 13900 }]]);
    expect(ui.mutations.chargeSavedCard.mutate).not.toHaveBeenCalled();
    button(tree, "Charge $120").props.onClick();
    expect(ui.confirm).toHaveBeenLastCalledWith("Charge $120 to the saved card now?");
    expect(ui.mutations.chargeSavedCard.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true }]]);
    expect(ui.mutations.captureHold.mutate).not.toHaveBeenCalled();
    expect(ui.mutations.cancelHold.mutate).not.toHaveBeenCalled();
  });

  it("preserves decimal cents in $139.75 confirmation and expectedAmountCents payload", () => {
    const ui = harness(); const tree = ui.render({ ...base, holdTotalCents: 13975 });
    button(tree, "Place hold").props.onClick();
    expect(ui.confirm.mock.calls).toEqual([["Place a $139.75 hold on the saved card for this booking?"]]);
    expect(ui.mutations.placeHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true, expectedAmountCents: 13975 }]]);
    expect(button(tree, "Charge $120")).toBeDefined();
  });

  it("without holdTotalCents falls back to totalCents and preserves the exact old hold payload", () => {
    const ui = harness(); const { holdTotalCents: _ignored, ...props } = base;
    const tree = ui.render(props); button(tree, "Place hold").props.onClick();
    expect(ui.confirm.mock.calls).toEqual([["Place a $120.00 hold on the saved card for this booking?"]]);
    expect(ui.mutations.placeHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true }]]);
  });

  it.each([13900, 14900, 13975, undefined])("existing authorized 13725 overrides edited amount %s for active/Capture/Cancel text", holdTotalCents => {
    const ui = harness({ authorizations: [
      { id: 1, status: "canceled", amountCents: 9100 },
      { id: 2, status: "pending_card", amountCents: 14900 },
      { id: 3, status: "authorized", amountCents: 13725 },
    ] });
    const tree = ui.render({ ...base, paymentStatus: "authorized", holdTotalCents });
    expect(text(tree)).toContain("Hold active for $137.25.");
    expect(elements(tree).filter(node => node.type === "button").map(text)).toEqual(["Capture $137.25", "Cancel hold"]);
    button(tree, "Capture $137.25").props.onClick();
    expect(ui.confirm).toHaveBeenLastCalledWith("Capture $137.25 from this booking hold?");
    expect(ui.mutations.captureHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true }]]);
    button(tree, "Cancel hold").props.onClick();
    expect(ui.confirm).toHaveBeenLastCalledWith("Cancel the $137.25 hold for this booking?");
    expect(ui.mutations.cancelHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true }]]);
    expect(ui.mutations.placeHold.mutate).not.toHaveBeenCalled();
    expect(ui.mutations.chargeSavedCard.mutate).not.toHaveBeenCalled();
  });

  it("uses nullish, not truthy fallback for a zero saved amount and zero existing authorization", () => {
    const ui = harness(); button(ui.render({ ...base, holdTotalCents: 0 }), "Place hold").props.onClick();
    expect(ui.confirm).toHaveBeenLastCalledWith("Place a $0.00 hold on the saved card for this booking?");
    expect(ui.mutations.placeHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true, expectedAmountCents: 0 }]]);
    const active = harness({ authorizations: [{ id: 2, status: "authorized", amountCents: 0 }] });
    expect(text(active.render())).toContain("Hold active for $0.00.");
    expect(button(active.render(), "Capture $0.00")).toBeDefined();
  });

  it.each(["placeHold", "captureHold", "cancelHold", "chargeSavedCard"] as const)("declining confirmation suppresses %s", action => {
    const active = action === "captureHold" || action === "cancelHold";
    const ui = harness({ confirm: false, authorizations: active ? [{ id: 3, status: "authorized", amountCents: 13725 }] : [] });
    const labels = { placeHold: "Place hold", captureHold: "Capture $137.25", cancelHold: "Cancel hold", chargeSavedCard: "Charge $120" };
    button(ui.render(), labels[action]).props.onClick();
    expect(ui.confirm).toHaveBeenCalledTimes(1);
    for (const mutation of Object.values(ui.mutations)) expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("keeps Cash App paid text/actions identical to HEAD despite an edited hold amount", () => {
    const props = { ...base, paymentMethod: "cashapp", paymentStatus: "captured" };
    const ui = harness(); const tree = ui.render(props);
    const original = harness({ source: head(componentPath) });
    expect(text(tree)).toBe(text(original.render(props)));
    expect(text(tree)).toContain("Cash App · paid$120 was paid for the first cleaning.");
    expect(text(tree)).not.toContain("139");
    expect(elements(tree).filter(node => node.type === "button")).toHaveLength(0);
    expect(ui.confirm).not.toHaveBeenCalled();
    for (const mutation of Object.values(ui.mutations)) expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it("keeps loading/no-card branches and mutation success refreshes unchanged", () => {
    const loading = harness({ loading: true }); expect(text(loading.render())).toContain("Loading payment");
    expect(elements(loading.render()).filter(node => node.type === "button")).toHaveLength(0);
    const missing = harness({ noProfile: true });
    expect(text(missing.render({ ...base, paymentStatus: "not_started" }))).toContain("Customer has not saved a card yet.");
    const ui = harness(); ui.render();
    expect(ui.query).toHaveBeenCalledWith({ bookingId: 7 }, { staleTime: 5_000 });
    ui.mutationOptions.placeHold.onSuccess();
    expect(ui.refetch).toHaveBeenCalledTimes(1);
    expect(ui.getInvalidate.mock.calls).toEqual([[{ id: 7 }]]);
    expect(ui.listInvalidate).toHaveBeenCalledTimes(1);
  });

  it("keeps shared pending disablement and stale-amount error visible without false success", () => {
    const ui = harness(); ui.mutations.placeHold.isPending = true;
    expect(elements(ui.render()).filter(node => node.type === "button").every(node => node.props.disabled)).toBe(true);
    ui.mutations.placeHold.isPending = false;
    ui.mutations.placeHold.error = { message: "The booking amount changed. Refresh the booking and confirm the current hold amount." };
    const tree = ui.render();
    const alert = elements(tree).find(node => node.props.role === "alert")!;
    expect(text(alert)).toBe(ui.mutations.placeHold.error.message);
    expect(text(tree)).not.toContain("Hold active");
    expect(ui.refetch).not.toHaveBeenCalled();
  });

  it("normalizes only the optional hold prop/amount/hold labels/optional expected payload; every other component byte equals HEAD", () => {
    let source = read(componentPath);
    source = source.replace("bookingId, totalCents, holdTotalCents, paymentStatus, paymentMethod", "bookingId, totalCents, paymentStatus, paymentMethod");
    source = source.replace("totalCents: number; holdTotalCents?: number; paymentStatus", "totalCents: number; paymentStatus");
    const amount = '  const holdAmount = `$${((activeHold?.amountCents ?? holdTotalCents ?? totalCents) / 100).toFixed(2)}`;\n';
    expect(source.split(amount)).toHaveLength(2); source = source.replace(amount, "");
    expect(source.match(/\$\{holdAmount\}/g)).toHaveLength(4);
    source = source.replaceAll("${holdAmount}", "${amount}").replace("Capture {holdAmount}", "Capture {amount}");
    const payload = ', ...(holdTotalCents !== undefined ? { expectedAmountCents: holdTotalCents } : {})';
    expect(source.split(payload)).toHaveLength(2); source = source.replace(payload, "");
    expect(source).toBe(head(componentPath));
  });
});

describe.each([
  "client/src/pages/BookingsCRMExactLive.tsx",
  "client/src/components/NativeBookingsWorkspace.tsx",
])("actual native payment caller %s", path => {
  it("passes saved first 13900 only as holdTotalCents; original 12000 stays the direct-charge amount", () => {
    const ui = caller(path);
    expect(ui.nativeProps(ui.render())).toEqual([{ bookingId: 7, totalCents: 12000, holdTotalCents: 13900, paymentStatus: "card_on_file", paymentMethod: "card" }]);
    for (const paymentMethod of ["apple_pay", "google_pay"]) {
      expect(ui.nativeProps(ui.render({ paymentMethod }))[0]).toMatchObject({ totalCents: 12000, holdTotalCents: 13900, paymentMethod });
    }
    const props = ui.nativeProps(ui.render())[0];
    const payment = harness(); button(payment.render(props), "Place hold").props.onClick();
    expect(payment.confirm).toHaveBeenLastCalledWith("Place a $139.00 hold on the saved card for this booking?");
    expect(payment.mutations.placeHold.mutate.mock.calls).toEqual([[{ bookingId: 7, confirmed: true, expectedAmountCents: 13900 }]]);
    expect(button(payment.render(props), "Charge $120")).toBeDefined();
  });

  it("keeps Cash App captured caller on original amount with no hold prop, and unpaid/invoice/null branches untouched", () => {
    const ui = caller(path);
    expect(ui.nativeProps(ui.render({ paymentMethod: "cashapp", paymentStatus: "captured" }))).toEqual([{ bookingId: 7, totalCents: 12000, paymentStatus: "captured", paymentMethod: "cashapp" }]);
    for (const paymentStatus of ["charge_pending", "not_started"]) {
      const tree = ui.render({ paymentMethod: "cashapp", paymentStatus });
      expect(ui.nativeProps(tree)).toEqual([]); expect(text(tree)).toContain("Cash App");
    }
    const invoice = ui.render({ paymentMethod: "invoice" });
    expect(ui.nativeProps(invoice)).toEqual([]); expect(text(invoice)).toContain("Collection after service. No card is required.");
    expect(ui.nativeProps(ui.render({ firstCleaningTotalCents: null }))).toEqual([]);
  });

  it("preserves raw original nullish fallback while still passing saved amount including zero", () => {
    const ui = caller(path);
    expect(ui.nativeProps(ui.render({ originalFirstCleaningTotalCents: undefined }))[0]).toMatchObject({ totalCents: 13900, holdTotalCents: 13900 });
    expect(ui.nativeProps(ui.render({ originalFirstCleaningTotalCents: 0 }))[0]).toMatchObject({ totalCents: 0, holdTotalCents: 13900 });
    expect(ui.nativeProps(ui.render({ firstCleaningTotalCents: 0 }))[0]).toMatchObject({ totalCents: 12000, holdTotalCents: 0 });
  });
});
