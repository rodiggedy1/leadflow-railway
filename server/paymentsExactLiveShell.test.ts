import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Payments exact live shell", () => {
  it("routes the sensitive live workflow through the approved review composition", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/PaymentsExactLive.tsx");

    expect(app).toContain("AdminPaymentsExactReviewRoute");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/payments"><PaymentsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/payments"} component={AdminPaymentsExactReviewRoute} />');
    expect(app).not.toContain('<Route path={"/admin/payments"} component={AdminPayments} />');
    expect(app).toContain('location === "/admin/payments"');
    expect(shell).toContain('import "./payments-review.css"');
    expect(shell).toContain('import "./payments-exact-live.css"');
    expect(shell).toContain('className="payments-review payments-live-exact"');
    expect(shell).toContain('className="payments-workbench"');
    expect(shell).toContain('className={`payment-detail payment-detail--${selected.state}`}');
    expect(shell).toContain('className="payments-page-head payments-page-head--compact"');
    expect(shell).not.toContain("Finance & billing · Live workspace");
    expect(shell).not.toContain("Live records use the existing guarded Stripe workflows");
  });

  it("retains every card, link, authorization, capture, and cancellation path unchanged", () => {
    const shell = read("client/src/pages/PaymentsExactLive.tsx");
    const router = read("server/stripeRouter.ts");

    expect(shell).toContain("trpc.stripe.listAllCardAuthTokens.useQuery({ limit: 50 }");
    expect(shell).toContain("trpc.stripe.listAllCustomers.useQuery(undefined");
    expect(shell).toContain("trpc.stripe.listPaymentAuthorizations.useQuery(undefined");
    expect(shell).toContain("trpc.stripe.generateCardAuthToken.useMutation");
    expect(shell).toContain("trpc.stripe.createPreauth.useMutation");
    expect(shell).toContain("trpc.stripe.capturePayment.useMutation");
    expect(shell).toContain("trpc.stripe.cancelPreauth.useMutation");
    expect(shell).toContain('record.kind === "card" || ["held", "review", "failed"].includes(record.state)');
    expect(shell).toContain("Existing record details");
    expect(shell).toContain("createdBy: authorization.createdBy");
    expect(shell).toContain("actionBy: authorization.actionBy");
    expect(shell).toContain("serviceDate: link.jobDate");
    expect(shell).toContain("serviceAddress: link.jobAddress");
    expect(shell).toContain("completedAt: timestamp(link.completedAt)");
    expect(shell).toContain("paymentIntentId: authorization.stripePaymentIntentId");
    expect(shell).toContain("customerPhone: normalizePhone(linkPhone.trim())");
    expect(shell).toContain("customerPhone: selected.phone");
    expect(shell).toContain("authorizationId: selected.authorizationId, amountCents: cents");
    expect(shell).toContain("window.confirm(`Cancel the ${formatCents(selected.amountCents)} hold");
    expect(shell).toContain("navigator.clipboard.writeText(text)");
    expect(shell).toContain("onClick={captureSelected}");
    expect(shell).toContain("onClick={cancelSelected}");
    expect(shell).toContain("const primaryActionSlot = !selected ? null");
    expect(shell).toContain("{primaryActionSlot}<section className=\"payment-lifecycle\">");
    expect(shell.indexOf("{primaryActionSlot}<section className=\"payment-lifecycle\">")).toBeLessThan(shell.indexOf("payment-existing-fields payment-existing-fields--complete"));
    expect(router).toContain("generateCardAuthToken: agentProcedure");
    expect(router).toContain("createPreauth: agentProcedure");
    expect(router).toContain('capture_method: "manual"');
    expect(router).toContain("capturePayment: agentProcedure");
    expect(router).toContain("cancelPreauth: agentProcedure");
    expect(router).toContain("listPaymentAuthorizations: agentProcedure");
    expect(router).toContain("listAllCustomers: agentProcedure");
    expect(router).toContain("listAllCardAuthTokens: agentProcedure");
  });

  it("keeps the desktop activity list within the fixed review workbench", () => {
    const styles = read("client/src/pages/payments-exact-live.css");

    expect(styles).toContain(".payments-live-exact .payments-workbench{height:590px;min-height:590px}");
    expect(styles).toContain(".payments-live-exact .payments-board{height:100%;min-height:0;overflow:hidden}");
    expect(styles).toContain(".payments-live-exact .payment-list{flex:1;min-height:0;overflow-y:auto");
    expect(styles).toContain(".payments-live-exact .payment-detail{min-height:0;overflow-y:scroll;overscroll-behavior:contain");
    expect(styles).toContain(".payments-live-exact .payment-detail::-webkit-scrollbar-thumb");
    expect(styles).toContain(".payment-existing-fields--complete .payment-existing-fields__wide");
    expect(styles).toContain(".payments-live-exact .payment-primary-actions{margin-top:10px");
    expect(styles).toContain(".payments-live-exact .payments-page-head--compact{align-items:center;min-height:34px;margin-bottom:10px}");
  });
});
