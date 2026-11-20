import { describe, expect, it, vi } from "vitest";
import { assertTeamEvidenceSelect, createTeamEvidenceReadPort } from "./teamLeaderboardReadPort";

describe("isolated weekly SELECT transport", () => {
  it("does not acquire credentials or a connection at import/factory time", async () => {
    const url = vi.fn(() => "private-url"), driver = vi.fn(async () => ({ query: vi.fn(), end: vi.fn() }));
    const port = createTeamEvidenceReadPort({ databaseUrl: url, driver });
    expect(url).not.toHaveBeenCalled(); expect(driver).not.toHaveBeenCalled();
    await port.close(); expect(driver).not.toHaveBeenCalled();
  });
  it("accepts literal parameterized projections from the owned service and receipt tables", async () => {
    const query = vi.fn(async () => [[{ id: "1" }], []] as const), end = vi.fn(async () => {});
    const port = createTeamEvidenceReadPort({ databaseUrl: () => "private", driver: async () => ({ query, end }) });
    const statement = "SELECT j.`id`, p.`jobStatus` FROM `leadflow_jobs` j LEFT JOIN `cleaner_portal_job_progress` p ON p.`leadflowJobId` = j.`id` WHERE j.`jobDate` >= ?";
    expect(await port.select(statement, ["2026-11-15"])).toEqual([{ id: "1" }]);
    expect(query).toHaveBeenCalledWith(statement, ["2026-11-15"]);
    await port.close(); expect(end).toHaveBeenCalledTimes(1);
  });
  it.each([
    "UPDATE `leadflow_jobs` SET `teamId` = ?", "DELETE FROM `leadflow_jobs`", "SELECT `id` FROM `leadflow_jobs` FOR UPDATE",
    "SELECT `id` FROM `leadflow_jobs`; SELECT `id` FROM `bookings`", "SELECT `id` FROM `users`", "SELECT `id` FROM bookings",
    "SELECT * FROM `leadflow_jobs`", "SELECT j.* FROM `leadflow_jobs` j", "SELECT SLEEP(?) FROM `leadflow_jobs`",
    "SELECT `id` FROM `bookings` UNION SELECT `id` FROM `leadflow_jobs`", "SELECT `id` INTO @result FROM `bookings`",
    "SELECT `id` FROM `leadflow_jobs` -- hidden", "SELECT `id` FROM `leadflow_jobs` WHERE `status` = 'completed'",
  ])("rejects unsafe SQL before connection acquisition: %s", async statement => {
    const driver = vi.fn();
    const port = createTeamEvidenceReadPort({ databaseUrl: () => "private", driver });
    await expect(port.select(statement)).rejects.toThrow("DB_READ_FAILED");
    expect(driver).not.toHaveBeenCalled();
  });
  it("allows bound hostile text as data, never executable SQL", async () => {
    const query = vi.fn(async (_query: string, _params: unknown[]) => [[], []] as const);
    const port = createTeamEvidenceReadPort({ databaseUrl: () => "private", driver: async () => ({ query, end: async () => {} }) });
    const hostile = "'; DELETE FROM anything; --";
    await port.select("SELECT `id` FROM `ops_chat_messages` WHERE `quickAction` = ?", [hostile]);
    expect(query.mock.calls[0][1]).toEqual([hostile]);
  });
  it("fails closed when no database is configured", async () => {
    const driver = vi.fn();
    await expect(createTeamEvidenceReadPort({ databaseUrl: () => undefined, driver }).select("SELECT `id` FROM `bookings`")).rejects.toThrow("DB_UNAVAILABLE");
    expect(driver).not.toHaveBeenCalled();
  });
  it("redacts raw connection errors and credentials", async () => {
    const port = createTeamEvidenceReadPort({ databaseUrl: () => "secret", driver: async () => ({
      query: async () => { throw Object.assign(new Error("mysql://secret/customer transcript"), { code: "ECONNREFUSED" }); }, end: async () => {},
    }) });
    await expect(port.select("SELECT `id` FROM `bookings`")).rejects.toThrow("DB_UNAVAILABLE");
  });
  it("rejects malformed driver results", async () => {
    const port = createTeamEvidenceReadPort({ databaseUrl: () => "private", driver: async () => ({ query: async () => [{ affectedRows: 1 }, []], end: async () => {} }) });
    await expect(port.select("SELECT `id` FROM `bookings`")).rejects.toThrow("DB_READ_FAILED");
  });
  it("can read current team IDs and historical native assignment intervals without locks", () => {
    expect(() => assertTeamEvidenceSelect("SELECT `id`, `launch27TeamId` FROM `scheduling_teams`")).not.toThrow();
    expect(() => assertTeamEvidenceSelect("SELECT `bookingId`, `assignedAt`, `unassignedAt` FROM `booking_assignments` WHERE `bookingId` IN (?, ?)")).not.toThrow();
  });
});
