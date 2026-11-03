import { describe, expect, it } from "vitest";
import { customerBookingError } from "../client/src/lib/customerBookingError";

describe("customer booking errors", () => {
  it.each([
    ["customerName", "name", "Enter your first and last name."],
    ["customerPhone", "phone", "Enter a valid phone number."],
    ["customerEmail", "email", "Enter a valid email address."],
    ["address", "address", "Enter the complete service address."],
  ])("maps %s validation to an inline field instead of raw Zod data", (path, field, message) => {
    expect(customerBookingError(new Error(JSON.stringify([{ path: [path], message: "raw provider payload", code: "invalid_string" }])), "Try again.")).toEqual({ field, message });
  });
  it("retains a readable provider failure and a semantic field failure", () => {
    expect(customerBookingError(new Error("Your card was declined."), "Try again.")).toEqual({ message: "Your card was declined." });
    expect(customerBookingError(new Error("Enter a valid US phone number."), "Try again.")).toEqual({ message: "Enter a valid US phone number.", field: "phone" });
  });
  it.each(["Failed query: insert into payment_records values (?) params: private", "select secret from records", "{\"private\":\"value\"}", "[{\"path\":[\"other\"],\"private\":\"value\"}]", "x".repeat(301)])("hides technical or unrelated payloads", message => {
    expect(customerBookingError(new Error(message), "Please try again.")).toEqual({ message: "Please try again." });
  });
  it("uses a safe fallback for unknown errors", () => {
    expect(customerBookingError({ private: "internal" }, "Please try again.")).toEqual({ message: "Please try again." });
  });
});
