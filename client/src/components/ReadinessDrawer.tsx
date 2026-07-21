/**
 * ReadinessDrawer — Tomorrow Readiness slide-in panel.
 *
 * Matches the "Tomorrow Readiness" modal mockup:
 *   - Header: icon, title, date, BETA badge, Refresh + Close buttons
 *   - Summary row: donut ring (readiness %) + 4 metric tiles
 *   - Expandable sections: Customer Confirmations, Payment Methods,
 *     Team Confirmations, Access & Lockboxes, Schedule & Route, Equipment & Supplies
 *   - Footer: Export Summary + Fix All Action Items
 *
 * Currently uses mock data. Wire to real tRPC in a follow-up pass.
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
  Clock,
  Package,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Download,
  Sparkles,
  ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReadinessSection {
  id: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  dotColor: "green" | "amber" | "red";
  count: number | null; // null = checkmark (all good)
  actionLabel: string | null;
  rows: ReadinessRow[];
}

interface ReadinessRow {
  id: number;
  name: string;
  time?: string;
  detail?: string;
  status: "ok" | "issue";
  statusLabel: string;
  actionLabel?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_DATE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
})();

const MOCK_SECTIONS: ReadinessSection[] = [
  {
    id: "customers",
    icon: <Users className="w-4 h-4 text-purple-600" />,
    iconBg: "bg-purple-50",
    title: "Customer Confirmations",
    subtitle: "4 customers haven't confirmed yet",
    dotColor: "amber",
    count: 4,
    actionLabel: "Follow Up",
    rows: [
      { id: 1, name: "Jessica Taylor", time: "11:30 AM", detail: "2 bed · 1 bath", status: "issue", statusLabel: "Not Confirmed", actionLabel: "Text" },
      { id: 2, name: "Michael Brown", time: "1:00 PM", detail: "3 bed · 2 bath", status: "issue", statusLabel: "Not Confirmed", actionLabel: "Text" },
      { id: 3, name: "Amanda Smith", time: "2:30 PM", detail: "1 bed · 1 bath", status: "issue", statusLabel: "Not Confirmed", actionLabel: "Text" },
      { id: 4, name: "Kevin Lee", time: "4:00 PM", detail: "2 bed · 2 bath", status: "issue", statusLabel: "Not Confirmed", actionLabel: "Text" },
    ],
  },
  {
    id: "payments",
    icon: <CreditCard className="w-4 h-4 text-emerald-600" />,
    iconBg: "bg-emerald-50",
    title: "Payment Methods",
    subtitle: "2 customers don't have cards on hold",
    dotColor: "amber",
    count: 2,
    actionLabel: "Collect Cards",
    rows: [
      { id: 5, name: "Sarah Chen", time: "11:00 AM", detail: "Visa ···· 3341", status: "issue", statusLabel: "No Pre-Auth" },
      { id: 6, name: "David Park", time: "1:00 PM", detail: "No card on file", status: "issue", statusLabel: "No Card" },
    ],
  },
  {
    id: "teams",
    icon: <Users className="w-4 h-4 text-blue-600" />,
    iconBg: "bg-blue-50",
    title: "Team Confirmations",
    subtitle: "All teams confirmed for tomorrow",
    dotColor: "green",
    count: 12,
    actionLabel: "View Teams",
    rows: [],
  },
  {
    id: "access",
    icon: <Lock className="w-4 h-4 text-orange-600" />,
    iconBg: "bg-orange-50",
    title: "Access & Lockboxes",
    subtitle: "1 job missing access details",
    dotColor: "amber",
    count: 1,
    actionLabel: "Resolve",
    rows: [
      { id: 7, name: "Robert Kim", time: "3:00 PM", detail: "1800 Columbia Rd NW", status: "issue", statusLabel: "No Access Info" },
    ],
  },
  {
    id: "schedule",
    icon: <Clock className="w-4 h-4 text-teal-600" />,
    iconBg: "bg-teal-50",
    title: "Schedule & Route",
    subtitle: "No conflicts detected",
    dotColor: "green",
    count: null,
    actionLabel: null,
    rows: [],
  },
  {
    id: "equipment",
    icon: <Package className="w-4 h-4 text-indigo-600" />,
    iconBg: "bg-indigo-50",
    title: "Equipment & Supplies",
    subtitle: "All good for tomorrow",
    dotColor: "green",
    count: null,
    actionLabel: null,
    rows: [],
  },
];

const MOCK_METRICS = {
  readinessPct: 82,
  customers: { ok: 34, total: 38, issueLabel: "4 need follow up" },
  payments: { ok: 31, total: 33, issueLabel: "2 not on hold" },
  teams: { ok: 12, total: 12, issueLabel: "All set" },
  jobs: { total: 34, issueLabel: "1 issue" },
};

// ─── Donut Ring ───────────────────────────────────────────────────────────────

function DonutRing({ pct }: { pct: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);
  const gap = circ * 0.03;

  // Green arc (ok), red arc (issues), small gap between
  const greenDash = filled - gap / 2;
  const redDash = circ - filled - gap / 2;

  const label = pct >= 90 ? "Excellent" : pct >= 75 ? "Good" : pct >= 50 ? "Fair" : "Needs Work";
  const labelColor = pct >= 90 ? "#22c55e" : pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex-shrink-0" style={{ width: 140, height: 140 }}>
      <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
        {/* Track */}
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f3f4f6" strokeWidth="14" />
        {/* Green (ok) */}
        <circle
          cx="70" cy="70" r={r}
          fill="none"
          stroke="#22c55e"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0, greenDash)} ${circ - Math.max(0, greenDash)}`}
          strokeDashoffset="0"
        />
        {/* Red (issues) — starts after green arc */}
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
  icon,
  iconBg,
  label,
  primary,
  okLabel,
  issueLabel,
  issueColor = "#f59e0b",
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

// ─── Section Row ──────────────────────────────────────────────────────────────

function SectionRow({ row, onAction }: { row: ReadinessRow; onAction?: (row: ReadinessRow) => void }) {
  const isIssue = row.status === "issue";
  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-bold text-gray-900">{row.name}</span>
        {row.time && <span className="ml-2 text-xs text-gray-400">{row.time}</span>}
        {row.detail && <span className="ml-2 text-xs text-gray-400">· {row.detail}</span>}
      </div>
      <span
        className="px-2.5 py-1 rounded-lg text-xs font-bold"
        style={{
          background: isIssue ? "#fff7ed" : "#f0fdf4",
          color: isIssue ? "#ea580c" : "#16a34a",
          border: `1px solid ${isIssue ? "#fed7aa" : "#bbf7d0"}`,
        }}
      >
        {row.statusLabel}
      </span>
      {row.actionLabel && (
        <button
          onClick={() => onAction?.(row)}
          className="px-3 py-1 rounded-lg text-xs font-bold border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors"
        >
          {row.actionLabel}
        </button>
      )}
    </div>
  );
}

// ─── Expandable Section ───────────────────────────────────────────────────────

function ExpandableSection({ section }: { section: ReadinessSection }) {
  const [open, setOpen] = useState(section.rows.length > 0 && section.dotColor !== "green");

  const dotColors = {
    green: "#22c55e",
    amber: "#f59e0b",
    red: "#ef4444",
  };

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header row */}
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
        {/* Count badge or checkmark */}
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
        {/* Action button */}
        {section.actionLabel && (
          <button className="px-3 py-1.5 rounded-xl text-xs font-bold text-purple-700 border border-purple-200 hover:bg-purple-50 transition-colors flex-shrink-0">
            {section.actionLabel}
          </button>
        )}
        {/* Expand toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded rows */}
      {open && section.rows.length > 0 && (
        <div className="border-t border-gray-50 bg-gray-50/50 px-4 pb-2">
          <div className="text-xs font-semibold text-gray-400 pt-2 pb-1">
            Not Confirmed ({section.rows.length})
          </div>
          {section.rows.map((row) => (
            <SectionRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

interface ReadinessDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ReadinessDrawer({ open, onClose }: ReadinessDrawerProps) {
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

  if (!visible) return null;

  const m = MOCK_METRICS;
  const issueCount = (m.customers.total - m.customers.ok) + (m.payments.total - m.payments.ok) + 1; // +1 for access

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
            {/* Sunrise emoji-style icon */}
            <span className="text-2xl">🌅</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
                Tomorrow Readiness
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">BETA</span>
            </div>
            <p className="text-sm text-gray-500">{MOCK_DATE}</p>
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            onClick={() => {}}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
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

          {/* Summary card: donut + 4 metrics */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-6 flex-wrap">
              <DonutRing pct={m.readinessPct} />
              <div className="flex gap-5 flex-wrap flex-1 min-w-0">
                <MetricTile
                  icon={<MessageSquare className="w-4 h-4 text-purple-600" />}
                  iconBg="bg-purple-50"
                  label="Customers"
                  primary={`${m.customers.ok} / ${m.customers.total}`}
                  okLabel="Confirmed"
                  issueLabel={m.customers.issueLabel}
                />
                <MetricTile
                  icon={<CreditCard className="w-4 h-4 text-emerald-600" />}
                  iconBg="bg-emerald-50"
                  label="Payments"
                  primary={`${m.payments.ok} / ${m.payments.total}`}
                  okLabel="On Hold"
                  issueLabel={m.payments.issueLabel}
                  issueColor="#ef4444"
                />
                <MetricTile
                  icon={<Users className="w-4 h-4 text-blue-600" />}
                  iconBg="bg-blue-50"
                  label="Teams"
                  primary={`${m.teams.ok} / ${m.teams.total}`}
                  okLabel="Confirmed"
                  issueLabel={m.teams.issueLabel}
                  issueColor="#22c55e"
                />
                <MetricTile
                  icon={<Calendar className="w-4 h-4 text-orange-500" />}
                  iconBg="bg-orange-50"
                  label="Jobs"
                  primary={`${m.jobs.total}`}
                  okLabel="Scheduled"
                  issueLabel={m.jobs.issueLabel}
                />
              </div>
            </div>
          </div>

          {/* Expandable sections */}
          {MOCK_SECTIONS.map((section) => (
            <ExpandableSection key={section.id} section={section} />
          ))}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-white">
          <button className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
            <Download className="w-4 h-4" /> Export Summary
          </button>
          <div className="flex flex-col items-end gap-0.5">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
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
