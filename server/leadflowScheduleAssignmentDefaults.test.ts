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

  it("uses the current booking's local team ID, not the job snapshot or a colliding Launch27 ID", () => {
    const colliding = [...teams, { id: 4, name: "Wrong imported team", launch27TeamId: 2, isActive: 1, isArchived: 0 }];
    expect(bookingTeamDefault({ bookingId: 42, teamId: 1 }, colliding, { teamId: 2 })).toEqual(teams[1]);
    expect(bookingTeamDefault({ bookingId: 42, teamId: null }, colliding, { teamId: 2 })).toEqual(teams[1]);
  });

  it("does not revive an absent booking assignment from stale IDs or matching names", () => {
    expect(bookingTeamDefault({ bookingId: 42, teamId: 220 }, teams)).toBeNull();
    expect(bookingTeamDefault({ bookingId: 42, teamId: 220 }, teams, { teamId: null })).toBeNull();
    expect(bookingTeamDefault({ bookingId: 42, teamId: 220 }, teams, { teamId: 999 })).toBeNull();
    expect(bookingTeamDefault({ bookingId: 42, teamId: 220 }, [...teams, { ...teams[1] }], { teamId: 2 })).toBeNull();
  });

  it("keeps a native booking assigned to its known inactive team instead of labelling it unassigned", () => {
    expect(bookingTeamDefault({ bookingId: 42, teamId: null }, teams, { teamId: 3 })).toEqual(teams[2]);
  });

  it("retains the imported-ID namespace even if an unrelated native assignment is supplied", () => {
    expect(bookingTeamDefault({ bookingId: null, teamId: 220 }, teams, { teamId: 1 })).toEqual(teams[1]);
  });
});
