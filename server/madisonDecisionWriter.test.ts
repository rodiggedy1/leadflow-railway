import { describe, expect, it } from "vitest";
import { madisonActionProposals, madisonDecisions, madisonIntents } from "../drizzle/schema";
import { persistMadisonDecision, buildMadisonDecision } from "./madisonDecisionWriter";

function input(sourceMessageId = "openphone-message-1") {
  return {
    sourceMessageId,
    sessionId: 55,
    customerId: null,
    inboundText: "When will my team arrive?",
    classification: { type: "QUESTION" as const, intentConfidence: 0.98 },
    intent: "get_eta",
    intentSummary: "Customer wants the team arrival time.",
    draft: "I’m checking the team’s arrival time now and will update you shortly.",
    context: {
      isCleaner: false,
      senderName: "Alex Customer",
      customerName: "Alex Customer",
      bookingId: 42,
      leadflowJobId: 77,
      serviceDateTime: "2026-10-08 11:00",
      teamName: "Team North",
    },
    capabilityResult: {
      capability: "get_eta",
      capabilityVersion: 2,
      args: { leadflowJobId: 77 },
      result: { found: true, etaTimeStr: null },
      observations: ["No ETA recorded yet."],
      suggestedActions: ["send", "edit", "dismiss"],
      followUps: ["Verify ETA."],
    },
    contextUsed: [
      { kind: "latest_message" as const, id: sourceMessageId, summary: "Latest inbound SMS" },
      { kind: "active_booking" as const, id: "42", summary: "Matched native booking" },
    ],
  };
}

function fakeDb() {
  let nextId = 1;
  const decisions: any[] = [];
  const intents: any[] = [];
  const proposals: any[] = [];
  const db: any = {
    select() {
      const query: any = {
        from(table: unknown) { query.table = table; return query; },
        where() { return query; },
        limit() {
          if (query.table === madisonDecisions) return Promise.resolve(decisions.slice(0, 1));
          if (query.table === madisonIntents) return Promise.resolve(intents.slice(0, 1));
          return Promise.resolve([]);
        },
      };
      return query;
    },
    insert(table: unknown) {
      return {
        values(value: any) {
          if (table === madisonDecisions) {
            const row = { id: nextId++, ...value };
            decisions.push(row);
            return Promise.resolve([{ insertId: row.id }]);
          }
          if (table === madisonIntents) {
            const row = { id: nextId++, ...value };
            intents.push(row);
            return Promise.resolve([{ insertId: row.id }]);
          }
          const row = { id: nextId++, ...value };
          proposals.push(row);
          return Promise.resolve([{ insertId: row.id }]);
        },
      };
    },
    _state: { decisions, intents, proposals },
  };
  return db;
}

describe("Madison decision writer", () => {
  it("builds a reviewable operational proposal from a real inbound analysis", () => {
    const built = buildMadisonDecision(input());
    expect(built.decision.sourceMessageId).toBe("openphone-message-1");
    expect(built.decision.disposition).toBe("ACTION_REQUIRED");
    expect(built.intent.intentType).toBe("TEAM_ETA");
    expect(built.proposal).toMatchObject({
      actionType: "OTHER_OPERATION",
      targetType: "booking",
      targetId: "42",
      readiness: "READY_FOR_HUMAN_REVIEW",
      status: "PROPOSED",
    });
  });

  it("creates one decision and does not duplicate it on webhook retry", async () => {
    const db = fakeDb();
    const first = await persistMadisonDecision(db, input());
    const second = await persistMadisonDecision(db, input());

    expect(first).toEqual({ decisionId: 1, created: true });
    expect(second).toEqual({ decisionId: 1, created: false });
    expect(db._state.decisions).toHaveLength(1);
    expect(db._state.intents).toHaveLength(1);
    expect(db._state.proposals).toHaveLength(1);
  });
});
