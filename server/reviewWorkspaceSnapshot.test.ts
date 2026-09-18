import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = () => readFileSync(resolve(root, "client/src/App.tsx"), "utf8");

const reviewRoutes = [
  ["/review/operations-dashboard", "OperationsDashboardReviewRoute"],
  ["/review/leads-crm", "OperationsCRMReviewRoute"],
  ["/review/bookings-crm", "BookingsCRMReviewRoute"],
  ["/review/schedule-crm", "ScheduleCRMReviewRoute"],
  ["/review/sms", "SmsReviewRoute"],
  ["/review/day-board-crm", "DayBoardCRMReviewRoute"],
  ["/review/command-chat-crm", "CommandChatCRMReviewRoute"],
  ["/review/hiring-admin", "HiringAdminDashboardReviewRoute"],
  ["/review/ai-calls", "AiCallsReviewRoute"],
  ["/review/ai-calls-transcript", "AiCallsTranscriptReviewRoute"],
  ["/review/emails", "EmailsReviewRoute"],
  ["/review/team", "TeamReviewRoute"],
  ["/review/confirmation-calls", "ConfirmationCallsReviewRoute"],
  ["/review/settings", "SettingsReviewRoute"],
  ["/review/payroll-summary", "PayrollSummaryReviewRoute"],
  ["/review/customer-profile", "CustomerProfileReviewRoute"],
  ["/review/reviews-quality", "ReviewsQualityReviewRoute"],
  ["/review/invoices", "InvoicesReviewRoute"],
  ["/review/payments", "PaymentsReviewRoute"],
] as const;

const staticReviewPages = [
  "OperationsDashboardReview.tsx",
  "OperationsCRMReview.tsx",
  "BookingsCRMReview.tsx",
  "ScheduleCRMReview.tsx",
  "CsInboxCRMReview.tsx",
  "DayBoardCRMReview.tsx",
  "CommandChatCRMReview.tsx",
  "HiringAdminDashboardReview.tsx",
  "AiCallsReview.tsx",
  "AiCallsTranscriptReview.tsx",
  "EmailsReview.tsx",
  "SmsReview.tsx",
  "TeamReview.tsx",
  "ConfirmationCallsReview.tsx",
  "SettingsReview.tsx",
  "PayrollSummaryReview.tsx",
  "CustomerProfileReview.tsx",
  "ReviewsQualityReview.tsx",
  "InvoicesReview.tsx",
  "PaymentsReview.tsx",
] as const;

describe("static review workspace snapshot", () => {
  it("mounts the existing review-only workspace suite under /review paths and uses its exact Settings shell at the approved admin baseline", () => {
    const source = app();
    expect(source).toContain('import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";');
    expect(source).toContain('import "./pages/review-typography.css";');
    expect(source).toContain("function ReviewWorkspaceFrame");
    expect(source).toContain("function CommandChatCRMReviewRoute() { return <ReviewWorkspaceFrame hideNavigation><CommandChatCRMReview /></ReviewWorkspaceFrame>; }");

    for (const [path, component] of reviewRoutes) {
      expect(source).toContain(`<Route path={"${path}"} component={${component}} />`);
    }

    expect(source).toContain('function AdminSettingsReviewRoute() { return <AdminPageGuard pageId="settings"><ReviewWorkspaceFrame navActivePath="/review/settings"><SettingsReview /></ReviewWorkspaceFrame></AdminPageGuard>; }');
    expect(source).toContain('path={"/admin/settings"} component={AdminSettingsReviewRoute}');
    expect(source).not.toContain('path={"/admin/leads"} component={CommandChatCRMReviewRoute}');
    expect(source).not.toContain('path={"/admin/ops-chat"} component={CommandChatCRMReviewRoute}');
  });

  it("excludes global live watchers and polling instrumentation on review routes", () => {
    const source = app();
    expect(source).toContain('if (location.startsWith("/review/") || location === "/admin/settings") return null;');
    expect(source).toContain("function RuntimeWatchers()");
    expect(source).toContain("function RuntimePollingInstrumentation()");
  });

  it("keeps every deployed review page free of live query, mutation, fetch, and legacy job dependencies", () => {
    for (const filename of staticReviewPages) {
      const source = readFileSync(resolve(root, "client/src/pages", filename), "utf8");
      for (const forbidden of ["trpc.", "useQuery", "useMutation", "fetch(", "axios", "WebSocket", "EventSource", "cleanerJobs", "cleaner_jobs", "/manus-storage/"]) {
        expect(source, `${filename} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("uses directly-deliverable CDN images instead of the unavailable preview storage proxy", () => {
    const commandChat = readFileSync(resolve(root, "client/src/pages/CommandChatCRMReview.tsx"), "utf8");
    const dashboard = readFileSync(resolve(root, "client/src/pages/OperationsDashboardReview.tsx"), "utf8");
    expect(commandChat).toContain("https://files.manuscdn.com/");
    expect(dashboard).toContain("https://files.manuscdn.com/");
  });
});
