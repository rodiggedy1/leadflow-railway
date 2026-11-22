import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "client/src/pages/BookingsCRMExactLive.tsx"), "utf8");
const workspace = readFileSync(resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
const noop = () => null;
const childModules: Record<string, unknown> = {
  "@/components/NativeBookingsWorkspace": { default: noop },
  "@/pages/InternalBooking": { InternalBooking: noop },
  "@/pages/CustomerBookingLinksAdmin": { default: noop },
  "@/components/BookingPaymentActions": { BookingPaymentActions: noop },
  "@/components/PortalRequestPaymentActions": { PortalRequestPaymentActions: noop },
  "@/components/BookingTeamMagicLink": { BookingTeamMagicLink: noop },
  "@/components/NativeBookingAmountEditor": { NativeBookingAmountEditor: noop },
  "@shared/publicBookingPricing": { PUBLIC_BOOKING_PRICED_EXTRAS: {} },
  "@/lib/bookingArrivalDisplay": { getBookingArrivalWindowLabel: () => null },
  "@/lib/trpc": { trpc: new Proxy({}, { get() { throw new Error("Offline CRM must not call a backend"); } }) },
};
function drawer() {
  const module = { exports: {} as any };
  const runtime = { ...jsxRuntime };
  // Execute the actual drawer, but do not execute unrelated payment/payroll/link children.
  for (const key of ["jsx", "jsxs"] as const) runtime[key] = ((type: any, props: any, elementKey: any) =>
    jsxRuntime[key](typeof type === "function" ? noop : type, props, elementKey)) as any;
  const code = ts.transpileModule(page + "\nexport { BookingDetailDrawer };\n", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports,
    require(id: string) {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return runtime;
      if (id === "lucide-react") return new Proxy({}, { get: () => noop });
      if (id.endsWith(".css")) return {};
      if (Object.hasOwn(childModules, id)) return childModules[id];
      throw new Error(`Offline CRM rejected import ${id}`);
    },
  });
  return module.exports.BookingDetailDrawer;
}
function markup(source: string, notes: string[], staffNotes: string | null = null) {
  const active = {
    source, key: `${source}:701`, id: 701, publicNumber: "L27-900701", customerName: "Synthetic Customer",
    status: "assigned", requestedLocalDate: "2026-11-22", requestedLocalTime: "10:30", address: "701 Test Avenue",
    serviceName: "Hourly cleaning", firstCleaningTotalCents: 13900, bedrooms: null, bathrooms: 1,
    recurrence: "One time", extras: [], assignedTeamName: "Synthetic Team", assignedTeamId: 8,
    paymentStatus: "not_started", specialRequestNotes: notes, staffNotes, customerPhone: "", customerEmail: null,
  };
  const query = { isLoading: false, isError: false, isFetching: false, data: null };
  const mutation = { isPending: false };
  const model = {
    active, staffSignoffQuery: query, staffPhotosQuery: query, staffMessagesQuery: query, detailQuery: query,
    assignBookingTeam: mutation, bookingTeamsQuery: query, bookingTeams: [], updateLeadflowJob: mutation,
    updateBookingDetails: mutation, updateFunnelSchedule: mutation, updatePortalSchedule: mutation,
    customerMagicLink: mutation, beforePhotos: [], afterPhotos: [], staffMessages: [],
    rescheduleDate: "2026-11-22", rescheduleTime: "10:30", teamPortalLinkVersion: { current: 0 },
  };
  return renderToStaticMarkup(React.createElement(drawer(), { model }));
}

describe("Launch27 notes in the actual Bookings CRM drawer", () => {
  it("shows the actual hourly service and separate customer and staff notes", () => {
    const html = markup("leadflow", ["Side entrance\nPlease text on arrival"], "Three hours for two cleaners");
    expect(html).toContain("Hourly cleaning");
    expect(html).toContain("Customer notes");
    expect(html).toContain("Side entrance\nPlease text on arrival");
    expect(html).toContain("Staff notes");
    expect(html).toContain("Three hours for two cleaners");
    expect(html).toContain("$139");
    expect(html).toContain("10:30 AM");
    expect(html).toContain("Synthetic Team");
  });
  it("shows staff-only notes without needing customer notes", () => {
    const html = markup("leadflow", [], "Use supplied equipment");
    expect(html).toContain("Use supplied equipment");
    expect(html).toContain("No special requests");
  });
  it("retains native customer-note rendering and does not show provider staff notes on native bookings", () => {
    const html = markup("booking", ["Saved native request"], "Must not appear for a native booking");
    expect(html).toContain("Saved native request");
    expect(html).not.toContain("Must not appear for a native booking");
    expect(html).not.toContain("Launch27 staff notes");
  });
  it("keeps imported notes separate and adds no manual refresh or automatic provider calls", () => {
    expect(workspace).toContain("specialRequestNotes: job.customerNotes ? [job.customerNotes] : []");
    expect(workspace).toContain("staffNotes: job.staffNotes ?? null");
    expect(workspace).not.toContain("refreshLaunch27VisitNotes");
    expect(page).not.toContain("Refresh notes from Launch27");
    for (const text of [page, workspace]) {
      expect(text).not.toContain(["cleaner", "Jobs"].join(""));
      expect(text).not.toContain(["cleaner", "jobs"].join("_"));
    }
  });
});
