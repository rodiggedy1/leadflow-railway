import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const baseline = "a9e5139bad72d51e2a2ff7dfb9cce8c85255335a";
const root = new URL("../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const original = (file: string) => execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 5_000_000 });

function withoutSavedHoldSupport(file: string, source: string): string {
  if (file === "server/bookingPaymentAdminRouter.ts") {
    source = source.replace('import { effectiveNativeVisitAmount } from "../shared/nativeBookingManualAmounts";\n', "");
    const start = source.indexOf("  placeHold: agentProcedure");
    const end = source.indexOf("  captureHold: agentProcedure", start);
    let hold = source.slice(start, end);
    hold = hold.replace('.input(confirmedBookingInput.extend({ expectedAmountCents: z.number().int().nonnegative().safe().optional() }))', '.input(confirmedBookingInput)');
    hold = hold.replace("const { booking, profile, pending, amountCents }", "const { booking, profile, pending }");
    hold = hold.replace('        const amountCents = effectiveNativeVisitAmount(booking, booking.requestedLocalDate, { firstVisit: true });\n        if (input.expectedAmountCents !== undefined && input.expectedAmountCents !== amountCents)\n          throw new TRPCError({ code: "CONFLICT", message: "The booking amount changed. Refresh the booking and confirm the current hold amount." });\n', "");
    hold = hold.replaceAll("          amountCents,", "          amountCents: booking.firstCleaningTotalCents,");
    hold = hold.replace("return { booking, profile, pending, amountCents };", "return { booking, profile, pending };");
    return source.slice(0, start) + hold + source.slice(end);
  }
  if (file === "client/src/components/BookingPaymentActions.tsx") {
    source = source.replace("totalCents, holdTotalCents,", "totalCents,");
    source = source.replace(" holdTotalCents?: number;", "");
    source = source.replace('  const holdAmount = `$${((activeHold?.amountCents ?? holdTotalCents ?? totalCents) / 100).toFixed(2)}`;\n', "");
    source = source.replaceAll("${holdAmount}", "${amount}").replace("Capture {holdAmount}", "Capture {amount}");
    source = source.replace("placeHold.mutate({ bookingId, confirmed: true, ...(holdTotalCents !== undefined ? { expectedAmountCents: holdTotalCents } : {}) });", "placeHold.mutate({ bookingId, confirmed: true });");
  }
  return source;
}

function totals(file: string, tag: string) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === tag) {
      const attribute = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === "totalCents");
      if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) throw new Error("Missing actual total expression");
      expressions.push(attribute.initializer.expression.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return expressions;
}

describe("requested Bookings-only additions preserve working owners", () => {
  it.each([
    "server/bookingPaymentAdminRouter.ts",
    "server/bookingPaymentAdminActions.test.ts",
    "server/payableInvoiceRepository.ts",
    "server/bookingCashAppRouter.ts",
    "server/bookingCashAppEngine.ts",
    "server/internalExactBookingMarker.ts",
    "server/internalBookingHandoffContext.ts",
    "server/payableInvoiceBookingGuard.ts",
    "server/cleanerRouter.ts",
    "server/cleanerPortalReadOnlyRouter.ts",
    "server/cleanerPortalOwnership.ts",
    "server/webhooks.ts",
    "client/src/components/BookingPaymentActions.tsx",
    "client/src/components/ControlTowerTab.tsx",
    "client/src/components/CsInbox.tsx",
    "client/src/pages/CustomerPortal.tsx",
  ])("keeps %s unchanged outside the exact approved hold amount support", file => {
    expect(withoutSavedHoldSupport(file, read(file))).toBe(original(file));
  });

  it.each([
    "client/src/pages/BookingsCRMExactLive.tsx",
    "client/src/components/NativeBookingsWorkspace.tsx",
  ])("keeps original payment-control totals separate from edited Bookings totals in %s", file => {
    const expressions = totals(file, "BookingPaymentActions");
    expect(expressions).toHaveLength(2);
    for (const expression of expressions) {
      const evaluate = new Function("active", `return (${expression});`);
      expect(evaluate({ originalFirstCleaningTotalCents: 12000, firstCleaningTotalCents: 15500 })).toBe(12000);
      expect(evaluate({ firstCleaningTotalCents: 12000 })).toBe(12000);
      expect(evaluate({ originalFirstCleaningTotalCents: 0, firstCleaningTotalCents: 15500 })).toBe(0);
    }
    expect(totals(file, "PortalRequestPaymentActions")).toEqual(["active.firstCleaningTotalCents"]);
  });

  it("copies the established Control Tower link invocation without a second link mutation", () => {
    const component = read("client/src/components/BookingTeamMagicLink.tsx");
    expect(component).toContain("trpc.cleaner.getMagicLink.useMutation()");
    expect(component).toContain('origin: "https://quote.maidinblack.com"');
    expect(component).toContain("navigator.clipboard.writeText(result.url)");
    expect(component).not.toContain("teamMagicLink.useMutation");
    expect(component).not.toContain("sendMagicLink");
    expect(read("server/bookingsRouter.ts")).not.toContain("cleanerRouter.createCaller(ctx).getMagicLink");
  });
});
