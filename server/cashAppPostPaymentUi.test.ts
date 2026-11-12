import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/** LOCAL ONLY: actual TSX functions, explicit dependency mocks, no application
 * imports, SDK, DB, network or browser. The small hook driver exercises source
 * callbacks/effect cleanup; it is not a React DOM/iframe lifecycle test. */
const root = resolve(import.meta.dirname, "..");
const BASE = "fffbf1127384bb941fa03145187e5449007205af";
const pagePath = "client/src/pages/CashAppPay.tsx";
const rowPath = "client/src/pages/BookingsCRMExactLive.tsx";
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const base = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], {
  cwd: root, encoding: "utf8", env: { PATH: process.env.PATH }, maxBuffer: 2 * 1024 * 1024,
});
const parse = (text: string) => ts.createSourceFile("actual.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const current = parse(read(pagePath));
const control = parse(base(pagePath));
const rows = parse(read(rowPath));
function all<T extends ts.Node>(node: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (child: ts.Node) => { if (guard(child)) found.push(child); ts.forEachChild(child, visit); };
  visit(node);
  return found;
}
function named(name: string, file = current) {
  const found = all(file, ts.isFunctionDeclaration).filter(node => node.name?.text === name);
  expect(found, `unique actual function ${name}`).toHaveLength(1);
  return found[0];
}
function variable(name: string, file = current) {
  const found = all(file, ts.isVariableDeclaration).filter(node => ts.isIdentifier(node.name) && node.name.text === name);
  expect(found, `unique actual variable ${name}`).toHaveLength(1);
  return found[0];
}
function compile(text: string, scope: Record<string, unknown> = {}): any {
  const module = { exports: {} };
  const code = ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { ...scope, module, exports: module.exports, Error, Date, Intl, URLSearchParams,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      throw new Error(`Unexpected actual-source import: ${id}`);
    },
  }, { timeout: 1000 });
  return module.exports;
}
const icon = (props: any) => React.createElement("svg", props);
const icons = { CheckCircle2: icon, Clock3: icon, Loader2: icon, LockKeyhole: icon, ShieldCheck: icon };
const PaymentElement = (props: any) => React.createElement("div", { "data-payment-layout": props.options.layout });
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// A bounded in-memory effect driver: same-dependency rerenders retain refs/state;
// changed dependencies clean up first. Timers/listeners never reach the host.
function driver(scope: Record<string, any>, sourceFile = current) {
  const slots: any[] = [];
  let cursor = 0;
  let jobs: Array<() => void> = [];
  let dead = false;
  let lateWrites = 0;
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        if (dead) { lateWrites++; return; }
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => void | (() => void), deps?: any[]) {
      const index = cursor++;
      const old = slots[index];
      if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i])) || deps.length !== old.deps?.length) {
        slots[index] = { deps, cleanup: old?.cleanup };
        jobs.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const functions = ["money", "CashAppCheckout", "CashAppPay"].map(name => named(name, sourceFile).getText(sourceFile).replace(/^export default /, "")).join("\n");
  const loaded = compile(`${functions}\nmodule.exports = { CashAppCheckout, CashAppPay };`, {
    ...icons, PaymentElement, Elements: ({ children }: any) => children, stripePromise: {}, ...scope, ...hooks,
  });
  return {
    render(name: "CashAppCheckout" | "CashAppPay", props?: any) {
      cursor = 0;
      const tree = loaded[name](props);
      const pending = jobs; jobs = []; pending.forEach(run => run());
      return { tree, html: renderToStaticMarkup(tree) };
    },
    dispose() { dead = true; slots.forEach(slot => slot?.cleanup?.()); jobs = []; },
    get lateWrites() { return lateWrites; },
  };
}
function checkout(result: any, unavailable?: "stripe" | "elements", sourceFile = current) {
  const stripe = { confirmPayment: vi.fn(() => result instanceof Promise ? result : Promise.resolve(result)) };
  const elementHandle = {};
  const replace = vi.fn();
  const harness = driver({ useStripe: () => unavailable === "stripe" ? null : stripe,
    useElements: () => unavailable === "elements" ? null : elementHandle,
    window: { location: { origin: "https://local.invalid", replace } },
  }, sourceFile);
  const render = () => harness.render("CashAppCheckout", { token: "hp1_local-token", amountCents: 12345 });
  const first = render();
  const event = { preventDefault: vi.fn() };
  return { stripe, elementHandle, replace, event, render,
    submit: () => (first.tree.props as any).onSubmit(event) };
}
function page(options: { token?: string; complete?: boolean; status?: string; confirm?: () => Promise<any> } = {}) {
  let token = options.token ?? "hp1_local-token";
  let search = options.complete === false ? "" : "?complete=1";
  let serverStatus = options.status ?? "pending";
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const timerDelays: number[] = [];
  const setTimeout = vi.fn((callback: () => void, delay: number) => { timerDelays.push(delay); const id = ++timerId; timers.set(id, callback); return id; });
  const clearTimeout = vi.fn((id: number) => timers.delete(id));
  const create = vi.fn();
  const refetch = vi.fn(async () => ({ data: { status: serverStatus } }));
  const confirmAsync = vi.fn(options.confirm ?? (async () => ({ status: serverStatus })));
  const confirm = vi.fn((input: any, callbacks: any) => {
    void confirmAsync(input).then(data => callbacks?.onSuccess?.(data), error => callbacks?.onError?.(error)).finally(() => callbacks?.onSettled?.());
  });
  const statusQuery = vi.fn(() => ({ data: { status: serverStatus }, refetch }));
  const harness = driver({
    useParams: () => ({ token }),
    window: { location: { get search() { return search; } }, setTimeout, clearTimeout,
      addEventListener: (name: string, callback: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
      removeEventListener: (name: string, callback: () => void) => listeners.get(name)?.delete(callback),
    }, setTimeout, clearTimeout,
    trpc: { cashApp: {
      getLink: { useQuery: () => ({ data: { customerName: "Local Fixture", amountCents: 12345, description: "Local payment", expiresAt: "2027-01-01" } }) },
      getStatus: { useQuery: statusQuery },
      createPaymentIntent: { useMutation: () => ({ mutate: create, isPending: false }) },
      confirmPayment: { useMutation: () => ({ mutate: confirm, mutateAsync: confirmAsync, isPending: false }) },
    } },
  });
  return { harness, create, refetch, confirmAsync, statusQuery, timers, timerDelays, clearTimeout,
    render: () => harness.render("CashAppPay"),
    changeToken: (next: string) => { token = next; },
    setStatus: (next: string) => { serverStatus = next; },
    setComplete: (next: boolean) => { search = next ? "?complete=1" : ""; },
    focus: () => listeners.get("focus")?.forEach(callback => callback()),
    fireTimer: () => { const first = timers.entries().next().value; if (first) { timers.delete(first[0]); first[1](); } },
    get listenerCount() { return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
  };
}

// Only the actual BookingListRow is extracted. Unrelated CRM modules/providers
// and all presentation helpers are explicit local mocks; payment logic is real.
const BookingListRow = compile(`${named("BookingListRow", rows).getText(rows)}\nmodule.exports = BookingListRow;`, {
  MapPin: icon, CreditCard: icon, MoreHorizontal: icon,
  customerPortraitFor: () => "data:image/svg+xml,local", avatarColorFor: () => "#353535", initialsFor: () => "LF",
  displayRequestedTime: (value: string) => value, labelRecurrence: (value: string) => value, sourceLabel: () => "Native booking",
  labelPaymentMethod: compile(`module.exports = ${variable("labelPaymentMethod", rows).initializer!.getText(rows)};`),
});
function rowLabel(paymentMethod: string, paymentStatus: string) {
  const row = { source: "booking", status: "confirmed", customerName: "Local Fixture", bedrooms: 2, bathrooms: 1,
    requestedLocalTime: "09:00", address: "Local address", serviceName: "Standard", extras: [], assignmentStatus: "assigned",
    firstCleaningTotalCents: 12345, paymentMethod, paymentStatus, paymentLast4: "4242", paymentBrand: "Visa" };
  const tree = BookingListRow({ row, selected: false, onSelect: vi.fn() });
  const payment = elements(tree).find(node => /^bcr-payment-/.test(node.props.className ?? ""));
  expect(payment).toBeDefined();
  return renderToStaticMarkup(payment);
}

describe("Cash App actual submit callback (mock SDK)", () => {
  it.each(["succeeded", "processing"])("%s replaces the exact existing complete URL, with unchanged Stripe args", async status => {
    const h = checkout({ paymentIntent: { status } });
    await h.submit();
    expect(h.event.preventDefault).toHaveBeenCalledOnce();
    expect(h.stripe.confirmPayment).toHaveBeenCalledOnce();
    expect(h.stripe.confirmPayment).toHaveBeenCalledWith({ elements: h.elementHandle,
      confirmParams: { return_url: "https://local.invalid/cashapp-pay/hp1_local-token?complete=1" }, redirect: "if_required" });
    expect(h.stripe.confirmPayment.mock.calls[0][0].elements).toBe(h.elementHandle);
    expect(h.replace).toHaveBeenCalledOnce();
    expect(h.replace).toHaveBeenCalledWith("https://local.invalid/cashapp-pay/hp1_local-token?complete=1");
    expect(h.render().html).not.toContain("Payment received");
  });
  it.each([{ error: { message: "Local decline" } }, { error: {} }, { paymentIntent: { status: "requires_action" } },
    { paymentIntent: { status: "requires_payment_method" } }, { paymentIntent: { status: "canceled" } }, {}])(
    "error/nonterminal result %j restores a truthful retry button", async result => {
      const h = checkout(result); await h.submit(); const view = h.render();
      expect(h.replace).not.toHaveBeenCalled();
      expect(view.html).toContain('role="alert"');
      expect(view.html).toContain("Pay $123.45 with Cash App");
      expect(view.html).not.toContain("Payment received");
      expect(elements(view.tree).find(node => node.type === "button")!.props.disabled).toBe(false);
    });
  it("rejected SDK promise is handled and restores the button", async () => {
    const result = deferred(); const h = checkout(result.promise); const submitted = h.submit();
    result.reject(new Error("Local SDK rejection")); await submitted;
    expect(h.replace).not.toHaveBeenCalled(); expect(h.render().html).toContain('role="alert"');
    expect(elements(h.render().tree).find(node => node.type === "button")!.props.disabled).toBe(false);
  });
  it.each(["stripe", "elements"] as const)("unavailable %s never submits or claims paid", async unavailable => {
    const h = checkout({ paymentIntent: { status: "succeeded" } }, unavailable); await h.submit();
    expect(h.stripe.confirmPayment).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled();
    expect(elements(h.render().tree).find(node => node.type === "button")!.props.disabled).toBe(true);
    expect(h.render().html).not.toContain("Payment received");
  });
  it("an error wins even if a result also contains succeeded", async () => {
    const h = checkout({ error: { message: "Local error" }, paymentIntent: { status: "succeeded" } }); await h.submit();
    expect(h.replace).not.toHaveBeenCalled(); expect(h.render().html).toContain("Local error");
  });
  it("keeps the button disabled while an SDK promise is unresolved", async () => {
    const result = deferred(); const h = checkout(result.promise); const submitted = h.submit();
    const view = h.render(); expect(view.html).toContain("Opening Cash App");
    expect(elements(view.tree).find(node => node.type === "button")!.props.disabled).toBe(true);
    expect(h.replace).not.toHaveBeenCalled(); result.resolve({ error: { message: "Local decline" } }); await submitted;
    expect(elements(h.render().tree).find(node => node.type === "button")!.props.disabled).toBe(false);
  });
  it.each(["succeeded", "processing"])("untouched base reproduces the missing %s postpayment transition", async status => {
    const h = checkout({ paymentIntent: { status } }, undefined, control); await h.submit();
    expect(h.stripe.confirmPayment).toHaveBeenCalledOnce(); expect(h.replace).not.toHaveBeenCalled();
    expect(h.render().html).toContain("Opening Cash App");
    expect(elements(h.render().tree).find(node => node.type === "button")!.props.disabled).toBe(true);
  });
});

describe("source-exact protected contracts against the approved base", () => {
  it("keeps confirmPayment argument syntax exact and checkout/PaymentElement layout byte-exact", () => {
    const args = (file: ts.SourceFile) => all(named("CashAppCheckout", file), ts.isCallExpression)
      .filter(node => node.expression.getText(file) === "stripe.confirmPayment")
      .map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node.arguments[0], file));
    expect(args(current)).toEqual(args(control));
    const jsx = (file: ts.SourceFile) => all(named("CashAppCheckout", file), ts.isReturnStatement).map(node => node.getText(file));
    expect(jsx(current)).toEqual(jsx(control));
    expect(read("client/src/pages/cashapp-pay.css")).toBe(base("client/src/pages/cashapp-pay.css"));
  });
  it("keeps complete detection, read-only getStatus polling and create-intent guard byte-exact", () => {
    for (const name of ["complete", "status"]) expect(variable(name).getText(current)).toBe(variable(name, control).getText(control));
    const creation = (file: ts.SourceFile) => all(named("CashAppPay", file), ts.isCallExpression)
      .filter(node => node.expression.getText(file) === "useEffect" && node.getText(file).includes("createIntent.mutate"))
      .map(node => node.getText(file));
    expect(creation(current)).toEqual(creation(control));
  });
  it("keeps non-complete page layout and booking CRM source unchanged", () => {
    const layout = (file: ts.SourceFile) => named("CashAppPay", file).body!.statements
      .filter(ts.isReturnStatement).map(node => node.getText(file));
    expect(layout(current)).toEqual(layout(control));
    const production = (file: string) => execFileSync("git", ["show", `2e7b7c082a9db5aa1624485d69f0972621cf5fd9:${file}`], { encoding: "utf8" });
    expect(read(rowPath)).toBe(production(rowPath));
    for (const path of ["client/src/pages/Book.tsx", "client/src/pages/InternalBooking.tsx",
      "client/src/components/BookingCashAppCheckout.tsx", "client/src/components/internal-booking/BookingCashAppCheckout.tsx"])
      expect(read(path), path).toBe(production(path));
  });
});

describe("actual BookingListRow SSR payment labels", () => {
  it("captured Cash App renders Cash App · paid", () => { expect(rowLabel("cashapp", "captured")).toContain("Cash App · paid"); });
  it.each(["pending", "pending_payment", "not_started"])("%s Cash App does not render paid", status => {
    const html = rowLabel("cashapp", status); expect(html).toContain("Cash App"); expect(html).not.toMatch(/paid|Paid/);
  });
  it("captured card remains Paid", () => { const html = rowLabel("card", "captured"); expect(html).toContain("Paid"); expect(html).not.toContain("Cash App"); });
  it("captured invoice remains the existing Paid label", () => { expect(rowLabel("invoice", "captured")).toContain("Paid"); });
  it("pending invoice remains Check", () => { const html = rowLabel("invoice", "pending"); expect(html).toContain("Check"); expect(html).not.toMatch(/paid|Paid/); });
  it.each([["apple_pay", "Apple Pay"], ["google_pay", "Google Pay"]])("%s captured and saved states stay distinct", (method, label) => {
    expect(rowLabel(method, "captured")).toContain("Paid");
    const saved = rowLabel(method, "card_on_file"); expect(saved).toContain(`${label} card on file`);
    expect(saved).toContain("4242"); expect(saved).not.toMatch(/paid|Paid/);
  });
  it("saved card stays Visa with last four and no paid claim", () => {
    const html = rowLabel("card", "card_on_file"); expect(html).toContain("Visa"); expect(html).toContain("4242"); expect(html).not.toMatch(/paid|Paid/);
  });
});

describe("actual complete-phase confirmation effect (in-memory hooks/timers)", () => {
  it("pending return starts only status confirmation, preserves polling, and never creates another intent", async () => {
    const h = page(); const view = h.render(); await tick();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.confirmAsync).toHaveBeenCalledOnce();
    expect(h.confirmAsync).toHaveBeenCalledWith({ token: "hp1_local-token" });
    expect(h.statusQuery).toHaveBeenCalledWith({ token: "hp1_local-token" }, { enabled: true, refetchInterval: 2000 });
    expect(view.html).toContain("Confirming your payment"); expect(view.html).not.toContain("Payment received");
    expect(view.html).toContain("Do not pay again");
    expect(h.refetch).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it.each(["legacy-local-token", "", "HP1_local-token"])("token %s cannot call the hp1 confirmation API on return", async token => {
    const h = page({ token }); const view = h.render(); h.focus(); await tick();
    expect(h.confirmAsync).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
    expect(view.html).not.toContain("Check payment status"); h.harness.dispose();
  });
  it("pre-complete phase uses its existing create path only once and never confirms", async () => {
    const h = page({ complete: false }); h.render(); h.render(); await tick();
    expect(h.create).toHaveBeenCalledOnce(); expect(h.confirmAsync).not.toHaveBeenCalled();
    h.setComplete(true); h.render(); await tick(); expect(h.create).toHaveBeenCalledOnce();
    expect(h.confirmAsync).toHaveBeenCalledOnce(); h.harness.dispose();
  });
  it("pending automatic rechecks are bounded to four calls at 2, 5, 10 seconds", async () => {
    const h = page(); h.render(); await tick();
    for (let i = 0; i < 3; i++) { expect(h.timers.size).toBe(1); h.fireTimer(); await tick(); }
    expect(h.confirmAsync).toHaveBeenCalledTimes(4); expect(h.timers.size).toBe(0);
    expect(h.timerDelays).toEqual([2000, 5000, 10000]);
    for (let i = 0; i < 3; i++) { h.fireTimer(); await tick(); }
    expect(h.confirmAsync).toHaveBeenCalledTimes(4); expect(h.create).not.toHaveBeenCalled();
    h.harness.dispose();
  });
  it("manual and focus checks coalesce while a request is in flight", async () => {
    const result = deferred(); const h = page({ confirm: () => result.promise }); const view = h.render();
    const button = elements(view.tree).find(node => node.type === "button"); expect(button).toBeDefined();
    h.focus(); h.focus(); button!.props.onClick(); button!.props.onClick();
    expect(h.confirmAsync).toHaveBeenCalledOnce(); expect(h.create).not.toHaveBeenCalled();
    result.resolve({ status: "pending" }); await tick();
    h.focus(); button!.props.onClick(); expect(h.confirmAsync).toHaveBeenCalledTimes(2);
    await tick(); expect(h.timers.size).toBe(1); h.harness.dispose();
  });
  it("manual check after bounded pending attempts rechecks the existing payment, not create", async () => {
    const h = page(); h.render(); await tick();
    for (let i = 0; i < 3; i++) { h.fireTimer(); await tick(); }
    const button = elements(h.render().tree).find(node => node.type === "button"); button!.props.onClick(); await tick();
    expect(h.confirmAsync).toHaveBeenCalledTimes(5); expect(h.timers.size).toBe(1);
    expect(h.create).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it.each(["paid", "cancelled"])("verified server confirmation %s renders its terminal state and stops checks", async status => {
    const h = page({ confirm: async () => ({ status }) }); h.render(); await tick(); const view = h.render();
    expect(view.html).toContain(status === "paid" ? "Payment received" : "Payment canceled");
    expect(view.html).not.toContain("Check payment status"); h.focus(); await tick();
    expect(h.confirmAsync).toHaveBeenCalledOnce(); expect(h.timers.size).toBe(0); expect(h.create).not.toHaveBeenCalled();
    h.harness.dispose();
  });
  it("read-only server-paid status renders paid and suppresses confirmation", async () => {
    const h = page({ status: "paid" }); expect(h.render().html).toContain("Payment received"); h.focus(); await tick();
    expect(h.confirmAsync).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it("read-only poll becoming paid stops a scheduled pending recheck", async () => {
    const h = page(); h.render(); await tick(); h.setStatus("paid"); expect(h.render().html).toContain("Payment received");
    h.fireTimer(); h.focus(); await tick(); expect(h.confirmAsync).toHaveBeenCalledOnce();
    expect(h.create).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it("a failed confirmation stays unpaid with a safe check-again retry, never create", async () => {
    const failure = deferred(); const h = page({ confirm: () => failure.promise }); h.render();
    failure.reject(new Error("Local sensitive provider detail")); await tick(); const view = h.render();
    expect(view.html).toContain('role="alert"'); expect(view.html).toContain("will not charge you again");
    expect(view.html).not.toContain("Local sensitive provider detail"); expect(view.html).not.toContain("Payment received");
    expect(view.html).toContain("Check payment status"); expect(h.timers.size).toBe(0); expect(h.create).not.toHaveBeenCalled();
    h.harness.dispose();
  });
  it("unexpected confirmation status cannot claim paid or canceled", async () => {
    const h = page({ confirm: async () => ({ status: "succeeded" }) }); h.render(); await tick(); const html = h.render().html;
    expect(html).toContain("Confirming your payment"); expect(html).not.toContain("Payment received"); expect(html).not.toContain("Payment canceled");
    expect(h.create).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it("late response for an old token cannot mark the new token paid", async () => {
    const old = deferred(); const next = deferred(); const h = page({ confirm: () => old.promise });
    h.confirmAsync.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    h.render(); h.changeToken("hp1_new-local-token"); h.render(); old.resolve({ status: "paid" }); await tick();
    expect(h.render().html).not.toContain("Payment received");
    expect(h.confirmAsync.mock.calls.map(args => args[0])).toEqual([{ token: "hp1_local-token" }, { token: "hp1_new-local-token" }]);
    next.resolve({ status: "pending" }); await tick(); expect(h.render().html).not.toContain("Payment received");
    expect(h.create).not.toHaveBeenCalled(); h.harness.dispose();
  });
  it("already received confirmation belongs only to its matching token", async () => {
    const pending = deferred(); const h = page(); h.confirmAsync.mockResolvedValueOnce({ status: "paid" }).mockImplementationOnce(() => pending.promise);
    h.render(); await tick(); expect(h.render().html).toContain("Payment received");
    h.changeToken("hp1_other-local-token"); expect(h.render().html).not.toContain("Payment received");
    pending.resolve({ status: "pending" }); await tick(); h.harness.dispose();
  });
  it("unmount clears timer/listener and ignores an unresolved verification response", async () => {
    const pending = deferred(); const h = page({ confirm: () => pending.promise }); h.render();
    expect(h.listenerCount).toBe(1); h.harness.dispose(); expect(h.listenerCount).toBe(0);
    pending.resolve({ status: "paid" }); await tick(); h.focus();
    expect(h.harness.lateWrites).toBe(0); expect(h.timers.size).toBe(0); expect(h.confirmAsync).toHaveBeenCalledOnce();
  });
  it("unmount cancels scheduled pending checks", async () => {
    const h = page(); h.render(); await tick(); expect(h.timers.size).toBe(1); h.harness.dispose();
    expect(h.timers.size).toBe(0); expect(h.clearTimeout).toHaveBeenCalledOnce(); expect(h.listenerCount).toBe(0);
    h.fireTimer(); h.focus(); await tick(); expect(h.confirmAsync).toHaveBeenCalledOnce();
  });
});
