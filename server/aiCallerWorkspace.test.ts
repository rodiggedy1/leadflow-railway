import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiCallerWorkspace, type CallerRecord } from "../client/src/components/AiCallerWorkspace";
import type { AiCallerSession } from "../client/src/hooks/useAiCallerSession";

const record: CallerRecord = {
  id: "sample-record", person: { id: "sample", name: "Example Customer", initials: "EC", phone: "+12025550101", type: "Customer", location: "Fictional location", leadflowJobId: 501, jobDate: "2026-11-22", scripts: [{ label: "Confirm address", text: "Hello, please confirm your address." }] },
  reason: "Confirm address", outcome: "completed", durationSeconds: 42, time: "Sample time", transcript: "AI assistant: Please confirm your city.\nCustomer: Example city.\nAva: Thank you.", summary: "Existing summary.", recordingUrl: "/api/media-proxy?url=sample",
};
function render(options: { review?: boolean; recent?: CallerRecord[]; session?: AiCallerSession | null; error?: string; historyError?: string; loading?: boolean } = {}) {
  return renderToStaticMarkup(createElement(AiCallerWorkspace, { review: false, contacts: [record.person], recent: [record], session: null, onStartCall: vi.fn(), onDismissSession: vi.fn(), ...options }));
}
describe("approved caller UI rendering", () => {
  it("retains the three-step composition and shows stored speaker-separated transcripts", () => {
    const html = render();
    for (const label of ["Who are we calling?", "What should the AI do?", "Voice &amp; conversation style", "Call preview", "Recent calls"]) expect(html).toContain(label);
    expect(html.match(/class="turn ai"/g)).toHaveLength(2); expect(html.match(/class="turn customer"/g)).toHaveLength(1);
    expect(html).toContain("Example city."); expect(html).toContain("Existing summary.");
    expect(html).not.toContain("00:03");
  });
  it("wires existing proxied audio into a native player without fake recordings", () => {
    expect(render()).toContain('src="/api/media-proxy?url=sample"'); expect(render()).toContain('controls=""');
    const html = render({ recent: [{ ...record, recordingUrl: null }] }); expect(html).not.toContain("<audio");
  });
  it("makes synthetic review status explicit throughout the view", () => {
    const html = render({ review: true, recent: [{ ...record, recordingUrl: null }] });
    expect(html).toContain("Review only"); expect(html).toContain("EXAMPLE OUTCOME");
    expect(html).toContain("this button will not dial anyone"); expect(html).toContain("Synthetic provider responses");
  });
  it("shows the active call recipient and never presents prior history as the current call transcript", () => {
    const session: AiCallerSession = { vapiCallId: "active", phase: "active", status: "ringing", customerName: "Active Person", phone: "+12025550104", scenario: "ETA request" };
    const html = render({ session });
    expect(html).toContain("Active Person"); expect(html).toContain("Ringing");
    expect(html).toContain("Transcript and outcome will appear when the call finishes.");
    expect(html).not.toContain("Please confirm your city.");
    expect(html).not.toContain("Prepare another call");
  });
  it("shows failed outcomes and allows explicit preparation of another call", () => {
    const session: AiCallerSession = { vapiCallId: "", phase: "terminal", status: "failed", customerName: "Active Person", phone: "+12025550104", scenario: "ETA request", outcome: { summary: null, transcript: null, durationSeconds: null, recordingUrl: null, error: "Provider did not return an ID." } };
    const html = render({ session }); expect(html).toContain("Provider did not return an ID."); expect(html).toContain("Prepare another call");
  });
  it("renders loading, empty history and errors without phantom results", () => {
    const html = render({ recent: [], loading: true, error: "Contacts unavailable", historyError: "History unavailable" });
    expect(html).toContain("Loading contacts"); expect(html).toContain("No calls recorded yet.");
    expect(html).toContain("Contacts unavailable"); expect(html).toContain("History unavailable");
  });
  it("escapes stored transcript HTML instead of rendering it as code", () => {
    const html = render({ recent: [{ ...record, transcript: 'Customer: <script>alert("example")</script>' }] });
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>alert");
  });
});
