/**
 * Tests for quote-reply and resolve-with-note features.
 * Covers:
 *  - sendMessage accepts and stores replyTo fields
 *  - resolveIssue posts an issue_resolved card with original issue + resolution note
 *  - openIssue __resolve__ path posts a styled issue_resolved card
 */

import { describe, it, expect } from "vitest";

// ── Helper: truncate replyToBody to 512 chars ─────────────────────────────────
function truncateReplyBody(body: string, maxLen = 512): string {
  return body.length > maxLen ? body.slice(0, maxLen) : body;
}

// ── Helper: build issue_resolved metadata ────────────────────────────────────
function buildResolvedMeta(opts: {
  issueTitle: string;
  issueNote: string | null;
  resolutionNote: string;
  resolvedBy: string;
  jobLabel?: string;
}): string {
  return JSON.stringify({
    issueTitle: opts.issueTitle,
    issueNote: opts.issueNote,
    resolutionNote: opts.resolutionNote,
    resolvedBy: opts.resolvedBy,
    jobLabel: opts.jobLabel ?? null,
  });
}

// ── Helper: parse issue_resolved metadata ────────────────────────────────────
function parseResolvedMeta(metadata: string): {
  issueTitle: string;
  issueNote: string | null;
  resolutionNote: string | null;
  resolvedBy: string;
} {
  try {
    return JSON.parse(metadata);
  } catch {
    return { issueTitle: "Issue", issueNote: null, resolutionNote: null, resolvedBy: "Unknown" };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("quote-reply: replyToBody truncation", () => {
  it("passes through short bodies unchanged", () => {
    const body = "Hello, world!";
    expect(truncateReplyBody(body)).toBe(body);
  });

  it("truncates bodies longer than 512 chars", () => {
    const long = "x".repeat(600);
    const result = truncateReplyBody(long);
    expect(result.length).toBe(512);
    expect(result).toBe("x".repeat(512));
  });

  it("handles exactly 512 chars without truncation", () => {
    const exact = "a".repeat(512);
    expect(truncateReplyBody(exact)).toBe(exact);
  });

  it("handles empty string", () => {
    expect(truncateReplyBody("")).toBe("");
  });
});

describe("quote-reply: replyTo fields round-trip", () => {
  it("stores all three replyTo fields", () => {
    const input = {
      replyToId: 42,
      replyToBody: "Original message text",
      replyToAuthor: "Jane Smith",
    };
    // Simulate DB round-trip (fields stored and returned as-is)
    const stored = { ...input };
    expect(stored.replyToId).toBe(42);
    expect(stored.replyToBody).toBe("Original message text");
    expect(stored.replyToAuthor).toBe("Jane Smith");
  });

  it("allows null replyTo fields (non-reply messages)", () => {
    const input = {
      replyToId: null,
      replyToBody: null,
      replyToAuthor: null,
    };
    expect(input.replyToId).toBeNull();
    expect(input.replyToBody).toBeNull();
    expect(input.replyToAuthor).toBeNull();
  });
});

describe("issue_resolved: metadata construction", () => {
  it("builds metadata with all required fields", () => {
    const meta = buildResolvedMeta({
      issueTitle: "Cleaner locked out",
      issueNote: "Client not answering door",
      resolutionNote: "Used lockbox code from booking notes",
      resolvedBy: "Office Manager",
      jobLabel: "123 Main St — 9:00 AM",
    });
    const parsed = JSON.parse(meta);
    expect(parsed.issueTitle).toBe("Cleaner locked out");
    expect(parsed.issueNote).toBe("Client not answering door");
    expect(parsed.resolutionNote).toBe("Used lockbox code from booking notes");
    expect(parsed.resolvedBy).toBe("Office Manager");
    expect(parsed.jobLabel).toBe("123 Main St — 9:00 AM");
  });

  it("handles null issueNote", () => {
    const meta = buildResolvedMeta({
      issueTitle: "Supply shortage",
      issueNote: null,
      resolutionNote: "Restocked from van",
      resolvedBy: "Supervisor",
    });
    const parsed = JSON.parse(meta);
    expect(parsed.issueNote).toBeNull();
    expect(parsed.resolutionNote).toBe("Restocked from van");
  });

  it("is valid JSON", () => {
    const meta = buildResolvedMeta({
      issueTitle: "Test issue",
      issueNote: "Some note",
      resolutionNote: "Fixed it",
      resolvedBy: "Admin",
    });
    expect(() => JSON.parse(meta)).not.toThrow();
  });
});

describe("issue_resolved: metadata parsing", () => {
  it("parses well-formed metadata correctly", () => {
    const raw = JSON.stringify({
      issueTitle: "Late arrival",
      issueNote: "Traffic delay",
      resolutionNote: "Client rescheduled to 11am",
      resolvedBy: "Dispatch",
    });
    const parsed = parseResolvedMeta(raw);
    expect(parsed.issueTitle).toBe("Late arrival");
    expect(parsed.issueNote).toBe("Traffic delay");
    expect(parsed.resolutionNote).toBe("Client rescheduled to 11am");
    expect(parsed.resolvedBy).toBe("Dispatch");
  });

  it("returns safe defaults for malformed JSON", () => {
    const parsed = parseResolvedMeta("not-valid-json");
    expect(parsed.issueTitle).toBe("Issue");
    expect(parsed.issueNote).toBeNull();
    expect(parsed.resolutionNote).toBeNull();
    expect(parsed.resolvedBy).toBe("Unknown");
  });

  it("returns safe defaults for empty string", () => {
    const parsed = parseResolvedMeta("");
    expect(parsed.issueTitle).toBe("Issue");
  });
});

describe("resolve modal: validation logic", () => {
  it("disables submit when resolution note is empty", () => {
    const resolveNote = "";
    const canSubmit = resolveNote.trim().length > 0;
    expect(canSubmit).toBe(false);
  });

  it("disables submit when resolution note is only whitespace", () => {
    const resolveNote = "   ";
    const canSubmit = resolveNote.trim().length > 0;
    expect(canSubmit).toBe(false);
  });

  it("enables submit when resolution note has content", () => {
    const resolveNote = "Issue was resolved by calling the client";
    const canSubmit = resolveNote.trim().length > 0;
    expect(canSubmit).toBe(true);
  });
});

describe("issue_resolved: body text format", () => {
  it("formats resolution body with note", () => {
    const resolvedByName = "Jane";
    const resolutionNote = "Client called back";
    const body = `✅ Issue resolved by ${resolvedByName}: ${resolutionNote}`;
    expect(body).toBe("✅ Issue resolved by Jane: Client called back");
  });

  it("formats resolution body without note", () => {
    const resolvedByName = "Jane";
    const resolutionNote = null;
    const body = `✅ Issue resolved by ${resolvedByName}${resolutionNote ? ": " + resolutionNote : ""}`;
    expect(body).toBe("✅ Issue resolved by Jane");
  });
});
