import mysql from "mysql2/promise";
import { runVersionedMigrations } from "./migrations/runnerCommand.js";

type RunnerEvent = Record<string, unknown> & { event: string };

function emitRunnerEvent(event: RunnerEvent): Promise<void> {
  return new Promise(resolve => {
    process.stdout.write(`${JSON.stringify(event)}\n`, () => resolve());
  });
}

async function main(): Promise<void> {
  await runVersionedMigrations({
    environment: process.env,
    createPool: mysql.createPool,
    emit: emitRunnerEvent,
  });
}

main().catch(error => {
  void emitRunnerEvent({
    event: "migration_runner_failed",
    error: error instanceof Error ? error.message : String(error),
  }).finally(() => process.exit(1));
});
