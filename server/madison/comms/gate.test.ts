import { describe, it, expect } from "vitest";
import { evaluateCommsGate, isCommsDomain } from "./gate";

describe("comms gate", () => {
  describe("SMS intent — should match", () => {
    it("text Maria", () => expect(isCommsDomain("text Maria")).toBe(true));
    it("send a text to Team 3", () => expect(isCommsDomain("send a text to Team 3")).toBe(true));
    it("message today's cleaners", () => expect(isCommsDomain("message today's cleaners")).toBe(true));
    it("notify everyone scheduled tomorrow", () => expect(isCommsDomain("notify everyone scheduled tomorrow")).toBe(true));
    it("ping the team", () => expect(isCommsDomain("ping the team")).toBe(true));
    it("tell them to check in", () => expect(isCommsDomain("tell them to check in")).toBe(true));
    it("tell the cleaners about the change", () => expect(isCommsDomain("tell the cleaners about the change")).toBe(true));
    it("shoot a text to Maria", () => expect(isCommsDomain("shoot a text to Maria")).toBe(true));
    it("reach out to Corey", () => expect(isCommsDomain("reach out to Corey")).toBe(true));
    it("sms the team", () => expect(isCommsDomain("sms the team")).toBe(true));
  });

  describe("call-only — should NOT match", () => {
    it("call Maria", () => expect(isCommsDomain("call Maria")).toBe(false));
    it("place a call to the customer", () => expect(isCommsDomain("place a call to the customer")).toBe(false));
    it("give Maria a call", () => expect(isCommsDomain("give Maria a call")).toBe(false));
    it("phone the team", () => expect(isCommsDomain("phone the team")).toBe(false));
    it("ring Maria", () => expect(isCommsDomain("ring Maria")).toBe(false));
  });

  describe("non-SMS — should NOT match", () => {
    it("show me tomorrow's jobs", () => expect(isCommsDomain("show me tomorrow's jobs")).toBe(false));
    it("what jobs need attention", () => expect(isCommsDomain("what jobs need attention")).toBe(false));
    it("mark them as handled", () => expect(isCommsDomain("mark them as handled")).toBe(false));
    it("who is unassigned tomorrow", () => expect(isCommsDomain("who is unassigned tomorrow")).toBe(false));
  });

  describe("diagnostics", () => {
    it("returns matched keywords", () => {
      const d = evaluateCommsGate("text Maria about her job");
      expect(d.matchedKeywords).toContain("text");
      expect(d.gateMatched).toBe(true);
      expect(d.blockedByCallOnly).toBe(false);
    });

    it("blocks call-only and reports reason", () => {
      const d = evaluateCommsGate("call Maria");
      expect(d.gateMatched).toBe(false);
      expect(d.blockedByCallOnly).toBe(true);
    });
  });
});
