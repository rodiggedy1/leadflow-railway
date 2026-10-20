import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const route = readFileSync(path.join(root, "server/twilioLeadBridge.ts"), "utf8");
const sql = readFileSync(path.join(root, "server/versioned-migrations/0069_create_twilio_lead_bridges.sql"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(root, "server/versioned-migrations/manifest.json"), "utf8"));
const postconditions = JSON.parse(readFileSync(path.join(root, "server/versioned-migrations/0069_create_twilio_lead_bridges.postconditions.json"), "utf8"));

describe("Twilio lead bridge proof-of-concept contract", () => {
  it("uses a durable bridge row before provider initiation and exposes reconciliation", () => {
    expect(route).toContain("INSERT INTO twilio_lead_bridges");
    expect(route).toContain("'office_call_starting'");
    expect(route).toContain("/reconcile/:bridgeId");
    expect(route).toContain("customerCallSid");
    expect(route).toContain("calls.list");
  });

  it("requires Twilio signature verification on every Twilio callback route", () => {
    const callbackRoutes = ["office-answer", "confirm-office", "customer-answer", "status", "conference-status"];
    for (const callback of callbackRoutes) {
      const routeStart = route.indexOf(`BRIDGE_PATH}/${callback}`);
      expect(routeStart).toBeGreaterThan(-1);
      const nextRoute = route.indexOf("app.", routeStart + 10);
      const block = route.slice(routeStart, nextRoute === -1 ? undefined : nextRoute);
      expect(block).toContain("verifyTwilioSignature(req, res)");
    }
    expect(route).toContain("twilio.validateRequest");
    expect(route).toContain("res.status(403).send(\"Invalid callback signature\")");
  });

  it("guards customer initiation behind exactly one confirmed transition", () => {
    expect(route).toContain("updateBridge(bridgeId, { state: \"office_confirmed\", confirmedAt: new Date() }, [\"awaiting_confirmation\"])");
    expect(route).toContain("await startCustomerLeg(req, bridgeId)");
    expect(route).toContain("state: \"customer_call_starting\",");
    expect(route).toContain("[\"office_confirmed\"]");
  });

  it("contains office-hangup cleanup and invalid/timeout confirmation handling", () => {
    expect(route).toContain("office_hung_up_before_connection");
    expect(route).toContain("calls(bridge.customerCallSid).update({ status: \"completed\" })");
    expect(route).toContain("office_confirmation_invalid_or_timeout");
    expect(route).toContain("String(req.body?.Digits ?? \"\") !== \"1\"");
  });

  it("has an idempotent managed migration with matching postconditions", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `twilio_lead_bridges`");
    const entry = manifest.migrations.find((migration: { id: string }) => migration.id === "0069_create_twilio_lead_bridges");
    expect(entry).toBeTruthy();
    expect(entry.sha256).toBe(createHash("sha256").update(sql).digest("hex"));
    expect(postconditions.table).toBe("twilio_lead_bridges");
    expect(postconditions.columns.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining(["bridgeId", "idempotencyKey", "officeCallSid", "customerCallSid", "state"]));
  });
});
