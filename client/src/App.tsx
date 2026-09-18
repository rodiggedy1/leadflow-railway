import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense, useEffect, useState } from "react";
import LeadAssignmentWatcher from "./components/LeadAssignmentWatcher";
import SuperAlertWatcher from "./components/SuperAlertWatcher";
import { useOpsChatWindow, OpsChatProvider } from "./hooks/useOpsChatWindow";
const OpsChat = lazy(() => import("./pages/OpsChat"));
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "./hooks/useOpsStream";
import { usePollingInstrumentation } from "@/hooks/usePollingInstrumentation";
import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";
import "./pages/review-typography.css";
import AdminPageGuard from "./components/AdminPageGuard";

// Route-level code splitting — each page loads only when its route is visited.
const Home = lazy(() => import("./pages/Home"));
const Book = lazy(() => import("./pages/Book"));
const BookWidget = lazy(() => import("./pages/BookWidget"));
const BookNow = lazy(() => import("./pages/BookNow"));
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AgentDashboard = lazy(() => import("./pages/AgentDashboard"));
const ReactivationCampaigns = lazy(() => import("./pages/ReactivationCampaigns"));
const CompletedJobs = lazy(() => import("./pages/CompletedJobs"));
const AlwaysOnCampaign = lazy(() => import("./pages/AlwaysOnCampaign"));
const SyncHealthPage = lazy(() => import("./pages/SyncHealthPage"));
const CampaignApprovalPage = lazy(() => import("./pages/CampaignApprovalPage"));
const AllCalls = lazy(() => import("./pages/AllCalls"));
const RevenueAttribution = lazy(() => import("./pages/RevenueAttribution"));
const CleanerDashboard = lazy(() => import("./pages/CleanerDashboard"));
const CleanerPortal = lazy(() => import("./pages/CleanerPortal"));
const JobTracker = lazy(() => import("./pages/JobTracker"));
const SettingsExactLive = lazy(() => import("./pages/SettingsExactLive"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const TrackerFlow = lazy(() => import("./pages/TrackerFlow"));
const FieldManagement = lazy(() => import("./pages/FieldManagement"));
const ReactivationEngine = lazy(() => import("./pages/ReactivationEngine"));
const CleanerAuthCallback = lazy(() => import("./pages/CleanerAuthCallback"));
const LiveCallAssist = lazy(() => import("./pages/LiveCallAssist"));
const ReviewTracker = lazy(() => import("./pages/ReviewTracker"));
const SseTest = lazy(() => import("./pages/SseTest"));
const HiringAdminLive = lazy(() => import("./pages/HiringAdminLive"));
const Apply = lazy(() => import("./pages/Apply"));
const ApplicantPortal = lazy(() => import("./pages/ApplicantPortal"));
const AIInterview = lazy(() => import("./pages/AIInterview"));
const HiringStatus = lazy(() => import("./pages/HiringStatus"));
const TeamPay = lazy(() => import("./pages/TeamPay"));
const TeamAvailability = lazy(() => import("./pages/TeamAvailability"));
const ConfirmationCallsExactLive = lazy(() => import("./pages/ConfirmationCallsExactLive"));
const CustomerProfileExactLive = lazy(() => import("./pages/CustomerProfileExactLive"));
const MissedCalls = lazy(() => import("./pages/MissedCalls"));
const PayrollSummary = lazy(() => import("./pages/PayrollSummary"));
const Performance = lazy(() => import("./pages/Performance"));
const Metrics = lazy(() => import("./pages/Metrics"));
const LeadNurturing = lazy(() => import("./pages/LeadNurturing"));
const EmailInbox = lazy(() => import("./pages/EmailInbox"));
const SenderPoliciesPage = lazy(() => import("./pages/SenderPoliciesPage"));
const AICallMatrix = lazy(() => import("./pages/AICallMatrix"));
const CleanerCalls = lazy(() => import("./pages/CleanerCalls"));
const CardAuth = lazy(() => import("./pages/CardAuth"));
const AdminPayments = lazy(() => import("./pages/AdminPayments"));
const CleanerPortalV2 = lazy(() => import("./pages/CleanerPortalConnected"));
const SmsCampaigns = lazy(() => import("./pages/SmsCampaigns"));
const IconPicker = lazy(() => import("./pages/IconPicker"));
const ReadinessDashboard = lazy(() => import("./pages/ReadinessDashboard"));
const InvoiceManager = lazy(() => import("./pages/InvoiceManager"));
const MadisonDebugPanel = lazy(() => import("./pages/MadisonDebugPanel"));
const MadisonDebrief = lazy(() => import("./pages/MadisonDebrief"));
const MadisonFocus = lazy(() => import("./pages/MadisonFocus"));
const WelcomePage = lazy(() => import("./pages/WelcomePage"));
const NativeBookings = lazy(() => import("./pages/NativeBookings"));
const CsInbox2 = lazy(() => import("./components/CsInbox2"));
const OperationsDashboardReview = lazy(() => import("./pages/OperationsDashboardReview"));
const OperationsCRMReview = lazy(() => import("./pages/OperationsCRMReview"));
const BookingsCRMReview = lazy(() => import("./pages/BookingsCRMReview"));
const ScheduleCRMReview = lazy(() => import("./pages/ScheduleCRMReview"));
const DayBoardCRMReview = lazy(() => import("./pages/DayBoardCRMReview"));
const CommandChatCRMReview = lazy(() => import("./pages/CommandChatCRMReview"));
const HiringAdminDashboardReview = lazy(() => import("./pages/HiringAdminDashboardReview"));
const AiCallsReview = lazy(() => import("./pages/AiCallsReview"));
const AiCallsTranscriptReview = lazy(() => import("./pages/AiCallsTranscriptReview"));
const EmailsReview = lazy(() => import("./pages/EmailsReview"));
const SmsReview = lazy(() => import("./pages/SmsReview"));
const TeamReview = lazy(() => import("./pages/TeamReview"));
const ConfirmationCallsReview = lazy(() => import("./pages/ConfirmationCallsReview"));
const SettingsReview = lazy(() => import("./pages/SettingsReview"));
const PayrollSummaryReview = lazy(() => import("./pages/PayrollSummaryReview"));
const CustomerProfileReview = lazy(() => import("./pages/CustomerProfileReview"));
const ReviewsQualityReview = lazy(() => import("./pages/ReviewsQualityReview"));
const InvoicesReview = lazy(() => import("./pages/InvoicesReview"));
const PaymentsReview = lazy(() => import("./pages/PaymentsReview"));

/**
 * DebriefRedirect — /admin/madison-debrief is now /admin/madison-focus.
 * Preserves bookmarks by redirecting silently.
 */
function DebriefRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/admin/madison-focus"); }, []);
  return null;
}

// Minimal spinner shown while a route chunk is downloading.
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#E8735A] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ReviewWorkspaceFrame({ children, hideNavigation = false, navActivePath }: { children: React.ReactNode; hideNavigation?: boolean; navActivePath?: string }) {
  return <div className={`review-nav-host ${hideNavigation ? "review-nav-host-without-nav" : ""}`}>{!hideNavigation && <ReviewWorkspaceNav activePath={navActivePath} />}{children}</div>;
}

function OperationsDashboardReviewRoute() { return <ReviewWorkspaceFrame><OperationsDashboardReview /></ReviewWorkspaceFrame>; }
function OperationsCRMReviewRoute() { return <ReviewWorkspaceFrame><OperationsCRMReview /></ReviewWorkspaceFrame>; }
function BookingsCRMReviewRoute() { return <ReviewWorkspaceFrame><BookingsCRMReview /></ReviewWorkspaceFrame>; }
function ScheduleCRMReviewRoute() { return <ReviewWorkspaceFrame><ScheduleCRMReview /></ReviewWorkspaceFrame>; }
function DayBoardCRMReviewRoute() { return <ReviewWorkspaceFrame><DayBoardCRMReview /></ReviewWorkspaceFrame>; }
function CommandChatCRMReviewRoute() { return <ReviewWorkspaceFrame hideNavigation><CommandChatCRMReview /></ReviewWorkspaceFrame>; }
function HiringAdminDashboardReviewRoute() { return <ReviewWorkspaceFrame><HiringAdminDashboardReview /></ReviewWorkspaceFrame>; }
function AiCallsReviewRoute() { return <ReviewWorkspaceFrame><AiCallsReview /></ReviewWorkspaceFrame>; }
function AiCallsTranscriptReviewRoute() { return <ReviewWorkspaceFrame><AiCallsTranscriptReview /></ReviewWorkspaceFrame>; }
function EmailsReviewRoute() { return <ReviewWorkspaceFrame><EmailsReview /></ReviewWorkspaceFrame>; }
function SmsReviewRoute() { return <ReviewWorkspaceFrame><SmsReview /></ReviewWorkspaceFrame>; }
function TeamReviewRoute() { return <ReviewWorkspaceFrame><TeamReview /></ReviewWorkspaceFrame>; }
function ConfirmationCallsReviewRoute() { return <ReviewWorkspaceFrame><ConfirmationCallsReview /></ReviewWorkspaceFrame>; }
function AdminConfirmationCallsExactReviewRoute() { return <AdminPageGuard pageId="confirmation-calls"><ReviewWorkspaceFrame navActivePath="/review/confirmation-calls"><ConfirmationCallsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>; }
function SettingsReviewRoute() { return <ReviewWorkspaceFrame><SettingsReview /></ReviewWorkspaceFrame>; }
function AdminSettingsReviewRoute() { return <AdminPageGuard pageId="settings"><ReviewWorkspaceFrame navActivePath="/review/settings"><SettingsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>; }
function AdminCustomerProfileExactReviewRoute() { return <ReviewWorkspaceFrame navActivePath="/review/customer-profile"><CustomerProfileExactLive /></ReviewWorkspaceFrame>; }
function PayrollSummaryReviewRoute() { return <ReviewWorkspaceFrame><PayrollSummaryReview /></ReviewWorkspaceFrame>; }
function CustomerProfileReviewRoute() { return <ReviewWorkspaceFrame><CustomerProfileReview /></ReviewWorkspaceFrame>; }
function ReviewsQualityReviewRoute() { return <ReviewWorkspaceFrame><ReviewsQualityReview /></ReviewWorkspaceFrame>; }
function InvoicesReviewRoute() { return <ReviewWorkspaceFrame><InvoicesReview /></ReviewWorkspaceFrame>; }
function PaymentsReviewRoute() { return <ReviewWorkspaceFrame><PaymentsReview /></ReviewWorkspaceFrame>; }

/**
 * OpsChatRedirect
 * /admin/ops-chat is now an overlay — redirect to /admin/leads and open the overlay.
 */
function OpsChatRedirect() {
  const { open } = useOpsChatWindow();
  const [, navigate] = useLocation();
  useEffect(() => {
    open();
    navigate("/admin/leads");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/book"} component={Book} />
        <Route path={"/book/widget"} component={BookWidget} />
        <Route path={"/book-now"} component={BookNow} />
        <Route path={"/my-home"} component={CustomerPortal} />
        <Route path={"/admin"} component={() => { window.location.replace("/admin/command-center"); return null; }} />
        <Route path={"/admin/leads"} component={AdminDashboard} />
        <Route path={"/admin/cs-inbox-2"} component={CsInbox2} />
        <Route path={"/admin/ops-chat"} component={OpsChatRedirect} />
        <Route path={"/agent"} component={AgentDashboard} />
        <Route path={"/admin/campaigns"} component={ReactivationCampaigns} />
        <Route path={"/admin/completed-jobs"} component={CompletedJobs} />
        <Route path={"/admin/always-on"} component={AlwaysOnCampaign} />
        <Route path={"/admin/sync-health"} component={SyncHealthPage} />
        <Route path={"/admin/campaign-approval"} component={CampaignApprovalPage} />
        <Route path={"/admin/calls"} component={AllCalls} />
        <Route path={"/admin/revenue"} component={RevenueAttribution} />
        <Route path={"/admin/quality"} component={CleanerDashboard} />
        <Route path={"/cleaner"} component={() => { window.location.replace("/portal-v2"); return null; }} />
        <Route path={"/portal-v2"} component={CleanerPortalV2} />
        <Route path={"/auth/cleaner-callback"} component={CleanerAuthCallback} />
        <Route path={"/track/:token"} component={JobTracker} />
        <Route path={"/admin/widget-config"} component={AdminSettingsReviewRoute} />
        <Route path={"/admin/bookings"} component={NativeBookings} />
        <Route path={"/admin/settings"} component={AdminSettingsReviewRoute} />
        <Route path={"/admin/customer-profile"} component={AdminCustomerProfileExactReviewRoute} />
        <Route path={"/admin/command-center"} component={CommandCenter} />
        <Route path={"/admin/tracker-flow"} component={TrackerFlow} />
        <Route path={"/admin/field-management"} component={FieldManagement} />
        <Route path={"/admin/reactivation"} component={ReactivationEngine} />
        <Route path={"/admin/review-tracker"} component={ReviewTracker} />
        <Route path={"/call-assist"} component={LiveCallAssist} />
        <Route path={"/sse-test"} component={SseTest} />
        <Route path={"/admin/hiring"} component={HiringAdminLive} />
        <Route path={"/apply"} component={Apply} />
        <Route path={"/applicant-portal"} component={ApplicantPortal} />
        <Route path={"/interview/:candidateId"} component={AIInterview} />
        <Route path={"/hiring-status/:token"} component={HiringStatus} />
        <Route path={"/admin/team-pay"} component={TeamPay} />
        <Route path={"/admin/team-availability"} component={TeamAvailability} />
        <Route path={"/admin/confirmation-calls"} component={AdminConfirmationCallsExactReviewRoute} />
        <Route path={"/admin/missed-calls"} component={MissedCalls} />
        <Route path={"/admin/payroll-summary"} component={PayrollSummary} />
        <Route path={"/admin/performance"} component={Performance} />
        <Route path={"/admin/metrics"} component={Metrics} />
        <Route path={"/admin/lead-nurturing"} component={LeadNurturing} />
        <Route path={"/admin/inbox"} component={EmailInbox} />
        <Route path={"/admin/inbox/sender-policies"} component={SenderPoliciesPage} />
        <Route path={"/admin/ai-calls"} component={AICallMatrix} />
        <Route path={"/admin/cleaner-calls"} component={CleanerCalls} />
        <Route path={"/pay/:token"} component={CardAuth} />
        <Route path={"/admin/payments"} component={AdminPayments} />
        <Route path={"/admin/sms-campaigns"} component={SmsCampaigns} />
        <Route path={"/admin/readiness"} component={ReadinessDashboard} />
        <Route path={"/admin/invoices"} component={InvoiceManager} />
        <Route path={"/admin/madison-focus"} component={MadisonFocus} />
        <Route path={"/admin/madison-debrief"} component={DebriefRedirect} />
        <Route path={"/madison-debug"} component={MadisonDebugPanel} />
        <Route path={"/welcome/:firstName"} component={WelcomePage} />
        <Route path={"/icon-picker"} component={IconPicker} />
        <Route path={"/review/operations-dashboard"} component={OperationsDashboardReviewRoute} />
        <Route path={"/review/leads-crm"} component={OperationsCRMReviewRoute} />
        <Route path={"/review/operations-crm"} component={OperationsCRMReviewRoute} />
        <Route path={"/review/bookings-crm"} component={BookingsCRMReviewRoute} />
        <Route path={"/review/schedule-crm"} component={ScheduleCRMReviewRoute} />
        <Route path={"/review/sms"} component={SmsReviewRoute} />
        <Route path={"/review/cs-inbox2-crm"} component={SmsReviewRoute} />
        <Route path={"/review/day-board-crm"} component={DayBoardCRMReviewRoute} />
        <Route path={"/review/command-chat-crm"} component={CommandChatCRMReviewRoute} />
        <Route path={"/review/hiring-admin"} component={HiringAdminDashboardReviewRoute} />
        <Route path={"/review/ai-calls"} component={AiCallsReviewRoute} />
        <Route path={"/review/callbacks"} component={AiCallsReviewRoute} />
        <Route path={"/review/all-calls"} component={AiCallsReviewRoute} />
        <Route path={"/review/ai-calls-transcript"} component={AiCallsTranscriptReviewRoute} />
        <Route path={"/review/emails"} component={EmailsReviewRoute} />
        <Route path={"/review/team"} component={TeamReviewRoute} />
        <Route path={"/review/confirmation-calls"} component={ConfirmationCallsReviewRoute} />
        <Route path={"/review/settings"} component={SettingsReviewRoute} />
        <Route path={"/review/payroll-summary"} component={PayrollSummaryReviewRoute} />
        <Route path={"/review/customer-profile"} component={CustomerProfileReviewRoute} />
        <Route path={"/review/reviews-quality"} component={ReviewsQualityReviewRoute} />
        <Route path={"/review/invoices"} component={InvoicesReviewRoute} />
        <Route path={"/review/payments"} component={PaymentsReviewRoute} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

/**
 * GlobalOpsChat
 * Renders OpsChat as a fixed full-screen overlay — never navigates away from
 * the current page. The bubble opens it; Minimize collapses it back to the bubble.
 */
function GlobalOpsChat() {
  const [location] = useLocation();
  const { state, open, minimize, close } = useOpsChatWindow();
  // NOTE: Do NOT call agents.me here.
  // AdminDashboard/AgentDashboard are lazy-loaded, so they mount in a later render tick.
  // Calling agents.me here fires a duplicate request that bypasses tRPC batch deduplication,
  // consuming the rate limit before the login mutation can fire.
  // The bubble shows unconditionally on eligible routes — OpsChat's AgentLoginGate handles auth.
  // The unread badge is populated by OpsChat itself once it has a session.

  // OpsChat is only relevant on admin / agent / call-assist routes.
  // IMPORTANT: Once OpsChat has been mounted, we must NEVER unmount it while
  // navigating between eligible routes — doing so destroys scroll refs and
  // causes the position to reset to 0. However, it must NOT be mounted at all
  // on public pages (e.g. the quote form at /) to prevent notification sounds
  // from leaking onto those pages.
  const isBookingsWorkspace = location === "/admin/bookings";
  const isHiringWorkspace = location === "/admin/hiring";
  const isChatExcludedWorkspace = isBookingsWorkspace || isHiringWorkspace;
  const isEligible =
    (location.startsWith("/admin") && !isChatExcludedWorkspace) ||
    location.startsWith("/agent") ||
    location.startsWith("/call-assist");

  // Poll every 60s for unanswered CS SMS count (202-888-5362 line only)
  const utils = trpc.useUtils();
  const { data: csData } = trpc.leads.getUnansweredCsCount.useQuery(undefined, {
    enabled: isEligible,
    refetchInterval: isEligible ? 60_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
    throwOnError: false,
  });
  // Invalidate immediately when any lead_update SSE fires (agent reply or resolve)
  useOpsStream({ onLeadUpdate: () => utils.leads.getUnansweredCsCount.invalidate() }, { enabled: isEligible, label: "App/GlobalOpsChat" });
  const csCount = csData?.count ?? 0;
  const csUrgent = csData?.urgentCount ?? 0;
  const csWarning = csData?.warningCount ?? 0;

  // Track whether OpsChat has ever been mounted in this session.
  // Once true, keep it in the DOM for the rest of the session (eligible routes only).
  const [hasBeenMounted, setHasBeenMounted] = useState(false);
  useEffect(() => {
    if (isEligible && !hasBeenMounted) setHasBeenMounted(true);
  }, [isEligible, hasBeenMounted]);

  // Only render OpsChat if we are on (or have visited) an eligible route.
  // This prevents the sound hooks from being active on the public quote form.
  const shouldRenderOpsChat = hasBeenMounted && !isChatExcludedWorkspace;

  return (
    <>
      {/* Full-screen overlay — only in the DOM after first eligible route visit.
           Keeping OpsChat mounted preserves scroll refs, query caches, and
           prevMsgCountRef so position/sounds don't reset on page navigation. */}
      {shouldRenderOpsChat && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ background: 'radial-gradient(900px 700px at 10% 10%, rgba(255,90,31,.14), transparent 60%), radial-gradient(700px 500px at 90% 8%, rgba(99,91,255,.10), transparent 55%), radial-gradient(900px 700px at 50% 100%, rgba(16,185,129,.06), transparent 65%), linear-gradient(135deg, #F4F6FB 0%, #EEF2F7 100%)', display: state === "open" ? "flex" : "none" }}
        >
          <Suspense fallback={null}>
            <OpsChat onMinimize={minimize} onClose={close} />
          </Suspense>
        </div>
      )}

      {/* Floating bubble — only visible on eligible routes when not open */}
      {isEligible && state !== "open" && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
          <button
            onClick={open}
            className="relative flex items-center gap-3 rounded-full bg-slate-900 text-white shadow-2xl px-5 py-3.5 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95"
            aria-label="Open MIB Chat"
          >
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png"
              alt="MIB"
              className="w-7 h-7 rounded-full object-cover"
            />
            <span className="text-sm font-bold tracking-wide">MIB Chat</span>
            {/* CS SMS unanswered badge — always visible, color-coded by urgency */}
            <span
              className={[
                "absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 shadow transition-colors",
                csUrgent > 0 ? "bg-red-500" : csWarning > 0 ? "bg-amber-500" : "bg-slate-500"
              ].join(" ")}
              title={csUrgent > 0 ? `${csUrgent} waiting 1h+` : csWarning > 0 ? `${csWarning} waiting 15min+` : "All caught up"}
            >
              {csCount > 99 ? "99+" : csCount}
            </span>
          </button>
          {state === "minimized" && (
            <button
              onClick={close}
              className="w-8 h-8 rounded-full bg-slate-700 text-white shadow-lg flex items-center justify-center hover:bg-slate-600 transition-all hover:scale-105 active:scale-95 text-base leading-none"
              aria-label="Dismiss MIB Chat"
            >
              ×
            </button>
          )}
        </div>
      )}
    </>
  );
}

function isReviewDerivedLiveShell(location: string) {
  return location.startsWith("/review/") || location === "/admin/settings" || location === "/admin/confirmation-calls" || location === "/admin/customer-profile";
}

function ReviewSafeGlobalOpsChat() {
  const [location] = useLocation();
  if (isReviewDerivedLiveShell(location)) return null;
  return <GlobalOpsChat />;
}

function RuntimePollingInstrumentation() {
  const [location] = useLocation();
  if (isReviewDerivedLiveShell(location)) return null;
  return <PollingInstrumentation />;
}

function PollingInstrumentation() {
  usePollingInstrumentation();
  return null;
}

function RuntimeWatchers() {
  const [location] = useLocation();
  if (isReviewDerivedLiveShell(location)) return null;
  return <><LeadAssignmentWatcher /><SuperAlertWatcher /></>;
}

function App() {
  return (
    <ErrorBoundary>
      <OpsChatProvider>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <Toaster />
            <Router />
            <ReviewSafeGlobalOpsChat />
            <RuntimePollingInstrumentation />
            <RuntimeWatchers />
          </TooltipProvider>
        </ThemeProvider>
      </OpsChatProvider>
    </ErrorBoundary>
  );
}

export default App;
