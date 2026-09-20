import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("shared operations workspace sidebar", () => {
  it("keeps the complete workspace catalog visible on every operations page", () => {
    const sidebar = read("client/src/components/OperationsWorkspaceSidebar.tsx");
    const app = read("client/src/App.tsx");

    for (const href of [
      "/admin/leads",
      "/admin/command-chat",
      "/admin/bookings",
      "/admin/customer-profile",
      "/admin/day-board",
      "/admin/schedule",
      "/admin/confirmation-calls",
      "/admin/field-management?tab=tower",
      "/admin/field-management?tab=log",
      "/admin/field-management?tab=workflow",
      "/admin/field-management?tab=concierge",
      "/admin/sms",
      "/admin/emails",
      "/admin/ai-calls",
      "/admin/invoices",
      "/admin/payments",
      "/admin/team-availability",
      "/admin/quality",
      "/admin/payroll-summary",
      "/admin/hiring",
      "/admin/settings",
    ]) expect(sidebar).toContain(href);

    for (const label of ["CRM OVERVIEW", "CUSTOMER OPERATIONS", "CUSTOMER COMMUNICATION", "FINANCE & BILLING", "TEAM OPERATIONS"]) {
      expect(sidebar).toContain(label);
    }

    for (const route of [
      "/admin/day-board",
      "/admin/schedule",
      "/admin/field-management",
      "/admin/sms",
      "/admin/emails",
      "/admin/team-availability",
      "/admin/settings",
    ]) expect(app).toContain(`path={"${route}"}`);

    expect(sidebar).not.toContain("/review/");
  });

  it("uses the same sidebar and active route on every shipped operations workspace", () => {
    const pages = [
      ["client/src/pages/DayBoardExactLive.tsx", "/admin/day-board", "CrmRail"],
      ["client/src/pages/SmsExactLive.tsx", "/admin/sms", "CrmSidebar"],
      ["client/src/pages/LeadflowScheduleCRMExactLive.tsx", "/admin/schedule", "ScheduleSidebar"],
    ] as const;

    for (const [relativePath, activePath, retiredLocalSidebar] of pages) {
      const source = read(relativePath);
      expect(source).toContain(`OperationsWorkspaceSidebar activePath="${activePath}"`);
      expect(source).not.toContain(`function ${retiredLocalSidebar}`);
    }

    expect(read("client/src/pages/EmailsExactLive.tsx")).toContain('OperationsWorkspaceSidebar activePath="/admin/emails"');
  });

  it("opens Field Management tabs from the URL and keeps human tab clicks addressable", () => {
    const fieldManagement = read("client/src/pages/FieldManagement.tsx");
    expect(fieldManagement).toContain("initialFieldManagementTab");
    expect(fieldManagement).toContain('new URLSearchParams(window.location.search).get("tab")');
    expect(fieldManagement).toContain('window.history.replaceState(null, "", `/admin/field-management${query}`)');
  });
});
