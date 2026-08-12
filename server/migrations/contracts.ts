export type MigrationState = "started" | "applied" | "failed";

export interface ManagedMigration {
  id: string;
  sqlFile: string;
  sha256: string;
  replayMode: "verified-idempotent";
  postconditionsFile: string;
}

export interface ManagedMigrationManifest {
  format: 1;
  migrations: ManagedMigration[];
}

export interface ExpectedColumn {
  name: string;
  columnType: string;
  nullable: boolean;
  autoIncrement?: boolean;
  default?: string;
}

export interface ExpectedIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TablePostconditions {
  format: 1;
  table: string;
  columns: ExpectedColumn[];
  indexes: ExpectedIndex[];
}

export interface DatabaseColumn {
  name: string;
  columnType: string;
  nullable: boolean;
  autoIncrement: boolean;
  default: string | null;
}

export interface DatabaseIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface PostconditionResult {
  tableExists: boolean;
  valid: boolean;
  differences: string[];
}

export interface LedgerRow {
  migrationId: string;
  sha256: string;
  state: MigrationState;
  attemptCount: number;
}

export interface MigrationDb {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}
