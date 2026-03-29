/**
 * Tests for agents.setAwayStatus and agents.getStatuses procedures.
 *
 * These tests verify:
 *  1. setAwayStatus throws when no agent cookie is present (unauthenticated)
 *  2. getStatuses returns an array (empty DB returns [])
 *  3. The awayStatus values accepted by the input schema are correct
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAnonContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

describe("agents.setAwayStatus", () => {
  it("throws when no agent session cookie is present", async () => {
    const caller = appRouter.createCaller(createAnonContext());
    await expect(
      caller.agents.setAwayStatus({ status: "lunch" })
    ).rejects.toThrow(/Agent not authenticated/i);
  });

  it("throws when status is an invalid value", async () => {
    const caller = appRouter.createCaller(createAnonContext());
    await expect(
      // @ts-expect-error intentionally passing invalid value
      caller.agents.setAwayStatus({ status: "invalid_value" })
    ).rejects.toThrow();
  });

  it("accepts null to clear away status (still fails auth without cookie)", async () => {
    const caller = appRouter.createCaller(createAnonContext());
    await expect(
      caller.agents.setAwayStatus({ status: null })
    ).rejects.toThrow(/Agent not authenticated/i);
  });
});

describe("agents.getStatuses", () => {
  it("returns an array (empty or populated)", async () => {
    const caller = appRouter.createCaller(createAnonContext());
    const result = await caller.agents.getStatuses();
    expect(Array.isArray(result)).toBe(true);
  });

  it("each row has id, name, awayStatus, and profilePhotoUrl fields", async () => {
    const caller = appRouter.createCaller(createAnonContext());
    const result = await caller.agents.getStatuses();
    for (const row of result) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("awayStatus");
      expect(row).toHaveProperty("profilePhotoUrl");
    }
  });
});
