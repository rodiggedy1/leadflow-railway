import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const route = read("server/twilioLeadBridge.ts");
const sql = read("server/versioned-migrations/0069_create_twilio_lead_bridges.sql");
const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
const postconditions = JSON.parse(read("server/versioned-migrations/0069_create_twilio_lead_bridges.postconditions.json"));

describe("Twilio lead bridge proof-of-concept contract", () => {
  it("uses a durable bridge row before provider initiation and exposes reconciliation", () => {
    expect(route).toContain("INSERT INTO twilio_lead_bridges");
    expect(route).toContain("'office_call_starting'");
    expect(route).toContain("/reconcile/:bridgeId");
    expect(route).toContain("customerCallSid");
    expect(route).toContain("calls.list");
  });

  it("requires Twilio signature verification on every active Twilio callback route", () => {
    const callbackRoutes = ["office-answer", "customer-answer", "status", "conference-status"];
    for (const callback of callbackRoutes) {
      const routeStart = route.indexOf(`BRIDGE_PATH}/${callback}`);
      expect(routeStart).toBeGreaterThan(-1);
      const nextRoute = route.indexOf("app.", routeStart + 10);
      const block = route.slice(routeStart, nextRoute === -1 ? undefined : nextRoute);
      expect(block).toContain("verifyTwilioSignature(req, res)");
    }
    expect(route).not.toContain("confirm-office");
    expect(route).not.toContain("Press 1");
    expect(route).toContain("twilio.validateRequest");
    expect(route).toContain('res.status(403).send("Invalid callback signature")');
  });

  it("starts the customer leg only after the durable office-answered transition", () => {
    expect(route).toContain('state: "office_answered"');
    expect(route).toContain("await startCustomerLeg(req, bridgeId)");
    expect(route).toContain('state: "customer_call_starting",');
    expect(route).toContain('["office_answered"]');
  });

  it("contains office-hangup cleanup and customer-leg reconciliation", () => {
    expect(route).toContain("office_hung_up_before_connection");
    expect(route).toContain('calls(bridge.customerCallSid).update({ status: "completed" })');
    expect(route).toContain("/reconcile/:bridgeId");
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
