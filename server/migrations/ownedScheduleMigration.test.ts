import { createHash } from "crypto";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { MigrationDb } from "./contracts.js";
import {
  ManagedMigrationError,
  runManagedMigrations,
} from "./managedRunner.js";

const migrationDirectory = path.resolve(
  process.cwd(),
  "server",
  "versioned-migrations"
);
const mode = "owned-schedule-existing-table-schema";
const fixtureSql = `ALTER TABLE \`schedule_assignments\`
  MODIFY COLUMN \`cleanerJobId\` int NULL;
--> statement-breakpoint
ALTER TABLE \`schedule_assignments\`
  MODIFY COLUMN \`teamId\` int NULL;
--> statement-breakpoint
ALTER TABLE \`schedule_assignments\`
  ADD COLUMN IF NOT EXISTS \`leadflowJobId\` int NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS \`uq_schedule_assignments_leadflow_job_date\`
  ON \`schedule_assignments\` (\`leadflowJobId\`, \`jobDate\`);
`;
const fixturePostconditions = {
  format: 1 as const,
  table: "schedule_assignments",
  columns: [
    { name: "cleanerJobId", columnType: "int", nullable: true },
    { name: "teamId", columnType: "int", nullable: true },
    { name: "leadflowJobId", columnType: "int", nullable: true },
  ],
  indexes: [
    {
      name: "uq_schedule_assignments_leadflow_job_date",
      columns: ["leadflowJobId", "jobDate"],
      unique: true,
    },
  ],
};

const ownedScheduleArtifacts = [
  {
    id: "0036_owned_schedule_assignments",
    sqlFile: "0036_owned_schedule_assignments.sql",
    postconditionsFile: "0036_owned_schedule_assignments.postconditions.json",
    table: "schedule_assignments",
    columns: ["cleanerJobId", "teamId", "leadflowJobId"],
    index: {
      name: "uq_schedule_assignments_leadflow_job_date",
      columns: ["leadflowJobId", "jobDate"],
      unique: true,
    },
  },
  {
    id: "0037_owned_schedule_job_locks",
    sqlFile: "0037_owned_schedule_job_locks.sql",
    postconditionsFile: "0037_owned_schedule_job_locks.postconditions.json",
    table: "schedule_job_locks",
    columns: ["jobId", "leadflowJobId", "teamId"],
    index: {
      name: "uq_schedule_job_locks_leadflow_job_date",
      columns: ["leadflowJobId", "date"],
      unique: true,
    },
  },
  {
    id: "0038_owned_field_mgmt_calls",
    sqlFile: "0038_owned_field_mgmt_calls.sql",
    postconditionsFile: "0038_owned_field_mgmt_calls.postconditions.json",
    table: "field_mgmt_calls",
    columns: ["cleanerJobId", "leadflowJobId"],
    index: {
      name: "idx_field_mgmt_calls_leadflow_job",
      columns: ["leadflowJobId"],
      unique: false,
    },
  },
  {
    id: "0039_owned_call_log",
    sqlFile: "0039_owned_call_log.sql",
    postconditionsFile: "0039_owned_call_log.postconditions.json",
    table: "call_log",
    columns: ["leadflowJobId"],
    index: {
      name: "idx_call_log_leadflow_job",
      columns: ["leadflowJobId"],
      unique: false,
    },
  },
  {
    id: "0040_owned_job_issues",
    sqlFile: "0040_owned_job_issues.sql",
    postconditionsFile: "0040_owned_job_issues.postconditions.json",
    table: "job_issues",
    columns: ["cleanerJobId", "leadflowJobId"],
    index: {
      name: "idx_job_issues_leadflow_job_date",
      columns: ["leadflowJobId", "jobDate"],
      unique: false,
    },
  },
] as const;

async function withOwnedScheduleMigrationDirectory<T>(
  sql: string,
  run: (directory: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "managed-owned-schedule-")
  );
  const sha256 = createHash("sha256").update(sql).digest("hex");
  try {
    await Promise.all([
      writeFile(
        path.join(directory, "manifest.json"),
        JSON.stringify({
          format: 1,
          migrations: [
            {
              id: "0036_owned_schedule_assignments",
              mode,
              sqlFile: "0036_owned_schedule_assignments.sql",
              sha256,
              replayMode: "verified-idempotent",
              postconditionsFile:
                "0036_owned_schedule_assignments.postconditions.json",
            },
          ],
        })
      ),
      writeFile(
        path.join(directory, "0036_owned_schedule_assignments.sql"),
        sql
      ),
      writeFile(
        path.join(
          directory,
          "0036_owned_schedule_assignments.postconditions.json"
        ),
        JSON.stringify(fixturePostconditions)
      ),
    ]);
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createOwnedScheduleFakeDb() {
  let cleanerJobIdNullable = false;
  let teamIdNullable = false;
  let leadflowJobIdExists = false;
  let indexExists = false;
  let ledgerState: "started" | "applied" | "failed" | undefined;
  const calls: string[] = [];
  const db: MigrationDb = {
    async query(sql: string): Promise<unknown> {
      calls.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.includes("SELECT migration_id")) {
        return [
          ledgerState
            ? [
                {
                  migration_id: "0036_owned_schedule_assignments",
                  sha256: createHash("sha256").update(fixtureSql).digest("hex"),
                  state: ledgerState,
                  attempt_count: 1,
                },
              ]
            : [],
        ];
      }
      if (sql.includes("information_schema.tables"))
        return [[{ table_name: "schedule_assignments" }]];
      if (sql.includes("information_schema.columns")) {
        return [
          [
            {
              column_name: "cleanerJobId",
              column_type: "int",
              is_nullable: cleanerJobIdNullable ? "YES" : "NO",
              extra: "",
              column_default: null,
            },
            {
              column_name: "teamId",
              column_type: "int",
              is_nullable: teamIdNullable ? "YES" : "NO",
              extra: "",
              column_default: null,
            },
            ...(leadflowJobIdExists
              ? [
                  {
                    column_name: "leadflowJobId",
                    column_type: "int",
                    is_nullable: "YES",
                    extra: "",
                    column_default: null,
                  },
                ]
              : []),
          ],
        ];
      }
      if (sql.includes("information_schema.statistics")) {
        return [
          indexExists
            ? [
                {
                  index_name: "uq_schedule_assignments_leadflow_job_date",
                  non_unique: 0,
                  seq_in_index: 1,
                  column_name: "leadflowJobId",
                },
                {
                  index_name: "uq_schedule_assignments_leadflow_job_date",
                  non_unique: 0,
                  seq_in_index: 2,
                  column_name: "jobDate",
                },
              ]
            : [],
        ];
      }
      if (sql.includes("MODIFY COLUMN `cleanerJobId` int NULL")) {
        cleanerJobIdNullable = true;
        return [[]];
      }
      if (sql.includes("MODIFY COLUMN `teamId` int NULL")) {
        teamIdNullable = true;
        return [[]];
      }
      if (sql.includes("ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL")) {
        leadflowJobIdExists = true;
        return [[]];
      }
      if (
        sql.includes(
          "CREATE UNIQUE INDEX IF NOT EXISTS `uq_schedule_assignments_leadflow_job_date`"
        )
      ) {
        indexExists = true;
        return [[]];
      }
      if (sql.includes("INSERT INTO `app_versioned_migration_ledger`")) {
        ledgerState = "started";
        return [[]];
      }
      if (sql.includes("SET state = 'applied'")) {
        ledgerState = "applied";
        return [[]];
      }
      if (sql.includes("SET state = 'failed'")) {
        ledgerState = "failed";
        return [[]];
      }
      return [[]];
    },
  };
  return {
    db,
    calls,
    state: () => ({
      cleanerJobIdNullable,
      teamIdNullable,
      leadflowJobIdExists,
      indexExists,
      ledgerState,
    }),
  };
}

describe("owned Schedule versioned migration contracts", () => {
  it("declares five sequential, checksummed, single-table schema-only artifacts", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(migrationDirectory, "manifest.json"), "utf8")
    );
    const entries = manifest.migrations.filter(
      (migration: { id: string }) => migration.id >= "0036_"
    );
    expect(entries.map((migration: { id: string }) => migration.id)).toEqual(
      ownedScheduleArtifacts.map(artifact => artifact.id)
    );

    const prohibitedPattern = /cleanerJ(?=obs)|cleaner_j(?=obs)/i;
    for (const artifact of ownedScheduleArtifacts) {
      const entry = entries.find(
        (migration: { id: string }) => migration.id === artifact.id
      );
      expect(entry).toMatchObject({
        id: artifact.id,
        mode,
        sqlFile: artifact.sqlFile,
        replayMode: "verified-idempotent",
        postconditionsFile: artifact.postconditionsFile,
      });

      const [sql, postconditionText] = await Promise.all([
        readFile(path.join(migrationDirectory, artifact.sqlFile), "utf8"),
        readFile(
          path.join(migrationDirectory, artifact.postconditionsFile),
          "utf8"
        ),
      ]);
      const postconditions = JSON.parse(postconditionText);
      expect(entry.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
      expect(postconditions).toMatchObject({
        format: 1,
        table: artifact.table,
        columns: artifact.columns.map(name => ({
          name,
          columnType: "int",
          nullable: true,
        })),
        indexes: [artifact.index],
      });
      expect(sql).toContain("--> statement-breakpoint");
      expect(sql).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|RENAME|CREATE\s+TABLE)\b/i
      );
      expect(`${sql}\n${postconditionText}`).not.toMatch(prohibitedPattern);
    }
  });

  it("applies declared nullable-column and unique-index DDL, then verifies the postconditions", async () => {
    await withOwnedScheduleMigrationDirectory(fixtureSql, async directory => {
      const fake = createOwnedScheduleFakeDb();
      const results = await runManagedMigrations({
        db: fake.db,
        migrationsDirectory: directory,
        logger: console,
      });
      expect(results).toEqual([
        { id: "0036_owned_schedule_assignments", outcome: "applied" },
      ]);
      expect(fake.state()).toEqual({
        cleanerJobIdNullable: true,
        teamIdNullable: true,
        leadflowJobIdExists: true,
        indexExists: true,
        ledgerState: "applied",
      });
      expect(
        fake.calls.filter(sql =>
          /^(?:ALTER|CREATE UNIQUE INDEX)/.test(sql.trim())
        )
      ).toHaveLength(4);
    });
  });

  it("rejects destructive statements before they can execute", async () => {
    const unsafeSql =
      "ALTER TABLE `schedule_assignments` DROP COLUMN `teamId`;\n";
    await withOwnedScheduleMigrationDirectory(unsafeSql, async directory => {
      const fake = createOwnedScheduleFakeDb();
      await expect(
        runManagedMigrations({
          db: fake.db,
          migrationsDirectory: directory,
          logger: console,
        })
      ).rejects.toBeInstanceOf(ManagedMigrationError);
      expect(fake.calls.some(sql => sql.includes("DROP COLUMN"))).toBe(false);
    });
  });

  it("rejects an index whose name, uniqueness, or columns differ from postconditions", async () => {
    const wrongIndexSql = `ALTER TABLE \`schedule_assignments\`
  MODIFY COLUMN \`cleanerJobId\` int NULL;
--> statement-breakpoint
ALTER TABLE \`schedule_assignments\`
  MODIFY COLUMN \`teamId\` int NULL;
--> statement-breakpoint
ALTER TABLE \`schedule_assignments\`
  ADD COLUMN IF NOT EXISTS \`leadflowJobId\` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS \`idx_unexpected\`
  ON \`schedule_assignments\` (\`leadflowJobId\`);\n`;
    await withOwnedScheduleMigrationDirectory(
      wrongIndexSql,
      async directory => {
        const fake = createOwnedScheduleFakeDb();
        await expect(
          runManagedMigrations({
            db: fake.db,
            migrationsDirectory: directory,
            logger: console,
          })
        ).rejects.toBeInstanceOf(ManagedMigrationError);
        expect(fake.calls.some(sql => sql.includes("idx_unexpected"))).toBe(
          false
        );
      }
    );
  });
});
