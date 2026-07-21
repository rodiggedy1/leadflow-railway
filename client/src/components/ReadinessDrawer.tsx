/**
 * ReadinessDrawer — Tomorrow Readiness slide-in panel.
 *
 * Fetches real data from trpc.aiConcierge.getReadinessSummary.
 * Falls back to a loading skeleton while fetching.
 *
 * Props:
 *   open    — whether the drawer is visible
 *   onClose — called when backdrop or X is clicked
 *   date    — optional YYYY-MM-DD override (defaults to tomorrow ET on server)
 */
import React, { useState, useEffect, useRef } from "react";
import {
  X,
  RefreshCw,
  MessageSquare,
  CreditCard,
  Users,
  Calendar,
  Lock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Download,
  Sparkles,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ─── Types (mirrors server return shape) ─────────────────────────────────────

type PaymentStatus = "on_hold" | "no_preauth" | "no_card";
type ConfirmStatus = "confirmed" | "pending";
type ClientReqStatus = "honored" | "violated" | "unassigned";

interface SummaryData {
  date: string;
  overallPct: number;
  totalIssues: number;
  dimensions: {
    jobs: {
      total: number;
      issueCount: number;
      unassigned: Array<{ customerName: string; jobTime: string | null }>;
      doubleBooked: Array<{ customerName: string; jobTime: string | null; cleanerName: string }>;
    };
    teams: {
      total: number;
      confirmed: number;
      issueCount: number;
      rows: Array<{ name: string; confirmed: boolean; jobCount: number }>;
    };
    payments: {
      total: number;
      onHold: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        cardBrand: string | null;
        last4: string | null;
        status: PaymentStatus;
        amountCents: number;
      }>;
    };
    confirmations: {
      total: number;
      confirmed: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        serviceType: string | null;
        status: ConfirmStatus;
        outcomeLabel: string | null;
      }>;
    };
    clientRequests: {
      total: number;
      honored: number;
      issueCount: number;
      rows: Array<{
        customerName: string;
        jobTime: string | null;
        requestedTeam: string;
        assignedTeam: string | null;
        status: ClientReqStatus;
      }>;
    };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Donut Ring ───────────────────────────────────────────────────────────────

function DonutRing({ pct }: { pct: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);
  const gap = circ * 0.03;
  const greenDash = filled - gap / 2;
  const redDash = circ - filled - gap / 2;
  const label = pct >= 90 ? "Excellent" : pct >= 75 ? "Good" : pct >= 50 ? "Fair" : "Needs Work";
  const labelColor = pct >= 90 ? "#22c55e" : pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex-shrink-0" style={{ width: 140, height: 140 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f3f4f6" strokeWidth="14" />
        <circle
          cx="70" cy="70" r={r}
          fill="none"
          stroke="#22c55e"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0, greenDash)} ${circ - Math.max(0, greenDash)}`}
          strokeDashoffset="0"
        />
        <circle
          cx="70" cy="70" r={r}
          fill="none"
          stroke="#ef4444"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0, redDash)} ${circ - Math.max(0, redDash)}`}
          strokeDashoffset={`${-(filled + gap / 2)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-gray-900">{pct}%</span>
        <span className="text-xs text-gray-400 font-medium">Overall Readiness</span>
        <span className="mt-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${labelColor}22`, color: labelColor }}>{label}</span>
      </div>
    </div>
  );
}

// ─── Metric Tile ──────────────────────────────────────────────────────────────

function MetricTile({
  icon, iconBg, label, primary, okLabel, issueLabel, issueColor = "#f59e0b",
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  primary: string;
  okLabel: string;
  issueLabel: string;
  issueColor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>{icon}</div>
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div className="text-lg font-black text-gray-900 leading-none">{primary}</div>
      <div className="text-xs font-semibold text-emerald-600">{okLabel}</div>
      <div className="text-xs font-semibold" style={{ color: issueColor }}>{issueLabel}</div>
    </div>
  );
}

// ─── Expandable Section ───────────────────────────────────────────────────────

interface SectionDef {
  id: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  dotColor: "green" | "amber" | "red";
  count: number | null;
  actionLabel: string | null;
  expandedLabel: string;
  rows: React.ReactNode[];
}

function ExpandableSection({ section }: { section: SectionDef }) {
  const [open, setOpen] = useState(section.dotColor !== "green" && section.rows.length > 0);

  const dotColors = { green: "#22c55e", amber: "#f59e0b", red: "#ef4444" };

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5 bg-white">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${section.iconBg}`}>
          {section.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">{section.title}</span>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColors[section.dotColor] }} />
          </div>
          <div className="text-xs text-gray-500">{section.subtitle}</div>
        </div>
        {section.count !== null ? (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
            style={{
              background: section.dotColor === "green" ? "#f0fdf4" : "#fff7ed",
              color: section.dotColor === "green" ? "#16a34a" : "#ea580c",
            }}
          >
            {section.count}
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-50 flex-shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
        )}
        {section.actionLabel && (
          <button className="px-3 py-1.5 rounded-xl text-xs font-bold text-purple-700 border border-purple-200 hover:bg-purple-50 transition-colors flex-shrink-0">
            {section.actionLabel}
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {open && section.rows.length > 0 && (
        <div className="border-t border-gray-50 bg-gray-50/50 px-4 pb-2">
          <div className="text-xs font-semibold text-gray-400 pt-2 pb-1">
            {section.expandedLabel} ({section.rows.length})
          </div>
          {section.rows}
        </div>
      )}
    </div>
  );
}

// ─── Row helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ label, isIssue }: { label: string; isIssue: boolean }) {
  return (
    <span
      className="px-2.5 py-1 rounded-lg text-xs font-bold flex-shrink-0"
      style={{
        background: isIssue ? "#fff7ed" : "#f0fdf4",
        color: isIssue ? "#ea580c" : "#16a34a",
        border: `1px solid ${isIssue ? "#fed7aa" : "#bbf7d0"}`,
      }}
    >
      {label}
    </span>
  );
}

function RowBase({ name, time, detail, children }: { name: string; time?: string | null; detail?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-bold text-gray-900">{name}</span>
        {time && <span className="ml-2 text-xs text-gray-400">{time}</span>}
        {detail && <span className="ml-2 text-xs text-gray-400">· {detail}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Build sections from real data ───────────────────────────────────────────

function buildSections(data: SummaryData): SectionDef[] {
  const { dimensions: d } = data;

  // 1. Customer Confirmations — show only pending rows
  const pendingConfirmRows = d.confirmations.rows
    .filter(r => r.status === "pending")
    .map((r, i) => (
      <RowBase key={i} name={r.customerName} time={r.jobTime} detail={r.serviceType}>
        <StatusBadge label="Not Confirmed" isIssue={true} />
        <button className="px-3 py-1 rounded-lg text-xs font-bold border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors flex-shrink-0">
          Text
        </button>
      </RowBase>
    ));

  // 2. Payment Methods — show only non-on-hold rows
  const paymentIssueRows = d.payments.rows
    .filter(r => r.status !== "on_hold")
    .map((r, i) => {
      const statusLabel = r.status === "no_preauth" ? "No Pre-Auth" : "No Card";
      const detail = r.cardBrand && r.last4 ? `${r.cardBrand} ···· ${r.last4}` : "No card on file";
      return (
        <RowBase key={i} name={r.customerName} time={r.jobTime} detail={detail}>
          <StatusBadge label={statusLabel} isIssue={true} />
        </RowBase>
      );
    });

  // 3. Team Confirmations — show all teams, unconfirmed first
  const teamRows = [...d.teams.rows]
    .sort((a, b) => Number(a.confirmed) - Number(b.confirmed))
    .map((r, i) => (
      <RowBase key={i} name={r.name} detail={`${r.jobCount} job${r.jobCount !== 1 ? "s" : ""}`}>
        <StatusBadge label={r.confirmed ? "Confirmed" : "Pending"} isIssue={!r.confirmed} />
      </RowBase>
    ));

  // 4. Client Requests — show only violated/unassigned
  const clientIssueRows = d.clientRequests.rows
    .filter(r => r.status !== "honored")
    .map((r, i) => {
      const statusLabel = r.status === "violated" ? "Mismatch" : "Unassigned";
      const detail = r.assignedTeam ? `Assigned: ${r.assignedTeam}` : undefined;
      return (
        <RowBase key={i} name={r.customerName} time={r.jobTime} detail={detail}>
          <span className="text-xs text-gray-400 flex-shrink-0">Req: {r.requestedTeam}</span>
          <StatusBadge label={statusLabel} isIssue={true} />
        </RowBase>
      );
    });

  // 5. Jobs — show unassigned + double-booked
  const unassignedJobRows = d.jobs.unassigned.map((r, i) => (
    <RowBase key={i} name={r.customerName} time={r.jobTime}>
      <StatusBadge label="Unassigned" isIssue={true} />
    </RowBase>
  ));
  const doubleBookedRows = d.jobs.doubleBooked.map((r, i) => (
    <RowBase key={`db-${i}`} name={r.customerName} time={r.jobTime} detail={r.cleanerName}>
      <StatusBadge label="Double Booked" isIssue={true} />
    </RowBase>
  ));

  return [
    {
      id: "confirmations",
      icon: <MessageSquare className="w-4 h-4 text-purple-600" />,
      iconBg: "bg-purple-50",
      title: "Customer Confirmations",
      subtitle: d.confirmations.issueCount > 0
        ? `${d.confirmations.issueCount} customer${d.confirmations.issueCount !== 1 ? "s" : ""} haven't confirmed yet`
        : "All customers confirmed",
      dotColor: d.confirmations.issueCount > 0 ? "amber" : "green",
      count: d.confirmations.issueCount > 0 ? d.confirmations.issueCount : null,
      actionLabel: d.confirmations.issueCount > 0 ? "Follow Up" : null,
      expandedLabel: "Not Confirmed",
      rows: pendingConfirmRows,
    },
    {
      id: "payments",
      icon: <CreditCard className="w-4 h-4 text-emerald-600" />,
      iconBg: "bg-emerald-50",
      title: "Payment Methods",
      subtitle: d.payments.issueCount > 0
        ? `${d.payments.issueCount} customer${d.payments.issueCount !== 1 ? "s" : ""} don't have cards on hold`
        : "All payments on hold",
      dotColor: d.payments.issueCount > 0 ? "amber" : "green",
      count: d.payments.issueCount > 0 ? d.payments.issueCount : null,
      actionLabel: d.payments.issueCount > 0 ? "Collect Cards" : null,
      expandedLabel: "Needs Attention",
      rows: paymentIssueRows,
    },
    {
      id: "teams",
      icon: <Users className="w-4 h-4 text-blue-600" />,
      iconBg: "bg-blue-50",
      title: "Team Confirmations",
      subtitle: d.teams.issueCount > 0
        ? `${d.teams.issueCount} team${d.teams.issueCount !== 1 ? "s" : ""} haven't confirmed`
        : "All teams confirmed for tomorrow",
      dotColor: d.teams.issueCount > 0 ? "amber" : "green",
      count: d.teams.total > 0 ? d.teams.total : null,
      actionLabel: "View Teams",
      expandedLabel: "Teams",
      rows: teamRows,
    },
    {
      id: "clientRequests",
      icon: <Lock className="w-4 h-4 text-orange-600" />,
      iconBg: "bg-orange-50",
      title: "Client Requests",
      subtitle: d.clientRequests.issueCount > 0
        ? `${d.clientRequests.issueCount} request${d.clientRequests.issueCount !== 1 ? "s" : ""} not honored`
        : d.clientRequests.total > 0 ? "All client requests honored" : "No client requests",
      dotColor: d.clientRequests.issueCount > 0 ? "amber" : "green",
      count: d.clientRequests.issueCount > 0 ? d.clientRequests.issueCount : null,
      actionLabel: d.clientRequests.issueCount > 0 ? "Resolve" : null,
      expandedLabel: "Issues",
      rows: clientIssueRows,
    },
    {
      id: "jobs",
      icon: <Calendar className="w-4 h-4 text-teal-600" />,
      iconBg: "bg-teal-50",
      title: "Scheduling Issues",
      subtitle: d.jobs.issueCount > 0
        ? `${d.jobs.issueCount} job${d.jobs.issueCount !== 1 ? "s" : ""} unassigned`
        : `${d.jobs.total} jobs scheduled`,
      dotColor: d.jobs.issueCount > 0 ? "amber" : "green",
      count: d.jobs.issueCount > 0 ? d.jobs.issueCount : null,
      actionLabel: null,
      expandedLabel: "Unassigned",
      rows: [...unassignedJobRows, ...doubleBookedRows],
    },
  ];
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

interface ReadinessDrawerProps {
  open: boolean;
  onClose: () => void;
  date?: string;
}

export default function ReadinessDrawer({ open, onClose, date }: ReadinessDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  const { data, isLoading, isError, refetch } = trpc.aiConcierge.getReadinessSummary.useQuery(
    { date },
    { enabled: open, staleTime: 60_000 }
  );

  if (!visible) return null;

  const d = data as SummaryData | undefined;
  const sections = d ? buildSections(d) : [];

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[60] transition-all duration-300"
        style={{ background: animating ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-[61] flex flex-col bg-white shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: "min(680px, 95vw)",
          transform: animating ? "translateX(0)" : "translateX(100%)",
          borderLeft: "1px solid #e5e7eb",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-purple-100 to-orange-100 flex items-center justify-center">
            <span className="text-2xl">🌅</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
                Tomorrow Readiness
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">BETA</span>
            </div>
            <p className="text-sm text-gray-500">
              {d ? formatDateLabel(d.date) : "Loading…"}
            </p>
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm text-gray-500 font-medium">Running readiness checks…</p>
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-gray-500 font-medium">Failed to load readiness data</p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Data loaded */}
          {d && !isLoading && (
            <>
              {/* Summary card: donut + 4 metrics */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-6 flex-wrap">
                  <DonutRing pct={d.overallPct} />
                  <div className="flex gap-5 flex-wrap flex-1 min-w-0">
                    <MetricTile
                      icon={<MessageSquare className="w-4 h-4 text-purple-600" />}
                      iconBg="bg-purple-50"
                      label="Customers"
                      primary={`${d.dimensions.confirmations.confirmed} / ${d.dimensions.confirmations.total}`}
                      okLabel="Confirmed"
                      issueLabel={d.dimensions.confirmations.issueCount > 0 ? `${d.dimensions.confirmations.issueCount} need follow up` : "All set"}
                    />
                    <MetricTile
                      icon={<CreditCard className="w-4 h-4 text-emerald-600" />}
                      iconBg="bg-emerald-50"
                      label="Payments"
                      primary={`${d.dimensions.payments.onHold} / ${d.dimensions.payments.total}`}
                      okLabel="On Hold"
                      issueLabel={d.dimensions.payments.issueCount > 0 ? `${d.dimensions.payments.issueCount} not on hold` : "All set"}
                      issueColor="#ef4444"
                    />
                    <MetricTile
                      icon={<Users className="w-4 h-4 text-blue-600" />}
                      iconBg="bg-blue-50"
                      label="Teams"
                      primary={`${d.dimensions.teams.confirmed} / ${d.dimensions.teams.total}`}
                      okLabel="Confirmed"
                      issueLabel={d.dimensions.teams.issueCount > 0 ? `${d.dimensions.teams.issueCount} unconfirmed` : "All set"}
                      issueColor="#22c55e"
                    />
                    <MetricTile
                      icon={<Calendar className="w-4 h-4 text-orange-500" />}
                      iconBg="bg-orange-50"
                      label="Scheduling Issues"
                      primary={`${d.dimensions.jobs.total}`}
                      okLabel="Scheduled"
                      issueLabel={d.dimensions.jobs.issueCount > 0 ? `${d.dimensions.jobs.issueCount} unassigned` : "All assigned"}
                    />
                  </div>
                </div>
              </div>

              {/* Expandable sections */}
              {sections.map((section) => (
                <ExpandableSection key={section.id} section={section} />
              ))}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-white">
          <button className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
            <Download className="w-4 h-4" /> Export Summary
          </button>
          <div className="flex flex-col items-end gap-0.5">
            <button
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}
            >
              <Sparkles className="w-4 h-4" />
              Fix All Action Items
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-400">Madison will handle everything she can</span>
          </div>
        </div>
      </div>
    </>
  );
}
