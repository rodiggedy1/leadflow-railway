import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const stripeRouterSource = readFileSync(resolve(projectRoot, "server/stripeRouter.ts"), "utf8");
const paymentsPageSource = readFileSync(resolve(projectRoot, "client/src/pages/AdminPayments.tsx"), "utf8");

describe("Cards on File discoverability", () => {
  it("does not apply an arbitrary server or client cap to the preauthorization list", () => {
    const listProcedureStart = stripeRouterSource.indexOf("listAllCustomers: agentProcedure");
    const nextProcedureStart = stripeRouterSource.indexOf("// 11. listAllCardAuthTokens", listProcedureStart);
    const listAllCustomersBlock = stripeRouterSource.slice(listProcedureStart, nextProcedureStart);

    expect(listProcedureStart).toBeGreaterThanOrEqual(0);
    expect(nextProcedureStart).toBeGreaterThan(listProcedureStart);
    expect(listAllCustomersBlock).not.toMatch(/\.input\(/);
    expect(listAllCustomersBlock).not.toMatch(/\.limit\(/);

    const cardsOnFilePanel = paymentsPageSource.match(
      /function CardsOnFilePanel\(\) \{([\s\S]*?)\n\}\n\n\/\/ ── TAB 2: Auth row/,
    )?.[1];

    expect(cardsOnFilePanel).toBeDefined();
    expect(cardsOnFilePanel).not.toMatch(/listAllCustomers\.useQuery\(\s*\{\s*limit:/);
  });
});
