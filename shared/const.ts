export const COOKIE_NAME = "app_session_id";
export const AGENT_COOKIE_NAME = "agent_session_id";
export const CLEANER_COOKIE_NAME = "cleaner_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * All admin page IDs that can be toggled per-agent.
 * Matches AdminTab type in AdminHeader.tsx.
 * isAdmin agents always see everything; regular agents see only their allowed subset.
 * null pagePermissions = no restrictions (legacy / admin agents).
 */
export const ADMIN_PAGES = [
  { id: "command-center",    label: "AI Center",     group: "Core" },
  { id: "leads",             label: "Leads",         group: "Core" },
  { id: "pipeline",          label: "Pipeline",      group: "Core" },
  { id: "callbacks",         label: "Callbacks",     group: "Voice" },
  { id: "calls",             label: "All Calls",     group: "Voice" },
  { id: "agents",            label: "Team",          group: "Staff" },
  { id: "leaderboard",       label: "Leaderboard",   group: "Staff" },
  { id: "campaigns",         label: "Campaigns",     group: "Campaigns" },
  { id: "always-on",         label: "Always-On",     group: "Campaigns" },
  { id: "campaign-approval", label: "Approvals",     group: "Campaigns" },
  { id: "field-management",  label: "Field Mgmt",    group: "Operations" },
  { id: "quality",           label: "Jobs",          group: "Operations" },
  { id: "tracker-flow",      label: "Journey",       group: "Operations" },
  { id: "settings",          label: "Settings",      group: "Admin" },
] as const;

export type AdminPageId = typeof ADMIN_PAGES[number]["id"];
