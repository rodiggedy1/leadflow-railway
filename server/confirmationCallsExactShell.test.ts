import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appSource = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const reviewSource = readFileSync(resolve(root, "client/src/pages/ConfirmationCallsReview.tsx"), "utf8");
const shellSource = readFileSync(resolve(root, "client/src/pages/ConfirmationCallsExactLive.tsx"), "utf8");

const approvedStructureTokens = [
  'className="confirmation-review ops-review"',
  'className="ops-utility"',
  'className="ops-content ops-content--narrow"',
  'className="ops-head"',
  'className="ops-status-notice"',
  'className="ops-date-nav"',
  'className="ops-segmented"',
  'className="ops-confirmation-list"',
  'className="ops-list-head"',
  'className="ops-dispatch-stack"',
  'className={`ops-dispatch-card',
  'className="ops-results"',
  'className="ops-results-stack"',
  'className={`ops-result-card',
  'className="ops-sms-fallback"',
  'className="ops-transcript-toggle"',
  'className="ops-transcript"',
] as const;

describe("Confirmation Calls exact review shell", () => {
  it("keeps every approved visual region and the same approved stylesheet layer", () => {
    for (const token of approvedStructureTokens) {
      expect(reviewSource).toContain(token);
      expect(shellSource).toContain(token);
    }
    for (const stylesheet of [
      '"./team-confirmation-review.css"',
      '"./confirmation-calls-leads-cohesion.css"',
      '"./confirmation-calls-audio-player.css"',
      '"./confirmation-calls-crm-identity.css"',
    ]) {
      expect(reviewSource).toContain(stylesheet);
      expect(shellSource).toContain(stylesheet);
    }
  });

  it("mounts the exact shell inside the approved review workspace frame", () => {
    expect(appSource).toContain('const ConfirmationCallsExactLive = lazy(() => import("./pages/ConfirmationCallsExactLive"));');
    expect(appSource).toContain('function AdminConfirmationCallsExactReviewRoute() { return <AdminPageGuard pageId="confirmation-calls"><ReviewWorkspaceFrame navActivePath="/review/confirmation-calls"><ConfirmationCallsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>; }');
    expect(appSource).toContain('<Route path={"/admin/confirmation-calls"} component={AdminConfirmationCallsExactReviewRoute} />');
  });

  it("does not retain the inherited live AdminHeader or runtime chrome on the exact route", () => {
    const routeBlock = appSource.match(/function AdminConfirmationCallsExactReviewRoute\(\)[\s\S]*?\n}\n/);
    expect(routeBlock?.[0]).toBeDefined();
    expect(routeBlock?.[0]).not.toContain("AdminHeader");
    expect(shellSource).not.toContain("AdminHeader");
    expect(appSource).toContain('location === "/admin/confirmation-calls"');
    expect(appSource).toContain("if (isReviewDerivedLiveShell(location)) return null;");
  });

  it("retains the existing live queue, send, override, recording, and transcript contracts", () => {
    expect(shellSource).toContain("trpc.confirmationCalls.getJobsForDay.useQuery");
    expect(shellSource).toContain("trpc.confirmationCalls.placeCall.useMutation");
    expect(shellSource).toContain("trpc.confirmationCalls.overrideOutcome.useMutation");
    expect(shellSource).toContain("proxyRecordingUrl(recordingUrl)");
    expect(shellSource).toContain("<audio");
    expect(shellSource).toContain("Recording progress for ${customer}");
    expect(shellSource).toContain("Set outcome for ${job.customerName ?? \"customer\"}");
    expect(shellSource).toContain("smsFollowupBody");
    expect(shellSource).toContain("smsReplies");
    expect(shellSource).toContain("call.transcript");
  });

  it("does not route the live admin page to static data or static action handlers", () => {
    expect(shellSource).not.toContain("INITIAL_ITEMS");
    expect(shellSource).not.toContain("StaticConfirmation");
    expect(shellSource).not.toContain("StaticRecordingPlayer");
    expect(shellSource).not.toContain("Static review only");
  });
});
