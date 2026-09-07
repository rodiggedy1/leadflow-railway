import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const workspace = readFileSync(path.join(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");

describe("Bookings detail customer magic-link action", () => {
  it("reuses the staff-only customer portal procedure and copies the returned link without sending an SMS", () => {
    expect(workspace).toContain("trpc.customerPortal.staffMagicLink.useMutation");
    expect(workspace).toContain("Copy Customer My Home Link");
    expect(workspace).toContain("Customer My Home link copied.");
    expect(workspace).toContain("customerName: active.customerName");
    expect(workspace).toContain("customerPhone: active.customerPhone");
    expect(workspace).not.toContain("sendSms(");
    expect(workspace).not.toContain("sendJobSms");
  });

  it("requires customer identity before enabling the copy action", () => {
    expect(workspace).toContain("Customer name and phone number are required to create a My Home link.");
    expect(workspace).toContain("disabled={customerMagicLink.isPending || !active.customerName || !active.customerPhone}");
  });
});
