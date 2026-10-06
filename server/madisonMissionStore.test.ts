import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  deriveBookServiceState,
  hasBookServiceSignal,
} from "./madisonMissionStore";

describe("Madison BOOK_SERVICE mission foundation", () => {
  it("recognizes booking, quote, and availability signals", () => {
    expect(hasBookServiceSignal("How much for a 2 bedroom cleaning?")).toBe(
      true
    );
    expect(hasBookServiceSignal("Do you have anything Thursday morning?")).toBe(
      true
    );
    expect(hasBookServiceSignal("Thanks, that helps.")).toBe(false);
  });

  it("chooses availability as the next step without creating a booking", () => {
    expect(deriveBookServiceState("Do you have Thursday available?")).toEqual({
      currentStep: "AVAILABILITY_READY",
      nextBestAction: "CHECK_AVAILABILITY",
      objective: "Book the customer for a verified cleaning opening.",
    });
  });

  it("keeps quote requests in discovery and asks only for the next useful step", () => {
    expect(deriveBookServiceState("How much would a cleaning cost?")).toEqual({
      currentStep: "DISCOVERY",
      nextBestAction: "ASK_CUSTOMER",
      objective:
        "Book the customer by first resolving the minimum information needed for a verified quote.",
    });
  });

  it("registers the additive migration with a matching checksum", async () => {
    const directory = path.resolve(
      process.cwd(),
      "server",
      "versioned-migrations"
    );
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8")
    ) as {
      migrations: Array<{
        id: string;
        sqlFile: string;
        sha256: string;
        mode: string;
        replayMode: string;
        postconditionsFile: string;
      }>;
    };
    const migration = manifest.migrations.find(
      item => item.id === "0056_create_madison_missions"
    );
    expect(migration).toMatchObject({
      mode: "create-table",
      sqlFile: "0056_create_madison_missions.sql",
      replayMode: "verified-idempotent",
      postconditionsFile: "0056_create_madison_missions.postconditions.json",
    });
    const sql = await readFile(
      path.join(directory, migration!.sqlFile),
      "utf8"
    );
    expect(createHash("sha256").update(sql).digest("hex")).toBe(
      migration!.sha256
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS `madison_customer_missions`"
    );
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS `madison_customer_mission_facts`"
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
