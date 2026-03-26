/**
 * AdminPageGuard — wraps admin pages to enforce per-agent page permissions.
 *
 * Behaviour:
 *   - While auth is loading: shows a spinner
 *   - No agent session: renders children (the page's own AdminLoginScreen handles auth)
 *   - Agent is admin OR pagePermissions is null (unrestricted): renders children
 *   - Agent has permissions and pageId is allowed: renders children
 *   - Agent has permissions and pageId is NOT allowed: redirects to first allowed page
 *   - Agent has no allowed pages: shows "Access Denied" screen
 *
 * IMPORTANT: Do NOT redirect to /agent when there is no session.
 * The admin pages have their own login screen (AdminLoginScreen). Redirecting here
 * would hijack the admin login flow and send the owner to the agent login instead.
 */
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { ADMIN_PAGES } from "@shared/const";

// Map ADMIN_PAGES id → URL
const PAGE_URLS: Record<string, string> = {
  "command-center":    "/admin/command-center",
  "leads":             "/admin/leads",
  "pipeline":          "/admin/leads?tab=pipeline",
  "callbacks":         "/admin/leads?tab=callbacks",
  "calls":             "/admin/calls",
  "agents":            "/admin/leads?tab=agents",
  "leaderboard":       "/admin/leads?tab=leaderboard",
  "campaigns":         "/admin/campaigns",
  "always-on":         "/admin/always-on",
  "campaign-approval": "/admin/campaign-approval",
  "field-management":  "/admin/field-management",
  "quality":           "/admin/quality",
  "tracker-flow":      "/admin/tracker-flow",
  "settings":          "/admin/settings",
};

interface AdminPageGuardProps {
  pageId: string;
  children: React.ReactNode;
}

export default function AdminPageGuard({ pageId, children }: AdminPageGuardProps) {
  const { pagePermissions, loaded, agentId, isAdmin } = useAgentPermissions();

  // No session = not logged in as an agent
  const hasSession = agentId !== null;

  // Admins are always allowed; null permissions = unrestricted agent
  const isAllowed = isAdmin || pagePermissions === null || pagePermissions.includes(pageId);

  useEffect(() => {
    if (!loaded) return;

    // No agent session — do NOT redirect. Let the page's own auth guard handle it.
    // (AdminLoginScreen is rendered by AdminDashboard/CommandCenter/etc. when hasSession is false)
    if (!hasSession) return;

    if (isAllowed) return;

    // Agent is logged in but not allowed on this specific page — redirect to first allowed page
    const firstAllowed = ADMIN_PAGES.find(p => pagePermissions!.includes(p.id));
    if (firstAllowed) {
      window.location.replace(PAGE_URLS[firstAllowed.id] ?? "/agent");
    }
    // else: no pages allowed — fall through to Access Denied UI below
  }, [loaded, isAllowed, pagePermissions, hasSession, isAdmin]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Agent is logged in but being redirected to their allowed page — show spinner
  if (hasSession && !isAllowed && pagePermissions && pagePermissions.length > 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Agent is logged in with no allowed pages at all
  if (hasSession && !isAllowed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-xl">🔒</span>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Access Denied</h2>
          <p className="text-sm text-gray-500">You don't have access to any admin pages. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
