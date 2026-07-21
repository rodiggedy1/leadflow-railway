/**
 * ReadinessDashboard — Tomorrow Preparation Overview
 *
 * Shows 5 readiness dimensions for the next business day:
 *   1. Customers Texted / Confirmed
 *   2. Cards on Hold
 *   3. Team Confirmations
 *   4. Jobs Scheduled
 *   5. Overall Readiness %
 *
 * Currently uses mock data. Will be wired to real tRPC queries in a follow-up pass.
 */
import { useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import {
  MessageSquare,
  CreditCard,
  Users,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  RefreshCw,
  ChevronRight,
  Sparkles,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerRow = {
  id: number;
  name: string;
  initials: string;
  jobTime: string;
  address: string;
  confirmed: boolean;
};

type CardRow = {
  id: number;
  name: string;
  initials: string;
  cardBrand: string;
  last4: string;
  amountCents: number;
  status: "on_hold" | "no_preauth" | "no_card";
};

type TeamRow = {
  id: number;
  name: string;
  initials: string;
  jobCount: number;
  confirmed: boolean;
};

type ScheduleRow = {
  id: number;
  time: string;
  customerName: string;
  address: string;
  teamName: string;
};

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_CUSTOMERS: CustomerRow[] = [
  { id: 1, name: "Lorraine Rushing", initials: "LR", jobTime: "8:00 AM", address: "4521 Oak St NW", confirmed: true },
  { id: 2, name: "Quito Swan", initials: "QS", jobTime: "9:00 AM", address: "1230 K St NW", confirmed: true },
  { id: 3, name: "Rachel Silberman", initials: "RS", jobTime: "9:00 AM", address: "3400 Connecticut Ave", confirmed: true },
  { id: 4, name: "Michael Murphy", initials: "MM", jobTime: "10:00 AM", address: "5600 Wisconsin Ave", confirmed: false },
  { id: 5, name: "Sarah Chen", initials: "SC", jobTime: "11:00 AM", address: "2100 Pennsylvania Ave", confirmed: true },
  { id: 6, name: "David Park", initials: "DP", jobTime: "1:00 PM", address: "700 New Hampshire Ave", confirmed: false },
  { id: 7, name: "Jennifer Walsh", initials: "JW", jobTime: "2:00 PM", address: "4200 Massachusetts Ave", confirmed: true },
  { id: 8, name: "Robert Kim", initials: "RK", jobTime: "3:00 PM", address: "1800 Columbia Rd NW", confirmed: false },
];

const MOCK_CARDS: CardRow[] = [
  { id: 1, name: "Lorraine Rushing", initials: "LR", cardBrand: "Visa", last4: "1219", amountCents: 17300, status: "on_hold" },
  { id: 2, name: "Quito Swan", initials: "QS", cardBrand: "Mastercard", last4: "7927", amountCents: 21000, status: "on_hold" },
  { id: 3, name: "Rachel Silberman", initials: "RS", cardBrand: "Visa", last4: "1821", amountCents: 30510, status: "on_hold" },
  { id: 4, name: "Michael Murphy", initials: "MM", cardBrand: "Amex", last4: "4004", amountCents: 19800, status: "on_hold" },
  { id: 5, name: "Sarah Chen", initials: "SC", cardBrand: "Visa", last4: "3341", amountCents: 0, status: "no_preauth" },
  { id: 6, name: "David Park", initials: "DP", cardBrand: "", last4: "", amountCents: 0, status: "no_card" },
  { id: 7, name: "Jennifer Walsh", initials: "JW", cardBrand: "Mastercard", last4: "8812", amountCents: 16500, status: "on_hold" },
  { id: 8, name: "Robert Kim", initials: "RK", cardBrand: "Visa", last4: "5590", amountCents: 14000, status: "on_hold" },
];

const MOCK_TEAMS: TeamRow[] = [
  { id: 1, name: "Consuelo Alba", initials: "CA", jobCount: 3, confirmed: true },
  { id: 2, name: "BZA Cleaning", initials: "BZ", jobCount: 4, confirmed: true },
  { id: 3, name: "GoGreen", initials: "GG", jobCount: 2, confirmed: true },
  { id: 4, name: "Pilar Duarte", initials: "PD", jobCount: 3, confirmed: false },
  { id: 5, name: "MaidsPlus", initials: "MP", jobCount: 5, confirmed: true },
  { id: 6, name: "Clean Sweep", initials: "CS", jobCount: 2, confirmed: false },
];

const MOCK_SCHEDULE: ScheduleRow[] = [
  { id: 1, time: "8:00 AM", customerName: "Lorraine Rushing", address: "4521 Oak St NW", teamName: "Consuelo Alba" },
  { id: 2, time: "9:00 AM", customerName: "Quito Swan", address: "1230 K St NW", teamName: "BZA Cleaning" },
  { id: 3, time: "9:00 AM", customerName: "Rachel Silberman", address: "3400 Connecticut Ave", teamName: "GoGreen" },
  { id: 4, time: "10:00 AM", customerName: "Michael Murphy", address: "5600 Wisconsin Ave", teamName: "Pilar Duarte" },
  { id: 5, time: "11:00 AM", customerName: "Sarah Chen", address: "2100 Pennsylvania Ave", teamName: "MaidsPlus" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getTomorrowLabel(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InitialsCircle({ initials, color = "purple" }: { initials: string; color?: "purple" | "coral" | "green" | "blue" }) {
  const colors = {
    purple: "bg-purple-100 text-purple-700",
    coral: "bg-orange-100 text-orange-700",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${colors[color]}`}>
      {initials}
    </div>
  );
}

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 className="w-3 h-3" /> {okLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
      <Clock className="w-3 h-3" /> {badLabel}
    </span>
  );
}

function CardStatusBadge({ status, amountCents }: { status: CardRow["status"]; amountCents: number }) {
  if (status === "on_hold") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" /> On Hold {fmtDollars(amountCents)}
      </span>
    );
  }
  if (status === "no_preauth") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="w-3 h-3" /> No Pre-Auth
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200">
      <XCircle className="w-3 h-3" /> No Card
    </span>
  );
}

type TabFilter = "all" | "ok" | "issues";

function SectionTabs({ filter, setFilter, okLabel, issueLabel }: {
  filter: TabFilter;
  setFilter: (f: TabFilter) => void;
  okLabel: string;
  issueLabel: string;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
      {(["all", "ok", "issues"] as TabFilter[]).map((f) => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
            filter === f
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {f === "all" ? "All" : f === "ok" ? okLabel : issueLabel}
        </button>
      ))}
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  iconBg,
  label,
  value,
  okCount,
  okLabel,
  badCount,
  badLabel,
  okColor = "text-emerald-600",
  badColor = "text-amber-600",
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  okCount: number;
  okLabel: string;
  badCount: number;
  badLabel: string;
  okColor?: string;
  badColor?: string;
}) {
  const pct = value > 0 ? Math.round((okCount / value) * 100) : 0;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2.5 text-sm font-bold text-gray-700 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>{icon}</span>
        {label}
      </div>
      <div className="text-3xl font-black text-gray-900 mb-2">{value}</div>
      <div className="text-xs text-gray-500 space-y-0.5 mb-3">
        <div className={`font-semibold ${okColor}`}>{okCount} {okLabel}</div>
        <div className={`font-semibold ${badColor}`}>{badCount} {badLabel}</div>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        <div className="h-full bg-amber-300 rounded-full transition-all" style={{ width: `${100 - pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReadinessDashboard() {
  const [customerFilter, setCustomerFilter] = useState<TabFilter>("all");
  const [cardFilter, setCardFilter] = useState<TabFilter>("all");
  const [teamFilter, setTeamFilter] = useState<TabFilter>("all");

  const tomorrow = getTomorrowLabel();

  // Derived counts
  const confirmedCustomers = MOCK_CUSTOMERS.filter((c) => c.confirmed).length;
  const unconfirmedCustomers = MOCK_CUSTOMERS.filter((c) => !c.confirmed).length;
  const cardsOnHold = MOCK_CARDS.filter((c) => c.status === "on_hold").length;
  const cardsIssue = MOCK_CARDS.filter((c) => c.status !== "on_hold").length;
  const teamsConfirmed = MOCK_TEAMS.filter((t) => t.confirmed).length;
  const teamsPending = MOCK_TEAMS.filter((t) => !t.confirmed).length;
  const totalJobs = MOCK_SCHEDULE.length;

  // Readiness score: weight each dimension equally
  const customerPct = MOCK_CUSTOMERS.length > 0 ? confirmedCustomers / MOCK_CUSTOMERS.length : 1;
  const cardPct = MOCK_CARDS.length > 0 ? cardsOnHold / MOCK_CARDS.length : 1;
  const teamPct = MOCK_TEAMS.length > 0 ? teamsConfirmed / MOCK_TEAMS.length : 1;
  const readinessPct = Math.round(((customerPct + cardPct + teamPct) / 3) * 100);

  const issueCount = unconfirmedCustomers + cardsIssue + teamsPending;

  // Filtered lists
  const filteredCustomers = MOCK_CUSTOMERS.filter((c) => {
    if (customerFilter === "ok") return c.confirmed;
    if (customerFilter === "issues") return !c.confirmed;
    return true;
  });

  const filteredCards = MOCK_CARDS.filter((c) => {
    if (cardFilter === "ok") return c.status === "on_hold";
    if (cardFilter === "issues") return c.status !== "on_hold";
    return true;
  });

  const filteredTeams = MOCK_TEAMS.filter((t) => {
    if (teamFilter === "ok") return t.confirmed;
    if (teamFilter === "issues") return !t.confirmed;
    return true;
  });

  function handleDownloadCSV() {
    toast.success("CSV download coming soon");
  }

  function handleAskMadison() {
    toast.info("Opening Madison…");
  }

  return (
    <AdminPageGuard>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/30">
        <AdminHeader />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <div className="relative bg-white border border-purple-100 rounded-3xl shadow-sm overflow-hidden mb-6 p-8">
            {/* Background blobs */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-purple-100/60 to-transparent rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-1/3 w-48 h-48 bg-gradient-to-tr from-orange-100/40 to-transparent rounded-full translate-y-1/2 pointer-events-none" />

            <div className="relative flex items-center justify-between gap-6 flex-wrap">
              <div>
                <div className="flex items-center gap-2 text-purple-600 font-bold text-sm mb-3">
                  <Sun className="w-4 h-4" />
                  DAILY READINESS
                </div>
                <h1 className="text-4xl font-bold text-gray-900 mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Preparation for Tomorrow
                </h1>
                <p className="text-gray-500 text-sm mb-4">
                  Your customers, payments, teams, and schedule — ready at a glance.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-purple-200 rounded-full text-purple-700 font-bold text-sm shadow-sm">
                  <Calendar className="w-4 h-4" />
                  Tomorrow · {tomorrow}
                </div>
              </div>

              {/* Readiness ring */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative w-36 h-36">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#f3f0ff" strokeWidth="12" />
                    <circle
                      cx="60" cy="60" r="50"
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 50}`}
                      strokeDashoffset={`${2 * Math.PI * 50 * (1 - readinessPct / 100)}`}
                      className="transition-all duration-700"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-gray-900">{readinessPct}%</span>
                    <span className="text-xs text-gray-400 font-medium">ready</span>
                  </div>
                </div>
                {issueCount > 0 && (
                  <div className="flex items-center gap-1.5 text-amber-600 text-xs font-bold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {issueCount} action{issueCount !== 1 ? "s" : ""} needed
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Metric Cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <MetricCard
              icon={<MessageSquare className="w-4 h-4 text-purple-600" />}
              iconBg="bg-purple-50"
              label="Customers Texted"
              value={MOCK_CUSTOMERS.length}
              okCount={confirmedCustomers}
              okLabel="confirmed"
              badCount={unconfirmedCustomers}
              badLabel="not confirmed"
            />
            <MetricCard
              icon={<CreditCard className="w-4 h-4 text-emerald-600" />}
              iconBg="bg-emerald-50"
              label="Cards on Hold"
              value={MOCK_CARDS.length}
              okCount={cardsOnHold}
              okLabel="on hold"
              badCount={cardsIssue}
              badLabel="need attention"
              badColor="text-red-500"
            />
            <MetricCard
              icon={<Users className="w-4 h-4 text-blue-600" />}
              iconBg="bg-blue-50"
              label="Team Confirmations"
              value={MOCK_TEAMS.length}
              okCount={teamsConfirmed}
              okLabel="confirmed"
              badCount={teamsPending}
              badLabel="pending"
            />
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2.5 text-sm font-bold text-gray-700 mb-3">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-orange-50">
                  <Clock className="w-4 h-4 text-orange-500" />
                </span>
                Jobs Scheduled
              </div>
              <div className="text-3xl font-black text-gray-900 mb-2">{totalJobs}</div>
              <div className="text-xs text-gray-500">
                Tomorrow's total jobs<br />across {MOCK_TEAMS.length} teams
              </div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2.5 text-sm font-bold text-gray-700 mb-3">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-50">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                </span>
                Ready to Go
              </div>
              <div className="text-3xl font-black text-gray-900 mb-2">{readinessPct}%</div>
              <div className="text-xs text-gray-500">
                {issueCount} item{issueCount !== 1 ? "s" : ""} still need attention
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${readinessPct}%` }} />
              </div>
            </div>
          </div>

          {/* ── Detail Cards Grid ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">

            {/* Customers */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <MessageSquare className="w-4 h-4 text-purple-500" />
                  Customers Texted
                </div>
                <button
                  className="text-xs font-bold text-purple-600 hover:underline"
                  onClick={() => toast.info("Full customer list coming soon")}
                >
                  View all ({MOCK_CUSTOMERS.length})
                </button>
              </div>
              <div className="px-5 pt-4">
                <SectionTabs
                  filter={customerFilter}
                  setFilter={setCustomerFilter}
                  okLabel={`Confirmed (${confirmedCustomers})`}
                  issueLabel={`Not Confirmed (${unconfirmedCustomers})`}
                />
              </div>
              <div className="px-5 pb-2 divide-y divide-gray-50">
                {filteredCustomers.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-3">
                    <InitialsCircle initials={c.initials} color="purple" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{c.name}</div>
                      <div className="text-xs text-gray-400 truncate">{c.address}</div>
                    </div>
                    <div className="text-xs font-semibold text-gray-500 mr-2">{c.jobTime}</div>
                    <StatusBadge ok={c.confirmed} okLabel="Confirmed" badLabel="Pending" />
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/50">
                <button
                  className="flex items-center gap-2 text-purple-600 font-bold text-sm hover:underline"
                  onClick={() => toast.info("Sending follow-up texts…")}
                >
                  <ChevronRight className="w-4 h-4" /> Send follow-up texts
                </button>
              </div>
            </div>

            {/* Cards */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <CreditCard className="w-4 h-4 text-emerald-500" />
                  Credit Cards on Hold
                </div>
                <button
                  className="text-xs font-bold text-purple-600 hover:underline"
                  onClick={handleDownloadCSV}
                >
                  <Download className="w-3 h-3 inline mr-1" />
                  Download CSV
                </button>
              </div>
              <div className="px-5 pt-4">
                <SectionTabs
                  filter={cardFilter}
                  setFilter={setCardFilter}
                  okLabel={`On Hold (${cardsOnHold})`}
                  issueLabel={`Issues (${cardsIssue})`}
                />
              </div>
              <div className="px-5 pb-2 divide-y divide-gray-50">
                {filteredCards.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-3">
                    <InitialsCircle initials={c.initials} color="green" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{c.name}</div>
                      <div className="text-xs text-gray-400">
                        {c.cardBrand && c.last4 ? `${c.cardBrand} •••• ${c.last4}` : "No card on file"}
                      </div>
                    </div>
                    <CardStatusBadge status={c.status} amountCents={c.amountCents} />
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/50">
                <button
                  className="flex items-center gap-2 text-purple-600 font-bold text-sm hover:underline"
                  onClick={() => toast.info("Sending payment links…")}
                >
                  <ChevronRight className="w-4 h-4" /> Send payment links to missing cards
                </button>
              </div>
            </div>

            {/* Teams */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <Users className="w-4 h-4 text-blue-500" />
                  Team Confirmations
                </div>
                <button
                  className="text-xs font-bold text-purple-600 hover:underline"
                  onClick={() => toast.info("Full team list coming soon")}
                >
                  View all ({MOCK_TEAMS.length})
                </button>
              </div>
              <div className="px-5 pt-4">
                <SectionTabs
                  filter={teamFilter}
                  setFilter={setTeamFilter}
                  okLabel={`Confirmed (${teamsConfirmed})`}
                  issueLabel={`Pending (${teamsPending})`}
                />
              </div>
              <div className="px-5 pb-2 divide-y divide-gray-50">
                {filteredTeams.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-3">
                    <InitialsCircle initials={t.initials} color="blue" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{t.name}</div>
                      <div className="text-xs text-gray-400">{t.jobCount} jobs tomorrow</div>
                    </div>
                    <StatusBadge ok={t.confirmed} okLabel="Confirmed" badLabel="Pending" />
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/50">
                <button
                  className="flex items-center gap-2 text-purple-600 font-bold text-sm hover:underline"
                  onClick={() => toast.info("Sending team reminders…")}
                >
                  <ChevronRight className="w-4 h-4" /> Send team reminders
                </button>
              </div>
            </div>

            {/* Schedule Preview */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                  <Calendar className="w-4 h-4 text-orange-500" />
                  Tomorrow's Schedule Preview
                </div>
                <button
                  className="text-xs font-bold text-purple-600 hover:underline"
                  onClick={() => toast.info("Opening full schedule…")}
                >
                  View full schedule
                </button>
              </div>
              <div className="px-5 py-2 divide-y divide-gray-50">
                {MOCK_SCHEDULE.map((s, idx) => (
                  <div key={s.id} className="flex items-start gap-4 py-3.5 relative">
                    {/* Timeline line */}
                    {idx < MOCK_SCHEDULE.length - 1 && (
                      <div className="absolute left-[27px] top-8 bottom-0 w-0.5 bg-purple-100" />
                    )}
                    <div className="w-14 text-xs font-bold text-gray-500 pt-0.5 flex-shrink-0">{s.time}</div>
                    <div className="relative z-10 w-2.5 h-2.5 rounded-full bg-purple-500 mt-1.5 flex-shrink-0 border-2 border-white shadow" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{s.customerName}</div>
                      <div className="text-xs text-gray-400 truncate">{s.address}</div>
                      <div className="text-xs text-purple-600 font-semibold mt-0.5">{s.teamName}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/50">
                <button
                  className="flex items-center gap-2 text-purple-600 font-bold text-sm hover:underline"
                  onClick={() => toast.info("Opening all jobs…")}
                >
                  <ChevronRight className="w-4 h-4" /> View all {totalJobs} jobs
                </button>
              </div>
            </div>
          </div>

          {/* ── Bottom Banner ─────────────────────────────────────────────── */}
          <div className="bg-gradient-to-r from-purple-50 to-purple-100/50 border border-purple-200 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-purple-700 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                Keep it up! You're <span className="text-purple-900">{readinessPct}% ready</span> for tomorrow.
              </div>
              <p className="text-gray-500 text-xs mt-1">
                Clear the remaining {issueCount} item{issueCount !== 1 ? "s" : ""} to reach 100%.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => toast.info("Refreshing data…")}
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
              <Button
                size="sm"
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                onClick={handleAskMadison}
              >
                <Sparkles className="w-3.5 h-3.5" /> Ask Madison what's next
              </Button>
            </div>
          </div>

        </div>
      </div>
    </AdminPageGuard>
  );
}
