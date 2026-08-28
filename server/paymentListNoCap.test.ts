import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const routerSource = fs.readFileSync(path.join(root, "server/stripeRouter.ts"), "utf8");
const pageSource = fs.readFileSync(path.join(root, "client/src/pages/AdminPayments.tsx"), "utf8");

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("payment list no-cap contract", () => {
  const authorizationProcedure = between(
    routerSource,
    "listPaymentAuthorizations: agentProcedure",
    "listAllCustomers: agentProcedure",
  );
  const cardsProcedure = between(
    routerSource,
    "listAllCustomers: agentProcedure",
    "listAllCardAuthTokens: agentProcedure",
  );
  const authorizationPanel = between(
    pageSource,
    "function AuthorizationsPanel()",
    "export default function AdminPayments()",
  );

  it("returns every matching authorization without a limit input or SQL limit", () => {
    expect(authorizationProcedure).not.toMatch(/\blimit\s*:/);
    expect(authorizationProcedure).not.toContain(".limit(");
    expect(authorizationProcedure).toContain("customerPhone:");
    expect(authorizationProcedure).toContain("cleanerJobId:");
    expect(authorizationProcedure).toContain("}).optional()");
  });

  it("requests the complete authorization list from Cards & Charges", () => {
    expect(authorizationPanel).toContain("listPaymentAuthorizations.useQuery(");
    expect(authorizationPanel).toMatch(/listPaymentAuthorizations\.useQuery\(\s*undefined,/);
    expect(authorizationPanel).not.toContain("limit: 100");
  });

  it("preserves the existing uncapped Cards on File query", () => {
    expect(cardsProcedure).not.toContain(".limit(");
    expect(cardsProcedure).toContain(".from(stripeCustomers)");
  });

  it("does not change payment action mutations", () => {
    expect(routerSource).toContain("capturePayment:");
    expect(routerSource).toContain("cancelPreauth:");
    expect(routerSource).toContain("createPreauth:");
  });
});
