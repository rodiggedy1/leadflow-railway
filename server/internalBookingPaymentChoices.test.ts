import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/** Local-only VM/SSR contract test: no app startup, browser, DB, network, or provider. */
const root = resolve(import.meta.dirname, "..");
const paymentPath =
  "client/src/components/internal-booking/InternalApprovedBookPayment.tsx";
const controlsPath =
  "client/src/components/approved-book/InternalBookingControls.tsx";
const shellCssPath =
  "client/src/components/internal-booking/internal-booking-shell.css";
const protectedBase = "126b2c30f411f658a59a2daae1079d96d4a65737";
const protectedPaths = [
  "client/src/pages/Book.tsx",
  "client/src/App.tsx",
  "client/src/components/approved-book/ApprovedBookPayment.tsx",
  "client/src/components/BookingPaymentCheckout.tsx",
  "client/src/components/BookingApplePayCheckout.tsx",
  "client/src/components/BookingCashAppCheckout.tsx",
  "client/src/components/internal-booking/BookingPaymentCheckout.tsx",
  "client/src/components/internal-booking/BookingApplePayCheckout.tsx",
  "client/src/components/internal-booking/BookingCashAppCheckout.tsx",
  "client/src/components/internal-booking/InternalExactBookingApi.ts",
  "client/src/components/internal-booking/InternalExactBookingSession.ts",
  "server/internalExactBookingService.ts",
  "server/bookingPaymentEngine.ts",
  "server/bookingCashAppEngine.ts",
  "shared/publicBookingPricing.ts",
  "shared/canonicalBooking.ts",
];
const methods = ["card", "apple_pay", "cashapp", "google_pay"] as const;

const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const transpile = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
function safeModule(path: string, imports: Record<string, unknown> = {}): any {
  const module = { exports: {} };
  const result = transpile(read(path));
  const errors =
    result.diagnostics?.filter(
      d => d.category === ts.DiagnosticCategory.Error
    ) ?? [];
  if (errors.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: name => name,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      })
    );
  runInNewContext(result.outputText, {
    module,
    exports: module.exports,
    Error,
    Intl,
    require: (id: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, id)) return imports[id];
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".css")) return {};
      if (id.includes("@/assets/payment-marks/")) return id;
      throw new Error(`Unexpected presentation import: ${id}`);
    },
  });
  return module.exports;
}
const controls = safeModule(controlsPath);
const icons = new Proxy(
  {},
  {
    get: (_target, key) => (props: object) =>
      React.createElement("svg", { ...props, "data-icon": String(key) }),
  }
);
const Payment = safeModule(paymentPath, {
  "lucide-react": icons,
  "@shared/easternTime": { easternDateLabel: () => "Wednesday, November 18" },
  "../approved-book/ApprovedBookContext": {
    useApprovedBookContext: () => fixture(),
    approvedBookArrivalLabel: () => "Flexible arrival",
    approvedBookArrivalDiscountTitle: () => "Flexible arrival discount",
  },
});
function fixture() {
  return {
    flow: {
      pricingMode: "home",
      service: "deep",
      frequency: "biweekly",
      bedrooms: 3,
      bathrooms: 2,
      maidCount: 2,
      hourCount: 4,
      requestedLocalDate: "2026-11-18",
      address: "Local test address",
      pricing: {
        firstCleaningTotalCents: 33300,
        futureVisitTotalCents: 23800,
        serviceSubtotalCents: 28000,
        discountPercent: 15,
        arrivalDiscountPercent: 5,
        arrivalDiscountCents: 1700,
        extras: [],
      },
      setStep: vi.fn(),
      setBedrooms: vi.fn(),
      setBathrooms: vi.fn(),
      setMaidCount: vi.fn(),
      setHourCount: vi.fn(),
    },
    location: {
      street: "Local test street",
      apt: "",
      city: "Local city",
      region: "VA",
      zip: "22201",
    },
    arrival: { mode: "flexible" },
    onBack: vi.fn(),
  };
}
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
function renderPayment(overrides: Record<string, unknown> = {}) {
  const seen: string[] = [];
  const panels = Object.fromEntries(
    methods.map(method => [
      method,
      React.createElement(function Sentinel() {
        seen.push(method);
        return React.createElement(
          "span",
          { "data-checkout-sentinel": method },
          method
        );
      }),
    ])
  );
  const props = {
    selectedPaymentMethod: null,
    onPaymentMethodChange: vi.fn(),
    isSaving: false,
    bookingDetailsLocked: false,
    allowCashAppSwitch: false,
    cardOnFile: false,
    formError: "",
    onRetryFinalization: vi.fn(),
    panels,
    ...overrides,
  };
  const noPayment = React.createElement(
    controls.InternalBookWithoutPaymentControl,
    {
      onClick: props.onPaymentMethodChange,
      disabled: props.isSaving,
    }
  );
  let tree: any;
  function Capture() {
    tree = Payment.default({ ...props, internalNoPaymentControl: noPayment });
    return tree;
  }
  const html = renderToStaticMarkup(React.createElement(Capture));
  return { html, tree, seen, props, panels, noPayment };
}

describe("internal booking payment choices: exact scoped presentation", () => {
  it("hides only internal Apple Pay, Cash App, and Google Pay sections while keeping all four panels mounted", () => {
    const source = read(paymentPath);
    const css = read(shellCssPath);
    const result = renderPayment();
    expect(result.seen).toEqual(methods);
    const panels = elements(result.tree).filter(node =>
      /^br3-panel-/.test(node.props.id ?? "")
    );
    expect(panels).toHaveLength(4);
    expect(panels.map(node => node.props.children)).toEqual(
      methods.map(method => result.panels[method])
    );
    for (const method of methods)
      expect(source).toContain(`data-internal-payment-method={option.id}`);
    for (const method of ["apple_pay", "cashapp", "google_pay"]) {
      expect(css).toContain(`[data-internal-payment-method="${method}"]`);
    }
    expect(css).toContain(
      ".internal-exact-booking-shell.approved-book-surface .br-third-page"
    );
    expect(css).toContain("display: none;");
    expect(css).not.toMatch(
      /(^|\n)\s*\.br-third-page\s*\[data-internal-payment-method/
    );
    expect(result.html).toContain("Card on file · pay after service");
    expect(result.html).toContain("Pay with Cash App");
  });

  it("renders the matching no-payment method card and preserves its existing controlled callback/disabled state", () => {
    const onClick = vi.fn();
    const tree = controls.InternalBookWithoutPaymentControl({
      onClick,
      disabled: false,
    });
    const nodes = elements(tree);
    const section = nodes[0];
    const button = nodes.find(node => node.type === "button");
    expect(section.props.className).toBe(
      "internal-booking-no-payment-control br3-method"
    );
    expect(button.props.className).toBe("br3-method-head");
    expect(button.props["aria-label"]).toBe("Book without payment");
    const buttonChildren = React.Children.toArray(
      button.props.children
    ) as any[];
    expect(
      buttonChildren.find(node => node.props.className === "br3-radio").props[
        "aria-hidden"
      ]
    ).toBeTruthy();
    expect(nodes.find(node => node.type === "strong").props.children).toBe(
      "Book without payment"
    );
    expect(nodes.find(node => node.type === "small").props.children).toContain(
      "No payment will be collected"
    );
    expect(button.props.onClick).toBe(onClick);
    button.props.onClick();
    expect(onClick).toHaveBeenCalledOnce();
    const disabled = elements(
      controls.InternalBookWithoutPaymentControl({ onClick, disabled: true })
    ).find(node => node.type === "button");
    expect(disabled.props.disabled).toBe(true);
  });

  it("keeps protected public/controller/pricing/payment source byte-identical to the existing release", () => {
    for (const path of protectedPaths) {
      const expected = execFileSync(
        "git",
        ["show", `${protectedBase}:${path}`],
        {
          cwd: root,
          encoding: "utf8",
          env: { PATH: process.env.PATH },
        }
      );
      expect(read(path), path).toBe(expected);
    }
    expect(protectedPaths.length).toBeGreaterThan(0);
    const baseline = (path: string) => execFileSync("git", ["show", `2e7b7c082a9db5aa1624485d69f0972621cf5fd9:${path}`], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
    const controller = "client/src/components/internal-booking/InternalPublicBook.tsx";
    const stripCompletion = (source: string) => source
      .replace('import InternalBookingThankYou from "./InternalBookingThankYou";\n', "")
      .replace(/  if \(complete\)\n    return \([\s\S]*?\n    \);/, "[completion branch]");
    expect(stripCompletion(read(controller))).toBe(stripCompletion(baseline(controller)));
    const webhook = "server/stripeWebhookRoute.ts";
    const stripHandoffDispatch = (source: string) => source
      .replace('import { isInternalBookingHandoffEvent, processSignedInternalHandoffEvent } from "./internalBookingHandoffWebhook";\n', "")
      .replace(/    if \(isInternalBookingHandoffEvent\(event\)\) \{[\s\S]*?\n    \}\n/, "");
    expect(stripHandoffDispatch(read(webhook))).toBe(baseline(webhook));
  });
});
