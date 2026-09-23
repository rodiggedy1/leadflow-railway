import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense, useEffect } from "react";
import LeadAssignmentWatcher from "./components/LeadAssignmentWatcher";
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
const ConfirmationCalls = lazy(() => import("./pages/ConfirmationCalls"));
const MissedCalls = lazy(() => import("./pages/MissedCalls"));
const PayrollSummary = lazy(() => import("./pages/PayrollSummary"));
const Performance = lazy(() => import("./pages/Performance"));
const Metrics = lazy(() => import("./pages/Metrics"));
const LeadNurturing = lazy(() => import("./pages/LeadNurturing"));
const EmailInbox = lazy(() => import("./pages/EmailInbox"));
const SenderPoliciesPage = lazy(() => import("./pages/SenderPoliciesPage"));
const CleanerCalls = lazy(() => import("./pages/CleanerCalls"));
const CardAuth = lazy(() => import("./pages/CardAuth"));
const CleanerPortalV2 = lazy(() => import("./pages/CleanerPortalConnected"));
const SmsCampaigns = lazy(() => import("./pages/SmsCampaigns"));
const IconPicker = lazy(() => import("./pages/IconPicker"));
const ReadinessDashboard = lazy(() => import("./pages/ReadinessDashboard"));
const MadisonDebugPanel = lazy(() => import("./pages/MadisonDebugPanel"));
const MadisonDebrief = lazy(() => import("./pages/MadisonDebrief"));
const MadisonFocus = lazy(() => import("./pages/MadisonFocus"));
const WelcomePage = lazy(() => import("./pages/WelcomePage"));
const NativeBookings = lazy(() => import("./pages/NativeBookings"));
const CsInbox2 = lazy(() => import("./components/CsInbox2"));
const TeamExactLive = lazy(() => import("./pages/TeamExactLive"));
const DayBoardExactLive = lazy(() => import("./pages/DayBoardExactLive"));
const SmsExactLive = lazy(() => import("./pages/SmsExactLive"));
const EmailsExactLive = lazy(() => import("./pages/EmailsExactLive"));
const LeadflowScheduleCRMExactLive = lazy(() => import("./pages/LeadflowScheduleCRMExactLive"));
const LeadsCRMExactLive = lazy(() => import("./pages/LeadsCRMExactLive"));
const CommandChatExactLive = lazy(() => import("./pages/CommandChatExactLive"));
const CustomerProfileExactLive = lazy(() => import("./pages/CustomerProfileExactLive"));
const ConfirmationCallsExactLive = lazy(() => import("./pages/ConfirmationCallsExactLive"));
const AiCallsExactLive = lazy(() => import("./pages/AiCallsExactLive"));
const InvoicesExactLive = lazy(() => import("./pages/InvoicesExactLive"));
const PaymentsExactLive = lazy(() => import("./pages/PaymentsExactLive"));

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

function ReviewWorkspaceFrame({ children, navActivePath, hideNavigation = false }: { children: React.ReactNode; navActivePath?: string; hideNavigation?: boolean }) {
  return <div className="review-nav-host">{hideNavigation ? null : <ReviewWorkspaceNav activePath={navActivePath ?? "/review/leads-crm"} />}{children}</div>;
}

function AdminHiringAdminExactReviewRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/hiring-admin"><HiringAdminLive /></ReviewWorkspaceFrame>;
}

function AdminSettingsReviewRoute() {
  return <AdminPageGuard pageId="settings"><ReviewWorkspaceFrame navActivePath="/review/settings"><SettingsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

/**
 * OpsChatRedirect
 * The retired legacy Command Chat entry point always resolves to the one
 * exact-live Command Chat workspace. It never opens the legacy overlay.
 */
function OpsChatRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/admin/command-chat");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function AdminDayBoardExactLiveRoute() {
  return <AdminPageGuard pageId="field-management"><ReviewWorkspaceFrame navActivePath="/review/day-board-crm"><DayBoardExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminScheduleCRMExactRoute() {
  return <AdminPageGuard pageId="field-management"><ReviewWorkspaceFrame navActivePath="/review/schedule-crm"><LeadflowScheduleCRMExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminSmsExactLiveRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/sms"><SmsExactLive /></ReviewWorkspaceFrame>;
}

function AdminEmailsExactLiveRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/emails"><EmailsExactLive /></ReviewWorkspaceFrame>;
}

function AdminCommandChatExactLiveRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/command-chat-crm"><CommandChatExactLive /></ReviewWorkspaceFrame>;
}

function AdminBookingsCRMExactReviewRoute() {
  return <AdminPageGuard pageId="bookings"><ReviewWorkspaceFrame navActivePath="/review/bookings-crm"><NativeBookings /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminCustomerProfileExactReviewRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/customer-profile"><CustomerProfileExactLive /></ReviewWorkspaceFrame>;
}

function AdminConfirmationCallsExactReviewRoute() {
  return <AdminPageGuard pageId="confirmation-calls"><ReviewWorkspaceFrame navActivePath="/review/confirmation-calls"><ConfirmationCallsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminAiCallsExactReviewRoute() {
  return <ReviewWorkspaceFrame navActivePath="/review/ai-calls-transcript"><AiCallsExactLive /></ReviewWorkspaceFrame>;
}

function AdminInvoicesExactReviewRoute() {
  return <AdminPageGuard pageId="invoices"><ReviewWorkspaceFrame navActivePath="/review/invoices"><InvoicesExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminPaymentsExactReviewRoute() {
  return <AdminPageGuard pageId="payments"><ReviewWorkspaceFrame navActivePath="/review/payments"><PaymentsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminTeamExactLiveRoute() {
  return <AdminPageGuard pageId="agents"><ReviewWorkspaceFrame navActivePath="/review/team"><TeamExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
}

function AdminLeadsCRMExactLiveRoute() {
  const tab = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
  if (tab && tab !== "leads") return <AdminDashboard />;
  return <AdminPageGuard pageId="leads"><ReviewWorkspaceFrame navActivePath="/review/leads-crm"><LeadsCRMExactLive /></ReviewWorkspaceFrame></AdminPageGuard>;
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
        <Route path={"/admin/leads"} component={AdminLeadsCRMExactLiveRoute} />
        <Route path={"/admin/cs-inbox-2"} component={CsInbox2} />
        <Route path={"/admin/sms"} component={AdminSmsExactLiveRoute} />
        <Route path={"/admin/emails"} component={AdminEmailsExactLiveRoute} />
        <Route path={"/admin/command-chat"} component={AdminCommandChatExactLiveRoute} />
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
        <Route path={"/admin/bookings"} component={AdminBookingsCRMExactReviewRoute} />
        <Route path={"/admin/customer-profile"} component={AdminCustomerProfileExactReviewRoute} />
        <Route path={"/admin/settings"} component={AdminSettingsReviewRoute} />
        <Route path={"/admin/command-center"} component={CommandCenter} />
        <Route path={"/admin/tracker-flow"} component={TrackerFlow} />
        <Route path={"/admin/field-management"} component={FieldManagement} />
        <Route path={"/admin/schedule"} component={AdminScheduleCRMExactRoute} />
        <Route path={"/admin/day-board"} component={AdminDayBoardExactLiveRoute} />
        <Route path={"/admin/reactivation"} component={ReactivationEngine} />
        <Route path={"/admin/review-tracker"} component={ReviewTracker} />
        <Route path={"/call-assist"} component={LiveCallAssist} />
        <Route path={"/sse-test"} component={SseTest} />
        <Route path={"/admin/hiring"} component={AdminHiringAdminExactReviewRoute} />
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
        <Route path={"/admin/ai-calls"} component={AdminAiCallsExactReviewRoute} />
        <Route path={"/admin/cleaner-calls"} component={CleanerCalls} />
        <Route path={"/pay/:token"} component={CardAuth} />
        <Route path={"/admin/payments"} component={AdminPaymentsExactReviewRoute} />
        <Route path={"/admin/sms-campaigns"} component={SmsCampaigns} />
        <Route path={"/admin/readiness"} component={ReadinessDashboard} />
        <Route path={"/admin/invoices"} component={AdminInvoicesExactReviewRoute} />
        <Route path={"/admin/team"} component={AdminTeamExactLiveRoute} />
        <Route path={"/admin/madison-focus"} component={MadisonFocus} />
        <Route path={"/admin/madison-debrief"} component={DebriefRedirect} />
        <Route path={"/madison-debug"} component={MadisonDebugPanel} />
        <Route path={"/welcome/:firstName"} component={WelcomePage} />
        <Route path={"/icon-picker"} component={IconPicker} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function isDayBoardExactLiveRoute(location: string) {
  const isCommandChatWorkspace = location === "/admin/command-chat";
  const isTeamWorkspace = location === "/admin/team";
  const isHiringWorkspace = location === "/admin/hiring";
  const isSettingsWorkspace = location === "/admin/settings" || location === "/admin/widget-config";
  return location === "/admin/day-board" || location === "/admin/sms" || location === "/admin/emails" || location === "/admin/customer-profile" || location === "/admin/confirmation-calls" || location === "/admin/ai-calls" || location === "/admin/invoices" || location === "/admin/payments" || isCommandChatWorkspace || isTeamWorkspace || isHiringWorkspace || isSettingsWorkspace;
}

function PollingInstrumentation() {
  usePollingInstrumentation();
  return null;
}

function DayBoardSafePollingInstrumentation() {
  const [location] = useLocation();
  if (isDayBoardExactLiveRoute(location)) return null;
  return <PollingInstrumentation />;
}

function DayBoardSafeRuntimeWatchers() {
  const [location] = useLocation();
  if (isDayBoardExactLiveRoute(location)) return null;
  return <LeadAssignmentWatcher />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
          <DayBoardSafePollingInstrumentation />
          <DayBoardSafeRuntimeWatchers />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
