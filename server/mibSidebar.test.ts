import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sidebarSource = readFileSync(
  resolve(import.meta.dirname, "../client/src/components/MibSidebar.tsx"),
  "utf8",
);

describe("shared MIB sidebar", () => {
  it("keeps the requested navigation order with the existing destinations", () => {
    const expected = [
      ["Dashboard", 'href: "/admin2"'],
      ["Messages", 'href: "https://quote.maidinblack.com/admin/cs-inbox-2"'],
      ["Bookings", 'href: "/admin/bookings"'],
      ["Schedule", 'href: "https://quote.maidinblack.com/admin/field-management"'],
      ["Payments", 'href: "https://quote.maidinblack.com/admin/payments"'],
      ["Invoices", 'href: "https://quote.maidinblack.com/admin/invoices"'],
      ["Callbacks", 'href: "https://quote.maidinblack.com/admin/leads?tab=callbacks"'],
      ["Performance", 'href: "https://quote.maidinblack.com/admin/performance"'],
      ["Campaigns", 'href: "https://quote.maidinblack.com/admin/sms-campaigns"'],
      ["Team pay", 'href: "https://quote.maidinblack.com/admin/team-pay"'],
      ["Hiring", 'href: "https://quote.maidinblack.com/admin/hiring"'],
      ["Settings", 'href: "https://quote.maidinblack.com/admin/settings"'],
    ];

    let cursor = -1;
    for (const [label, href] of expected) {
      const entry = `{ label: "${label}",`;
      const start = sidebarSource.indexOf(entry, cursor + 1);
      expect(start).toBeGreaterThan(cursor);
      expect(sidebarSource.slice(start, start + 180)).toContain(href);
      cursor = start;
    }
  });
});
