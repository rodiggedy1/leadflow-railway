import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../client/src/components/NativeBookingsWorkspace.tsx", import.meta.url), "utf8");
const pageWrapperSource = readFileSync(new URL("../client/src/pages/NativeBookings.tsx", import.meta.url), "utf8");
const pageStyles = readFileSync(new URL("../client/src/pages/bookings-preview.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../client/src/components/AdminPageGuard.tsx", import.meta.url), "utf8");
const agentDashboardSource = readFileSync(new URL("../client/src/pages/AgentDashboard.tsx", import.meta.url), "utf8");
const sharedConstSource = readFileSync(new URL("../shared/const.ts", import.meta.url), "utf8");
const opsStreamSource = readFileSync(new URL("../client/src/hooks/useOpsStream.ts", import.meta.url), "utf8");
const broadcastSource = readFileSync(new URL("./sseBroadcast.ts", import.meta.url), "utf8");

describe("bookings UI preview contract", () => {
  it("wires a guarded lazy admin route without the shared Fast Leads header", () => {
    expect(appSource).toContain('const NativeBookings = lazy(() => import("./pages/NativeBookings"));');
    expect(appSource).toContain('<Route path={"/admin/bookings"} component={NativeBookings} />');
    expect(pageWrapperSource).toContain('<AdminPageGuard pageId="bookings">');
    expect(pageWrapperSource).not.toContain("AdminHeader");
    expect(pageWrapperSource).toContain("bookings-leadflow-shell");
    expect(pageWrapperSource).toContain("useAgentPermissions()");
    expect(pageWrapperSource).toContain('<NativeBookingsWorkspace realtimeEnabled={agentId !== null} />');
    expect(pageWrapperSource).toContain("bookings-reference-sidebar");
    expect(pageWrapperSource).toContain('data-presentation-only="true"');
    expect(guardSource).toContain('"bookings":          "/admin/bookings"');
    expect(agentDashboardSource).toContain('"bookings":          "/admin/bookings"');
    expect(sharedConstSource).toContain('{ id: "bookings",          label: "Bookings",      group: "Operations" }');
  });

  it("preserves the workspace and detail panel around native data", () => {
    for (const marker of ["Bookings", "Select booking date", "Booking metrics", "LeadFlow bookings list", "BOOKINGS", "TEAMS ASSIGNED", "CARDS ON FILE", "REVENUE", "Search customer, address, or request number", "Confirmed", "Needs attention", "Completed", "SERVICE & EXTRAS", "RECURRING PREFERENCE", "ASSIGNED TEAM", "PAYMENT", "NOTES & SPECIAL REQUESTS"]) {
      expect(pageSource).toContain(marker);
    }
    expect(pageSource).not.toContain("bookings-ops-nav");
    expect(pageSource).not.toContain("Bookings workspace navigation");
    expect(pageSource).not.toContain("Rohan");
    expect(pageSource).not.toContain("Administrator");
    expect(pageSource).toContain("trpc.bookings.list.useQuery");
    expect(pageSource).toContain("trpc.bookings.get.useQuery");
    expect(pageSource).toContain("trpc.bookingFunnel.list.useQuery");
    expect(pageSource).toContain("trpc.bookingFunnel.get.useQuery");
    expect(pageSource).toContain("useMemo");
    expect(pageSource).toContain("useState");
  });

  it("calculates Booking summary metrics only from active selected-date bookings so cancellation updates all totals together", () => {
    expect(pageSource).toContain('const ACTIVE_BOOKING_SOURCES: WorkspaceRow["source"][] = ["booking", "funnel", "leadflow"]');
    expect(pageSource).toContain('const isCancelledBookingStatus = (status: string) => ["cancelled", "canceled"].includes(status.trim().toLowerCase())');
    expect(pageSource).toContain('const activeBookingRows = useMemo(() => rows.filter(isActiveBookingRow), [rows]);');
    expect(pageSource).toContain('const metricRows = view === "bookings" ? activeBookingRows : rows;');
    expect(pageSource).toContain('const revenueCents = metricRows.reduce');
    expect(pageSource).toContain('const assigned = metricRows.filter');
    expect(pageSource).toContain('const cards = metricRows.filter');
    expect(pageSource).not.toContain('REQUESTED REVENUE');
  });

  it("starts the MIB workspace and detail panel at the viewport top without a shared header", () => {
    expect(pageStyles).toContain("grid-template-columns:minmax(720px,1fr) 410px");
    expect(pageStyles).toContain(".bookings-reference-frame{display:grid;grid-template-columns:204px minmax(0,1fr);min-height:100vh");
    expect(pageStyles).toContain(".bookings-reference-sidebar{position:sticky;top:0;height:100vh");
    expect(pageStyles).toContain(".bookings-detail-panel{position:sticky;top:0;height:100vh");
    expect(pageStyles).not.toContain("var(--admin-header-height");
    expect(pageStyles).not.toContain("grid-template-columns:82px");
    expect(pageStyles).not.toContain(".bookings-ops-nav");
    expect(pageStyles).toContain("padding:36px 38px 60px");
    expect(pageStyles).toContain("grid-template-columns:1.6fr 1.25fr 1fr .78fr .42fr 20px");
    expect(pageStyles).toContain("@media(max-width:1120px)");
    expect(pageStyles).toContain("@media(max-width:760px)");
    expect(pageStyles).toContain("grid-template-columns:repeat(4,1fr)");
  });

  it("removes sample records, retains the manual-booking safeguard, and reflects the current Booking detail behavior", () => {
    expect(pageSource).toContain("OPERATIONS · BOOKINGS");
    expect(pageSource).toContain("Native requests and isolated Launch27 imports appear here for review.");
    expect(pageSource).toContain("Phone-captured booking leads appear here while customers finish the flow.");
    expect(pageSource).not.toContain("Demo Customer A");
    expect(pageSource).not.toContain("SEED_BOOKINGS");
    expect(pageSource).toContain('disabled title="Manual booking creation is not connected in this release"');
    expect(pageSource).toContain("No team assigned");
    expect(pageSource).toContain("const cancelActiveRecord");
    for (const prototypeIdentity of ["Rohan Gilkes", "Maya Thompson", "Derek Collins", "Nia Robinson", "Jordan Lee", "302) 981-6191"]) {
      expect(pageSource).not.toContain(prototypeIdentity);
    }
  });

  it("uses approved tRPC mutations without direct client transport, storage, payment, or messaging writes", () => {
    for (const prohibited of ["axios", "sendSms", "processPayment", "storagePut", "localStorage", "sessionStorage"]) {
      expect(pageSource).not.toContain(prohibited);
    }
    expect(pageSource).not.toMatch(/\bfetch\(/);
  });

  it("keeps bookings and progressive leads in separate tabs with safe incomplete-field rendering", () => {
    expect(pageSource).toContain('useState<"bookings" | "leads">("bookings")');
    expect(pageSource).toContain('onClick={() => setView("bookings")}');
    expect(pageSource).toContain('onClick={() => setView("leads")}');
    expect(pageSource).toContain("Lead / In progress");
    expect(pageSource).toContain("Reservation started / Payment incomplete");
    expect(pageSource).toContain("status: lead.stage");
    expect(pageSource).not.toContain('stage: "lead" as const');
    expect(pageSource).toContain('if (view === "bookings") return [...inProgressFunnelRows, ...portalRequestRows, ...scheduledRows];');
    expect(pageSource).toContain('const scheduledRows = [...funnelRows.filter((row) => row.status !== "lead" && !isCancelledBookingStatus(row.status)), ...bookingRows, ...importedRows]');
    expect(pageSource).toContain('.filter((row) => row.requestedLocalDate === date)');
    expect(pageSource).toContain('[bookings, date, funnelLeads, leadflowJobsQuery.data, portalRequests, status, view]');
    expect(pageSource).toContain("return inProgressFunnelRows;");
    expect(pageSource).toContain("Details in progress");
    expect(pageSource).toContain("Email not entered yet");
    expect(pageSource).not.toContain("mutationToken");
    expect(pageSource).not.toContain("idempotencyKey");
    expect(pageSource).not.toContain("commandHash");
  });

  it("provides responsive list and full-width mobile detail-panel behavior", () => {
    expect(pageStyles).toContain(".bookings-detail-panel{width:100%}");
    expect(pageStyles).toContain(".bookings-row{grid-template-columns:1fr auto;padding:14px}");
    expect(pageStyles).toContain(".bookings-ops-main{padding:22px 14px 48px}");
    expect(pageSource).toContain('aria-label={`Booking details for ${active.customerName}`}');
  });

  it("uses a readable typography scale without changing the workspace geometry", () => {
    for (const marker of [
      ".bookings-list-head{padding:11px 15px;border-bottom:1px solid var(--line);background:#fafafa;color:#85888f;font-size:9px",
      ".bookings-customer-cell>b{font-size:13px}",
      ".bookings-customer-cell strong,.bookings-service-cell strong,.bookings-team-cell strong{font-size:12px}",
      ".bookings-customer-cell small,.bookings-service-cell small,.bookings-team-cell small{display:flex;align-items:center;color:#7d8189;font-size:10px",
      ".bookings-payment-ok,.bookings-payment-missing{display:flex;align-items:center;gap:5px;font-size:10px",
      ".bookings-row-price{font-size:14px}",
      ".bookings-detail-panel h2{margin:4px 0 7px;font-family:Georgia,serif;font-size:28px}",
      ".bookings-detail-summary strong{font-size:11px;line-height:1.45}",
      ".bookings-home-line{margin:0 0 10px;color:#696d75;font-size:11px;line-height:1.45}",
      ".bookings-detail-panel>footer button{height:40px;border-radius:10px;font-size:11px",
    ]) {
      expect(pageStyles).toContain(marker);
    }
    expect(pageStyles).toContain("grid-template-columns:minmax(720px,1fr) 410px");
    expect(pageStyles).toContain("grid-template-columns:1.6fr 1.25fr 1fr .78fr .42fr 20px");
    expect(pageStyles).not.toMatch(/font-size:[6-8]px/);
  });

  it("keeps an explicit right-detail close dismissed until another row is selected", () => {
    expect(pageSource).toContain("const [activeKey, setRawActiveKey] = useState<string | null>(null)");
    expect(pageSource).toContain("const detailDismissedRef = useRef(false)");
    expect(pageSource).toContain("detailDismissedRef.current = key === null");
    expect(pageSource).toContain("if (!rows.length) return setRawActiveKey(null)");
    expect(pageSource).toContain("if (!detailDismissedRef.current) setActiveKey(rows[0].key)");
    expect(pageSource).toContain("<BookingListRow key={row.key} row={row} selected={activeKey === row.key} onSelect={() => setActiveKey(row.key)} />");
    expect(pageSource).toContain('onClick={() => setActiveKey(null)} aria-label="Close booking detail panel"');
    expect(pageSource).not.toContain("if (activeKey === null || !rows.some");
  });

  it("refreshes funnel list and open detail instantly after committed updates and once after reconnect", () => {
    expect(pageSource).toContain('import { useOpsStream } from "@/hooks/useOpsStream"');
    expect(pageSource).toContain("onBookingFunnelUpdate: refreshBookingAndFunnelQueries");
    expect(pageSource).toContain("void funnelListQuery.refetch()");
    expect(pageSource).toContain("if (selectedFunnelId !== null) void funnelDetailQuery.refetch()");
    expect(pageSource).toContain("const hasConnectedRef = useRef(false)");
    expect(pageSource).toContain("if (!hasConnectedRef.current)");
    expect(pageSource).toContain("hasConnectedRef.current = true");
    expect(pageSource).toContain('{ enabled: realtimeEnabled, label: "NativeBookings" }');
    expect(pageSource).not.toContain("setInterval(");
    expect(opsStreamSource).toContain("onBookingFunnelUpdate?: () => void");
    expect(opsStreamSource).toContain('case "booking_funnel_update"');
    expect(broadcastSource).toContain('| "booking_funnel_update";');
  });

  it("keeps the existing MIB Chat suppression unchanged during the navigation-only redesign", () => {
    expect(appSource).toContain('const isBookingsWorkspace = location === "/admin/bookings";');
    expect(appSource).toContain("(location.startsWith(\"/admin\") && !isBookingsWorkspace)");
    expect(appSource).toContain("hasBeenMounted && !isBookingsWorkspace");
  });
});
