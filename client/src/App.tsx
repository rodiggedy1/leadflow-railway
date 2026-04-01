import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { useOpsChatWindow, OpsChatProvider, type OpsChatTab } from "./hooks/useOpsChatWindow";
import { CalendarDays, MessageSquare, HeadphonesIcon } from "lucide-react";
import OpsChat from "./pages/OpsChat";
import { trpc } from "./lib/trpc";
import { useAuth } from "./_core/hooks/useAuth";

// Route-level code splitting — each page loads only when its route is visited.
const Home = lazy(() => import("./pages/Home"));
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
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const TrackerFlow = lazy(() => import("./pages/TrackerFlow"));
const FieldManagement = lazy(() => import("./pages/FieldManagement"));
const ReactivationEngine = lazy(() => import("./pages/ReactivationEngine"));
const CleanerAuthCallback = lazy(() => import("./pages/CleanerAuthCallback"));
const LiveCallAssist = lazy(() => import("./pages/LiveCallAssist"));
const ReviewTracker = lazy(() => import("./pages/ReviewTracker"));
const SseTest = lazy(() => import("./pages/SseTest"));
const HiringPipeline = lazy(() => import("./pages/HiringPipeline"));
const Apply = lazy(() => import("./pages/Apply"));
const AIInterview = lazy(() => import("./pages/AIInterview"));
const HiringStatus = lazy(() => import("./pages/HiringStatus"));

// Minimal spinner shown while a route chunk is downloading.
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#E8735A] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
        <Route path={"/admin"} component={() => { window.location.replace("/admin/command-center"); return null; }} />
        <Route path={"/admin/leads"} component={AdminDashboard} />
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
        <Route path={"/cleaner"} component={CleanerPortal} />
        <Route path={"/auth/cleaner-callback"} component={CleanerAuthCallback} />
        <Route path={"/track/:token"} component={JobTracker} />
        <Route path={"/admin/settings"} component={SettingsPage} />
        <Route path={"/admin/command-center"} component={CommandCenter} />
        <Route path={"/admin/tracker-flow"} component={TrackerFlow} />
        <Route path={"/admin/field-management"} component={FieldManagement} />
        <Route path={"/admin/reactivation"} component={ReactivationEngine} />
        <Route path={"/admin/review-tracker"} component={ReviewTracker} />
        <Route path={"/call-assist"} component={LiveCallAssist} />
        <Route path={"/sse-test"} component={SseTest} />
        <Route path={"/admin/hiring"} component={HiringPipeline} />
        <Route path={"/apply"} component={Apply} />
        <Route path={"/interview/:candidateId"} component={AIInterview} />
        <Route path={"/hiring-status/:token"} component={HiringStatus} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

/**
 * GlobalOpsChat
 * Renders OpsChat as a fixed full-screen overlay — never navigates away from
 * the current page. The 3-button pill nav opens it to a specific tab.
 */

// Nav tab definitions
const NAV_TABS: { id: OpsChatTab; label: string; icon: React.ReactNode }[] = [
  { id: "today",    label: "Ops",  icon: <CalendarDays className="w-4 h-4" /> },
  { id: "channels", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { id: "cs",       label: "CS",   icon: <HeadphonesIcon className="w-4 h-4" /> },
];

function GlobalOpsChat() {
  const [location] = useLocation();
  const { state, openToTab, minimize, close, activeTab: ctxActiveTab } = useOpsChatWindow();
  const { user } = useAuth();

  // Fetch unread counts for the badge — only when authenticated and OpsChat is not open
  const { data: agentMe } = trpc.agents.me.useQuery(undefined, { retry: false });
  const isAuthenticated = Boolean(user) || Boolean(agentMe);

  const { data: unreadCounts } = trpc.opsChat.getUnreadCounts.useQuery(undefined, {
    enabled: isAuthenticated && state !== "open",
    refetchInterval: 30_000,
  });

  const chatUnread = unreadCounts
    ? (unreadCounts.urgent + unreadCounts.dispatch + unreadCounts.general + unreadCounts.cleaners)
    : 0;

  // OpsChat is only relevant on admin / agent / call-assist routes.
  // IMPORTANT: Once OpsChat has been mounted, we must NEVER unmount it while
  // navigating between eligible routes — doing so destroys scroll refs and
  // causes the position to reset to 0. However, it must NOT be mounted at all
  // on public pages (e.g. the quote form at /) to prevent notification sounds
  // from leaking onto those pages.
  const isEligible =
    location.startsWith("/admin") ||
    location.startsWith("/agent") ||
    location.startsWith("/call-assist");

  // Track whether OpsChat has ever been mounted in this session.
  // Once true, keep it in the DOM for the rest of the session (eligible routes only).
  const [hasBeenMounted, setHasBeenMounted] = useState(false);
  useEffect(() => {
    if (isEligible && !hasBeenMounted) setHasBeenMounted(true);
  }, [isEligible, hasBeenMounted]);

  // Determine which tab is currently active (for highlighting the nav button)
  // When OpsChat is open, use the context's activeTab (synced from inside OpsChat).
  const activeNavTab = state === "open" ? ctxActiveTab : null;

  // Only render OpsChat if we are on (or have visited) an eligible route.
  // This prevents the sound hooks from being active on the public quote form.
  const shouldRenderOpsChat = hasBeenMounted;

  return (
    <>
      {/* Full-screen overlay — only in the DOM after first eligible route visit.
           Keeping OpsChat mounted preserves scroll refs, query caches, and
           prevMsgCountRef so position/sounds don't reset on page navigation. */}
      {shouldRenderOpsChat && (
        <div
          className="fixed inset-0 z-50 bg-slate-50 overflow-hidden"
          style={{ display: state === "open" ? "flex" : "none" }}
        >
          <OpsChat onMinimize={minimize} onClose={close} />
        </div>
      )}

      {/* 3-button pill nav — always visible on eligible routes */}
      {isEligible && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="flex items-center gap-1 rounded-2xl bg-slate-900/95 backdrop-blur-sm shadow-2xl border border-white/10 p-1.5">
            {NAV_TABS.map((tab) => {
              const isActive = activeNavTab === tab.id;
              const unread = tab.id === "channels" ? chatUnread : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (state === "open" && ctxActiveTab === tab.id) {
                      minimize();
                    } else {
                      openToTab(tab.id);
                    }
                  }}
                  className={[
                    "relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150",
                    isActive
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                  aria-label={tab.label}
                >
                  {tab.icon}
                  <span className="tracking-wide">{tab.label}</span>
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <OpsChatProvider>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <Toaster />
            <Router />
            <GlobalOpsChat />
          </TooltipProvider>
        </ThemeProvider>
      </OpsChatProvider>
    </ErrorBoundary>
  );
}

export default App;
