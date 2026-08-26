import { describe, expect, it } from "vitest";
import { buildExactActiveHumanAliasMap, findLastHistoricalHumanAssistant, HUMAN_ASSISTANT_SUMMARY_VERSION } from "./lastHumanAssistantAttribution";

describe("last human assistant historical resolver", () => {
  const agents = new Map([
    ["madison", "Madison"],
    ["madison smith", "Madison"],
    ["rohan", "Rohan"],
    ["openphone", "OpenPhone Collision"],
  ]);

  it("keeps an earlier human through later customer, automation, and blank assistant messages", () => {
    const result = findLastHistoricalHumanAssistant(JSON.stringify([
      { role: "assistant", senderName: "Madison", ts: 100 },
      { role: "user", ts: 200 },
      { role: "assistant", senderName: "OpenPhone", ts: 300 },
      { role: "assistant", senderName: "", ts: 400 },
    ]), agents);
    expect(result).toBe("Madison");
  });

  it("chooses the newest qualifying human and returns null when none qualify", () => {
    expect(findLastHistoricalHumanAssistant(JSON.stringify([
      { role: "assistant", senderName: "Madison", ts: 100 },
      { role: "assistant", senderName: "Rohan", ts: 200 },
    ]), agents)).toBe("Rohan");
    expect(findLastHistoricalHumanAssistant(JSON.stringify([
      { role: "assistant", senderName: "OpenPhone", ts: 100 },
      { role: "assistant", senderName: "Unknown", ts: 200 },
    ]), agents)).toBeNull();
  });

  it("adds a full-name alias only through the exact agent-email-to-user-email join", () => {
    const aliases = buildExactActiveHumanAliasMap(
      [{ name: "Diane", email: "diane@maidsinblack.com" }],
      [
        { name: "Diane Ruiz", email: "diane@maidsinblack.com" },
        { name: "Diane Different", email: "different@maidsinblack.com" },
      ],
    );
    expect(aliases.get("diane")).toBe("Diane");
    expect(aliases.get("diane ruiz")).toBe("Diane");
    expect(aliases.get("diane different")).toBeUndefined();
    expect(findLastHistoricalHumanAssistant(JSON.stringify([
      { role: "assistant", senderName: "Diane Different", ts: 100 },
    ]), aliases)).toBeNull();
  });

  it("documents the live-wins conditional-backfill race contract", () => {
    const row = { name: null as string | null, version: 0 };
    const delayedBackfill = (name: string | null) => {
      if (row.version >= HUMAN_ASSISTANT_SUMMARY_VERSION) return 0;
      row.name = name;
      row.version = HUMAN_ASSISTANT_SUMMARY_VERSION;
      return 1;
    };
    row.name = "Rohan";
    row.version = HUMAN_ASSISTANT_SUMMARY_VERSION;
    expect(delayedBackfill("Madison")).toBe(0);
    expect(row).toEqual({ name: "Rohan", version: HUMAN_ASSISTANT_SUMMARY_VERSION });

    const untouched = { name: null as string | null, version: 0 };
    const backfillUntouched = () => {
      if (untouched.version >= HUMAN_ASSISTANT_SUMMARY_VERSION) return 0;
      untouched.name = "Madison";
      untouched.version = HUMAN_ASSISTANT_SUMMARY_VERSION;
      return 1;
    };
    expect(backfillUntouched()).toBe(1);
    expect(untouched).toEqual({ name: "Madison", version: HUMAN_ASSISTANT_SUMMARY_VERSION });
  });
});
