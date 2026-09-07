import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ONE_YEAR_MS } from "../shared/const";
import { getOrCreateCustomerPortalMagicLink, redeemCustomerPortalHandoff } from "./customerPortalService";

const root = path.resolve(import.meta.dirname, "..");
const service = readFileSync(path.join(root, "server/customerPortalService.ts"), "utf8");
const progress = readFileSync(path.join(root, "server/cleanerPortalProgressRouter.ts"), "utf8");
const route = readFileSync(path.join(root, "server/customerPortalHandoffRoute.ts"), "utf8");
const schema = readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
const drizzleMigration = readFileSync(path.join(root, "drizzle/0100_add_customer_portal_reusable_magic_link.sql"), "utf8");
const managedMigration = readFileSync(path.join(root, "server/versioned-migrations/0031_add_customer_portal_reusable_magic_link.sql"), "utf8");
const manifest = readFileSync(path.join(root, "server/versioned-migrations/manifest.json"), "utf8");

function fakeDb(selectResults: unknown[][]) {
  const results = [...selectResults];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = results.shift() ?? [];
        const query = { limit: vi.fn().mockResolvedValue(rows) };
        return { ...query, orderBy: vi.fn(() => query) };
      }),
    })),
  }));
  const values = vi.fn().mockResolvedValue({});
  const updateWhere = vi.fn().mockResolvedValue({ affectedRows: 1 });
  return {
    select,
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    values,
    updateWhere,
  };
}

describe("customer reusable My Home magic link", () => {
  it("creates or reuses one customer-only token for one year through the established customer handoff URL", () => {
    const helper = service.slice(service.indexOf("export async function getOrCreateCustomerPortalMagicLink"), service.indexOf("export async function redeemCustomerPortalHandoff"));
    expect(helper).toContain("ensureCustomerPortalAccount");
    expect(helper).toContain("eq(customerPortalHandoffTokens.reusable, 1)");
    expect(helper).toContain("customerPortalHandoffTokens.expiresAt} > ${now}");
    expect(helper).toContain("now + ONE_YEAR_MS");
    expect(helper).toContain("reusable: 1");
    expect(helper).toContain("reusableToken: code");
    expect(helper).toContain("/customer-portal/handoff?access=");
    expect(helper).not.toContain("cleanerMagicLinkTokens");
    expect(helper).not.toContain("/auth/cleaner-callback");
  });

  it("returns the already-valid customer link instead of generating a new link for every status update", async () => {
    const account = { id: 12, customerName: "Jamie Lee", customerPhone: "+12025550123", customerEmail: null };
    const db = fakeDb([[account], [{ token: "same-customer-link" }]]);

    const link = await getOrCreateCustomerPortalMagicLink(db as any, { customerName: account.customerName, customerPhone: account.customerPhone });

    expect(link).toBe("https://quote.maidinblack.com/customer-portal/handoff?access=same-customer-link");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates one one-year customer link only when no valid reusable link exists", async () => {
    const account = { id: 13, customerName: "Robin Ortiz", customerPhone: "+12025550124", customerEmail: "robin@example.test" };
    const db = fakeDb([[account], []]);
    const before = Date.now();

    const link = await getOrCreateCustomerPortalMagicLink(db as any, { customerName: account.customerName, customerPhone: account.customerPhone, customerEmail: account.customerEmail });

    const after = Date.now();
    expect(link).toMatch(/^https:\/\/quote\.maidinblack\.com\/customer-portal\/handoff\?access=[A-Za-z0-9_-]{43}$/);
    expect(db.values).toHaveBeenCalledTimes(1);
    const created = db.values.mock.calls[0][0];
    expect(created).toMatchObject({ accountId: account.id, reusable: 1 });
    expect(created.reusableToken).toBe(decodeURIComponent(link.split("access=")[1]));
    expect(created.expiresAt).toBeGreaterThanOrEqual(before + ONE_YEAR_MS);
    expect(created.expiresAt).toBeLessThanOrEqual(after + ONE_YEAR_MS);
  });

  it("keeps the existing short handoff code single-use while allowing only reusable customer tokens to be redeemed repeatedly", () => {
    const shortHandoff = service.slice(service.indexOf("export async function createCustomerPortalHandoff"), service.indexOf("export async function getOrCreateCustomerPortalMagicLink"));
    const redemption = service.slice(service.indexOf("export async function redeemCustomerPortalHandoff"));
    expect(shortHandoff).toContain("expiresAt: Date.now() + 15 * 60 * 1_000");
    expect(shortHandoff).not.toContain("reusable: 1");
    expect(redemption).toContain("or(eq(customerPortalHandoffTokens.reusable, 1), isNull(customerPortalHandoffTokens.usedAt))");
    expect(redemption).toContain("if (!token.reusable)");
    expect(redemption).toContain("set({ usedAt: now })");
  });

  it("does not consume a reusable customer link but continues to consume the existing short handoff token", async () => {
    const account = { id: 14, customerName: "Taylor Green", customerPhone: "+12025550125" };
    const reusableDb = fakeDb([[{ id: 21, accountId: account.id, reusable: 1, expiresAt: Date.now() + ONE_YEAR_MS }], [account]]);
    await expect(redeemCustomerPortalHandoff(reusableDb as any, "reusable-code")).resolves.toEqual(account);
    expect(reusableDb.update).not.toHaveBeenCalled();

    const shortDb = fakeDb([[{ id: 22, accountId: account.id, reusable: 0, expiresAt: Date.now() + 60_000 }], [account]]);
    await expect(redeemCustomerPortalHandoff(shortDb as any, "short-code")).resolves.toEqual(account);
    expect(shortDb.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("adds the same customer portal link to the active on-the-way and arrived texts, but retains the status text if link generation fails", () => {
    expect(progress).toContain('import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService"');
    expect(progress).toContain("portalLink = await getOrCreateCustomerPortalMagicLink");
    expect(progress).toContain("Customer portal link generation failed; sending status text without a link.");
    expect(progress).toContain("const content = portalLink ? `${input.content}\\n\\nOpen My Home: ${portalLink}` : input.content;");
    expect(progress).toContain("jobStatus: \"on_the_way\"");
    expect(progress).toContain("jobStatus: \"arrived\"");
    expect(progress).not.toContain("cleanerMagicLinkTokens");
  });

  it("uses the existing session-issuing handoff route and provides the existing portal login fallback when that link is no longer valid", () => {
    expect(route).toContain('app.get("/customer-portal/handoff", createCustomerPortalHandoffHandler())');
    expect(route).toContain("signCustomerPortalSession");
    expect(route).toContain('req.query.view === "messages" ? "/my-home?view=messages" : "/my-home"');
    expect(route).toContain("return res.redirect(303, destination)");
    expect(route).toContain("secure: true");
  });

  it("registers only the additive customer token columns required for reusable links", () => {
    expect(schema).toContain('reusable: tinyint("reusable").notNull().default(0)');
    expect(schema).toContain('reusableToken: varchar("reusableToken", { length: 64 })');
    for (const migration of [drizzleMigration, managedMigration]) {
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS `reusable` tinyint NOT NULL DEFAULT 0");
      expect(migration).toContain("ADD COLUMN IF NOT EXISTS `reusableToken` varchar(64)");
      expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
    }
    expect(managedMigration).toContain("--> statement-breakpoint");
    expect(manifest).toContain('"id": "0031_add_customer_portal_reusable_magic_link"');
    expect(manifest).toContain('"sha256": "7f4905ba49d6c70c4eaedd4c2b2c7a483bbf6610551837cb5ed550cff0873ef7"');
  });
});
