import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const watcher = readFileSync(resolve(import.meta.dirname, "../client/src/components/LeadAssignmentWatcher.tsx"), "utf8");

describe("Lead assignment watcher", () => {
  it("opens the assigned lead detail and leaves an already-open detail in place", () => {
    expect(watcher).toContain("const assignedSessionIdRef = useRef<number | null>(null);");
    expect(watcher).toContain("assignedSessionIdRef.current = pendingAssignment.sessionId;");
    expect(watcher).toContain('window.location.pathname === "/admin/leads"');
    expect(watcher).toContain('new URLSearchParams(window.location.search).get("leadId") === String(sessionId)');
    expect(watcher).toContain("navigate(`/admin/leads?leadId=${sessionId}`)");
    expect(watcher).not.toContain('navigate("/agent")');
    expect(watcher).toContain("Got it — Open lead detail");
  });
});
