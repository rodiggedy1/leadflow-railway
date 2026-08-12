import { describe, expect, it, vi } from "vitest";
import { runVersionedMigrations } from "./migrations/runnerCommand.js";

describe("runVersionedMigrations terminal observability", () => {
  it("emits an explicit terminal skip before opening a database connection when disabled", async () => {
    const createPool = vi.fn(() => {
      throw new Error("database should not be opened while migration execution is disabled");
    });
    const events: Array<Record<string, unknown>> = [];

    await runVersionedMigrations({
      environment: { RUN_VERSIONED_MIGRATIONS: "false" },
      createPool,
      emit: async event => events.push(event),
    });

    expect(events).toEqual([
      { event: "migration_runner_skipped", reason: "RUN_VERSIONED_MIGRATIONS is not true" },
    ]);
    expect(createPool).not.toHaveBeenCalled();
  });
});
