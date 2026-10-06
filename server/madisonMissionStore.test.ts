import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  deriveBookServiceState,
  extractQuoteInputsFromText,
  formatMissingQuoteQuestion,
  hasBookServiceSignal,
  resolveVerifiedQuote,
  shouldContinueBookServiceQuote,
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

  it("calculates a verified quote with the canonical pricing engine", () => {
    expect(
      resolveVerifiedQuote({
        bedrooms: "2 bedrooms",
        bathrooms: "2 bathrooms",
        serviceType: "standard",
        condition: 5,
        extras: [],
        extrasConfirmed: true,
      })
    ).toEqual({
      missing: [],
      quote: {
        bedrooms: "2 Bedrooms",
        bathrooms: "2 Bathrooms",
        serviceType: "Standard Cleaning",
        condition: 5,
        extras: [],
        amountDollars: 269,
        pricingVersion: "public-book-v2",
      },
    });
  });

  it("does not calculate or invent a quote when a required input is missing", () => {
    expect(
      resolveVerifiedQuote({ bedrooms: "2 bedrooms", bathrooms: "2 bathrooms", serviceType: "standard" })
    ).toEqual({
      quote: null,
      missing: ["condition", "extras"],
    });
  });

  it("applies the canonical condition adjustment and extras total", () => {
    const result = resolveVerifiedQuote({
      bedrooms: "2 bedrooms",
      bathrooms: "2 bathrooms",
      serviceType: "standard",
      condition: 7,
      extras: [{ id: "inside-oven", quantity: 1 }],
      extrasConfirmed: true,
    });
    expect(result.quote?.amountDollars).toBe(368);
    expect(result.quote?.extras).toEqual([{ id: "inside-oven", quantity: 1 }]);
  });

  it("extracts quote inputs from the customer SMS", () => {
    expect(extractQuoteInputsFromText("We need a deep cleaning for our 3 bed, 2.5 bath home, condition 7, plus inside oven")).toEqual({
      bedrooms: "3 bed",
      bathrooms: "2.5 bath",
      serviceType: "Deep Cleaning",
      condition: 7,
      extras: [{ id: "inside-oven", quantity: 1 }],
      extrasConfirmed: true,
    });
  });

  it("asks only for the verified fields still missing", () => {
    expect(formatMissingQuoteQuestion(["bathrooms", "serviceType"])).toBe("I can get that quote started — could you tell me how many bathrooms are in the home?");
  });

  it("combines bedrooms and bathrooms into one home-size question", () => {
    expect(formatMissingQuoteQuestion(["bedrooms", "bathrooms", "condition", "extras"])).toBe("I can get that quote started — how many bedrooms and bathrooms are in the home?");
  });

  it("asks for condition before extras when both are missing", () => {
    expect(formatMissingQuoteQuestion(["condition", "extras"])).toBe("I can get that quote started — could you tell me how you would rate the home’s condition from 1 to 10, where 1 is basically spotless and 10 needs a full reset?");
  });

  it("asks only the first discovery question initially", () => {
    expect(formatMissingQuoteQuestion(["serviceType", "bedrooms", "bathrooms", "condition", "extras"])).toBe("I can get that quote started — could you tell me what type of cleaning you need (standard, deep, or move-in/move-out)?");
  });

  it("continues an active quote mission when the customer only supplies details", () => {
    expect(shouldContinueBookServiceQuote("I need a standard cleaning and it's a two bedroom 2 Bathroom.", true, false)).toBe(true);
    expect(shouldContinueBookServiceQuote("I need a standard cleaning and it's a two bedroom 2 Bathroom.", false, false)).toBe(false);
  });

  it("maps Madison mission columns to the deployed table names", async () => {
    const schema = await readFile(path.resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    expect(schema).toContain('type: mysqlEnum("type",');
    expect(schema).toContain('status: mysqlEnum("status",');
    expect(schema).toContain('source: mysqlEnum("source",');
    expect(schema).toContain('confidence: mysqlEnum("confidence",');
    expect(schema).not.toContain('mysqlEnum("type_customer_mission",');
    expect(schema).not.toContain('mysqlEnum("status_customer_mission",');
    expect(schema).not.toContain('mysqlEnum("source_customer_mission_fact",');
    expect(schema).not.toContain('mysqlEnum("confidence_customer_mission_fact",');
  });

  it("registers both additive Madison migrations with matching checksums", async () => {
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
    const factsMigration = manifest.migrations.find(item => item.id === "0057_create_madison_mission_facts");
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
    expect(sql).not.toContain(
      "CREATE TABLE IF NOT EXISTS `madison_customer_mission_facts`"
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
    expect(factsMigration).toMatchObject({
      mode: "create-table",
      sqlFile: "0057_create_madison_mission_facts.sql",
      replayMode: "verified-idempotent",
      postconditionsFile: "0057_create_madison_mission_facts.postconditions.json",
    });
    const factsSql = await readFile(path.join(directory, factsMigration!.sqlFile), "utf8");
    expect(createHash("sha256").update(factsSql).digest("hex")).toBe(factsMigration!.sha256);
    expect(factsSql).toContain("CREATE TABLE IF NOT EXISTS `madison_customer_mission_facts`");
    expect(factsSql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
