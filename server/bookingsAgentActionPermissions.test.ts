import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");
const prohibitedLegacyTable = ["cleaner", "_jobs"].join("");

describe("Bookings page-action permission contract", () => {
  it("uses the same active-agent bookings permission for every Bookings-visible server procedure", () => {
    const trpc = read("server/_core/trpc.ts");
    const nativeBookings = read("server/bookingsRouter.ts");
    const funnel = read("server/bookingFunnelRouter.ts");
    const leadflow = read("server/leadflowJobsRouter.ts");

    expect(trpc).toContain('export const bookingsAgentProcedure = agentPageProcedure("bookings")');
    expect(trpc).toContain("const agent = await getAgentById(session.agentId)");
    expect(trpc).toContain("!pagePermissions.includes(pageId)");
    for (const procedure of ["list", "get", "cancel", "staffRequests", "cancelStaffRequest", "staffMagicLink"]) {
      expect(nativeBookings).toContain(`${procedure}: bookingsAgentProcedure`);
    }
    for (const procedure of ["list", "get", "cancel"]) {
      expect(funnel).toContain(`${procedure}: bookingsAgentProcedure`);
    }
    for (const procedure of ["list", "staffPhotos", "staffSignoff", "staffMessages", "importNextThirtyDays", "syncDate", "importStatus", "refreshImportedDetails", "cancel", "update"]) {
      expect(leadflow).toContain(`${procedure}: bookingsAgentProcedure`);
    }
  });

  it("wires the Bookings workspace only to Bookings-authorized staff procedures", () => {
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    expect(workspace).toContain("trpc.bookings.staffRequests.useQuery");
    expect(workspace).toContain("trpc.bookings.staffMagicLink.useMutation");
    expect(workspace).toContain("trpc.bookings.cancelStaffRequest.useMutation");
    expect(workspace).not.toContain("trpc.customerPortal.staffRequests");
    expect(workspace).not.toContain("trpc.customerPortal.staffMagicLink");
    expect(workspace).not.toContain("trpc.customerPortal.cancelStaffRequest");
  });

  it("does not introduce the prohibited legacy job path", () => {
    for (const path of ["server/_core/trpc.ts", "server/bookingsRouter.ts", "server/bookingFunnelRouter.ts", "server/leadflowJobsRouter.ts", "client/src/components/NativeBookingsWorkspace.tsx"]) {
      const source = read(path);
      expect(source).not.toContain(prohibitedLegacySymbol);
      expect(source).not.toContain(prohibitedLegacyTable);
    }
  });
});
