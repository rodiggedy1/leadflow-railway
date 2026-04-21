/**
 * Tests for the webhook session priority fix:
 * INTERVIEW_LINK_SENT sessions should not steal priority over newer active lead sessions.
 *
 * Root cause: When a phone number has both an INTERVIEW_LINK_SENT session (hiring candidate)
 * and a newer WIDGET_SIZING session (new lead), the webhook was selecting the interview session
 * as the active session (because it's in the priority list). This caused the new lead session
 * to be marked DONE by the "supersede stale duplicate sessions" block.
 *
 * Fix: If the selected reviewSession is an INTERVIEW_* session and a newer active session
 * exists (created after the interview session), the newer session takes priority.
 */
import { describe, it, expect } from "vitest";

// Replicate the session priority logic from server/webhooks.ts
function selectActiveSession(sessions: Array<{
  id: number;
  stage: string;
  createdAt: Date;
}>) {
  const reversedSessions = sessions.slice().reverse();
  const reviewSession = reversedSessions.find(
    s => s.stage === "QUALITY_RATING_REQUESTED" || s.stage === "QUALITY_MISSED_FOLLOWUP"
      || s.stage === "REVIEW_REQUESTED" || s.stage === "REVIEW_DONE"
      || s.stage === "REVIEW_REBOOKING_REQUESTED" || s.stage === "REVIEW_REBOOKING_DONE"
      || s.stage === "REACTIVATION" || s.stage === "REACTIVATION_TIME"
      || s.stage === "INTERVIEW_LINK_SENT" || s.stage === "INTERVIEW_NUDGE_1" || s.stage === "INTERVIEW_NUDGE_2"
  );
  // INTERVIEW_LINK_SENT / NUDGE sessions are for hiring candidates, not customers.
  // If a newer active lead session exists (created after the interview session), the
  // lead session takes priority — otherwise the interview session would steal the reply
  // and the new lead session would be incorrectly marked DONE by the supersede logic.
  const isInterviewSession = reviewSession &&
    (reviewSession.stage === "INTERVIEW_LINK_SENT" ||
     reviewSession.stage === "INTERVIEW_NUDGE_1" ||
     reviewSession.stage === "INTERVIEW_NUDGE_2");
  const newerLeadSession = isInterviewSession
    ? reversedSessions.find(
        s => s.stage !== "DONE" &&
          s.id !== reviewSession!.id &&
          new Date(s.createdAt) > new Date(reviewSession!.createdAt)
      )
    : undefined;
  const activeSession = (newerLeadSession ?? reviewSession) ??
    reversedSessions.find(s => s.stage !== "DONE");
  return activeSession ?? sessions[sessions.length - 1];
}

describe("Webhook session priority — INTERVIEW vs newer lead", () => {
  it("selects INTERVIEW_LINK_SENT when it is the only active session", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_LINK_SENT", createdAt: new Date("2026-04-10") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(100);
    expect(selected?.stage).toBe("INTERVIEW_LINK_SENT");
  });

  it("selects newer WIDGET_SIZING lead over older INTERVIEW_LINK_SENT (the bug fix)", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_LINK_SENT", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "WIDGET_SIZING", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(200);
    expect(selected?.stage).toBe("WIDGET_SIZING");
  });

  it("selects newer FLOWC_ADDON lead over older INTERVIEW_NUDGE_1", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_NUDGE_1", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "FLOWC_ADDON", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(200);
    expect(selected?.stage).toBe("FLOWC_ADDON");
  });

  it("still selects INTERVIEW_LINK_SENT when the newer session is DONE", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_LINK_SENT", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "DONE", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(100);
    expect(selected?.stage).toBe("INTERVIEW_LINK_SENT");
  });

  it("selects REVIEW_REQUESTED over newer WIDGET_SIZING (review still takes priority over leads)", () => {
    const sessions = [
      { id: 100, stage: "WIDGET_SIZING", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "REVIEW_REQUESTED", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    // REVIEW_REQUESTED is not an interview session, so it keeps its priority
    expect(selected?.id).toBe(200);
    expect(selected?.stage).toBe("REVIEW_REQUESTED");
  });

  it("selects REACTIVATION over newer WIDGET_SIZING (reactivation still takes priority)", () => {
    const sessions = [
      { id: 100, stage: "WIDGET_SIZING", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "REACTIVATION", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(200);
    expect(selected?.stage).toBe("REACTIVATION");
  });

  it("selects the most recent INTERVIEW_LINK_SENT when multiple interview sessions exist", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_LINK_SENT", createdAt: new Date("2026-04-01") },
      { id: 200, stage: "INTERVIEW_LINK_SENT", createdAt: new Date("2026-04-10") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(200);
  });

  it("selects newer AVAILABILITY lead over older INTERVIEW_NUDGE_2", () => {
    const sessions = [
      { id: 100, stage: "INTERVIEW_NUDGE_2", createdAt: new Date("2026-04-10") },
      { id: 200, stage: "AVAILABILITY", createdAt: new Date("2026-04-21") },
    ];
    const selected = selectActiveSession(sessions);
    expect(selected?.id).toBe(200);
    expect(selected?.stage).toBe("AVAILABILITY");
  });
});
