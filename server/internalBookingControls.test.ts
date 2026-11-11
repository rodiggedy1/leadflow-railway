import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/** Local source/SSR tests only: no application imports or live checkout execution. */
const root = resolve(import.meta.dirname, "..");
const publicPaymentPath =
  "client/src/components/approved-book/ApprovedBookPayment.tsx";
const paymentPath =
  "client/src/components/internal-booking/InternalApprovedBookPayment.tsx";
const controlsPath =
  "client/src/components/approved-book/InternalBookingControls.tsx";
const paymentSource = readFileSync(resolve(root, paymentPath), "utf8");
const baselineSource = execFileSync(
  "git",
  ["show", `7120deaac50e8bdf9f231517131bc5318d6e64ea:${publicPaymentPath}`],
  { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } }
);
const methods = ["card", "apple_pay", "cashapp", "google_pay"] as const;

function safeModule(
  source: string,
  imports: Record<string, unknown> = {}
): any {
  const module = { exports: {} };
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
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
    Intl,
    Error,
    require: (id: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, id)) return imports[id];
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (
        id === "./internal-booking-controls.css" ||
        id === "./approved-payment.css" ||
        id === "../approved-book/approved-payment.css"
      )
        return {};
      if (/^@\/assets\/payment-marks\/[a-z-]+\.svg$/.test(id)) return id;
      throw new Error(`Unexpected presentation import: ${id}`);
    },
  });
  return module.exports;
}

const controls = safeModule(readFileSync(resolve(root, controlsPath), "utf8"));
const icons = Object.fromEntries(
  [
    "ArrowLeft",
    "BedDouble",
    "Bath",
    "Clock",
    "Users",
    "Minus",
    "Plus",
    "Check",
    "LockKeyhole",
    "ShieldCheck",
  ].map(name => [
    name,
    (props: object) =>
      React.createElement("svg", { ...props, "data-icon": name }),
  ])
);
function fixture(pricingMode = "home") {
  return {
    flow: {
      pricingMode,
      service: "deep",
      frequency: "biweekly",
      bedrooms: 3,
      bathrooms: 2,
      maidCount: 2,
      hourCount: 4,
      requestedLocalDate: "2026-11-18",
      address: "Local test address",
      setStep: vi.fn(),
      setBedrooms: vi.fn(),
      setBathrooms: vi.fn(),
      setMaidCount: vi.fn(),
      setHourCount: vi.fn(),
      pricing: {
        firstCleaningTotalCents: 33300,
        futureVisitTotalCents: 23800,
        serviceSubtotalCents: 28000,
        discountPercent: 15,
        arrivalDiscountPercent: 5,
        arrivalDiscountCents: 1700,
        extras: [
          {
            id: "local-extra",
            label: "Local extra",
            quantity: 2,
            totalCents: 7000,
          },
        ],
      },
    },
    location: {
      street: "Local test street",
      apt: "",
      city: "Local city",
      zip: "22201",
    },
    arrival: { mode: "flexible" },
    onBack: vi.fn(),
  };
}
function renderPayment(
  source: string,
  overrides: Record<string, unknown> = {},
  value = fixture()
) {
  const seen: string[] = [];
  const panels = Object.fromEntries(
    methods.map(method => [
      method,
      React.createElement(function CheckoutSentinel() {
        seen.push(method);
        return React.createElement(
          "span",
          { "data-checkout-sentinel": method },
          method
        );
      }),
    ])
  );
  const Payment = safeModule(source, {
    "lucide-react": icons,
    "@shared/easternTime": { easternDateLabel: () => "Wednesday, November 18" },
    "./ApprovedBookContext": {
      useApprovedBookContext: () => value,
      approvedBookArrivalLabel: () => "Flexible arrival",
      approvedBookArrivalDiscountTitle: () => "Flexible arrival discount",
    },
    "../approved-book/ApprovedBookContext": {
      useApprovedBookContext: () => value,
      approvedBookArrivalLabel: () => "Flexible arrival",
      approvedBookArrivalDiscountTitle: () => "Flexible arrival discount",
    },
  }).default;
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
  let tree: any;
  function Capture() {
    tree = Payment(props);
    return tree;
  }
  const html = renderToStaticMarkup(React.createElement(Capture));
  return { html, tree, seen, props };
}
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
function amountProps(overrides: Record<string, unknown> = {}) {
  return {
    value: "300.00",
    onChange: vi.fn(),
    onReset: vi.fn(),
    calculatedTotalCents: 33300,
    adjustmentCents: -3300,
    disabled: false,
    ...overrides,
  };
}
function renderControl(Component: any, props: any) {
  let tree: any;
  function Capture() {
    tree = Component(props);
    return tree;
  }
  const html = renderToStaticMarkup(React.createElement(Capture));
  return { tree, html };
}

describe("internal booking controls: public preservation and optional slots", () => {
  it("leaves public payment source untouched; the internal copy adds only two optional slots and relative import resolution", () => {
    expect(readFileSync(resolve(root, publicPaymentPath), "utf8")).toBe(baselineSource);
    const withoutAdditions = paymentSource
      .split("\n")
      .filter(
        line =>
          !line.includes("internalAmountControl") &&
          !line.includes("internalNoPaymentControl")
      )
      .join("\n")
      .replace('from "../approved-book/ApprovedBookContext"', 'from "./ApprovedBookContext"')
      .replace('import "../approved-book/approved-payment.css"', 'import "./approved-payment.css"');
    expect(withoutAdditions).toBe(baselineSource);
    expect(paymentSource).toContain("internalAmountControl?: ReactNode;");
    expect(paymentSource).toContain("internalNoPaymentControl?: ReactNode;");
  });
  it.each(["home", "hourly"])(
    "omitted/undefined/null slots add zero DOM and preserve %s public SSR byte-for-byte",
    mode => {
      for (const selectedPaymentMethod of [null, ...methods]) {
        const value = fixture(mode);
        const baseline = renderPayment(
          baselineSource,
          { selectedPaymentMethod },
          value
        );
        for (const slots of [
          {},
          {
            internalAmountControl: undefined,
            internalNoPaymentControl: undefined,
          },
          { internalAmountControl: null, internalNoPaymentControl: null },
        ]) {
          const current = renderPayment(
            paymentSource,
            { selectedPaymentMethod, ...slots },
            value
          );
          expect(current.html).toBe(baseline.html);
          expect(current.seen).toEqual(methods);
          expect(current.html).not.toContain("internal-booking-");
        }
      }
    }
  );
  it("preserves the public locked/saving/error/retry DOM with no slots", () => {
    const overrides = {
      selectedPaymentMethod: "card",
      isSaving: true,
      bookingDetailsLocked: true,
      cardOnFile: true,
      formError: "Local retry notice",
    };
    expect(renderPayment(paymentSource, overrides).html).toBe(
      renderPayment(baselineSource, overrides).html
    );
  });
  it.each([null, ...methods])(
    "slots keep all four checkout children rendered with selection %s",
    selectedPaymentMethod => {
      const amount = React.createElement(
        controls.InternalBookingAmountControl,
        amountProps()
      );
      const noPayment = React.createElement(
        controls.InternalBookWithoutPaymentControl,
        { onClick: vi.fn(), disabled: false }
      );
      const result = renderPayment(paymentSource, {
        selectedPaymentMethod,
        internalAmountControl: amount,
        internalNoPaymentControl: noPayment,
        formError: "Local form error",
      });
      expect(result.seen).toEqual(methods);
      const panels = elements(result.tree).filter(node =>
        /^br3-panel-/.test(node.props.id ?? "")
      );
      expect(panels.map(node => node.props.children)).toEqual(
        methods.map(method => result.props.panels[method])
      );
      for (const panel of panels) {
        const active = panel.props.id === `br3-panel-${selectedPaymentMethod}`;
        expect(panel.props.inert).toBe(!active);
        expect(panel.props["aria-hidden"]).toBe(!active);
      }
      const summary = elements(result.tree).find(
        node => node.props.className === "br2-price-card br3-summary"
      );
      const summaryChildren = React.Children.toArray(
        summary.props.children
      ) as any[];
      const amountIndex = summaryChildren.findIndex(
        node => node.type === controls.InternalBookingAmountControl
      );
      expect(summaryChildren[amountIndex - 1].props.className).toBe(
        "br2-price-lines"
      );
      expect(summaryChildren[amountIndex + 1].props.className).toBe(
        "br2-total"
      );
      const paymentCard = elements(result.tree).find(
        node => node.props.className === "br3-payment-card"
      );
      const paymentChildren = React.Children.toArray(
        paymentCard.props.children
      ) as any[];
      // React.Children assigns keys, so locate optional nodes by component type.
      const noPaymentIndex = paymentChildren.findIndex(
        node => node.type === controls.InternalBookWithoutPaymentControl
      );
      expect(paymentChildren[noPaymentIndex - 1].props.className).toBe(
        "br3-methods"
      );
      expect(paymentChildren[noPaymentIndex + 1].props.className).toBe(
        "br3-booking-error"
      );
      expect(
        elements(result.tree).filter(
          node => node.props.className === "br3-method-head"
        )
      ).toHaveLength(4);
    }
  );
});

describe("internal booking controls: thin controlled presentation", () => {
  it("uses a labeled decimal text input and forwards the raw value/reset only", () => {
    const props = amountProps();
    const result = renderControl(controls.InternalBookingAmountControl, props);
    const nodes = elements(result.tree);
    const input = nodes.find(node => node.type === "input");
    const label = nodes.find(node => node.type === "label");
    expect(input.props.type).toBe("text");
    expect(input.props.inputMode).toBe("decimal");
    expect(input.props.value).toBe(props.value);
    expect(label.props.htmlFor).toBe(input.props.id);
    expect(result.html).toContain("Final booking amount ($)");
    expect(result.html).toContain("Calculated price: $333.00");
    expect(result.html).toContain("First cleaning only.");
    expect(result.html).toContain("Future visits unchanged.");
    expect(result.html).not.toContain('type="number"');
    input.props.onChange({ target: { value: "12.3.4" } });
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith("12.3.4");
    const reset = nodes.find(node => node.type === "button");
    expect(reset.props.type).toBe("button");
    reset.props.onClick();
    expect(props.onReset).toHaveBeenCalledOnce();
    expect(result.html).toContain("Use calculated price");
  });
  it.each([
    [-3300, "-$33.00"],
    [1250, "+$12.50"],
  ])("renders the actual signed adjustment %s", (adjustmentCents, signed) => {
    const result = renderControl(
      controls.InternalBookingAmountControl,
      amountProps({ adjustmentCents })
    );
    expect(result.html).toContain("Staff price adjustment");
    expect(result.html).toContain(signed);
  });
  it("does not add an adjustment line when the supplied adjustment is zero", () => {
    const result = renderControl(
      controls.InternalBookingAmountControl,
      amountProps({ adjustmentCents: 0 })
    );
    expect(result.html).not.toContain("Staff price adjustment");
  });
  it("uses only parent-supplied error/disabled states and associates the field error", () => {
    const result = renderControl(
      controls.InternalBookingAmountControl,
      amountProps({ disabled: true, error: "Enter a valid amount." })
    );
    const nodes = elements(result.tree);
    const input = nodes.find(node => node.type === "input");
    const error = nodes.find(node => node.props.role === "alert");
    expect(input.props.disabled).toBe(true);
    expect(input.props["aria-invalid"]).toBe(true);
    expect(input.props["aria-describedby"].split(" ")).toContain(
      error.props.id
    );
    expect(nodes.find(node => node.type === "button").props.disabled).toBe(
      true
    );
    expect(result.html).toContain("Enter a valid amount.");
  });
  it.each([false, true])(
    "keeps the unpaid CTA truthful and parent-controlled, disabled=%s",
    disabled => {
      const onClick = vi.fn();
      const result = renderControl(controls.InternalBookWithoutPaymentControl, {
        onClick,
        disabled,
      });
      const nodes = elements(result.tree);
      const button = nodes.find(node => node.type === "button");
      expect(button.props.type).toBe("button");
      expect(button.props.disabled).toBe(disabled);
      expect(button.props.onClick).toBe(onClick);
      if (!disabled) {
        button.props.onClick();
        expect(onClick).toHaveBeenCalledOnce();
      }
      expect(result.html).toContain("Book without payment");
      expect(result.html).toContain(
        "No payment will be collected. The booking remains unpaid."
      );
      expect(
        nodes.filter(node => node.type === "input" || node.type === "form")
      ).toHaveLength(0);
    }
  );
});
