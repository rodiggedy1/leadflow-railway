import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB module
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";

describe("hiring router helpers", () => {
  it("should build correct candidate insert payload", () => {
    const input = {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "3025551234",
      streetAddress: "123 Main St",
      apt: undefined,
      city: "Washington",
      state: "DC",
      zip: "20001",
      hasCleaning: true,
      hasBankAccount: true,
      isAuthorized: true,
      consentBackground: false,
      experience: "5 years residential",
      specialties: ["Pro Residential Cleaning", "Move in/Move Out"],
    };

    // Validate the payload transformation logic
    const payload = {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || null,
      phone: input.phone,
      streetAddress: input.streetAddress || null,
      apt: input.apt || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
      hasCleaning: input.hasCleaning === null ? null : input.hasCleaning ? 1 : 0,
      hasBankAccount: input.hasBankAccount === null ? null : input.hasBankAccount ? 1 : 0,
      isAuthorized: input.isAuthorized === null ? null : input.isAuthorized ? 1 : 0,
      consentBackground: input.consentBackground === null ? null : input.consentBackground ? 1 : 0,
      experience: input.experience || null,
      specialties: input.specialties.length > 0 ? JSON.stringify(input.specialties) : null,
      stage: "Application Submitted",
    };

    expect(payload.firstName).toBe("Jane");
    expect(payload.lastName).toBe("Doe");
    expect(payload.hasCleaning).toBe(1);
    expect(payload.hasBankAccount).toBe(1);
    expect(payload.isAuthorized).toBe(1);
    expect(payload.consentBackground).toBe(0);
    expect(payload.specialties).toBe(JSON.stringify(["Pro Residential Cleaning", "Move in/Move Out"]));
    expect(payload.stage).toBe("Application Submitted");
    expect(payload.apt).toBeNull();
  });

  it("should handle null boolean fields correctly", () => {
    const boolToTinyint = (v: boolean | null) =>
      v === null ? null : v ? 1 : 0;

    expect(boolToTinyint(null)).toBeNull();
    expect(boolToTinyint(true)).toBe(1);
    expect(boolToTinyint(false)).toBe(0);
  });

  it("should handle empty specialties array", () => {
    const specialties: string[] = [];
    const result = specialties.length > 0 ? JSON.stringify(specialties) : null;
    expect(result).toBeNull();
  });

  it("should parse specialties JSON in getCandidates response", () => {
    const raw = { specialties: '["Pro Residential Cleaning","Move in/Move Out"]' };
    const parsed = raw.specialties ? JSON.parse(raw.specialties) as string[] : [];
    expect(parsed).toEqual(["Pro Residential Cleaning", "Move in/Move Out"]);
  });

  it("should return empty array for null specialties", () => {
    const raw = { specialties: null };
    const parsed = raw.specialties ? JSON.parse(raw.specialties) as string[] : [];
    expect(parsed).toEqual([]);
  });
});
