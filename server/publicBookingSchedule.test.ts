import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bookNow = readFileSync(resolve(import.meta.dirname, "../client/src/pages/BookNow.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dirname, "../client/src/pages/book-now.css"), "utf8");

describe("public booking date and time controls", () => {
  it("keeps quick cards and hides the future-date calendar until the selected-date-row control is clicked", () => {
    expect(bookNow).toContain('className="book-now-date-grid"');
    expect(bookNow).toContain('aria-controls="other-booking-dates"');
    expect(bookNow).toContain('aria-expanded={showOtherDates}');
    expect(bookNow).toContain('>Choose other dates</button>');
    expect(bookNow).toContain('showOtherDates && <div id="other-booking-dates"');
    expect(bookNow).toContain('<Calendar mode="single"');
    expect(bookNow).toContain('disabled={{ before: firstBookableDate }}');
  });

  it("uses the approved arrival windows and removes availability framing", () => {
    expect(bookNow).toContain('const TIME_SLOTS = ["8:30 AM", "11:00 AM", "1:30 PM", "4:30 PM"] as const;');
    expect(bookNow).toContain("Choose a date and arrival window.");
    expect(bookNow).not.toContain("Pick an available day and arrival window.");
    expect(bookNow).not.toContain("Best availability");
  });

  it("starts quick cards tomorrow at or after 4:30 PM Eastern Time", () => {
    expect(bookNow).toContain('const BUSINESS_TIME_ZONE = "America/New_York";');
    expect(bookNow).toContain('timeZone: BUSINESS_TIME_ZONE');
    expect(bookNow).toContain('easternParts.hour > 16 || (easternParts.hour === 16 && easternParts.minute >= 30)');
    expect(bookNow).toContain("start.setDate(start.getDate() + 1)");
  });

  it("keeps the opened calendar compact instead of stretching day cells across the workspace", () => {
    expect(styles).toContain(".book-now-date-calendar{width:min(340px,100%)");
    expect(styles).toContain("margin-left:auto");
    expect(styles).toContain("--cell-size:32px");
    expect(styles).toContain(".book-now-date-calendar .rdp-day_button{width:32px;min-width:0;height:32px}");
  });
});
