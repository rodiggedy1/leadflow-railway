/**
 * AdminPageGuard — wraps admin pages to enforce per-agent page permissions.
 *
 * Behaviour:
 *   - While auth is loading: shows a spinner
 *   - No session at all: redirects to /agent (agent login)
 *   - Agent is admin OR pagePermissions is null (unrestricted): renders children
 *   - Agent has permissions and pageId is allowed: renders children
 *   - Agent has permissions and pageId is NOT allowed: redirects to first allowed page
 *   - Agent has no allowed pages: shows "Access Denied" screen
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

  // No session = not logged in at all
  const hasSession = agentId !== null;

  // Admins are always allowed; null permissions = unrestricted agent
  const isAllowed = isAdmin || pagePermissions === null || pagePermissions.includes(pageId);

  useEffect(() => {
    if (!loaded) return;

    // No session — send to agent login
    if (!hasSession) {
      window.location.replace("/agent");
      return;
    }

    if (isAllowed) return;

    // Find the first allowed page and redirect there
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

  // Redirect in progress — show spinner
  if (!hasSession || (!isAllowed && pagePermissions && pagePermissions.length > 0)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!isAllowed) {
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
