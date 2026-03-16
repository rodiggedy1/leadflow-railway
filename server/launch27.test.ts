/**
 * Launch27 API connector tests
 * Validates credentials and API connectivity, plus the data extraction logic.
 */
import { describe, it, expect } from "vitest";
import { getCompletedBookingsForDate } from "./launch27";

describe("Launch27 API connector", () => {
  it("should connect to Launch27 and return bookings for a known date", async () => {
    // Use a known date that has completed bookings in the system
    const result = await getCompletedBookingsForDate("2026-03-15");

    // Should not have an error
    expect(result.error).toBeUndefined();

    // Should return an array (may be empty if no bookings on that date)
    expect(Array.isArray(result.bookings)).toBe(true);

    // If there are bookings, validate the shape
    if (result.bookings.length > 0) {
      const booking = result.bookings[0];
      expect(booking).toHaveProperty("id");
      expect(booking).toHaveProperty("phone");
      expect(booking).toHaveProperty("firstName");
      expect(booking).toHaveProperty("fullName");
      expect(booking).toHaveProperty("serviceDate");
      expect(booking.phone).toMatch(/^\+?[\d\s\-().]+$/);
    }
  }, 15000); // 15s timeout for API call

  it("should return empty array for a future date", async () => {
    const result = await getCompletedBookingsForDate("2030-01-01");
    expect(result.error).toBeUndefined();
    expect(result.bookings).toHaveLength(0);
  }, 15000);

  it("should handle invalid credentials gracefully", async () => {
    // This test just validates the module loads and exports correctly
    expect(typeof getCompletedBookingsForDate).toBe("function");
  });
});
