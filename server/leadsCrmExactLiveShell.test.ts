import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(import.meta.dirname, "../client/src/pages/LeadsCRMExactLive.tsx"), "utf8");
const route = readFileSync(resolve(import.meta.dirname, "../client/src/App.tsx"), "utf8");
const workspaceNav = readFileSync(resolve(import.meta.dirname, "../client/src/components/ReviewWorkspaceNav.tsx"), "utf8");
const liveStyles = readFileSync(resolve(import.meta.dirname, "../client/src/pages/leads-crm-exact-live.css"), "utf8");
const server = readFileSync(resolve(import.meta.dirname, "commandCenterRouter.ts"), "utf8");
const coreRouter = readFileSync(resolve(import.meta.dirname, "routers.ts"), "utf8");

const forbiddenLegacySymbol = ["cleaner", "Jobs"].join("");
const forbiddenLegacyTable = ["cleaner", "_jobs"].join("");

describe("Leads CRM exact-live shell", () => {
  it("uses the shared workspace navigation with the approved Leads CRM content shell", () => {
    expect(page).toContain('className="operations-crm-review leads-crm-live"');
    expect(page).toContain('className="ocr-workspace"');
    expect(page).toContain('className="ocr-table-shell"');
    expect(page).toContain('className="ocr-detail-drawer ocr-live-detail-drawer"');
    expect(page).not.toContain('className="ocr-sidebar"');
    expect(page).not.toContain("LeadsInbox");
    expect(page).not.toContain("LeadOps");
  });

  it("renders actual incoming lead fields and does not retain review sample data", () => {
    expect(page).toContain("trpc.commandCenter.listIncomingLeads.useQuery");
    expect(page).toContain("Pipeline value");
    expect(page).toContain("Win probability");
    expect(page).toContain("function ProbabilityMeter");
    expect(page).toContain("DEFAULT_WIN_PROBABILITY = 50");
    expect(page).toContain("<ProbabilityMeter value={DEFAULT_WIN_PROBABILITY} />");
    expect(page).toContain("DEFAULT_ACTIVITY_TREND");
    expect(page).toContain("customerPortraitFor(name)");
    expect(page).toContain("displayStage(lead.stage)");
    expect(page).toContain('const requestedLeadId = useMemo(() => {');
    expect(page).toContain('const requestedLead = rows.find((lead) => lead.id === requestedLeadId);');
    expect(page).toContain('if (requestedLead) setDetailLead(requestedLead);');
    expect(page).toContain('const detailWasOpenRef = useRef(false);');
    expect(page).toContain('params.set("leadId", String(detailLead.id));');
    expect(page).toContain('params.delete("leadId");');
    expect(page).toContain('const [leadSearch, setLeadSearch] = useState(requestedSearch);');
    expect(page).toContain('className="ocr-live-lead-search"');
    expect(page).toContain('Search leads by name, phone, email, source, service, address, or owner');
    expect(page).toContain('lead.phone.replace(/\\D/g, "").includes(digits)');
    expect(page).toContain('"Quote"');
    expect(page).not.toContain("<small>{lead.phone}</small>");
    expect(page).not.toContain("SAMPLE_ROWS");
    expect(page).not.toContain("Static review");
    expect(page).not.toContain("Preview controls only");
  });

  it("keeps messaging and lead lifecycle controls read-only while allowing requested admin identity edits", () => {
    expect(page).not.toContain("sendMessage.useMutation");
    expect(page).not.toContain("sendWorkspaceMessage.useMutation");
    expect(page).not.toContain("markBooked");
    expect(page).not.toContain("resolveSession");
    expect(page).toContain("trpc.agents.list.useQuery");
    expect(page).toContain("trpc.leads.adminAssignAgent.useMutation");
    expect(page).toContain("trpc.leads.updateLeadPhone.useMutation");
    expect(page).toContain('aria-label="Edit lead assignee"');
    expect(page).toContain('aria-label="Edit lead phone"');
    expect(server).toContain('listIncomingLeads: agentPageProcedure("leads")');
    expect(server).not.toContain("listIncomingLeads: adminAgentProcedure");
    expect(coreRouter).toContain("updateLeadPhone: agentProcedure");
    expect(coreRouter).toContain("leadPhone: z.string().min(1).max(30).trim()");
    expect(coreRouter).toContain("return { success: true, leadPhone: normalized };");
  });

  it("gates the default admin leads route while preserving existing utility deep links", () => {
    expect(route).toContain("function AdminLeadsCRMExactLiveRoute()");
    expect(route).toContain('return <AdminPageGuard pageId="leads"><ReviewWorkspaceFrame navActivePath="/review/leads-crm"><LeadsCRMExactLive /></ReviewWorkspaceFrame></AdminPageGuard>');
    expect(route).toContain('if (tab && tab !== "leads") return <AdminDashboard />');
    expect(route).toContain('component={AdminLeadsCRMExactLiveRoute}');
    expect(workspaceNav).toContain('{ label: "Leads CRM", href: "/review/leads-crm", liveHref: "/admin/leads"');
  });

  it("keeps the new data path isolated from the legacy job boundary", () => {
    expect(server).toContain("LEADS_CRM_EXCLUDED_SOURCES");
    expect(server).toContain("leadsCrmThirtyDayActivity");
    expect(server).not.toContain(forbiddenLegacySymbol);
    expect(server).not.toContain(forbiddenLegacyTable);
    expect(page).not.toContain(forbiddenLegacySymbol);
    expect(page).not.toContain(forbiddenLegacyTable);
  });

  it("preserves the review layout and contains only scoped live additions", () => {
    expect(liveStyles).toContain(".leads-crm-live .ocr-live-filter-menu");
    expect(liveStyles).toContain(".leads-crm-live .ocr-lead-portrait");
    expect(liveStyles).toContain(".review-nav-host > .ocr-live-login");
    expect(liveStyles).toContain(".ocr-live-login");
    expect(liveStyles).toContain(".ocr-live-notice");
    expect(liveStyles).toContain(".ocr-live-lead-search");
    expect(liveStyles).toContain(".ocr-live-editor");
    expect(liveStyles).toContain(".ocr-live-editor-save");
  });
});
