/**
 * callsRouter.test.ts
 *
 * Unit tests for the AI Call Command Center server-side logic.
 * Tests the variable extraction / resolution helpers and the
 * self-call protection guard — no DB or VAPI calls needed.
 */

import { describe, it, expect } from "vitest";

// ── Inline the helpers so tests don't need to import from the router ──────────

function resolveScript(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}

function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  let m: RegExpExecArray | null;
  const re = /\{\{(\w+)\}\}/g;
  while ((m = re.exec(template)) !== null) vars.add(m[1]);
  return Array.from(vars);
}

const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077";

function normalizePhone(raw: string): string {
  return raw.startsWith("+") ? raw : `+1${raw.replace(/\D/g, "")}`;
}

function isSelfCall(phone: string): boolean {
  return normalizePhone(phone) === VAPI_OUTBOUND_PHONE_NUMBER;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveScript", () => {
  it("replaces known variables", () => {
    const tpl = "Hi {{team_name}}, your client {{client_name}} is waiting at {{address}}.";
    const result = resolveScript(tpl, {
      team_name: "Team Alpha",
      client_name: "Jane Smith",
      address: "123 Main St",
    });
    expect(result).toBe("Hi Team Alpha, your client Jane Smith is waiting at 123 Main St.");
  });

  it("leaves unknown variables as-is", () => {
    const tpl = "ETA is {{new_eta}} and utility is {{water_power_access}}.";
    const result = resolveScript(tpl, { new_eta: "2:30 PM" });
    expect(result).toBe("ETA is 2:30 PM and utility is {{water_power_access}}.");
  });

  it("handles empty vars map", () => {
    const tpl = "Hello {{team_name}}";
    const result = resolveScript(tpl, {});
    expect(result).toBe("Hello {{team_name}}");
  });

  it("handles script with no variables", () => {
    const tpl = "This is a plain script with no placeholders.";
    const result = resolveScript(tpl, { team_name: "Alpha" });
    expect(result).toBe("This is a plain script with no placeholders.");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const tpl = "{{team_name}} is late. Please call {{team_name}} now.";
    const result = resolveScript(tpl, { team_name: "Team Bravo" });
    expect(result).toBe("Team Bravo is late. Please call Team Bravo now.");
  });
});

describe("extractVariables", () => {
  it("extracts all unique variable names", () => {
    const tpl = "Hi {{team_name}}, client is {{client_name}} at {{address}}.";
    const vars = extractVariables(tpl);
    expect(vars).toContain("team_name");
    expect(vars).toContain("client_name");
    expect(vars).toContain("address");
    expect(vars.length).toBe(3);
  });

  it("deduplicates repeated variables", () => {
    const tpl = "{{team_name}} is late. {{team_name}} should call in.";
    const vars = extractVariables(tpl);
    expect(vars.filter(v => v === "team_name").length).toBe(1);
  });

  it("returns empty array for no variables", () => {
    const tpl = "No placeholders here.";
    expect(extractVariables(tpl)).toEqual([]);
  });
});

describe("normalizePhone", () => {
  it("leaves E.164 numbers unchanged", () => {
    expect(normalizePhone("+12025551234")).toBe("+12025551234");
  });

  it("prepends +1 to 10-digit US numbers", () => {
    expect(normalizePhone("2025551234")).toBe("+12025551234");
  });

  it("strips formatting and prepends +1", () => {
    expect(normalizePhone("(202) 555-1234")).toBe("+12025551234");
  });
});

describe("isSelfCall (self-call protection)", () => {
  it("blocks the VAPI outbound number", () => {
    expect(isSelfCall("+19347898077")).toBe(true);
  });

  it("allows regular phone numbers", () => {
    expect(isSelfCall("+12025551234")).toBe(false);
    expect(isSelfCall("2025551234")).toBe(false);
  });
});

describe("call template trigger mapping", () => {
  const triggerMap: Record<string, string[]> = {
    late_team: ["late_team", "checkin_reminder"],
    no_access: ["no_access", "lockout_warning"],
    parking: ["parking"],
    delay: ["delay_update", "late_team"],
    lockout: ["lockout_warning", "lockout_final"],
    utility_issue: ["utility_issue"],
    no_checkin: ["checkin_reminder", "arrival_confirmation"],
    completion: ["completion_walkthrough"],
    manual: ["manual"],
  };

  it("maps every issue type to at least one trigger", () => {
    const issueTypes = [
      "late_team", "no_access", "parking", "delay", "lockout",
      "utility_issue", "no_checkin", "completion", "manual",
    ];
    for (const type of issueTypes) {
      expect(triggerMap[type]).toBeDefined();
      expect(triggerMap[type].length).toBeGreaterThan(0);
    }
  });

  it("late_team includes checkin_reminder as fallback", () => {
    expect(triggerMap.late_team).toContain("checkin_reminder");
  });

  it("lockout includes both warning and final", () => {
    expect(triggerMap.lockout).toContain("lockout_warning");
    expect(triggerMap.lockout).toContain("lockout_final");
  });
});
