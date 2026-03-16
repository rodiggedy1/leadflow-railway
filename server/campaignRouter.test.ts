/**
 * Tests for the Campaign Router
 * Tests CSV parsing/filtering and message rendering
 */
import { describe, expect, it } from "vitest";
import { parseAndFilterCsv, renderMessage } from "./campaignRouter";

// ─── parseAndFilterCsv tests ──────────────────────────────────────────────────
describe("parseAndFilterCsv", () => {
  // Helper: build a minimal CSV row matching the real bookings CSV format
  // Real columns: Transaction ID,Date,First Name,Last Name,Full Name,...,Phone,...,Final Amount,Amount Paid by the Customer,Frequency
  function makeCsvRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      "Transaction ID": "TX001",
      "Date": "06/15/2025",
      "First Name": "Jane",
      "Last Name": "Doe",
      "Full Name": "Jane Doe",
      "Company Name": "",
      "Email": "jane@example.com",
      "Address": "123 Main St",
      "City": "Washington",
      "State": "DC",
      "Postal Code": "20001",
      "Location": "",
      "Phone": "2025551234",
      "Rating Value": "",
      "Rating Comment": "",
      "Service Total": "150",
      "Extras Total": "0",
      "Final Amount": "150",
      "Amount Paid by the Customer": "150",
      "Frequency": "One time",
      ...overrides,
    };
  }

  function rowsToCsv(rows: Record<string, string>[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]!);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map(h => row[h] ?? "").join(","));
    }
    return lines.join("\n");
  }

  it("includes eligible one-time customers (6-24 months ago)", () => {
    // Use a date that is ~12 months ago in MM/DD/YYYY format
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(1);
    expect(result.eligible[0]!.name).toBe("Jane Doe");
  });

  it("excludes recurring customers (Bi-weekly (15%OFF))", () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Frequency": "Bi-weekly (15%OFF)", "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(0);
    expect(result.stats.excludedRecurring).toBe(1);
  });

  it("excludes recurring customers (Monthly (10%OFF))", () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Frequency": "Monthly (10%OFF)", "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(0);
    expect(result.stats.excludedRecurring).toBe(1);
  });

  it("excludes customers booked less than 6 months ago", () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const m = String(threeMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(threeMonthsAgo.getDate()).padStart(2, "0");
    const y = threeMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(0);
    expect(result.stats.excludedRecent).toBe(1);
  });

  it("excludes customers booked more than 2 years ago", () => {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const m = String(threeYearsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(threeYearsAgo.getDate()).padStart(2, "0");
    const y = threeYearsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(0);
    expect(result.stats.excludedTooOld).toBe(1);
  });

  it("normalizes phone numbers to E.164", () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Phone": "(202) 555-1234", "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(1);
    expect(result.eligible[0]!.phone).toBe("+12025551234");
  });

  it("skips rows with missing phone", () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Phone": "", "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(0);
    // No phone → skipped during parsing, not counted in stats
  });

  it("parses lastPrice from Final Amount column", () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();
    const dateStr = `${m}/${d}/${y}`;

    const csv = rowsToCsv([makeCsvRow({ "Final Amount": "175", "Date": dateStr })]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(1);
    expect(result.eligible[0]!.lastPrice).toBe(175);
  });

  it("segments warm (6-12 months) vs lapsed (12-24 months)", () => {
    const eightMonthsAgo = new Date();
    eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
    const m1 = String(eightMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d1 = String(eightMonthsAgo.getDate()).padStart(2, "0");
    const y1 = eightMonthsAgo.getFullYear();

    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const m2 = String(eighteenMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d2 = String(eighteenMonthsAgo.getDate()).padStart(2, "0");
    const y2 = eighteenMonthsAgo.getFullYear();

    const csv = rowsToCsv([
      makeCsvRow({ "Full Name": "Warm Customer", "Phone": "2025550001", "Date": `${m1}/${d1}/${y1}` }),
      makeCsvRow({ "Full Name": "Lapsed Customer", "Phone": "2025550002", "Date": `${m2}/${d2}/${y2}` }),
    ]);
    const result = parseAndFilterCsv(csv);
    expect(result.eligible.length).toBe(2);
    const warm = result.eligible.find(c => c.name === "Warm Customer");
    const lapsed = result.eligible.find(c => c.name === "Lapsed Customer");
    expect(warm?.segment).toBe("6-12mo");
    expect(lapsed?.segment).toBe("1-2yr");
  });

  it("deduplicates customers by phone and uses most recent booking", () => {
    // Same phone, two bookings — should only produce one eligible contact
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const m = String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d = String(twelveMonthsAgo.getDate()).padStart(2, "0");
    const y = twelveMonthsAgo.getFullYear();

    const twentyMonthsAgo = new Date();
    twentyMonthsAgo.setMonth(twentyMonthsAgo.getMonth() - 20);
    const m2 = String(twentyMonthsAgo.getMonth() + 1).padStart(2, "0");
    const d2 = String(twentyMonthsAgo.getDate()).padStart(2, "0");
    const y2 = twentyMonthsAgo.getFullYear();

    const csv = rowsToCsv([
      makeCsvRow({ "Phone": "2025551234", "Date": `${m2}/${d2}/${y2}`, "Final Amount": "100" }),
      makeCsvRow({ "Phone": "2025551234", "Date": `${m}/${d}/${y}`, "Final Amount": "150" }),
    ]);
    const result = parseAndFilterCsv(csv);
    // Should be 1 contact (deduplicated)
    expect(result.eligible.length).toBe(1);
    // Should use the most recent booking's price
    expect(result.eligible[0]!.lastPrice).toBe(150);
  });
});

// ─── renderMessage tests ──────────────────────────────────────────────────────
describe("renderMessage", () => {
  it("replaces [Name] with first name", () => {
    const msg = renderMessage("Hi [Name]!", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("Hi Jane!");
  });

  it("replaces [FirstName] with first name", () => {
    const msg = renderMessage("Hi [FirstName]!", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("Hi Jane!");
  });

  it("replaces [FullName] with full name", () => {
    const msg = renderMessage("Hello [FullName]!", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("Hello Jane Doe!");
  });

  it("handles both placeholders in one template", () => {
    const msg = renderMessage("Hi [Name] ([FullName])!", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("Hi Jane (Jane Doe)!");
  });

  it("returns template unchanged if no placeholders", () => {
    const msg = renderMessage("No placeholders here.", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("No placeholders here.");
  });

  it("placeholder matching is case-insensitive", () => {
    const msg = renderMessage("Hi [name]!", { firstName: "Jane", name: "Jane Doe" });
    expect(msg).toBe("Hi Jane!");
  });
});
