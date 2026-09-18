import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("isolated LeadFlow jobs contract", () => {
  const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");
  it("uses a separate LeadFlow-owned table and never imports through the legacy table", () => {
    const schema = read("drizzle/schema.ts");
    const service = read("server/leadflowJobsService.ts");
    const router = read("server/leadflowJobsRouter.ts");
    expect(schema).toContain('mysqlTable("leadflow_jobs"');
    expect(schema).toContain('uniqueIndex("uq_leadflow_jobs_launch27_booking")');
    expect(service).toContain('getCompletedBookingsForDate(date, { includeAll: true })');
    expect(service).toContain("db.update(leadflowJobs)");
    expect(service).toContain("runEndOfDayLeadflowJobRecurrence");
    expect(service).toContain("refreshImportedLaunch27JobDetails");
    expect(service).toContain("importLaunch27JobsForDate");
    expect(service).toContain("if (existing.length > 0) {");
    expect(service).toContain("await db.update(leadflowJobs).set(values).where(eq(leadflowJobs.id, existing[0].id));");
    expect(service).toContain("isSameLeadflowJobIdentity");
    expect(service).not.toContain(prohibitedLegacySymbol);
    expect(router).not.toContain(prohibitedLegacySymbol);
    expect(service).toContain("async function mergeRecurringPlaceholderIntoImportedJob");
    expect(service).toContain("await tx.delete(leadflowJobs).where(eq(leadflowJobs.id, placeholderId));");
    expect(router).toContain("A matching LeadFlow job already exists on that date.");
    expect(router).toContain("importStatus");
    expect(router).toContain("syncDate");
    expect(router).toContain("cancel:");
    expect(router).toContain('bookingStatus: "cancelled"');
  });

  it("keeps the manual import fixed to 30 individual dates", () => {
    const service = read("server/leadflowJobsService.ts");
    expect(service).toContain("LEADFLOW_JOB_IMPORT_DAYS = 30");
    expect(service).toContain("getConsecutiveBusinessDates(startDate)");
  });

  it("registers the isolated table with Railway's active versioned migration runner", () => {
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as {
      migrations: Array<{ id: string; mode?: string; sqlFile?: string; postconditionsFile?: string }>;
    };
    const migration = manifest.migrations.find((item) => item.id === "0025_create_leadflow_jobs");
    const sql = read("server/versioned-migrations/0025_create_leadflow_jobs.sql");
    const postconditions = read("server/versioned-migrations/0025_create_leadflow_jobs.postconditions.json");
    expect(migration).toMatchObject({
      mode: "create-table",
      sqlFile: "0025_create_leadflow_jobs.sql",
      postconditionsFile: "0025_create_leadflow_jobs.postconditions.json",
    });
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `leadflow_jobs`");
    expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
    expect(postconditions).toContain('"table": "leadflow_jobs"');

    const controls = manifest.migrations.find((item) => item.id === "0026_add_leadflow_job_controls");
    const controlsSql = read("server/versioned-migrations/0026_add_leadflow_job_controls.sql");
    expect(controls).toMatchObject({
      mode: "additive-columns-existing-table",
      sqlFile: "0026_add_leadflow_job_controls.sql",
      postconditionsFile: "0026_add_leadflow_job_controls.postconditions.json",
    });
    expect(controlsSql).toMatch(/^ALTER TABLE `leadflow_jobs` ADD COLUMN IF NOT EXISTS/m);
    expect(controlsSql.split(/^\s*-->\s*statement-breakpoint\s*$/m).filter(Boolean)).toHaveLength(4);
    expect(controlsSql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });

  it("renders isolated jobs through the exact Bookings CRM review shell", () => {
    const engine = read("client/src/components/NativeBookingsWorkspace.tsx");
    const route = read("client/src/pages/NativeBookings.tsx");
    const app = read("client/src/App.tsx");
    const liveShell = read("client/src/pages/BookingsCRMExactLive.tsx");
    expect(engine).toContain("trpc.leadflowJobs.list.useQuery");
    expect(engine).toContain("leadflow:job:");
    expect(engine).toContain("syncLeadflowJobsDate");
    expect(engine).toContain("cancelLeadflowJob");
    expect(engine).toContain("cancelActiveRecord");
    expect(engine).toContain("cancelBooking");
    expect(engine).toContain("cancelFunnel");
    expect(engine).toContain("cancelPortalRequest");
    expect(engine).toContain('disabled={cancellationPending} onClick={cancelActiveRecord}');
    expect(engine).toContain("const scheduledPortalRows = portalRequestRows.filter((row) => row.requestedLocalDate === date);");
    expect(engine).toContain("if (view === \"bookings\") return [...scheduledPortalRows, ...scheduledRows];");
    expect(engine).not.toContain("return [...inProgressFunnelRows, ...portalRequestRows, ...scheduledRows];");
    expect(route).toContain("BookingsCRMExactLive");
    expect(route).not.toContain("bookings-ops-shell");
    expect(app).toContain("AdminBookingsCRMExactReviewRoute");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/bookings-crm"><NativeBookings /></ReviewWorkspaceFrame>');
    expect(liveShell).toContain('import "./operations-crm-review.css"');
    expect(liveShell).toContain('import "./bookings-crm-review.css"');
    expect(liveShell).toContain("operations-crm-review booking-crm-review bcr-full-workspace");
    expect(liveShell).toContain("ocr-drawer-backdrop");
    expect(liveShell).toContain("Import next 30 days");
    expect(liveShell).toContain("Refresh team & card details");
    expect(liveShell).toContain("Save date");
    expect(liveShell).toContain("Cleaner &amp; customer");
    expect(liveShell).toContain("const CUSTOMER_PORTRAITS = [");
    expect(liveShell).toContain('className="bcr-customer-portrait"');
    expect(liveShell).toContain("customerPortraitFor(row.customerName)");
    expect(liveShell).not.toContain("bookings-ops-shell");
  });

  it("cancels each detail-panel record by status only without payment or cleaner job side effects", () => {
    const funnel = read("server/bookingFunnelRouter.ts");
    const nativeBookings = read("server/bookingsRouter.ts");
    expect(funnel).toContain("cancel: bookingsAgentProcedure");
    expect(funnel).toContain('stage: "cancelled"');
    expect(nativeBookings).toContain("cancel: bookingsAgentProcedure");
    expect(nativeBookings).toContain('status: "cancelled"');
    expect(nativeBookings).toContain("cancelStaffRequest: bookingsAgentProcedure");
    expect(funnel).not.toContain("getStripeClient");
    expect(nativeBookings).not.toContain("getStripeClient");
  });
});
