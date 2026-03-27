import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { lazy, Suspense } from "react";
import { useOpsChatWindow } from "./hooks/useOpsChatWindow";
import { MessageCircle } from "lucide-react";

// Route-level code splitting — each page loads only when its route is visited.
// Splits the monolithic bundle into small per-route chunks for faster deploys.
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
const OpsChat = lazy(() => import("./pages/OpsChat"));

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
      <Route path={"/admin/ops-chat"} component={OpsChat} />
      <Route path={"/call-assist"} component={LiveCallAssist} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function GlobalOpsChatBubble() {
  const [location, navigate] = useLocation();
  const { state, close } = useOpsChatWindow();

  // Only show the bubble when minimized AND not already on the OpsChat page
  if (state !== "minimized" || location === "/admin/ops-chat") return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
      <button
        onClick={() => { close(); navigate("/admin/ops-chat"); }}
        className="flex items-center gap-2.5 rounded-full bg-slate-900 text-white shadow-xl px-4 py-3 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95"
        aria-label="Open OpsChat"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="text-sm font-semibold">OpsChat</span>
      </button>
      <button
        onClick={close}
        className="w-9 h-9 rounded-full bg-slate-700 text-white shadow-xl flex items-center justify-center hover:bg-slate-600 transition-all hover:scale-105 active:scale-95 text-lg leading-none"
        aria-label="Dismiss OpsChat bubble"
      >
        ×
      </button>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
          <GlobalOpsChatBubble />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
