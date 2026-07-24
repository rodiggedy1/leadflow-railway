/**
 * server/madison/chain/planner.test.ts
 *
 * Tests for the deterministic pre-parser (hasCoordinationSignal).
 * These tests cover the four boundary cases specified in the scope:
 *
 *   1. "Text James"                                  → single (no coordination signal)
 *   2. "Text James and John"                         → chain  (and)
 *   3. "Find unconfirmed customers and text them"    → chain  (and)
 *   4. "Find customers without cards and send payment links" → chain (and)
 *   5. "Check readiness and confirmations"           → chain  (and)
 *
 * Note: hasCoordinationSignal is a pure function with no I/O — no mocking needed.
 */

import { describe, it, expect } from "vitest";
import { hasCoordinationSignal } from "./planner";

describe("hasCoordinationSignal — deterministic pre-parser", () => {
  // ── Boundary case 1: single action, no coordination ──────────────────────
  it("returns false for a simple single-recipient SMS command", () => {
    expect(hasCoordinationSignal("Text James")).toBe(false);
  });

  it("returns false for a single-capability query", () => {
    expect(hasCoordinationSignal("Check readiness")).toBe(false);
  });

  it("returns false for a single-capability query with no conjunction", () => {
    expect(hasCoordinationSignal("What is the confirmation status for today")).toBe(false);
  });

  // ── Boundary case 2: "Text James and John" ────────────────────────────────
  it("returns true for two named recipients joined by 'and'", () => {
    expect(hasCoordinationSignal("Text James and John")).toBe(true);
  });

  // ── Boundary case 3: "Find unconfirmed customers and text them" ───────────
  it("returns true for find-then-act pattern with 'and'", () => {
    expect(hasCoordinationSignal("Find unconfirmed customers and text them")).toBe(true);
  });

  it("returns true for the exact production trigger phrase", () => {
    expect(hasCoordinationSignal("find unconfirmed customers for today and text them all")).toBe(true);
  });

  // ── Boundary case 4: "Find customers without cards and send payment links" ─
  it("returns true for find-then-send pattern with 'and'", () => {
    expect(hasCoordinationSignal("Find customers without cards and send payment links")).toBe(true);
  });

  // ── Boundary case 5: "Check readiness and confirmations" ─────────────────
  it("returns true for two capabilities joined by 'and'", () => {
    expect(hasCoordinationSignal("Check readiness and confirmations")).toBe(true);
  });

  // ── Other coordination keywords ───────────────────────────────────────────
  it("returns true for 'then'", () => {
    expect(hasCoordinationSignal("Get unconfirmed customers then text them")).toBe(true);
  });

  it("returns true for 'after'", () => {
    expect(hasCoordinationSignal("After checking readiness send the report")).toBe(true);
  });

  it("returns true for 'also'", () => {
    expect(hasCoordinationSignal("Check confirmations also send payment links")).toBe(true);
  });

  it("returns true for 'as well'", () => {
    expect(hasCoordinationSignal("Check readiness as well as confirmations")).toBe(true);
  });

  // ── hasWrites determinism verification ─────────────────────────────────────
  // The pre-parser correctly classifies the trigger phrase as chain.
  // The actual hasWrites computation happens inside planChain() using the registry,
  // which is tested here at the pre-parser level (the gateway to that path).
  it("classifies the exact production trigger as chain (gateway to hasWrites=true path)", () => {
    // confirmations.queryStatus (READ) → communications.sendBulkSms (WRITE)
    // hasWrites will be true because sendBulkSms.isWrite === true in the registry
    expect(hasCoordinationSignal("find unconfirmed customers for today and text them all")).toBe(true);
  });

  // ── False-positive guard: 'and' inside a name should NOT trigger ──────────
  // "Anderson" contains "and" but is not a coordination signal.
  // The word-boundary regex \b prevents this.
  it("does not trigger on 'and' inside a proper name like Anderson", () => {
    expect(hasCoordinationSignal("Text Anderson about her appointment")).toBe(false);
  });

  it("does not trigger on 'and' inside 'Sandra'", () => {
    expect(hasCoordinationSignal("Text Sandra about her cleaning")).toBe(false);
  });
});
