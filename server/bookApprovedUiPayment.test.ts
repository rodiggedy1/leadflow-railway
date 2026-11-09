import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * LOCAL ONLY: no application imports, app startup, browser, DB, provider, or Stripe.
 * Real presentation modules are transpiled with an explicit import allowlist.
 * Callback tests evaluate actual source expressions with in-memory mutations.
 * AST/source contracts are labeled separately: these are not live checkout tests.
 * A DOM renderer is not installed; SSR cannot prove iframe lifecycle/focus behavior.
 */
const root = resolve(import.meta.dirname, "..");
const BASE = "bc63fd6cef3bc453c51f3fc4d7fb0b81fe85bf84";
const bookPath = "client/src/pages/Book.tsx";
const paymentPath = "client/src/components/approved-book/ApprovedBookPayment.tsx";
const contextPath = "client/src/components/approved-book/ApprovedBookContext.tsx";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const baseline = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
const parse = (source: string) => ts.createSourceFile("contract.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const current = parse(read(bookPath));
const control = parse(baseline(bookPath));
const paymentSource = parse(read(paymentPath));
const printer = ts.createPrinter({ removeComments: true });
const printed = (node: ts.Node, file: ts.SourceFile = current) => printer.printNode(ts.EmitHint.Unspecified, node, file);
function findAll<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const matches: T[] = [];
  const visit = (child: ts.Node) => { if (predicate(child)) matches.push(child); ts.forEachChild(child, visit); };
  visit(node);
  return matches;
}
function declaration(name: string, file = current): ts.VariableDeclaration {
  const nodes = findAll(file, ts.isVariableDeclaration).filter(node => ts.isIdentifier(node.name) && node.name.text === name);
  expect(nodes, `unique variable ${name}`).toHaveLength(1);
  return nodes[0];
}
function namedFunction(name: string, file = current): ts.FunctionDeclaration {
  const nodes = findAll(file, ts.isFunctionDeclaration).filter(node => node.name?.text === name);
  expect(nodes, `unique function ${name}`).toHaveLength(1);
  return nodes[0];
}
function initializer(name: string, file = current): ts.Expression {
  const node = declaration(name, file).initializer;
  expect(node, `initializer ${name}`).toBeDefined();
  return node!;
}
const bookFunction = namedFunction("Book");
type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
function tags(name: string, node: ts.Node = bookFunction): JsxTag[] {
  return findAll(node, (child): child is JsxTag => ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
    .filter(tag => tag.tagName.getText(current) === name);
}
function attr(tag: JsxTag, name: string): ts.Expression {
  const prop = tag.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(current) === name) as ts.JsxAttribute | undefined;
  expect(prop?.initializer, `${tag.tagName.getText(current)}.${name}`).toBeDefined();
  if (ts.isStringLiteral(prop!.initializer!)) return prop!.initializer!;
  expect(ts.isJsxExpression(prop!.initializer!)).toBe(true);
  return (prop!.initializer as ts.JsxExpression).expression!;
}
function evaluate(expression: ts.Expression, scope: Record<string, unknown> = {}, file = current): any {
  const code = ts.transpileModule(`module.exports = (${printed(expression, file)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, {
    ...scope, module, exports: module.exports, Error, Date, Intl,
    require: (id: string) => { if (id === "react/jsx-runtime") return jsxRuntime; throw new Error(`Unexpected callback import: ${id}`); },
  });
  return module.exports;
}
function safeModule(path: string, imports: Record<string, unknown> = {}): any {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, Error, Date, Intl,
    require: (id: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, id)) return imports[id];
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".svg")) return id;
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected presentation import: ${id}`);
    },
  });
  return module.exports;
}
const eastern = safeModule("shared/easternTime.ts");
const arrival = safeModule("shared/bookingArrival.ts", { zod: { z } });
const context = safeModule(contextPath, { "@shared/bookingArrival": arrival });
const iconMock = new Proxy({}, { get: (_target, key) => (props: object) => React.createElement("svg", { ...props, "data-icon": String(key) }) });
const ApprovedBookPayment = safeModule(paymentPath, {
  "lucide-react": iconMock,
  "@shared/easternTime": eastern,
  "./ApprovedBookContext": context,
}).default;
const methods = ["card", "apple_pay", "cashapp", "google_pay"] as const;
type Method = typeof methods[number];
const money = evaluate(namedFunction("money") as unknown as ts.Expression) as (cents: number) => string;
function fixture(pricingMode = "home") {
  return {
    flow: {
      pricingMode, service: "deep", frequency: "biweekly", bedrooms: 3, bathrooms: 2,
      maidCount: 2, hourCount: 4, requestedLocalDate: "2026-11-18", address: "123 Test Street, Apt 4, Test City, VA 22201",
      setStep: vi.fn(), setBedrooms: vi.fn(), setBathrooms: vi.fn(), setMaidCount: vi.fn(), setHourCount: vi.fn(),
      pricing: { firstCleaningTotalCents: 28765, futureVisitTotalCents: 25432, serviceSubtotalCents: 28000,
        discountPercent: 15, arrivalDiscountPercent: 5, arrivalDiscountCents: 1514,
        extras: [{ id: "laundry-load", label: "Laundry", quantity: 3, totalCents: 7500 }] },
    },
    location: { street: "123 Test Street", apt: "Apt 4", city: "Test City", region: "VA", zip: "22201" },
    arrival: arrival.createBookingArrivalPreference("preferred", "morning"),
    onBack: vi.fn(),
  };
}
function renderPayment(overrides: Record<string, unknown> = {}, value = fixture()) {
  const seen: string[] = [];
  const panels = Object.fromEntries(methods.map(method => [method, React.createElement(function CheckoutSentinel() {
    seen.push(method);
    return React.createElement("span", { "data-checkout-sentinel": method }, method);
  }, { key: method })]));
  const props = { selectedPaymentMethod: null, onPaymentMethodChange: vi.fn(), isSaving: false,
    allowCashAppSwitch: false, bookingDetailsLocked: false, cardOnFile: false, formError: "", onRetryFinalization: vi.fn(), panels, ...overrides };
  let tree: React.ReactElement | undefined;
  function Capture() { tree = ApprovedBookPayment(props); return tree; }
  const html = renderToStaticMarkup(React.createElement(context.ApprovedBookProvider, { value }, React.createElement(Capture)));
  return { html, tree: tree!, seen, props, value };
}
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
const methodButtons = (result: ReturnType<typeof renderPayment>) => elements(result.tree).filter(node => node.type === "button" && node.props.className === "br3-method-head");
const panelNodes = (result: ReturnType<typeof renderPayment>) => elements(result.tree).filter(node => /^br3-panel-/.test(node.props.id ?? ""));
const paymentTag = () => { const found = tags("ApprovedBookPayment"); expect(found).toHaveLength(1); return found[0]; };
function callbackScope() {
  return { setCardLabel: vi.fn(), setCardOnFile: vi.fn(), setFormError: vi.fn(), setComplete: vi.fn(),
    setCashAppExitRequest: vi.fn(), setSelectedPaymentMethod: vi.fn(), finalizeConfirmedCard: vi.fn(), money };
}
function actualPanels(overrides: Record<string, unknown> = {}) {
  const scope = { ...callbackScope(), customerName: "Local Test", selectedPaymentMethod: null, isSaving: false, cardOnFile: false,
    applePayAvailable: false, googlePayAvailable: false, cashAppExitRequest: null,
    selectedDate: eastern.parseEasternDate("2026-11-18"), priceBreakdown: { firstCleaningTotalCents: 28765 },
    prepareLockedBooking: vi.fn(), setApplePayAvailable: vi.fn(), setGooglePayAvailable: vi.fn(), setWalletBusy: vi.fn(), setCashAppBusy: vi.fn(),
    Check: () => null,
    PublicBookingCardSetupBeforeReservation: function CardMock() { return null; },
    BookingWalletCardOnFileCheckout: function WalletMock() { return null; },
    BookingCashAppCheckout: function CashMock() { return null; }, ...overrides };
  return { scope, panels: evaluate(attr(paymentTag(), "panels"), scope) };
}
function panelChild(result: ReturnType<typeof actualPanels>, method: Method, name: string) {
  const nodes = elements(result.panels[method]).filter(node => node.type === result.scope[name as keyof typeof result.scope]);
  expect(nodes, `${method} ${name}`).toHaveLength(1);
  return nodes[0];
}
function reservationHarness(overrides: Record<string, unknown> = {}) {
  const lead = { publicFunnelNumber: "LOCAL-FUNNEL-1", mutationToken: "local-token", version: 1, stage: "lead" };
  const reserved = { ...lead, version: 2, stage: "reserved" };
  const scope = { fullName: "Local Test", phone: "2025550123", email: "local@example.invalid", address: "123 Test Street",
    setFormError: vi.fn(), setFunnelRecord: vi.fn(), setComplete: vi.fn(),
    funnelRecordRef: { current: null as any }, bookingAttemptIdRef: { current: "LOCAL-ATTEMPT-1" },
    beginFunnelMutation: { mutateAsync: vi.fn().mockResolvedValue(lead) },
    reserveFunnelMutation: { mutateAsync: vi.fn().mockResolvedValue(reserved) },
    updateFunnelMutation: { mutateAsync: vi.fn().mockResolvedValue({ ...reserved, version: 3 }) },
    finalizeBookingMutation: { mutateAsync: vi.fn().mockResolvedValue({}) },
    buildPatch: vi.fn().mockReturnValue({ fixture: "canonical-patch" }), ...overrides };
  const remember = evaluate(initializer("rememberFunnelRecord"), scope);
  return { scope, lead, reserved, reserve: evaluate(initializer("reserveBooking"), { ...scope, rememberFunnelRecord: remember }),
    finalize: evaluate(initializer("finalizeConfirmedCard"), scope) };
}

describe("approved /book payment: runtime presentation (provider-free SSR)", () => {
  it("starts collapsed in exact Card, Apple Pay, Cash App, Google Pay order with all four children rendered", () => {
    const result = renderPayment();
    expect(result.seen).toEqual(methods);
    expect(methodButtons(result).map(button => button.props["aria-controls"])).toEqual(methods.map(method => `br3-panel-${method}`));
    expect(methodButtons(result).every(button => button.props["aria-expanded"] === false)).toBe(true);
    expect(panelNodes(result)).toHaveLength(4);
    for (const panel of panelNodes(result)) { expect(panel.props.inert).toBe(true); expect(panel.props["aria-hidden"]).toBe(true); }
    expect(result.html).toContain("Choose the option that works best for you.");
    expect(result.html).not.toContain("br3-charge-help");
  });
  it.each(methods)("selecting %s keeps every other checkout child present and inert", method => {
    const result = renderPayment({ selectedPaymentMethod: method });
    expect(result.seen).toEqual(methods);
    expect(panelNodes(result).filter(panel => panel.props.inert === false).map(panel => panel.props.id)).toEqual([`br3-panel-${method}`]);
    expect(panelNodes(result).filter(panel => panel.props["aria-hidden"] === false)).toHaveLength(1);
    expect(methodButtons(result).filter(button => button.props["aria-expanded"])).toHaveLength(1);
    expect(panelNodes(result).map(panel => panel.props.children)).toEqual(methods.map(method => result.props.panels[method]));
  });
  it("headers only select; repeated clicks never emit collapse, reservation, payment, or completion", () => {
    const onPaymentMethodChange = vi.fn();
    const onRetryFinalization = vi.fn();
    const result = renderPayment({ selectedPaymentMethod: "apple_pay", onPaymentMethodChange, onRetryFinalization });
    for (const button of methodButtons(result)) { button.props.onClick(); button.props.onClick(); }
    expect(onPaymentMethodChange.mock.calls).toEqual(methods.flatMap(method => [[method], [method]]));
    expect(onRetryFinalization).not.toHaveBeenCalled();
  });
  it.each([[false, false, false], [true, false, true], [true, true, false], [false, true, false]])(
    "retains header isSaving=%s / allowCashAppSwitch=%s gate (disabled=%s)", (isSaving, allowCashAppSwitch, disabled) => {
      const result = renderPayment({ isSaving, allowCashAppSwitch });
      expect(methodButtons(result).every(button => button.props.disabled === disabled)).toBe(true);
      if (isSaving) expect(elements(result.tree).filter(node => node.type === "button" && node.props.className === "br2-back")[0].props.disabled).toBe(true);
    });
  it.each([[false, "", false], [true, "", false], [false, "Local failure", false], [true, "Local failure", true]])(
    "finalization retry requires cardOnFile=%s and formError=%s", (cardOnFile, formError, visible) => {
      const onRetryFinalization = vi.fn();
      const result = renderPayment({ cardOnFile, formError, onRetryFinalization });
      const retry = elements(result.tree).filter(node => node.type === "button" && node.props.className === "br3-secure-button");
      expect(retry).toHaveLength(visible ? 1 : 0);
      if (visible) { retry[0].props.onClick(); expect(onRetryFinalization).toHaveBeenCalledOnce(); }
      expect(result.html.includes('role="alert"')).toBe(Boolean(formError));
    });
  it("disables the retry while saving without expanding a second payment step", () => {
    const result = renderPayment({ cardOnFile: true, formError: "Local failure", isSaving: true });
    const retry = elements(result.tree).find(node => node.props.className === "br3-secure-button");
    expect(retry.props.disabled).toBe(true);
    expect(panelNodes(result).every(panel => panel.props.inert)).toBe(true);
  });
  it("uses authoritative integer cents, real quantity totals, recurring amount, and selected Eastern date", () => {
    const result = renderPayment({ selectedPaymentMethod: "cashapp" });
    expect(result.html).toContain("$287.65");
    expect(result.html).toContain("$254.32");
    expect(result.html).toContain("$75.00");
    expect(result.html).toContain("Laundry × 3");
    expect(result.html).toContain("Wednesday, November 18");
    expect(result.html).toContain("Preferred · Morning");
    expect(result.html).toContain("123 Test Street, Apt 4");
    expect(result.html).toContain("Pay $287.65 today for your first clean");
    expect(result.html).toContain("3 bedrooms · 2 bathrooms");
  });
  it("uses existing canonical quantity setters in home and hourly modes and blocks edits while saving", () => {
    for (const pricingMode of ["home", "hourly"]) {
      const value = fixture(pricingMode);
      const result = renderPayment({ isSaving: true }, value);
      const quantities = elements(result.tree).filter(node => typeof node.type === "function" && node.type.name === "Quantity");
      expect(quantities).toHaveLength(2);
      expect(quantities.map(node => node.props.onChange)).toEqual(pricingMode === "home"
        ? [value.flow.setBedrooms, value.flow.setBathrooms] : [value.flow.setMaidCount, value.flow.setHourCount]);
      expect(quantities.every(node => node.props.disabled)).toBe(true);
      const markup = result.html;
      expect(markup).toContain(pricingMode === "home" ? "3 bedrooms · 2 bathrooms" : "2 cleaners · 4 hours");
      expect(markup).not.toContain('<input');
    }
  });
  it("adds no fake card fields, wallet actions, or extra finalization CTA to opaque checkout panels", () => {
    const result = renderPayment();
    expect(elements(result.tree).filter(node => ["input", "form"].includes(node.type))).toHaveLength(0);
    expect(methodButtons(result)).toHaveLength(4);
    expect(elements(result.tree).filter(node => node.type === "button" && node.props.className === "br3-secure-button")).toHaveLength(0);
    expect(result.html).not.toMatch(/UI preview only|VISUAL REVIEW ONLY|awaiting availability review/i);
  });
});

describe("approved /book payment: actual panel JSX with inert checkout mocks", () => {
  it("injects exactly one real card adapter, two real wallet adapters, and one real Cash App adapter", () => {
    expect(tags("PublicBookingCardSetupBeforeReservation")).toHaveLength(1);
    expect(tags("BookingWalletCardOnFileCheckout")).toHaveLength(2);
    expect(tags("BookingCashAppCheckout")).toHaveLength(1);
    const result = actualPanels();
    expect(Object.keys(result.panels)).toEqual(methods);
    const card = panelChild(result, "card", "PublicBookingCardSetupBeforeReservation");
    expect(card.props.customerName).toBe(result.scope.customerName);
    expect(card.props.onPrepareReservation).toBe(result.scope.prepareLockedBooking);
    expect(card.props.creatingBooking).toBe(false);
    expect(card.props).not.toHaveProperty("bookingId");
    for (const method of ["apple_pay", "google_pay"] as const) {
      const wallet = panelChild(result, method, "BookingWalletCardOnFileCheckout");
      expect(wallet.props.wallet).toBe(method);
      expect(wallet.props.active).toBe(false);
      expect(wallet.props.deferredAmountCents).toBe(28765);
      expect(wallet.props.deferredPaymentDate).toBe(result.scope.selectedDate);
      expect(wallet.props.customerName).toBe(result.scope.customerName);
      expect(wallet.props.onPrepareReservation).toBe(result.scope.prepareLockedBooking);
      expect(wallet.props.onBusyChange).toBe(result.scope.setWalletBusy);
      expect(wallet.props.onAvailabilityChange).toBe(method === "apple_pay" ? result.scope.setApplePayAvailable : result.scope.setGooglePayAvailable);
    }
    const cash = panelChild(result, "cashapp", "BookingCashAppCheckout");
    expect(cash.props.totalCents).toBe(28765);
    expect(cash.props.onPrepareReservation).toBe(result.scope.prepareLockedBooking);
    expect(cash.props.onBusyChange).toBe(result.scope.setCashAppBusy);
  });
  it.each(methods)("all injected adapters are created when %s is selected (no selection-gated unmount)", method => {
    const result = actualPanels({ selectedPaymentMethod: method });
    panelChild(result, "card", "PublicBookingCardSetupBeforeReservation");
    for (const wallet of ["apple_pay", "google_pay"] as const) expect(panelChild(result, wallet, "BookingWalletCardOnFileCheckout").props.active).toBe(wallet === method);
    expect(panelChild(result, "cashapp", "BookingCashAppCheckout").props.active).toBe(method === "cashapp");
  });
  it("preserves wallet availability messages separately from unconditional wallet adapters", () => {
    const unavailable = actualPanels();
    expect(elements(unavailable.panels.apple_pay).some(node => node.props.role === "status")).toBe(true);
    expect(elements(unavailable.panels.google_pay).some(node => node.props.role === "status")).toBe(true);
    const available = actualPanels({ applePayAvailable: true, googlePayAvailable: true });
    for (const method of ["apple_pay", "google_pay"] as const) {
      expect(elements(available.panels[method]).some(node => node.props.role === "status")).toBe(false);
      panelChild(available, method, "BookingWalletCardOnFileCheckout");
    }
  });
  it.each(["card", "apple_pay", "google_pay"] as const)("%s success keeps card identity/error clearing and existing finalization callback", method => {
    const result = actualPanels();
    const node = panelChild(result, method, method === "card" ? "PublicBookingCardSetupBeforeReservation" : "BookingWalletCardOnFileCheckout");
    node.props.onComplete({ cardBrand: "Visa", cardLast4: "4242" });
    expect(result.scope.setCardOnFile).toHaveBeenCalledWith(true);
    expect(result.scope.setFormError).toHaveBeenCalledWith("");
    expect(result.scope.finalizeConfirmedCard).toHaveBeenCalledOnce();
    expect(result.scope.setComplete).not.toHaveBeenCalled();
    expect(result.scope.setCardLabel).toHaveBeenCalledWith(method === "card" ? "Visa ending in 4242" : `${method === "apple_pay" ? "Apple Pay" : "Google Pay"} · Visa ending in 4242`);
  });
  it("Cash App paid callback completes only its established prepaid path without card finalization", () => {
    const result = actualPanels();
    const cash = panelChild(result, "cashapp", "BookingCashAppCheckout");
    cash.props.onPaid(28765);
    expect(result.scope.setCardLabel).toHaveBeenCalledWith("Cash App · $287.65 paid today");
    expect(result.scope.setFormError).toHaveBeenCalledWith("");
    expect(result.scope.setComplete).toHaveBeenCalledWith(true);
    expect(result.scope.setCardOnFile).not.toHaveBeenCalled();
    expect(result.scope.finalizeConfirmedCard).not.toHaveBeenCalled();
  });
  it("Cash App exit request remains active-bound and acknowledgement clears the handshake before selecting", () => {
    const pending = actualPanels({ selectedPaymentMethod: "cashapp", cashAppExitRequest: "google_pay" });
    const cash = panelChild(pending, "cashapp", "BookingCashAppCheckout");
    expect(cash.props.exitRequest).toBe("google_pay");
    cash.props.onExited("google_pay", "Local cancellation notice");
    expect(pending.scope.setCashAppExitRequest).toHaveBeenCalledWith(null);
    expect(pending.scope.setSelectedPaymentMethod).toHaveBeenCalledWith("google_pay");
    expect(pending.scope.setFormError).toHaveBeenCalledWith("Local cancellation notice");
    const inactive = actualPanels({ selectedPaymentMethod: "card", cashAppExitRequest: "google_pay" });
    expect(panelChild(inactive, "cashapp", "BookingCashAppCheckout").props.exitRequest).toBe(null);
  });
  it("saved-card finalization failure exposes the existing retry and replaces only the completed card child", () => {
    const result = actualPanels({ cardOnFile: true });
    expect(elements(result.panels.card).some(node => node.type === result.scope.PublicBookingCardSetupBeforeReservation)).toBe(false);
    for (const wallet of ["apple_pay", "google_pay"] as const) panelChild(result, wallet, "BookingWalletCardOnFileCheckout");
    panelChild(result, "cashapp", "BookingCashAppCheckout");
    const scope = callbackScope();
    evaluate(attr(paymentTag(), "onRetryFinalization"), scope)();
    expect(scope.finalizeConfirmedCard).toHaveBeenCalledOnce();
    expect(scope.setComplete).not.toHaveBeenCalled();
  });
});

describe("approved /book payment: actual controller callbacks with in-memory mutations", () => {
  it.each(["card", "apple_pay", "google_pay"])("Cash App busy selection of %s requests exit but retains the active method", destination => {
    const scope = { ...callbackScope(), cashAppBusy: true, selectedPaymentMethod: "cashapp" };
    evaluate(initializer("choosePaymentMethod"), scope)(destination);
    expect(scope.setCashAppExitRequest).toHaveBeenCalledWith(destination);
    expect(scope.setSelectedPaymentMethod).not.toHaveBeenCalled();
    expect(scope.setFormError).not.toHaveBeenCalled();
  });
  it("nonbusy selection clears the exit/error and repeated selection does not collapse", () => {
    const scope = { ...callbackScope(), cashAppBusy: false, selectedPaymentMethod: "card" };
    const choose = evaluate(initializer("choosePaymentMethod"), scope);
    choose("card"); choose("card");
    expect(scope.setSelectedPaymentMethod.mock.calls).toEqual([["card"], ["card"]]);
    expect(scope.setCashAppExitRequest.mock.calls).toEqual([[null], [null]]);
    expect(scope.setFormError.mock.calls).toEqual([[""], [""]]);
  });
  it.each(["beginFunnelMutation", "updateFunnelMutation", "reserveFunnelMutation", "finalizeBookingMutation", "walletBusy", "cashAppBusy"])("isSaving keeps the %s gate", name => {
    const scope: Record<string, any> = { beginFunnelMutation: { isPending: false }, updateFunnelMutation: { isPending: false }, reserveFunnelMutation: { isPending: false }, finalizeBookingMutation: { isPending: false }, walletBusy: false, cashAppBusy: false };
    expect(evaluate(initializer("isSaving"), scope)).toBe(false);
    if (name.endsWith("Mutation")) scope[name].isPending = true; else scope[name] = true;
    expect(evaluate(initializer("isSaving"), scope)).toBe(true);
  });
  it("reserve retry reuses the retained attempt and begun funnel after failure without duplicate begin", async () => {
    const result = reservationHarness();
    result.scope.reserveFunnelMutation.mutateAsync.mockRejectedValueOnce(new Error("Local reserve failure"));
    expect(await result.reserve()).toBeNull();
    expect(result.scope.funnelRecordRef.current).toBe(result.lead);
    expect(result.scope.setFormError).toHaveBeenLastCalledWith("Local reserve failure");
    expect(await result.reserve()).toBe(result.reserved);
    expect(result.scope.beginFunnelMutation.mutateAsync).toHaveBeenCalledOnce();
    expect(result.scope.beginFunnelMutation.mutateAsync).toHaveBeenCalledWith({ idempotencyKey: "LOCAL-ATTEMPT-1", source: "book-page", customerName: "Local Test", customerPhone: "2025550123" });
    expect(result.scope.reserveFunnelMutation.mutateAsync).toHaveBeenCalledTimes(2);
    for (const [input] of result.scope.reserveFunnelMutation.mutateAsync.mock.calls) expect(input).toMatchObject({ publicFunnelNumber: result.lead.publicFunnelNumber, mutationToken: result.lead.mutationToken, expectedVersion: 1 });
    expect(result.scope.funnelRecordRef.current).toBe(result.reserved);
    expect(result.scope.setFormError).toHaveBeenLastCalledWith("");
  });
  it("a retained non-lead funnel updates its current version instead of beginning or reserving again", async () => {
    const result = reservationHarness();
    result.scope.funnelRecordRef.current = result.reserved;
    const updated = await result.reserve();
    expect(updated.version).toBe(3);
    expect(result.scope.beginFunnelMutation.mutateAsync).not.toHaveBeenCalled();
    expect(result.scope.reserveFunnelMutation.mutateAsync).not.toHaveBeenCalled();
    expect(result.scope.updateFunnelMutation.mutateAsync).toHaveBeenCalledWith({ publicFunnelNumber: result.reserved.publicFunnelNumber, mutationToken: result.reserved.mutationToken, expectedVersion: 2, patch: { fixture: "canonical-patch" } });
    expect(result.scope.funnelRecordRef.current).toBe(updated);
  });
  it.each([{ fullName: "Only" }, { phone: "12" }, { email: "invalid" }, { address: "" }])("existing validation returns before transport for %j", invalid => {
    const result = reservationHarness(invalid);
    return result.reserve().then((value: unknown) => {
      expect(value).toBeNull();
      expect(result.scope.setFormError).toHaveBeenCalledOnce();
      expect(result.scope.beginFunnelMutation.mutateAsync).not.toHaveBeenCalled();
      expect(result.scope.reserveFunnelMutation.mutateAsync).not.toHaveBeenCalled();
      expect(result.scope.updateFunnelMutation.mutateAsync).not.toHaveBeenCalled();
    });
  });
  it("failed finalization retains identity and only existing finalize retries before success", async () => {
    const result = reservationHarness();
    result.scope.funnelRecordRef.current = result.reserved;
    result.scope.finalizeBookingMutation.mutateAsync.mockRejectedValueOnce(new Error("Local finalize failure"));
    await result.finalize();
    expect(result.scope.setFormError).toHaveBeenLastCalledWith("Local finalize failure");
    expect(result.scope.setComplete).not.toHaveBeenCalled();
    expect(result.scope.funnelRecordRef.current).toBe(result.reserved);
    await result.finalize();
    expect(result.scope.setComplete).toHaveBeenCalledWith(true);
    expect(result.scope.finalizeBookingMutation.mutateAsync.mock.calls).toEqual([[{ publicFunnelNumber: result.reserved.publicFunnelNumber, mutationToken: result.reserved.mutationToken }], [{ publicFunnelNumber: result.reserved.publicFunnelNumber, mutationToken: result.reserved.mutationToken }]]);
    expect(result.scope.beginFunnelMutation.mutateAsync).not.toHaveBeenCalled();
    expect(result.scope.reserveFunnelMutation.mutateAsync).not.toHaveBeenCalled();
  });
  it("missing funnel cannot finalize or claim completion", async () => {
    const result = reservationHarness();
    await result.finalize();
    expect(result.scope.setFormError).toHaveBeenCalledWith("We couldn't confirm your booking. Please try again.");
    expect(result.scope.finalizeBookingMutation.mutateAsync).not.toHaveBeenCalled();
    expect(result.scope.setComplete).not.toHaveBeenCalled();
  });
  it.each(["08:00", "12:00"])("buildPatch keeps full canonical preferred start %s rather than the old slot fallback", preferred => {
    const scope = { fullName: "Local Test", phone: "2025550123", email: "local@example.invalid", service: "deep", bedrooms: 3, bathrooms: 2,
      extras: { "laundry-load": 3 }, selectedCanonicalExtras: vi.fn().mockReturnValue([{ id: "laundry-load", quantity: 3 }]),
      notes: " Local access note ", bookingAccessMethod: "I’ll be at home", address: "123 Test Street", dateIso: "2026-11-18", requestedLocalTime: preferred,
      selectedTime: "8:30 AM", timeLabelTo24Hour: vi.fn().mockReturnValue("08:30"), frequency: "biweekly",
      PUBLIC_BOOKING_PRICING_VERSION: "public-book-v2", getPublicBookingServiceName: vi.fn().mockReturnValue("Deep Cleaning"),
      priceBreakdown: { firstCleaningTotalCents: 28765, futureVisitTotalCents: 25432 }, snapshot: { authoritative: "local-snapshot" } };
    const patch = evaluate(initializer("buildPatch"), scope)();
    expect(patch.requestedLocalTime).toBe(preferred);
    expect(patch.requestedLocalDate).toBe(scope.dateIso);
    expect(patch.requestedTimeZone).toBe("America/New_York");
    expect(patch.firstCleaningTotalCents).toBe(28765);
    expect(patch.futureVisitTotalCents).toBe(25432);
    expect(patch.priceSnapshot).toBe(scope.snapshot);
    expect(patch.extras).toEqual([{ id: "laundry-load", quantity: 3 }]);
    expect(scope.selectedCanonicalExtras).toHaveBeenCalledWith(scope.extras);
    expect(scope.timeLabelTo24Hour).not.toHaveBeenCalled();
  });
});

describe("approved /book payment: explicit AST/source preservation contracts (not live integration)", () => {
  it.each(["choosePaymentMethod", "rememberFunnelRecord", "reserveBooking", "finalizeConfirmedCard", "isSaving", "funnelRecordRef", "bookingAttemptIdRef"])("keeps protected %s AST equal to the clean fixed baseline", name => {
    expect(printed(initializer(name))).toBe(printed(initializer(name, control), control));
  });
  it("keeps all four protected controller declarations byte-identical, not just AST-equivalent", () => {
    for (const name of ["choosePaymentMethod", "rememberFunnelRecord", "reserveBooking", "finalizeConfirmedCard"]) {
      expect(declaration(name).getText(current), `${name} source equality`).toBe(declaration(name, control).getText(control));
    }
  });
  it("allows only the approved requestedLocalTime and access-notes exceptions in buildPatch", () => {
    const object = (file: ts.SourceFile) => {
      const result = findAll(initializer("buildPatch", file), ts.isObjectLiteralExpression);
      expect(result).toHaveLength(1);
      return result[0];
    };
    const propertyName = (prop: ts.ObjectLiteralElementLike) => prop.name?.getText();
    const remaining = (file: ts.SourceFile) => object(file).properties.filter(prop => !["requestedLocalTime", "specialRequestNotes"].includes(propertyName(prop) ?? "")).map(prop => printed(prop, file));
    expect(remaining(current)).toEqual(remaining(control));
    const note = object(current).properties.find(prop => propertyName(prop) === "specialRequestNotes")!;
    expect(printed(note)).toBe("specialRequestNotes: [...(notes.trim() ? [notes.trim()] : []), `Access: ${bookingAccessMethod}`]");
    const requested = object(current).properties.find(prop => propertyName(prop) === "requestedLocalTime")!;
    const value = ts.isShorthandPropertyAssignment(requested) ? requested.name : (requested as ts.PropertyAssignment).initializer;
    expect(ts.isIdentifier(value) && value.text === "requestedLocalTime").toBe(true);
    expect(object(current).properties.length).toBe(object(control).properties.length);
  });
  it("keeps attempt generation and the early Cash App return ahead of normal completion", () => {
    expect(printed(namedFunction("createBookingAttemptId"))).toBe(printed(namedFunction("createBookingAttemptId", control), control));
    const body = bookFunction.body!;
    const earlyReturn = body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(current) === "cashAppReturnToken")!;
    const completion = body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(current) === "complete")!;
    expect(earlyReturn.getStart()).toBeLessThan(completion.getStart());
    expect(earlyReturn.getStart()).toBeLessThan(paymentTag().getStart());
    expect(printed(earlyReturn)).toContain("CashAppBookingReturn");
    expect(printed(initializer("cashAppReturnToken"))).toBe(printed(initializer("cashAppReturnToken", control), control));
  });
  it("Cash App return changes only the approved arrival display while preserving polling, completion and legacy fallback", () => {
    const handler = namedFunction("CashAppBookingReturn");
    const legacyHandler = namedFunction("CashAppBookingReturn", control);
    const time = findAll(handler, ts.isVariableDeclaration).find(node => node.name.getText(current) === "time")!;
    const legacyTime = findAll(legacyHandler, ts.isVariableDeclaration).find(node => node.name.getText(control) === "time")!;
    expect(ts.isConditionalExpression(time.initializer!)).toBe(true);
    const expression = time.initializer as ts.ConditionalExpression;
    expect(printed(expression.condition)).toBe("booking.arrivalPreference");
    expect(printed(expression.whenTrue)).toBe("formatBookingArrivalPreference(booking.arrivalPreference)");
    expect(printed(expression.whenFalse)).toBe(printed(legacyTime.initializer!, control));
    // Reparse instead of moving source-position-bearing nodes between files.
    const normalized = parse(current.text.slice(0, time.initializer!.getStart(current))
      + legacyTime.initializer!.getText(control) + current.text.slice(time.initializer!.end));
    expect(printed(namedFunction("CashAppBookingReturn", normalized), normalized)).toBe(printed(legacyHandler, control));
  });
  it("retains existing payment transport declarations and does not create presentation transports", () => {
    for (const name of ["beginFunnelMutation", "updateFunnelMutation", "reserveFunnelMutation", "finalizeBookingMutation"]) expect(printed(initializer(name))).toBe(printed(initializer(name, control), control));
    const calls = findAll(bookFunction, ts.isCallExpression).filter(call => call.expression.getText(current).endsWith(".useMutation"));
    expect(calls).toHaveLength(4);
    const presentation = read(paymentPath);
    expect(presentation).not.toMatch(/\btrpc\b|\bfetch\s*\(|\baxios\b|new\s+(WebSocket|XMLHttpRequest)|loadStripe|confirmCardSetup|confirmCashappPayment/);
    expect(presentation).not.toMatch(/\buseState\b|localStorage|sessionStorage|reviewState|demoState|mockPayment/i);
  });
  it("keeps stepCount 8 with only public Flexible overrides and visible canonical step navigation 1, 2, 6", () => {
    const calls = findAll(bookFunction, ts.isCallExpression).filter(call => call.expression.getText(current) === "useCanonicalBookingFlow");
    expect(calls).toHaveLength(1);
    const config = evaluate(calls[0].arguments[0], { PUBLIC_BOOK_DRAFT_OVERRIDES: evaluate(initializer("PUBLIC_BOOK_DRAFT_OVERRIDES"), { createBookingArrivalPreference: arrival.createBookingArrivalPreference }) });
    expect(config.stepCount).toBe(8);
    expect(config.overrides).toEqual({ requestedLocalTime: "08:30", arrivalPreference: arrival.createBookingArrivalPreference("flexible") });
    const provider = tags("ApprovedBookProvider")[0];
    expect(provider).toBeDefined();
    const scope = { flow: {}, bookingLocation: {}, setBookingLocationFields: vi.fn(), arrivalPreference: {}, onArrivalChange: vi.fn(), dateCleared: false,
      requestedLocalDate: "2026-11-18", easternDateIso: () => "2026-11-10", setDateCleared: vi.fn(), setRequestedLocalDate: vi.fn(),
      setStep: vi.fn(), step: 1, bookingPreparationRef: { current: { pending: 0, prepared: false } }, bookingAccessMethod: "I’ll be at home", setBookingAccessMethod: vi.fn(), APPROVED_BOOK_ASSETS: {} };
    const value = evaluate(attr(provider, "value"), scope);
    value.onNext(); expect(scope.setStep).toHaveBeenLastCalledWith(2);
    const second = evaluate(attr(provider, "value"), { ...scope, step: 2 });
    second.onNext(); expect(scope.setStep).toHaveBeenLastCalledWith(6);
    second.onBack(); expect(scope.setStep).toHaveBeenLastCalledWith(1);
    const third = evaluate(attr(provider, "value"), { ...scope, step: 6 });
    third.onBack(); expect(scope.setStep).toHaveBeenLastCalledWith(2);
    expect(tags("ApprovedBookFirstPage")).toHaveLength(1);
    expect(tags("ApprovedBookSecondPage")).toHaveLength(1);
    expect(tags("ApprovedBookPayment")).toHaveLength(1);
    for (const step of [1, 2, 6]) expect(evaluate(initializer("visibleStep"), { step })).toBe(step === 6 ? 3 : step);
  });
  it("payment selection starts null and exposes the identical Cash App switch condition", () => {
    const selected = findAll(bookFunction, ts.isVariableDeclaration).find(node => ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(current) === "selectedPaymentMethod")!;
    expect(ts.isCallExpression(selected.initializer!) && selected.initializer.arguments[0].kind === ts.SyntaxKind.NullKeyword).toBe(true);
    for (const selectedPaymentMethod of methods) for (const cashAppBusy of [true, false]) for (const cashAppExitRequest of [null, "card"]) {
      expect(evaluate(initializer("allowCashAppSwitch"), { selectedPaymentMethod, cashAppBusy, cashAppExitRequest })).toBe(selectedPaymentMethod === "cashapp" && cashAppBusy && cashAppExitRequest === null);
    }
    expect(printed(attr(paymentTag(), "onPaymentMethodChange"))).toBe("choosePaymentMethod");
    for (const name of ["isSaving", "bookingDetailsLocked", "allowCashAppSwitch", "cardOnFile", "formError", "selectedPaymentMethod"]) expect(printed(attr(paymentTag(), name))).toBe(name);
  });
  it("retains stable keyed panels and clips inactive panels without display:none or conditional children", () => {
    const source = read(paymentPath);
    expect(source).toContain("key={option.id}");
    expect(source).toContain("{panels[option.id]}");
    expect(source).not.toMatch(/active\s*&&\s*panels|active\s*\?\s*panels|selectedPaymentMethod\s*&&\s*panels/);
    const css = read("client/src/components/approved-book/approved-payment.css");
    const closed = /\.br-third-page \.br3-method-detail:not\(\.is-open\)\s*\{([^}]+)\}/.exec(css)?.[1];
    expect(closed).toBeDefined();
    expect(closed).toMatch(/height:\s*0\s*;/);
    expect(closed).toMatch(/overflow:\s*hidden\s*;/);
    expect(closed).toMatch(/pointer-events:\s*none\s*;/);
    expect(closed).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
  it.each(["client/src/components/BookingPaymentCheckout.tsx", "client/src/components/BookingApplePayCheckout.tsx", "client/src/components/BookingCashAppCheckout.tsx", "client/src/components/useStripeCardSetup.ts", "client/src/components/useCanonicalBookingFlow.ts"])("leaves real protected lifecycle file %s byte-for-byte equal to baseline", path => {
    expect(read(path)).toBe(baseline(path));
  });
  it("retains card form before reservation, real Stripe combined card element, reservation cache, and deferred consent path", () => {
    const card = read("client/src/components/BookingPaymentCheckout.tsx");
    const adapter = printed(namedFunction("PublicBookingCardSetupBeforeReservation", parse(card)), parse(card));
    expect(adapter).toContain("reservationRef.current ?? (await onPrepareReservation())");
    expect(adapter).toContain("reservationRef.current = reservation");
    expect(adapter).toContain("if (result.alreadyComplete)");
    expect(adapter).toContain("finalizationRequired: true");
    expect(adapter).toContain("consentAccepted: true");
    expect(adapter).toContain("deferConfirmation: true");
    expect(adapter).toContain("<InternalCardSetupForm");
    const internal = printed(namedFunction("InternalCardSetupForm", parse(card)), parse(card));
    expect(internal).toContain('autoComplete="cc-name"');
    expect(internal).toContain("<CardElement");
    expect(internal).toContain("stripe.confirmCardSetup");
    expect(internal).toContain("autoConfirmKey.current === clientSecret");
    expect(internal).toContain("await onCreateBooking?.()");
    expect(internal).toContain("await onConfirm(setupIntent.payment_method as string)");
  });
  it("retains Cash App settle/abandon completed-exit guard and queued preparation exit handshake", () => {
    const cash = read("client/src/components/BookingCashAppCheckout.tsx");
    for (const fragment of ["preparedRef.current", "startingRef.current = true", "exitRef.current = { destination }", "if (exitRef.current)", "await abandonPrepared(pending, exitRef.current.destination)", '"alreadySucceeded" in result && result.alreadySucceeded', "await settleSucceeded(payment)", "onPaid(payment.totalCents)", "onExited(destination, notice)", "if (!active || preparedRef.current || startingRef.current) return", "payment.totalCents !== totalCents"]) expect(cash).toContain(fragment);
  });
  it("uses no off-limits legacy names in the new scoped test or approved integration surface", () => {
    const forbidden = ["cleaner" + "_jobs", "cleaner" + "Jobs"];
    const paths = ["server/bookApprovedUiPayment.test.ts", bookPath, paymentPath, contextPath, "client/src/components/approved-book/FirstPage.tsx", "client/src/components/approved-book/SecondPage.tsx", "client/src/components/approved-book/ArrivalOptions.tsx"];
    for (const path of paths) for (const name of forbidden) expect(read(path), `${path} legacy boundary`).not.toContain(name);
  });
});


describe("approved /book: reviewed lifecycle-gap corrections", () => {
  it.each([[17010, "$170.10"], [17955, "$179.55"], [28765, "$287.65"], [18900, "$189"], [0, "$0"]])("actual Book formatter preserves %s cents as %s", (cents, expected) => {
    expect(money(cents as number)).toBe(expected);
  });
  it("uses that exact formatter on saved-card success, recurring success and Cash App return", () => {
    const success = printed(namedFunction("BookingSuccess"));
    const returned = printed(namedFunction("CashAppBookingReturn"));
    expect(success).toContain("money(total)");
    expect(success).toContain("money(futureTotal)");
    expect(returned).toContain("money(booking.firstCleaningTotalCents)");
    expect(printed(namedFunction("money"))).not.toContain("Math.round");
  });
  function lockHarness(reserveBooking = vi.fn()) {
    const scope = {
      reserveBooking,
      bookingPreparationRef: { current: { pending: 0, prepared: false } },
      setBookingDetailsLocked: vi.fn(),
    };
    return { scope, prepare: evaluate(initializer("prepareLockedBooking"), scope) };
  }
  it("locks synchronously before existing reservation and remains locked after a retained target", async () => {
    let release!: (value: unknown) => void;
    const record = { publicFunnelNumber: "LOCAL", mutationToken: "LOCAL", version: 2 };
    const result = lockHarness(vi.fn(() => new Promise(resolve => { release = resolve; })));
    const pending = result.prepare();
    expect(result.scope.setBookingDetailsLocked).toHaveBeenCalledWith(true);
    expect(result.scope.bookingPreparationRef.current).toEqual({ pending: 1, prepared: false });
    release(record);
    expect(await pending).toBe(record);
    expect(result.scope.bookingPreparationRef.current).toEqual({ pending: 0, prepared: true });
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(true);
    expect(result.scope.reserveBooking).toHaveBeenCalledOnce();
  });
  it.each([{ fullName: "Only" }, { phone: "12" }, { email: "invalid" }, { address: "" }])("unlocks for existing validation failure %j before any target is returned", async invalid => {
    const reservation = reservationHarness(invalid);
    const result = lockHarness(reservation.reserve);
    expect(await result.prepare()).toBeNull();
    expect(result.scope.setBookingDetailsLocked.mock.calls).toEqual([[true], [false]]);
    expect(result.scope.bookingPreparationRef.current).toEqual({ pending: 0, prepared: false });
    expect(reservation.scope.beginFunnelMutation.mutateAsync).not.toHaveBeenCalled();
  });
  it("unlocks for a failed initial reserve while preserving the existing funnel identity and retry", async () => {
    const reservation = reservationHarness();
    reservation.scope.reserveFunnelMutation.mutateAsync.mockRejectedValueOnce(new Error("Offline reserve failure"));
    const result = lockHarness(reservation.reserve);
    expect(await result.prepare()).toBeNull();
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(false);
    expect(reservation.scope.funnelRecordRef.current).toBe(reservation.lead);
    expect(await result.prepare()).toBe(reservation.reserved);
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(true);
    expect(reservation.scope.beginFunnelMutation.mutateAsync).toHaveBeenCalledOnce();
  });
  it("a later failed preparation cannot unlock a previously retained card/wallet/Cash App reservation", async () => {
    const reservation = reservationHarness();
    const result = lockHarness(reservation.reserve);
    await result.prepare();
    reservation.scope.updateFunnelMutation.mutateAsync.mockRejectedValueOnce(new Error("Offline update failure"));
    expect(await result.prepare()).toBeNull();
    expect(result.scope.bookingPreparationRef.current.prepared).toBe(true);
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(true);
  });
  it("overlapping preparations keep edits locked until every unsuccessful pre-target attempt completes", async () => {
    const releases: ((value: unknown) => void)[] = [];
    const result = lockHarness(vi.fn(() => new Promise(resolve => releases.push(resolve))));
    const first = result.prepare();
    const second = result.prepare();
    releases[0](null); await first;
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(true);
    expect(result.scope.bookingPreparationRef.current.pending).toBe(1);
    releases[1](null); await second;
    expect(result.scope.setBookingDetailsLocked).toHaveBeenLastCalledWith(false);
    expect(result.scope.reserveBooking).toHaveBeenCalledTimes(2);
  });
  it.each(["home", "hourly"])("blocks every %s quote/navigation edit after preparation but leaves existing method switching and retry usable", mode => {
    const value = fixture(mode);
    const result = renderPayment({ bookingDetailsLocked: true, cardOnFile: true, formError: "Offline finalization failure" }, value);
    const nodes = elements(result.tree);
    const editButtons = nodes.filter(node => node.type === "button" && (node.props.className === "br2-back" || node.props.children === "Change"));
    expect(editButtons.length).toBeGreaterThan(3);
    for (const button of editButtons) { expect(button.props.disabled).toBe(true); button.props.onClick(); }
    expect(value.flow.setStep).not.toHaveBeenCalled();
    expect(value.onBack).not.toHaveBeenCalled();
    const quantities = nodes.filter(node => typeof node.type === "function" && node.type.name === "Quantity");
    for (const quantity of quantities) {
      expect(quantity.props.disabled).toBe(true);
      for (const button of elements(quantity.type(quantity.props)).filter(node => node.type === "button")) {
        expect(button.props.disabled).toBe(true); button.props.onClick();
      }
    }
    for (const setter of [value.flow.setBedrooms, value.flow.setBathrooms, value.flow.setMaidCount, value.flow.setHourCount]) expect(setter).not.toHaveBeenCalled();
    expect(methodButtons(result).every(button => !button.props.disabled)).toBe(true);
    const retry = nodes.find(node => node.props.className === "br3-secure-button");
    expect(retry.props.disabled).toBe(false); retry.props.onClick();
    expect(result.props.onRetryFinalization).toHaveBeenCalledOnce();
    expect(result.seen).toEqual(methods);
  });
  it("keeps quote edits available before preparation and guards Back using the synchronous preparation ref", () => {
    const result = renderPayment();
    const editButtons = elements(result.tree).filter(node => node.type === "button" && (node.props.className === "br2-back" || node.props.children === "Change"));
    expect(editButtons.every(button => !button.props.disabled)).toBe(true);
    const provider = tags("ApprovedBookProvider")[0];
    for (const ref of [{ pending: 1, prepared: false }, { pending: 0, prepared: true }]) {
      const setStep = vi.fn();
      const scope = { flow: {}, bookingLocation: {}, setBookingLocationFields: vi.fn(), arrivalPreference: {}, onArrivalChange: vi.fn(), dateCleared: false,
        requestedLocalDate: "2026-11-18", easternDateIso: () => "2026-11-10", setDateCleared: vi.fn(), setRequestedLocalDate: vi.fn(),
        setStep, step: 6, bookingPreparationRef: { current: ref }, bookingAccessMethod: "I’ll be at home", setBookingAccessMethod: vi.fn(), APPROVED_BOOK_ASSETS: {} };
      evaluate(attr(provider, "value"), scope).onBack();
      expect(setStep).not.toHaveBeenCalled();
    }
  });
});


describe("approved /book: access choice uses existing booking notes", () => {
  function accessPatch(notes: string, bookingAccessMethod: string) {
    const scope = {
      fullName: "Local Customer", phone: "2025550123", email: "local@example.invalid",
      service: "standard", getPublicBookingServiceName: () => "Standard Cleaning",
      bedrooms: 2, bathrooms: 1, extras: {}, selectedCanonicalExtras: () => [], notes, bookingAccessMethod,
      address: "123 Test Street, Washington, DC, 20009", dateIso: "2026-11-18", requestedLocalTime: "08:30",
      selectedTime: "8:30 AM", timeLabelTo24Hour: () => "08:30",
      frequency: "one-time", PUBLIC_BOOKING_PRICING_VERSION: "local-pricing",
      priceBreakdown: { firstCleaningTotalCents: 17010, futureVisitTotalCents: null }, snapshot: { fixture: true },
    };
    return { scope, build: evaluate(initializer("buildPatch"), scope) };
  }
  it.each(["I’ll be at home", "Someone will let you in", "Other — see special instructions"])("persists exact access choice %s after customer instructions", choice => {
    const result = accessPatch("  Keep the gate closed\nLeave the keys inside  ", choice);
    expect(result.build().specialRequestNotes).toEqual(["Keep the gate closed\nLeave the keys inside", `Access: ${choice}`]);
    expect(result.build().specialRequestNotes).toEqual(result.build().specialRequestNotes);
    expect(result.scope.notes).toBe("  Keep the gate closed\nLeave the keys inside  ");
  });
  it("saves the default selected access instruction even when no additional note is entered", () => {
    const result = accessPatch(" \n ", "I’ll be at home");
    expect(result.build().specialRequestNotes).toEqual(["Access: I’ll be at home"]);
    expect(printed(bookFunction)).toContain('useState("I’ll be at home")');
  });
  it("changes only specialRequestNotes compared with the original payload builder", () => {
    const result = accessPatch("Keep all my instructions", "Someone will let you in");
    const old = evaluate(initializer("buildPatch", control), result.scope, control)();
    const actual = result.build();
    expect(old.specialRequestNotes).toEqual(["Keep all my instructions"]);
    expect(actual.specialRequestNotes).toEqual(["Keep all my instructions", "Access: Someone will let you in"]);
    delete old.specialRequestNotes; delete actual.specialRequestNotes;
    expect(actual).toEqual(old);
  });
  it("connects the existing approved selector while leaving the consent checkbox unbound", () => {
    const scope = { flow: {}, bookingLocation: {}, setBookingLocationFields: vi.fn(), arrivalPreference: {}, onArrivalChange: vi.fn(), dateCleared: false,
      requestedLocalDate: "2026-11-18", easternDateIso: () => "2026-11-10", setDateCleared: vi.fn(), setRequestedLocalDate: vi.fn(),
      setStep: vi.fn(), step: 2, bookingPreparationRef: { current: { pending: 0, prepared: false } },
      bookingAccessMethod: "Someone will let you in", setBookingAccessMethod: vi.fn(), APPROVED_BOOK_ASSETS: {} };
    const value = evaluate(attr(tags("ApprovedBookProvider")[0], "value"), scope);
    expect(value.entryMethod.value).toBe(scope.bookingAccessMethod);
    expect(value.entryMethod.onChange).toBe(scope.setBookingAccessMethod);
    value.entryMethod.onChange("Other — see special instructions");
    expect(scope.setBookingAccessMethod).toHaveBeenCalledWith("Other — see special instructions");
    expect(value.smsConsent).toBeUndefined();
  });
});
