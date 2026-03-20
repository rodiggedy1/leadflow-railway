import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AdminDashboard from "./pages/AdminDashboard";
import AgentDashboard from "./pages/AgentDashboard";
import ReactivationCampaigns from "./pages/ReactivationCampaigns";
import CompletedJobs from "./pages/CompletedJobs";
import AlwaysOnCampaign from "./pages/AlwaysOnCampaign";
import SyncHealthPage from "./pages/SyncHealthPage";
import AllCalls from "./pages/AllCalls";
import RevenueAttribution from "./pages/RevenueAttribution";
import CleanerDashboard from "./pages/CleanerDashboard";
import CleanerPortal from "./pages/CleanerPortal";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/admin"} component={AdminDashboard} />
      <Route path={"/agent"} component={AgentDashboard} />
      <Route path={"/admin/campaigns"} component={ReactivationCampaigns} />
      <Route path={"/admin/completed-jobs"} component={CompletedJobs} />
      <Route path={"/admin/always-on"} component={AlwaysOnCampaign} />
      <Route path={"/admin/sync-health"} component={SyncHealthPage} />
      <Route path={"/admin/calls"} component={AllCalls} />
      <Route path={"/admin/revenue"} component={RevenueAttribution} />
      <Route path={"/admin/quality"} component={CleanerDashboard} />
      <Route path={"/cleaner"} component={CleanerPortal} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
