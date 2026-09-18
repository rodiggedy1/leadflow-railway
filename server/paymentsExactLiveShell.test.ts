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
    expect(shell).toContain("Existing authorization details");
    expect(shell).toContain("createdBy: authorization.createdBy");
    expect(shell).toContain("actionBy: authorization.actionBy");
    expect(shell).toContain("customerPhone: normalizePhone(linkPhone.trim())");
    expect(shell).toContain("customerPhone: selected.phone");
    expect(shell).toContain("authorizationId: selected.authorizationId, amountCents: cents");
    expect(shell).toContain("window.confirm(`Cancel the ${formatCents(selected.amountCents)} hold");
    expect(shell).toContain("navigator.clipboard.writeText(text)");
    expect(shell).toContain("onClick={captureSelected}");
    expect(shell).toContain("onClick={cancelSelected}");
    expect(router).toContain("generateCardAuthToken: agentProcedure");
    expect(router).toContain("createPreauth: agentProcedure");
    expect(router).toContain('capture_method: "manual"');
    expect(router).toContain("capturePayment: agentProcedure");
    expect(router).toContain("cancelPreauth: agentProcedure");
    expect(router).toContain("listPaymentAuthorizations: agentProcedure");
    expect(router).toContain("listAllCustomers: agentProcedure");
    expect(router).toContain("listAllCardAuthTokens: agentProcedure");
  });
});
