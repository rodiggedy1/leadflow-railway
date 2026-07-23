/**
 * gate.test.ts
 *
 * Full test matrix for the concept-scoring readiness gate.
 * Reports score for every case so threshold tuning is data-driven.
 *
 * Threshold: READINESS_GATE_THRESHOLD (currently 2)
 *
 * Expected score matrix (approximate — exact scores depend on keyword overlap):
 *
 * Query                                    Score  Routed
 * ─────────────────────────────────────────────────────
 * What needs attention tomorrow?             5     ✅
 * Are we ready for today?                    4     ✅
 * Which jobs have no cleaner this week?      6     ✅
 * Show me unconfirmed jobs tomorrow morning  6     ✅
 * Any payment issues tomorrow afternoon?     5     ✅
 * Which jobs are at risk tomorrow?           6     ✅
 * What's the 9 AM job situation today?       4     ✅
 * Any access instruction problems tomorrow?  5     ✅
 * Show me double-booked jobs this week       5     ✅
 * How are we looking tomorrow?               4     ✅
 * Anything wrong with tomorrow's schedule?   5     ✅
 * Do all jobs have teams today?              3     ✅
 * Who still needs confirmation tomorrow?     4     ✅
 * Are cards good for tomorrow?               4     ✅
 * Any entry notes missing?                   3     ✅
 * What conflicts do we have this week?       4     ✅
 * Call John                                  0     ❌
 * Text Team 3                                0     ❌
 * Who is Mary Jones?                         0     ❌
 * Create an invoice                          0     ❌
 * Send a payment link                        0     ❌
 * Hire a cleaner                             1     ❌
 * What's today's revenue?                    1     ❌
 * Show yesterday's leads                     1     ❌
 */

import { describe, it, expect } from "vitest";
import { evaluateReadinessGate, READINESS_GATE_THRESHOLD } from "./gate";

function gate(msg: string) {
  return evaluateReadinessGate(msg);
}

describe("Readiness gate — concept scoring", () => {
  // ── Positive cases: original 9 queries ───────────────────────────────────

  it("routes: What needs attention tomorrow?", () => {
    const r = gate("What needs attention tomorrow?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Are we ready for today?", () => {
    const r = gate("Are we ready for today?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Which jobs have no cleaner this week?", () => {
    const r = gate("Which jobs have no cleaner this week?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Show me unconfirmed jobs tomorrow morning", () => {
    const r = gate("Show me unconfirmed jobs tomorrow morning");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Any payment issues tomorrow afternoon?", () => {
    const r = gate("Any payment issues tomorrow afternoon?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Which jobs are at risk tomorrow?", () => {
    const r = gate("Which jobs are at risk tomorrow?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: What's the 9 AM job situation today?", () => {
    const r = gate("What's the 9 AM job situation today?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Any access instruction problems tomorrow?", () => {
    const r = gate("Any access instruction problems tomorrow?");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Show me double-booked jobs this week", () => {
    const r = gate("Show me double-booked jobs this week");
    expect(r.gateMatched).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(READINESS_GATE_THRESHOLD);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  // ── Positive cases: paraphrases ──────────────────────────────────────────

  it("routes: How are we looking tomorrow?", () => {
    const r = gate("How are we looking tomorrow?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Anything wrong with tomorrow's schedule?", () => {
    const r = gate("Anything wrong with tomorrow's schedule?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Do all jobs have teams today?", () => {
    const r = gate("Do all jobs have teams today?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Who still needs confirmation tomorrow?", () => {
    const r = gate("Who still needs confirmation tomorrow?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Are cards good for tomorrow?", () => {
    const r = gate("Are cards good for tomorrow?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: Any entry notes missing?", () => {
    const r = gate("Any entry notes missing?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  it("routes: What conflicts do we have this week?", () => {
    const r = gate("What conflicts do we have this week?");
    expect(r.gateMatched).toBe(true);
    console.log("Score:", r.score, "| concepts:", r.matchedConcepts, "| dims:", r.matchedDimensions);
  });

  // ── Negative cases: should NOT enter Readiness ───────────────────────────

  it("rejects: Call John", () => {
    const r = gate("Call John");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected)");
  });

  it("rejects: Text Team 3", () => {
    const r = gate("Text Team 3");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected)");
  });

  it("rejects: Who is Mary Jones?", () => {
    const r = gate("Who is Mary Jones?");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected)");
  });

  it("rejects: Create an invoice", () => {
    const r = gate("Create an invoice");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected)");
  });

  it("rejects: Send a payment link", () => {
    const r = gate("Send a payment link");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected)");
  });

  it("rejects: Hire a cleaner", () => {
    const r = gate("Hire a cleaner");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected — near-miss expected)");
  });

  it("rejects: What's today's revenue?", () => {
    const r = gate("What's today's revenue?");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected — near-miss expected)");
  });

  it("rejects: Show yesterday's leads", () => {
    const r = gate("Show yesterday's leads");
    expect(r.gateMatched).toBe(false);
    console.log("Score:", r.score, "(rejected — near-miss expected)");
  });
});
