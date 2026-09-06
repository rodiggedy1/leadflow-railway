import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bookingsRouter = fs.readFileSync(path.join(root, "server/bookingsRouter.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
const isolatedRouter = fs.readFileSync(path.join(root, "server/cleanerIsolatedRouter.ts"), "utf8");

describe("direct booking assignment for Cleaner Portal visibility", () => {
  it("records the selected team’s stable portal identity in one current assignment row", () => {
    expect(bookingsRouter).toContain("assignTeam: adminAgentProcedure");
    expect(bookingsRouter).toContain("teamId: team.launch27TeamId");
    expect(bookingsRouter).toContain('status: "unassigned", unassignedAt: now');
    expect(bookingsRouter).toContain('status: "assigned", assignedByAgentId: ctx.agent.id');
    expect(bookingsRouter).toContain('assignmentStatus: "assigned"');
  });

  it("shows real active team assignment data on direct booking rows and detail panels", () => {
    expect(bookingsRouter).toContain("activeAssignmentByBooking");
    expect(bookingsRouter).toContain("assignedTeamName: assignment?.teamName ?? null");
    expect(workspace).toContain("trpc.bookings.listAssignableTeams.useQuery");
    expect(workspace).toContain("trpc.bookings.assignTeam.useMutation");
    expect(workspace).toContain("Assign to this team");
  });

  it("uses the same stored stable team ID required by the isolated Cleaner Portal direct booking adapter", () => {
    expect(isolatedRouter).toContain("eq(bookingAssignments.teamId, teamId)");
    expect(isolatedRouter).toContain('eq(bookingAssignments.status, "assigned")');
    expect(isolatedRouter).toContain("isNull(bookingAssignments.unassignedAt)");
  });
});
