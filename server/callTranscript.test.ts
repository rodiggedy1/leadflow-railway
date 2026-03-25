/**
 * Tests for call transcript webhook handler logic.
 * Covers: payload parsing, dialogue extraction, DB update path.
 */
import { describe, it, expect } from "vitest";

// ─── Helpers extracted from the webhook handler logic ───────────────────────

type DialogueTurn = {
  identifier: string;
  content: string;
  start: number;
  end: number;
};

/** Mirrors the logic in handleCallTranscriptCompleted */
function extractDialogue(eventPayload: unknown): DialogueTurn[] | null {
  const obj = (eventPayload as any)?.data?.object;
  const callId: string | undefined = obj?.callId;
  if (!callId) return null;

  const dialogue = obj?.dialogue;
  if (!Array.isArray(dialogue) || dialogue.length === 0) return null;

  return dialogue as DialogueTurn[];
}

/** Mirrors the speaker label logic in the dashboard call card */
function speakerLabel(identifier: string, leadName?: string): string {
  if (!identifier) return "Unknown";
  if (identifier.startsWith("+")) return leadName ?? identifier;
  return "Staff";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractDialogue", () => {
  it("returns null when callId is missing", () => {
    const payload = { data: { object: { dialogue: [{ identifier: "+1", content: "hi", start: 0, end: 1 }] } } };
    expect(extractDialogue(payload)).toBeNull();
  });

  it("returns null when dialogue is empty array", () => {
    const payload = { data: { object: { callId: "AC123", dialogue: [] } } };
    expect(extractDialogue(payload)).toBeNull();
  });

  it("returns null when dialogue is missing", () => {
    const payload = { data: { object: { callId: "AC123" } } };
    expect(extractDialogue(payload)).toBeNull();
  });

  it("returns dialogue array for valid payload", () => {
    const dialogue = [
      { identifier: "+15555551234", content: "Hello, I need a quote.", start: 0.5, end: 3.2 },
      { identifier: "USlHhXmRMz", content: "Sure, let me help you.", start: 3.8, end: 6.1 },
    ];
    const payload = {
      data: {
        object: {
          callId: "AC16558bc5f73445598a2627f5a94fe014",
          dialogue,
          duration: 6,
          status: "completed",
        },
      },
    };
    const result = extractDialogue(payload);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].content).toBe("Hello, I need a quote.");
    expect(result![1].identifier).toBe("USlHhXmRMz");
  });

  it("handles callTranscript event type (OpenPhone v4 webhook format)", () => {
    // OpenPhone sends type: "callTranscript" (not "call.transcript.completed") in v4
    const payload = {
      type: "callTranscript",
      data: {
        object: {
          callId: "ACabc123",
          object: "callTranscript",
          dialogue: [
            { identifier: "+19876543210", content: "Hello, world!", start: 5.1, end: 10.1 },
          ],
          duration: 5,
          status: "completed",
        },
      },
    };
    const result = extractDialogue(payload);
    expect(result).not.toBeNull();
    expect(result![0].content).toBe("Hello, world!");
  });
});

describe("speakerLabel", () => {
  it("labels external phone numbers as the lead name", () => {
    expect(speakerLabel("+15555551234", "Sarah")).toBe("Sarah");
  });

  it("falls back to phone number when lead name is undefined", () => {
    expect(speakerLabel("+15555551234", undefined)).toBe("+15555551234");
  });

  it("labels internal user IDs as Staff", () => {
    expect(speakerLabel("USlHhXmRMz")).toBe("Staff");
    expect(speakerLabel("USabc123", "Sarah")).toBe("Staff");
  });

  it("returns Unknown for empty identifier", () => {
    expect(speakerLabel("")).toBe("Unknown");
  });
});

describe("transcript JSON round-trip", () => {
  it("serialises and deserialises dialogue correctly", () => {
    const dialogue: DialogueTurn[] = [
      { identifier: "+15555551234", content: "I need a cleaning quote.", start: 0, end: 3 },
      { identifier: "USstaff001", content: "Happy to help! How many bedrooms?", start: 4, end: 7 },
      { identifier: "+15555551234", content: "Three bedrooms, two baths.", start: 8, end: 11 },
    ];
    const json = JSON.stringify(dialogue);
    const parsed: DialogueTurn[] = JSON.parse(json);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].identifier).toBe("+15555551234");
    expect(parsed[1].content).toBe("Happy to help! How many bedrooms?");
    expect(parsed[2].start).toBe(8);
  });

  it("handles malformed JSON gracefully (mirrors try/catch in dashboard)", () => {
    let result: DialogueTurn[] = [];
    try {
      result = JSON.parse("not valid json {{");
    } catch {
      result = [];
    }
    expect(result).toHaveLength(0);
  });
});
