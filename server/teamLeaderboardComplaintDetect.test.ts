import { describe, expect, it, vi } from "vitest";
import { createTeamComplaintDetector, validateTeamComplaintExtraction, TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS } from "./teamLeaderboardComplaintDetect";
import type { TeamEvidence, TeamComplaintCandidate } from "../shared/teamLeaderboardEvidence";

const source = (change: Partial<TeamEvidence> = {}): TeamEvidence => ({
  id: "sms:1", revision: "a".repeat(64), sourceKind: "sms", store: "inbound_sms", sourceRowId: "1", providerId: "msg1",
  sessionId: null, threadId: null, originalText: "The kitchen was dirty after the 2026-11-17 cleaning. Please come back.",
  occurredAtUtc: "2026-11-18T16:00:00Z", observedAtUtc: "2026-11-18T16:01:00Z", timeBasis: "original", bodyBasis: "original",
  speakerBasis: "customer", customerPhone: "+17035550101", customerEmail: null, customerName: "Sample Customer", businessLine: "+17035550202", mailboxEmail: null,
  limitations: [], ...change,
});
const candidate = (change: Partial<TeamComplaintCandidate> = {}): TeamComplaintCandidate => ({
  evidenceId: "sms:1", evidenceRevision: "a".repeat(64), summary: "Reported dirty kitchen; return requested", category: "cleaning_quality",
  evidenceQuotes: ["The kitchen was dirty"], references: [{ kind: "service_date", value: "2026-11-17", quote: "after the 2026-11-17 cleaning" }], ...change,
});

describe("candidate-only extraction", () => {
  it("reuses the injectable no-tool saved-agent runner and preserves exact source", async () => {
    const runner = vi.fn(async () => ({ finalSmsText: JSON.stringify({ candidates: [candidate()] }) }));
    expect(await createTeamComplaintDetector({ runner })(source())).toEqual([candidate()]);
    expect(runner).toHaveBeenCalledTimes(1);
    const sent = runner.mock.calls[0] as unknown as [{ systemPrompt: string; userPrompt: string }];
    expect(sent[0].systemPrompt).toBe(TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS);
    expect(JSON.parse(sent[0].userPrompt).source.originalText).toBe(source().originalText);
  });
  it.each([
    ["empty body", { originalText: "" }], ["missing body", { originalText: null, bodyBasis: "missing" }],
    ["snippet", { bodyBasis: "snippet" }], ["outbound/non-customer", { speakerBasis: "non_customer" }],
    ["translation variant", { bodyBasis: "snapshot", limitations: ["Stored English translation is a non-original variant"] }],
  ] as Array<[string, Partial<TeamEvidence>]>)("does not invoke a model for %s", async (_, change) => {
    const runner = vi.fn(async () => ({ finalSmsText: "bad" }));
    expect(await createTeamComplaintDetector({ runner })(source(change))).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
  it("accepts empty candidates without assigning a perfect score", () => {
    expect(validateTeamComplaintExtraction({ candidates: [] }, source())).toEqual([]);
  });
  it("rejects a model-assigned source ID", () => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ evidenceId: "sms:2" })] }, source())).toThrow("BINDING");
  });
  it("rejects an old source revision", () => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ evidenceRevision: "b".repeat(64) })] }, source())).toThrow("BINDING");
  });
  it.each(["The bathroom was dirty", "The kitchen\nwas dirty", "La cocina estaba sucia"])("rejects paraphrased, joined or translated quote %s", quote => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ evidenceQuotes: [quote] })] }, source())).toThrow("QUOTE");
  });
  it("accepts a literal Spanish complaint without translating its evidence", () => {
    const s = source({ originalText: "La cocina quedó sucia después de la limpieza." });
    const c = candidate({ evidenceQuotes: ["La cocina quedó sucia"], references: [] });
    expect(validateTeamComplaintExtraction({ candidates: [c] }, s)).toEqual([c]);
  });
  it("rejects an inferred year or internal booking ID outside the reference quote", () => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ references: [{ kind: "service_date", value: "2026-11-10", quote: "2026-11-17" }] })] }, source())).toThrow("REFERENCE");
  });
  it("requires an exact reference quote in the original", () => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ references: [{ kind: "booking", value: "LF-100", quote: "Booking LF-100" }] })] }, source())).toThrow("REFERENCE");
  });
  it("retains an unresolved relative reference for exception review", () => {
    const s = source({ originalText: "The cleaning two visits ago was bad." });
    const c = candidate({ evidenceQuotes: ["was bad"], references: [{ kind: "unresolved", value: null, quote: "two visits ago" }] });
    expect(validateTeamComplaintExtraction({ candidates: [c] }, s)).toEqual([c]);
  });
  it("rejects a resolved reference with no literal value", () => {
    expect(() => validateTeamComplaintExtraction({ candidates: [candidate({ references: [{ kind: "service_date", value: null, quote: "2026-11-17" }] })] }, source())).toThrow("UNRESOLVED");
  });
  it("rejects score, verification, identity and send/action fields", () => {
    for (const extra of [{ verified: true }, { teamId: 12 }, { score: 100 }, { sendSms: true }])
      expect(() => validateTeamComplaintExtraction({ candidates: [{ ...candidate(), ...extra }] }, source())).toThrow();
  });
  it("preserves complete source text and limitations, including unverified call speakers", async () => {
    const s = source({ sourceKind: "phone_unverified", speakerBasis: "unverified", limitations: ["Speaker identity unverified"] });
    const runner = vi.fn(async (input: { userPrompt: string }) => {
      expect(JSON.parse(input.userPrompt).source).toEqual(s);
      return { finalSmsText: JSON.stringify({ candidates: [candidate()] }) };
    });
    await createTeamComplaintDetector({ runner })(s);
  });
  it("does not retry or replace a failed model response with no complaints", async () => {
    const runner = vi.fn(async () => { throw new Error("model unavailable"); });
    await expect(createTeamComplaintDetector({ runner })(source())).rejects.toThrow();
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it("rejects non-JSON output instead of publishing it", async () => {
    await expect(createTeamComplaintDetector({ runner: async () => ({ finalSmsText: "Everything is great" }) })(source())).rejects.toThrow();
  });
});
