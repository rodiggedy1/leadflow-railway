import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("AI Calls exact transcript workspace", () => {
  it("uses the approved transcript shell and retains the existing live call behavior", () => {
    const shell = read("client/src/pages/AiCallsExactLive.tsx");
    const app = read("client/src/App.tsx");
    const nav = read("client/src/components/ReviewWorkspaceNav.tsx");

    expect(shell).toContain('import "./voice-workspaces-review.css";');
    expect(shell).toContain('import "./ai-calls-transcript-review.css";');
    expect(shell).toContain('className="transcript-lab-layout"');
    expect(shell).toContain('className="transcript-queue"');
    expect(shell).toContain('className="transcript-main-stage"');
    expect(shell).toContain('className="transcript-brief"');
    expect(shell).toContain("LIVE_CALLER_PORTRAITS");
    expect(shell).toContain("function LivePersonPortrait");
    expect(shell).toContain("caller|customer|client|user");
    expect(shell).toContain('className="voice-page-status voice-page-status--wide ai-calls-live-status"');
    expect(shell).toContain('className="transcript-caller-portrait transcript-caller-portrait--queue"');
    expect(shell).toContain('className="transcript-caller-portrait transcript-caller-portrait--hero"');
    expect(shell).toContain('className="transcript-caller-portrait transcript-caller-portrait--turn"');
    expect(shell).toContain("trpc.callMatrix.getCallHistory.useQuery");
    expect(shell).toContain("trpc.voice.listCalls.useQuery");
    expect(shell).toContain('source: "inbound" as const');
    expect(shell).toContain('source: "outbound" as const');
    expect(shell).toContain("callerPhone: call.callerPhone");
    expect(shell).toContain('const callerIdentity = callerPhone && callerPhone !== callerLabel');
    expect(shell).toContain('AI-handled {selectedHistory.source} call{callerPhone &&');
    expect(shell).toContain('Incoming calls and existing Call Matrix calls will appear here.');
    expect(shell).toContain("proxyRecordingUrl(selectedHistory?.recordingUrl)");
    expect(shell).toContain("trpc.callMatrix.getPeople.useQuery");
    expect(shell).toContain("trpc.callMatrix.getTemplates.useQuery");
    expect(shell).toContain("trpc.callMatrix.matchScenario.useMutation");
    expect(shell).toContain("trpc.callMatrix.startCall.useMutation");
    expect(shell).toContain("utils.callMatrix.pollCall.fetch");
    expect(shell).toContain("startCallMutation.mutate({");
    expect(shell).toContain("upsert.mutate({");
    expect(shell).toContain("deleteTemplate.mutate({ id: existing.id })");
    expect(shell).toContain(">Send SMS Instead</button>");
    expect(shell).not.toContain('gridTemplateColumns: "270px 1fr 390px"');

    const styles = read("client/src/pages/ai-calls-exact-live.css");
    expect(styles).toContain(".ai-calls-exact-live .transcript-turns { max-height: 365px; overflow-y: auto;");
    expect(styles).toContain(".ai-calls-exact-live .transcript-live-portrait");
    expect(styles).toContain(".ai-calls-exact-live .ai-calls-live-status");

    expect(app).toContain('const AiCallsExactLive = lazy(() => import("./pages/AiCallsExactLive"));');
    expect(app).toContain('function AdminAiCallsExactReviewRoute() { return <ReviewWorkspaceFrame navActivePath="/review/ai-calls-transcript"><AiCallsExactLive /></ReviewWorkspaceFrame>; }');
    expect(app).toContain('<Route path={"/admin/ai-calls"} component={AdminAiCallsExactReviewRoute} />');
    expect(app).toContain('location === "/admin/ai-calls"');
    expect(nav).toContain('{ label: "AI Calls", href: "/review/ai-calls-transcript", liveHref: "/admin/ai-calls", icon: PhoneCall }');
  });
});
