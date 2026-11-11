import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const base = "2041fa94a4cf8e2b47c40773582e07f482114987";
const internal = "client/src/components/internal-booking/";
const cardAuthFile = "client/src/pages/CardAuth.tsx";
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const original = (file: string) => execFileSync("git", ["show", `${base}:${file}`], {
  cwd: root, encoding: "utf8", env: { PATH: process.env.PATH },
});
type Element = { type: any; props: Record<string, any> };
type Instance = { slots: any[]; index: number; effects: Array<() => unknown> };
const nodes = (tree: any): Element[] => {
  const result: Element[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "props" in node) {
      result.push(node); walk(node.props.children);
    }
  };
  walk(tree); return result;
};
const text = (node: any): string => Array.isArray(node) ? node.map(text).join(" ")
  : node && typeof node === "object" ? text(node.props?.children)
  : node == null || typeof node === "boolean" ? "" : String(node);
const calledOnceWith = (call: any, ...args: any[]) => {
  expect(call).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledWith(...args);
};
const declaration = (source: string, name: string) => {
  const parsed = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name) as ts.FunctionDeclaration | undefined;
  if (!node?.body) throw new Error(`Missing actual function ${name}`);
  return { parsed, node };
};
const functionSource = (source: string, name: string) => {
  const { parsed, node } = declaration(source, name); return node.getText(parsed);
};
const returnSources = (source: string, name: string) => {
  const { parsed, node } = declaration(source, name);
  return node.body!.statements.filter(ts.isReturnStatement).map(item => item.expression?.getText(parsed));
};
const booking = (changes: Record<string, any> = {}) => ({
  bookingId: 91, publicBookingNumber: "BK-91", customerName: "Saved Customer",
  jobDate: "November 18, 2026", jobAddress: "123 Saved Street, Washington DC",
  firstCleaningTotalCents: 34567, requestedStartAt: Date.UTC(2026, 10, 18, 17), ...changes,
});
const adapterProps = {
  token: "offline-card-token", bookingId: 91, publicBookingNumber: "BK-91",
  customerName: "Saved Customer", amountCents: 34567, requestedStartAt: Date.UTC(2026, 10, 18, 17),
};

/**
 * Execute actual TSX with isolated require mocks: no schema/router import, browser,
 * credential, SDK network client or copied handler implementation. Only the
 * publishable-key expression is replaced by an inert test literal via TS AST.
 */
function fixture(options: { search?: string; token?: string; data?: any; error?: Error; loading?: boolean; source?: string } = {}) {
  let current: Instance;
  const instances = new Map<string, Instance>();
  const timers: Array<() => void> = [];
  const jsx = (type: any, props: Record<string, any>) => ({ type, props });
  const slot = () => current.index++;
  const hooks = {
    useState(initial: any) {
      const owner = current, index = slot();
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
      return [owner.slots[index], (value: any) => {
        owner.slots[index] = typeof value === "function" ? value(owner.slots[index]) : value;
      }];
    },
    useRef(initial: any) {
      const index = slot(); if (!(index in current.slots)) current.slots[index] = { current: initial };
      return current.slots[index];
    },
    useEffect(effect: () => unknown, deps?: any[]) {
      const index = slot(), previous = current.slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) {
        current.slots[index] = deps; current.effects.push(effect);
      }
    },
    useMemo(factory: () => unknown, deps: any[]) {
      const index = slot(), previous = current.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        current.slots[index] = { value: factory(), deps };
      }
      return current.slots[index].value;
    },
    useCallback(callback: (...args: any[]) => any, deps: any[]) { return hooks.useMemo(() => callback, deps); },
    createContext(initial: any) {
      const context: any = { current: initial };
      context.Provider = Object.assign(function OfflineProvider() {}, { context });
      return context;
    },
    useContext(context: any) { return context.current; },
  };
  const render = (name: string, component: any, props: any = {}) => {
    if (!instances.has(name)) instances.set(name, { slots: [], index: 0, effects: [] });
    current = instances.get(name)!; current.index = 0;
    const tree = component(props);
    current.effects.splice(0).forEach(effect => effect());
    return tree as Element;
  };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const unexpected = (name: string) => vi.fn(() => { throw new Error(`Forbidden offline call: ${name}`); });
  const setup = vi.fn(async (_input: any) => ({ clientSecret: "seti_offline_secret" }));
  const confirm = vi.fn(async (_input: any) => ({ success: true, cardBrand: "visa", cardLast4: "4242" }));
  const eagerSetup = vi.fn((_input: any, callbacks: any) => callbacks.onSuccess({ clientSecret: "seti_offline_secret" }));
  const publicStart = unexpected("public startSetup"), publicConfirm = unexpected("public confirmSetup");
  const forbidden = {
    confirmPayment: unexpected("confirmPayment"), paymentIntent: unexpected("paymentIntent"),
    createBooking: unexpected("createBooking"), invoice: unexpected("invoice"), migration: unexpected("migration"),
  };
  const query = {
    data: Object.prototype.hasOwnProperty.call(options, "data") ? options.data : booking(),
    error: options.error ?? null, isLoading: options.loading ?? false,
  };
  const queryHook = vi.fn(() => query);
  const stripe = {
    confirmSetup: vi.fn(async (_input: any) => ({ setupIntent: { payment_method: "pm_offline" } })),
    confirmPayment: forbidden.confirmPayment,
  };
  const elements = { submit: vi.fn(async () => ({} as any)) };
  const Elements = function OfflineElements() {};
  const ExpressCheckoutElement = function OfflineExpressCheckoutElement() {};
  const CardElement = function OfflineCardElement() {};
  const loadStripe = vi.fn(() => Promise.resolve(stripe));
  const windowMock = {
    location: { href: "https://example.test/pay/offline-card-token?wallet=apple_pay" },
    setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
    clearTimeout: vi.fn(), scrollTo: vi.fn(),
  };
  const trpc = {
    stripe: {
      getCardAuthToken: { useQuery: queryHook },
      createSetupIntent: { useMutation: () => ({ mutateAsync: setup, mutate: eagerSetup }) },
      confirmCardSaved: { useMutation: () => ({ mutateAsync: confirm }) },
    },
    bookingPayments: {
      startSetup: { useMutation: () => ({ mutateAsync: publicStart }) },
      confirmSetup: { useMutation: () => ({ mutateAsync: publicConfirm }) },
    },
  };
  const modules = new Map<string, any>();
  const load = (file: string, source = read(file)): any => {
    if (modules.has(file)) return modules.get(file);
    const exports: any = {}; modules.set(file, exports);
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      transformers: { before: [context => sourceFile => {
        const visit: ts.Visitor = node => ts.isPropertyAccessExpression(node)
          && node.getText(sourceFile) === "import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY"
          ? context.factory.createStringLiteral("pk_offline_test_only") : ts.visitEachChild(node, visit, context);
        return ts.visitNode(sourceFile, visit) as ts.SourceFile;
      }] },
    }).outputText;
    const requireMock = (name: string): any => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "@/lib/trpc") return { trpc };
      if (name === "@stripe/react-stripe-js") return { Elements, ExpressCheckoutElement, CardElement, useStripe: () => stripe, useElements: () => elements };
      if (name === "@stripe/stripe-js") return { loadStripe };
      if (name === "wouter") return { useParams: () => ({ token: options.token ?? "offline-card-token" }), useSearch: () => options.search ?? "wallet=apple_pay" };
      if (name === "@/components/useStripeCardSetup") return { CARD_ELEMENT_OPTIONS: {}, useStripeCardSetup: unexpected("legacy card hook in shallow root") };
      if (name === "lucide-react") return { Loader2: "offline-loader" };
      if (name === "@shared/bookingPayment") return { BOOKING_PAYMENT_CONSENT_TEXT: "I authorize my card to be saved; no charge today." };
      if (name === "./BookingCheckoutTransport") return load(internal + "BookingCheckoutTransport.tsx");
      if (name === "./BookingApplePayCheckout") return load(internal + "BookingApplePayCheckout.tsx");
      if (name === "@/components/internal-booking/ApplePayCardAuth") return load(internal + "ApplePayCardAuth.tsx");
      throw new Error(`Unexpected isolated source dependency: ${name}`);
    };
    new Function("require", "exports", "window", output)(requireMock, exports, windowMock);
    return exports;
  };
  const adapter = load(internal + "ApplePayCardAuth.tsx");
  const wallet = load(internal + "BookingApplePayCheckout.tsx");
  const cardAuth = load(cardAuthFile, options.source ?? read(cardAuthFile));
  const renderRoot = () => render("root", cardAuth.default);
  const renderAdapter = () => render("adapter", adapter.default, adapterProps);
  const mountWallet = () => {
    const adapterTree = renderAdapter();
    const provider = nodes(adapterTree).find(node => node.type.name === "InternalBookingCheckoutProvider")!;
    expect(provider).toBeDefined();
    const contextNode = render("provider", provider.type, provider.props);
    const transportModule = load(internal + "BookingCheckoutTransport.tsx");
    // Mount the real provider's Context.Provider value; the actual transport
    // hook then obtains it through the isolated React useContext mock.
    expect(transportModule.InternalBookingCheckoutProvider).toBe(provider.type);
    const providerValue = contextNode.props.value;
    contextNode.type.context.current = providerValue;
    const walletNode = provider.props.children;
    expect(walletNode.type).toBe(wallet.BookingWalletCardOnFileCheckout);
    render("wallet", walletNode.type, walletNode.props);
    timers.splice(0).forEach(callback => callback());
    const walletTree = render("wallet", walletNode.type, walletNode.props);
    const elementsNode = nodes(walletTree).find(node => node.type === Elements)!;
    expect(elementsNode).toBeDefined();
    const actualElement = elementsNode.props.children;
    const elementTree = render("wallet-element", actualElement.type, actualElement.props);
    const express = nodes(elementTree).find(node => node.type === ExpressCheckoutElement)!;
    expect(express).toBeDefined();
    return { adapterTree, provider, walletNode, walletTree, elementsNode, actualElement, express, transport: providerValue };
  };
  return {
    render, renderRoot, renderAdapter, mountWallet, flush, setup, confirm, eagerSetup,
    query, queryHook, stripe, elements, forbidden, publicStart, publicConfirm, loadStripe,
    adapter, wallet, Elements, CardElement, load,
  };
}

const confirmationInput = (changes: Record<string, any> = {}) => ({
  kind: "internal", bookingId: 91, publicBookingNumber: "BK-91", paymentMethodId: "pm_offline",
  wallet: "apple_pay", consentAccepted: true, deferConfirmation: true, ...changes,
});
const noNewProviderCalls = (f: ReturnType<typeof fixture>) => {
  expect(f.publicStart).not.toHaveBeenCalled(); expect(f.publicConfirm).not.toHaveBeenCalled();
  Object.values(f.forbidden).forEach(call => expect(call).not.toHaveBeenCalled());
};

describe("Apple Pay card-auth actual-source reuse boundary", () => {
  it("keeps public /book, both existing wallet sources, transport and the entire legacy StripeCardForm byte-identical to base", () => {
    for (const path of ["client/src/pages/Book.tsx", "client/src/App.tsx", "client/src/components/BookingApplePayCheckout.tsx", internal + "BookingApplePayCheckout.tsx", internal + "BookingCheckoutTransport.tsx", "client/src/components/useStripeCardSetup.ts"]) {
      expect(read(path), path).toBe(original(path));
    }
    expect(functionSource(read(cardAuthFile), "StripeCardForm")).toBe(functionSource(original(cardAuthFile), "StripeCardForm"));
  });
  it("reuses the exact internal wallet component reference and unchanged public wallet options/return JSX", () => {
    const f = fixture(), mounted = f.mountWallet();
    expect(mounted.walletNode.type).toBe(f.wallet.BookingWalletCardOnFileCheckout);
    const existing = read(internal + "BookingApplePayCheckout.tsx"), publicSource = read("client/src/components/BookingApplePayCheckout.tsx");
    for (const name of ["walletOptions", "BookingWalletCardOnFileCheckout"]) expect(functionSource(existing, name)).toBe(functionSource(publicSource, name));
    expect(returnSources(existing, "WalletCardOnFileElement")).toEqual(returnSources(publicSource, "WalletCardOnFileElement"));
    expect(read("client/src/pages/Book.tsx")).toContain('import { BookingWalletCardOnFileCheckout } from "@/components/BookingApplePayCheckout"');
    expect(read(internal + "InternalPublicBook.tsx")).toContain('import { BookingWalletCardOnFileCheckout } from "./BookingApplePayCheckout"');
    expect(read(internal + "ApplePayCardAuth.tsx")).toContain('import { BookingWalletCardOnFileCheckout } from "./BookingApplePayCheckout"');
  });
  it("adds no card element, express checkout, charge, booking, invoice or migration implementation to the adapter", () => {
    expect(read(internal + "ApplePayCardAuth.tsx")).not.toMatch(/CardElement|ExpressCheckoutElement|confirmPayment|paymentIntent|createBooking|invoice|migration|schema/i);
    const source = read(internal + "ApplePayCardAuth.tsx");
    expect(source).toContain("trpc.stripe.createSetupIntent.useMutation()");
    expect(source).toContain("trpc.stripe.confirmCardSaved.useMutation()");
    expect(source).not.toMatch(/trpc\.(?:bookings|bookingPayments|bookingPaymentAdmin|bookingFunnel)/);
  });
});

describe("token-bound adapter transport", () => {
  it("returns only the existing native identity, performs no eager setup, and maps setup to the exact card token", async () => {
    const f = fixture(), mounted = f.mountWallet();
    expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    const reservation = await mounted.walletNode.props.onPrepareReservation();
    expect(reservation).toEqual({ kind: "internal", bookingId: 91, publicBookingNumber: "BK-91" });
    expect(await mounted.walletNode.props.onPrepareReservation()).toBe(reservation);
    expect(await mounted.transport.startSetup(reservation)).toEqual({ bookingId: 91, alreadyComplete: false, clientSecret: "seti_offline_secret", setupIntentId: null });
    calledOnceWith(f.setup, { token: "offline-card-token" });
    expect(f.confirm).not.toHaveBeenCalled(); noNewProviderCalls(f);
  });
  it("rejects setup for a different native booking before calling the token API", async () => {
    const f = fixture(), { transport } = f.mountWallet();
    await expect(transport.startSetup({ kind: "internal", bookingId: 92, publicBookingNumber: "BK-92" })).rejects.toThrow("could not be verified");
    expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); noNewProviderCalls(f);
  });
  it("maps confirmation to token/payment method only, returns card metadata and never claims paid", async () => {
    const f = fixture(), { transport } = f.mountWallet();
    const result = await transport.confirmSetup(confirmationInput());
    calledOnceWith(f.confirm, { token: "offline-card-token", paymentMethodId: "pm_offline" });
    expect(result).toEqual({ bookingId: 91, cardBrand: "visa", cardLast4: "4242" });
    expect(result).not.toHaveProperty("paid"); expect(result).not.toHaveProperty("paymentStatus");
    expect(result).not.toHaveProperty("finalizationRequired"); noNewProviderCalls(f);
  });
  it.each([{ bookingId: 92 }, { wallet: "google_pay" }, { wallet: undefined }])("rejects mismatched confirmation before transport: %j", async change => {
    const f = fixture(), { transport } = f.mountWallet();
    await expect(transport.confirmSetup(confirmationInput(change))).rejects.toThrow("could not be verified");
    expect(f.confirm).not.toHaveBeenCalled(); expect(f.setup).not.toHaveBeenCalled(); noNewProviderCalls(f);
  });
  it.each([false, undefined, "true", 1])("requires strict success=true, not %s", async success => {
    const f = fixture(), { transport } = f.mountWallet();
    f.confirm.mockResolvedValueOnce({ success, cardBrand: "visa", cardLast4: "4242" } as any);
    await expect(transport.confirmSetup(confirmationInput())).rejects.toThrow("Card saving was not confirmed");
    noNewProviderCalls(f);
  });
  it("rejects all unrelated cash actions rather than creating a payment path", async () => {
    const f = fixture(), { transport } = f.mountWallet();
    for (const method of ["prepareCashApp", "settleCashApp", "abandonCashApp"]) await expect(transport[method](confirmationInput())).rejects.toThrow("saves a card only");
    expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); noNewProviderCalls(f);
  });
});

describe("unchanged actual wallet setup handler", () => {
  it("mounts mode=setup and saves through the existing elements.submit -> confirmSetup -> card-token confirmation sequence", async () => {
    const f = fixture(), mounted = f.mountWallet();
    expect(mounted.elementsNode.props.options).toEqual({ mode: "setup", currency: "usd", setupFutureUsage: "off_session", allowedPaymentMethodTypes: ["card"] });
    expect(mounted.walletNode.props).toMatchObject({ wallet: "apple_pay", active: true, customerName: "Saved Customer", deferredAmountCents: 34567 });
    expect(mounted.walletNode.props.deferredPaymentDate.getTime()).toBe(adapterProps.requestedStartAt);
    const event = { expressPaymentType: "apple_pay", paymentFailed: vi.fn() };
    mounted.express.props.onConfirm(event); await f.flush();
    expect(event.paymentFailed).not.toHaveBeenCalled(); expect(f.elements.submit).toHaveBeenCalledTimes(1);
    calledOnceWith(f.setup, { token: "offline-card-token" });
    calledOnceWith(f.stripe.confirmSetup, {
      elements: f.elements, clientSecret: "seti_offline_secret",
      confirmParams: { return_url: "https://example.test/pay/offline-card-token?wallet=apple_pay", payment_method_data: { billing_details: { name: "Saved Customer" } } },
      redirect: "if_required",
    });
    calledOnceWith(f.confirm, { token: "offline-card-token", paymentMethodId: "pm_offline" });
    expect(f.elements.submit.mock.invocationCallOrder[0]).toBeLessThan(f.setup.mock.invocationCallOrder[0]);
    expect(f.setup.mock.invocationCallOrder[0]).toBeLessThan(f.stripe.confirmSetup.mock.invocationCallOrder[0]);
    expect(f.stripe.confirmSetup.mock.invocationCallOrder[0]).toBeLessThan(f.confirm.mock.invocationCallOrder[0]);
    const saved = text(f.renderAdapter()).replace(/\s+/g, " ");
    expect(saved).toContain("Your card is saved"); expect(saved).toContain("visa ending 4242");
    expect(saved).toContain("No charge was made through this link"); expect(saved).not.toMatch(/payment complete|paid successfully/i);
    noNewProviderCalls(f);
  });
  it("rejects the wrong express wallet before submission, setup or card confirmation", async () => {
    const f = fixture(), { express } = f.mountWallet(), event = { expressPaymentType: "google_pay", paymentFailed: vi.fn() };
    express.props.onConfirm(event); await f.flush();
    expect(event.paymentFailed).toHaveBeenCalledWith({ reason: "fail", message: "Apple Pay is required." });
    expect(f.elements.submit).not.toHaveBeenCalled(); expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    noNewProviderCalls(f);
  });
  it("does not show saved when the existing confirmation API returns false", async () => {
    const f = fixture(), { express } = f.mountWallet(), event = { expressPaymentType: "apple_pay", paymentFailed: vi.fn() };
    f.confirm.mockResolvedValueOnce({ success: false, cardBrand: "visa", cardLast4: "4242" });
    express.props.onConfirm(event); await f.flush();
    expect(event.paymentFailed).toHaveBeenCalledWith({ reason: "fail", message: "Card saving was not confirmed. Please try again." });
    expect(text(f.renderAdapter())).not.toContain("Your card is saved"); noNewProviderCalls(f);
  });
  it("retains the actual handler's setup failure guard without confirmation or saved state", async () => {
    const f = fixture(), { express } = f.mountWallet(), event = { expressPaymentType: "apple_pay", paymentFailed: vi.fn() };
    f.setup.mockResolvedValueOnce({ clientSecret: null } as any);
    express.props.onConfirm(event); await f.flush();
    expect(event.paymentFailed).toHaveBeenCalledWith({ reason: "fail", message: "We could not prepare secure payment setup. Please try again." });
    expect(f.stripe.confirmSetup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    expect(text(f.renderAdapter())).not.toContain("Your card is saved"); noNewProviderCalls(f);
  });
});

describe("actual CardAuth root routing and legacy preservation", () => {
  it("renders Apple Pay only for server-returned native metadata plus explicit wallet parameter and performs no eager SetupIntent", () => {
    const f = fixture({ search: "wallet=apple_pay&name=Untrusted&date=Wrong&address=Wrong" });
    const tree = f.renderRoot();
    expect(tree.type.name).toBe("CardAuthInner"); expect(tree.props.prefillName).toBe("Saved Customer");
    const apple = nodes(tree.props.walletContent).find(node => node.type === f.adapter.default)!;
    expect(apple.props).toEqual(adapterProps);
    calledOnceWith(f.queryHook, { token: "offline-card-token" }, { enabled: true, retry: false });
    expect(f.eagerSetup).not.toHaveBeenCalled(); expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    noNewProviderCalls(f);
  });
  it.each(["", "wallet=google_pay", "wallet=card"])("keeps the ordinary native-token card path for search %s", search => {
    const f = fixture({ search }); f.renderRoot(); const tree = f.renderRoot();
    calledOnceWith(f.eagerSetup, { token: "offline-card-token" }, expect.any(Object));
    expect(tree.type.name).toBe("CardAuthInner"); expect(tree.props.clientSecret).toBe("seti_offline_secret");
    expect(tree.props.walletContent).toBeUndefined(); expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    noNewProviderCalls(f);
  });
  it("does not route wallet=apple_pay on legacy data into the new adapter and matches the untouched baseline card path", () => {
    const legacy = { customerName: "Legacy Customer", jobDate: "Legacy date", jobAddress: "Legacy address" };
    const candidate = fixture({ data: legacy }), control = fixture({ data: legacy, source: original(cardAuthFile) });
    candidate.renderRoot(); control.renderRoot();
    const actual = candidate.renderRoot(), before = control.renderRoot();
    expect(actual.type.name).toBe(before.type.name); expect(actual.props).toEqual(before.props);
    expect(actual.props.walletContent).toBeUndefined(); expect(candidate.eagerSetup.mock.calls[0][0]).toEqual(control.eagerSetup.mock.calls[0][0]);
    expect(candidate.eagerSetup).toHaveBeenCalledTimes(1); expect(candidate.setup).not.toHaveBeenCalled(); noNewProviderCalls(candidate);
  });
  it.each(["This link has expired", "This link has already been used", "Invalid token"])("fails closed on token error %s with no setup transport", message => {
    const f = fixture({ data: undefined, error: new Error(message) });
    const tree = f.renderRoot(); expect(tree.type.name).toBe("TokenError");
    expect(f.eagerSetup).not.toHaveBeenCalled(); expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled();
    noNewProviderCalls(f);
  });
  it("fails closed without a token or server metadata and cannot enter the new wallet setup transport", () => {
    const missing = fixture({ token: "", data: undefined });
    expect(missing.renderRoot().type.name).toBe("TokenError");
    expect(missing.queryHook).toHaveBeenCalledWith({ token: "" }, { enabled: false, retry: false });
    const pending = fixture({ data: undefined, loading: true });
    expect(text(pending.renderRoot())).toContain("Loading secure form");
    for (const f of [missing, pending]) {
      expect(f.eagerSetup).not.toHaveBeenCalled(); expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); noNewProviderCalls(f);
    }
  });
  it.each([{ bookingId: undefined }, { bookingId: 0 }, { bookingId: 1.5 }, { firstCleaningTotalCents: undefined }, { firstCleaningTotalCents: -1 }, { requestedStartAt: undefined }, { requestedStartAt: NaN }])("cannot enter Apple Pay with unverifiable metadata: %j", changes => {
    const f = fixture({ data: booking(changes) }); f.renderRoot(); const tree = f.renderRoot();
    expect(tree?.props.walletContent).toBeUndefined();
    expect(f.setup).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); noNewProviderCalls(f);
  });
  it("uses the existing inner layout's wallet slot, while the default slot remains the unchanged Elements/card form", () => {
    const f = fixture(), rootTree = f.renderRoot();
    const walletTree = f.render("wallet-layout", rootTree.type, rootTree.props);
    const aside = nodes(walletTree).find(node => node.type === "aside" && node.props.className === "hero-form")!;
    expect(aside.props.children).toBe(rootTree.props.walletContent);
    const control = fixture({ search: "" }); control.renderRoot(); const defaultRoot = control.renderRoot();
    const cardTree = control.render("card-layout", defaultRoot.type, defaultRoot.props);
    const elements = nodes(cardTree).find(node => node.type === control.Elements)!;
    expect(elements.props.options).toEqual({ clientSecret: "seti_offline_secret" });
    expect(elements.props.children.type.name).toBe("StripeCardForm");
    expect(elements.props.children.props).toMatchObject({ token: "offline-card-token", prefillName: "Saved Customer", clientSecret: "seti_offline_secret" });
    expect(nodes(cardTree).some(node => node.type === control.adapter.default)).toBe(false);
    expect(control.setup).not.toHaveBeenCalled(); noNewProviderCalls(control);
  });
});
