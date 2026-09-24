import { describe, expect, it } from "vitest";
import { bookingTeamDefault } from "./leadflowScheduleAssignmentDefaults";

const teams = [
  { id: 1, name: "Team Maria", launch27TeamId: 110, isActive: 1, isArchived: 0 },
  { id: 2, name: "Team Solange", launch27TeamId: 220, isActive: 1, isArchived: 0 },
  { id: 3, name: "Team Inactive", launch27TeamId: 330, isActive: 0, isArchived: 0 },
];

describe("bookingTeamDefault", () => {
  it("uses the canonical imported Launch27 team ID", () => {
    expect(bookingTeamDefault({ teamId: 220 }, teams)).toEqual(teams[1]);
  });

  it("does not invent a Schedule assignment from a missing, inactive, or ambiguous match", () => {
    expect(bookingTeamDefault({ teamId: null }, teams)).toBeNull();
    expect(bookingTeamDefault({ teamId: 330 }, teams)).toBeNull();
    expect(bookingTeamDefault({ teamId: 110 }, [...teams, { ...teams[0], id: 4 }])).toBeNull();
  });
});
