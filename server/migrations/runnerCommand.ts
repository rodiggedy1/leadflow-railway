import path from "path";
import { runManagedMigrations } from "./managedRunner.js";

type RunnerEvent = Record<string, unknown> & { event: string };

type ConnectionLike = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  release: () => void;
};

type PoolLike = {
  getConnection: () => Promise<ConnectionLike>;
  end: () => Promise<void>;
};

export interface RunVersionedMigrationsDependencies {
  environment: Record<string, string | undefined>;
  createPool: (options: { uri: string; connectionLimit: number }) => PoolLike;
  emit: (event: RunnerEvent) => Promise<void>;
  cwd?: string;
  runManaged?: typeof runManagedMigrations;
}

export async function runVersionedMigrations(dependencies: RunVersionedMigrationsDependencies): Promise<void> {
  if (dependencies.environment.RUN_VERSIONED_MIGRATIONS !== "true") {
    await dependencies.emit({
      event: "migration_runner_skipped",
      reason: "RUN_VERSIONED_MIGRATIONS is not true",
    });
    return;
  }

  const databaseUrl = dependencies.environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required when migrations are enabled");

  const pool = dependencies.createPool({ uri: databaseUrl, connectionLimit: 1 });
  const connection = await pool.getConnection();
  const pendingEvents: Array<Promise<void>> = [];
  const emitLifecycle = (event: string, details?: unknown) => {
    pendingEvents.push(
      dependencies.emit({
        event,
        ...((details ?? {}) as Record<string, unknown>),
      }),
    );
  };

  try {
    await (dependencies.runManaged ?? runManagedMigrations)({
      db: { query: (sql, params) => connection.query(sql, params) },
      migrationsDirectory: path.resolve(dependencies.cwd ?? process.cwd(), "server", "versioned-migrations"),
      logger: {
        info: emitLifecycle,
        error: emitLifecycle,
      },
    });
    await Promise.all(pendingEvents);
    await dependencies.emit({ event: "migration_runner_completed" });
  } catch (error) {
    await Promise.allSettled(pendingEvents);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}
