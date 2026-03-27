import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
import { useOpsChatWindow, OpsChatProvider } from "./hooks/useOpsChatWindow";
import { MessageCircle } from "lucide-react";
import OpsChat from "./pages/OpsChat";

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

// Minimal spinner shown while a route chunk is downloading.
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#E8735A] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/admin"} component={() => { window.location.replace("/admin/command-center"); return null; }} />
        <Route path={"/admin/leads"} component={AdminDashboard} />
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

  // Only show on admin / agent / call-assist routes
  const isEligible =
    location.startsWith("/admin") ||
    location.startsWith("/agent") ||
    location.startsWith("/call-assist");

  if (!isEligible) return null;

  return (
    <>
      {/* Full-screen overlay — visible when state === "open" */}
      {state === "open" && (
        <div className="fixed inset-0 z-50 bg-slate-50 overflow-hidden">
          <OpsChat onMinimize={minimize} onClose={close} />
        </div>
      )}

      {/* Floating bubble — visible when closed or minimized */}
      {state !== "open" && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
          <button
            onClick={open}
            className="flex items-center gap-2 rounded-full bg-slate-900 text-white shadow-lg px-4 py-2.5 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95"
            aria-label="Open OpsChat"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs font-semibold">OpsChat</span>
          </button>
          {state === "minimized" && (
            <button
              onClick={close}
              className="w-8 h-8 rounded-full bg-slate-700 text-white shadow-lg flex items-center justify-center hover:bg-slate-600 transition-all hover:scale-105 active:scale-95 text-base leading-none"
              aria-label="Dismiss OpsChat"
            >
              ×
            </button>
          )}
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
