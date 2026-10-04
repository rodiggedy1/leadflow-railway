import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("internal booking attribution", () => {
  it("captures the authenticated creator, persists it, and exposes it to admin responses", () => {
    const router = read("server/bookingsRouter.ts");
    const persistence = read("server/canonicalBookingPersistence.ts");
    const schema = read("drizzle/schema.ts");
    const notifications = read("server/bookingCompletionNotifications.ts");
    const chat = read("client/src/components/CommandChat.tsx");

    expect(router).toContain("bookedByAgentId: ctx.agent.agentId");
    expect(router).toContain("bookedByAgentName: ctx.agent.agentName");
    expect(router).toContain("bookedByAgentName: row.bookedByAgentName");
    expect(persistence).toContain("bookedByAgentId: options.bookedByAgentId");
    expect(persistence).toContain("bookedByAgentName: options.bookedByAgentName");
    expect(schema).toContain('bookedByAgentId: int("bookedByAgentId")');
    expect(schema).toContain('bookedByAgentName: varchar("bookedByAgentName", { length: 255 })');
    expect(notifications).toContain("bookedByAgentName: booking.bookedByAgentName");
    expect(chat).toContain("Booked by {bookedByAgentName}");
    expect(router).toContain("businessLocalDateTimeToUtcMs(today, \"00:00\", BOOKING_TIME_ZONE)");
    expect(router).toContain("gte(bookings.createdAt, startOfToday)");
    expect(router).toContain("lt(bookings.createdAt, startOfTomorrow)");
    expect(router).not.toContain("where(eq(bookings.requestedLocalDate, today))");
  });

  it("does not add a polling or timer path to attribution", () => {
    const changed = [
      read("server/bookingsRouter.ts"),
      read("server/canonicalBookingPersistence.ts"),
      read("server/bookingCompletionNotifications.ts"),
    ].join("\n");
    expect(changed).not.toMatch(/setInterval|refetchInterval|setTimeout|poll/i);
  });
});
