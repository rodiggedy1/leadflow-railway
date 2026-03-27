/**
 * ReviewTracker — /admin/review-tracker
 *
 * Three-section admin page:
 *   1. Team Leaderboard — per-team cards with avg rating, funnel %, total jobs
 *   2. Funnel Table — per-job rows with sort/filter (date, customer, team, rating, chips, draft, copied)
 *   3. SMS Reply Drawer — expandable per-row panel showing all inbound client SMS replies
 */
import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Star,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Copy,
  CheckCircle2,
  Circle,
  Filter,
  TrendingUp,
  Users,
  BarChart3,
  Loader2,
  X,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

// ── Types ─────────────────────────────────────────────────────────────────────
type SmsReply = {
  body: string;
  receivedAt: Date;
  senderType: string;
};

type ReviewRow = {
  id: number;
  jobDate: string | null;
  customerName: string | null;
  customerPhone: string | null;
  teamName: string | null;
  cleanerName: string | null;
  serviceType: string | null;
  customerRating: number | null;
  reviewChipsSelected: string | null;
  reviewDraftPicked: number | null;
  reviewCopied: number;
  trackerToken: string | null;
  jobAddress: string | null;
  updatedAt: Date;
  smsReplies: SmsReply[];
};

type TeamStat = {
  teamName: string;
  totalJobs: number;
  avgRating: number;
  fiveStarCount: number;
  fourStarCount: number;
  lowRatingCount: number;
  fiveStarPct: number;
  funnelPct: number;
  chipsCount: number;
  draftPickedCount: number;
  copiedCount: number;
};

type SortField = "jobDate" | "customerName" | "teamName" | "customerRating";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────
function StarDisplay({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-300 text-sm">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${
            i <= rating ? "fill-amber-400 text-amber-400" : "text-gray-200"
          }`}
        />
      ))}
      <span className="ml-1 text-xs font-semibold text-gray-600">{rating}</span>
    </div>
  );
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (!rating) return null;
  if (rating >= 5)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
        <Star className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" />5
      </span>
    );
  if (rating === 4)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
        <Star className="w-2.5 h-2.5 fill-blue-500 text-blue-500" />4
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
      <Star className="w-2.5 h-2.5 fill-red-400 text-red-400" />
      {rating}
    </span>
  );
}

function FunnelDots({
  chips,
  draft,
  copied,
}: {
  chips: boolean;
  draft: boolean;
  copied: boolean;
}) {
  const dot = (active: boolean, label: string) => (
    <span
      title={label}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border ${
        active
          ? "bg-[#E8735A] text-white border-[#E8735A]"
          : "bg-gray-100 text-gray-300 border-gray-200"
      }`}
    >
      {active ? "✓" : "·"}
    </span>
  );
  return (
    <div className="flex items-center gap-1">
      {dot(chips, "Chips selected")}
      {dot(draft, "Draft picked")}
      {dot(copied, "Copied")}
    </div>
  );
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(day, 10)}, ${y}`;
}

function formatTime(d: Date) {
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Team Leaderboard Card ─────────────────────────────────────────────────────
function TeamCard({ stat, rank }: { stat: TeamStat; rank: number }) {
  const rankColors = ["text-amber-500", "text-gray-400", "text-orange-400"];
  const rankLabels = ["🥇", "🥈", "🥉"];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-lg leading-none ${rankColors[rank] ?? "text-gray-400"}`}>
            {rankLabels[rank] ?? `#${rank + 1}`}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{stat.teamName}</p>
            <p className="text-xs text-gray-400">{stat.totalJobs} rated job{stat.totalJobs !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
          <span className="text-lg font-bold text-gray-900">{stat.avgRating.toFixed(1)}</span>
        </div>
      </div>

      {/* Rating breakdown bar */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 w-8 shrink-0">5★</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all"
              style={{ width: `${stat.fiveStarPct}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-gray-600 w-8 text-right">{stat.fiveStarPct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 w-8 shrink-0">4★</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400 rounded-full transition-all"
              style={{
                width: `${stat.totalJobs > 0 ? Math.round((stat.fourStarCount / stat.totalJobs) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="text-[11px] font-medium text-gray-600 w-8 text-right">
            {stat.totalJobs > 0 ? Math.round((stat.fourStarCount / stat.totalJobs) * 100) : 0}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 w-8 shrink-0">≤3★</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-400 rounded-full transition-all"
              style={{
                width: `${stat.totalJobs > 0 ? Math.round((stat.lowRatingCount / stat.totalJobs) * 100) : 0}%`,
              }}
            />
          </div>
          <span className="text-[11px] font-medium text-gray-600 w-8 text-right">
            {stat.totalJobs > 0 ? Math.round((stat.lowRatingCount / stat.totalJobs) * 100) : 0}%
          </span>
        </div>
      </div>

      {/* Review funnel */}
      <div className="pt-2 border-t border-gray-50">
        <p className="text-[11px] text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Review Funnel</p>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${stat.chipsCount > 0 ? "bg-[#E8735A]" : "bg-gray-200"}`} />
            <span className="text-gray-500">Chips</span>
            <span className="font-semibold text-gray-800">{stat.chipsCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${stat.draftPickedCount > 0 ? "bg-[#E8735A]" : "bg-gray-200"}`} />
            <span className="text-gray-500">Draft</span>
            <span className="font-semibold text-gray-800">{stat.draftPickedCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${stat.copiedCount > 0 ? "bg-emerald-500" : "bg-gray-200"}`} />
            <span className="text-gray-500">Copied</span>
            <span className="font-semibold text-gray-800">{stat.copiedCount}</span>
          </div>
          <div className="ml-auto">
            <span className={`text-xs font-bold ${stat.funnelPct >= 30 ? "text-emerald-600" : stat.funnelPct >= 10 ? "text-amber-600" : "text-gray-400"}`}>
              {stat.funnelPct}% copy rate
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SMS Reply Thread ──────────────────────────────────────────────────────────
function SmsReplyThread({ replies }: { replies: SmsReply[] }) {
  if (replies.length === 0) {
    return (
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 italic">
        No SMS replies from this customer yet.
      </div>
    );
  }
  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Customer SMS Replies ({replies.length})
      </p>
      {replies.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-full bg-[#E8735A]/10 flex items-center justify-center shrink-0 mt-0.5">
            <MessageSquare className="w-3 h-3 text-[#E8735A]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-800 leading-relaxed">{r.body}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{formatTime(r.receivedAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReviewTracker() {
  const { user } = useAuth();
  const isAdmin = (user as unknown as { isAdmin?: boolean } | null)?.isAdmin ?? false;
  const userAny = user as unknown as Record<string, unknown> | null;
  const pagePermissions = userAny?.pagePermissions
    ? JSON.parse(userAny.pagePermissions as string)
    : null;

  // ── Filters ──────────────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterFunnel, setFilterFunnel] = useState<string>("all"); // "all" | "chips" | "draft" | "copied" | "replied"
  const [searchText, setSearchText] = useState("");

  // ── Sort ─────────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField>("jobDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Expanded rows ─────────────────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // ── Data fetch ────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = trpc.tracker.getReviewAnalytics.useQuery(
    { from: fromDate, to: toDate },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );

  // ── Derived data ──────────────────────────────────────────────────────────
  const allTeams = useMemo(() => {
    if (!data?.rows) return [];
    const s = new Set(data.rows.map((r) => r.teamName ?? r.cleanerName ?? "Unknown"));
    return Array.from(s).sort();
  }, [data?.rows]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let rows = data.rows as ReviewRow[];

    if (filterTeam !== "all") {
      rows = rows.filter((r) => (r.teamName ?? r.cleanerName ?? "Unknown") === filterTeam);
    }
    if (filterRating !== "all") {
      const ratingNum = parseInt(filterRating, 10);
      rows = rows.filter((r) => r.customerRating === ratingNum);
    }
    if (filterFunnel === "chips") rows = rows.filter((r) => !!r.reviewChipsSelected);
    else if (filterFunnel === "draft") rows = rows.filter((r) => !!r.reviewDraftPicked);
    else if (filterFunnel === "copied") rows = rows.filter((r) => r.reviewCopied === 1);
    else if (filterFunnel === "replied") rows = rows.filter((r) => r.smsReplies.length > 0);
    else if (filterFunnel === "no_reply") rows = rows.filter((r) => r.smsReplies.length === 0);

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.customerName?.toLowerCase().includes(q) ||
          r.teamName?.toLowerCase().includes(q) ||
          r.cleanerName?.toLowerCase().includes(q) ||
          r.jobAddress?.toLowerCase().includes(q)
      );
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortField === "jobDate") { av = a.jobDate; bv = b.jobDate; }
      else if (sortField === "customerName") { av = a.customerName; bv = b.customerName; }
      else if (sortField === "teamName") { av = a.teamName ?? a.cleanerName; bv = b.teamName ?? b.cleanerName; }
      else if (sortField === "customerRating") { av = a.customerRating; bv = b.customerRating; }

      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [data?.rows, filterTeam, filterRating, filterFunnel, searchText, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  function toggleRow(id: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-[#E8735A] ml-0.5">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalRated = data?.rows.length ?? 0;
  const totalCopied = data?.rows.filter((r) => r.reviewCopied).length ?? 0;
  const totalReplied = data?.rows.filter((r) => r.smsReplies.length > 0).length ?? 0;
  const avgRating =
    totalRated > 0
      ? (data!.rows.reduce((s, r) => s + (r.customerRating ?? 0), 0) / totalRated).toFixed(1)
      : "—";

  return (
    <AdminPageGuard pageId="review-tracker">
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activeTab="review-tracker" pagePermissions={pagePermissions} isAdmin={isAdmin} />

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">

          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Review & Engagement Tracker</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Track review funnel performance and customer SMS engagement per team.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2 text-xs"
            >
              <Loader2 className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* ── Summary stat pills ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Ratings received", value: totalRated, icon: <Star className="w-4 h-4 text-amber-500" /> },
              { label: "Avg rating", value: avgRating, icon: <TrendingUp className="w-4 h-4 text-blue-500" /> },
              { label: "Reviews copied", value: totalCopied, icon: <Copy className="w-4 h-4 text-emerald-500" /> },
              { label: "SMS replies", value: totalReplied, icon: <MessageSquare className="w-4 h-4 text-[#E8735A]" /> },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  {s.icon}
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900 leading-none">{s.value}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Date range filter ───────────────────────────────────────── */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <span className="text-gray-400 text-xs font-medium">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="text-sm text-gray-800 bg-transparent outline-none"
              />
              <span className="text-gray-300">→</span>
              <span className="text-gray-400 text-xs font-medium">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="text-sm text-gray-800 bg-transparent outline-none"
              />
            </div>
            <Button
              size="sm"
              className="bg-[#E8735A] hover:bg-[#d4614a] text-white text-xs"
              onClick={() => refetch()}
            >
              Apply
            </Button>
          </div>

          {/* ── Team Leaderboard ────────────────────────────────────────── */}
          {data?.teamStats && data.teamStats.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Team Leaderboard
                </h2>
                <span className="text-xs text-gray-400">({data.teamStats.length} team{data.teamStats.length !== 1 ? "s" : ""})</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {data.teamStats.map((stat, i) => (
                  <TeamCard key={stat.teamName} stat={stat} rank={i} />
                ))}
              </div>
            </section>
          )}

          {/* ── Funnel Table ────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <BarChart3 className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Review Funnel
              </h2>
              <span className="text-xs text-gray-400">({filteredRows.length} of {totalRated} jobs)</span>

              {/* Filters */}
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Input
                    placeholder="Search customer, team, address…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="h-8 text-xs w-52 pl-7"
                  />
                  <Filter className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  {searchText && (
                    <button onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                      <X className="w-3 h-3 text-gray-400" />
                    </button>
                  )}
                </div>

                <Select value={filterTeam} onValueChange={setFilterTeam}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {allTeams.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterRating} onValueChange={setFilterRating}>
                  <SelectTrigger className="h-8 text-xs w-28">
                    <SelectValue placeholder="All ratings" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All ratings</SelectItem>
                    {[5, 4, 3, 2, 1].map((r) => (
                      <SelectItem key={r} value={String(r)}>{r} star{r !== 1 ? "s" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterFunnel} onValueChange={setFilterFunnel}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue placeholder="All stages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stages</SelectItem>
                    <SelectItem value="chips">Selected chips</SelectItem>
                    <SelectItem value="draft">Picked draft</SelectItem>
                    <SelectItem value="copied">Copied review</SelectItem>
                    <SelectItem value="replied">Has SMS reply</SelectItem>
                    <SelectItem value="no_reply">No SMS reply</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading reviews…</span>
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Star className="w-8 h-8 mb-2 text-gray-200" />
                  <p className="text-sm font-medium">No reviews match your filters</p>
                  <p className="text-xs mt-1">Try adjusting the date range or clearing filters.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <th
                          className="text-left text-xs font-semibold text-gray-500 px-4 py-3 cursor-pointer hover:text-gray-700 whitespace-nowrap"
                          onClick={() => toggleSort("jobDate")}
                        >
                          Date <SortIcon field="jobDate" />
                        </th>
                        <th
                          className="text-left text-xs font-semibold text-gray-500 px-4 py-3 cursor-pointer hover:text-gray-700 whitespace-nowrap"
                          onClick={() => toggleSort("customerName")}
                        >
                          Customer <SortIcon field="customerName" />
                        </th>
                        <th
                          className="text-left text-xs font-semibold text-gray-500 px-4 py-3 cursor-pointer hover:text-gray-700 whitespace-nowrap"
                          onClick={() => toggleSort("teamName")}
                        >
                          Team <SortIcon field="teamName" />
                        </th>
                        <th
                          className="text-left text-xs font-semibold text-gray-500 px-4 py-3 cursor-pointer hover:text-gray-700 whitespace-nowrap"
                          onClick={() => toggleSort("customerRating")}
                        >
                          Rating <SortIcon field="customerRating" />
                        </th>
                        <th className="text-left text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">
                          Chips
                        </th>
                        <th className="text-center text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">
                          Funnel
                        </th>
                        <th className="text-center text-xs font-semibold text-gray-500 px-4 py-3 whitespace-nowrap">
                          Replies
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredRows.map((row) => {
                        const isExpanded = expandedRows.has(row.id);
                        const hasReplies = row.smsReplies.length > 0;
                        const teamDisplay = row.teamName ?? row.cleanerName ?? "—";
                        const chips = row.reviewChipsSelected
                          ? row.reviewChipsSelected.split(",").map((c) => c.trim()).filter(Boolean)
                          : [];

                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              className={`hover:bg-gray-50/70 transition-colors ${isExpanded ? "bg-orange-50/30" : ""}`}
                            >
                              {/* Date */}
                              <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                                {formatDate(row.jobDate)}
                              </td>

                              {/* Customer */}
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs font-medium text-gray-900">
                                    {row.customerName ?? "Unknown"}
                                  </span>
                                  {row.jobAddress && (
                                    <span className="text-[10px] text-gray-400 truncate max-w-[160px]">
                                      {row.jobAddress}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Team */}
                              <td className="px-4 py-3">
                                <span className="text-xs font-medium text-gray-700">{teamDisplay}</span>
                              </td>

                              {/* Rating */}
                              <td className="px-4 py-3">
                                <RatingBadge rating={row.customerRating} />
                              </td>

                              {/* Chips */}
                              <td className="px-4 py-3">
                                {chips.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                                    {chips.slice(0, 3).map((c) => (
                                      <span
                                        key={c}
                                        className="inline-block text-[10px] bg-orange-50 text-orange-700 border border-orange-100 rounded-full px-1.5 py-0.5 whitespace-nowrap"
                                      >
                                        {c}
                                      </span>
                                    ))}
                                    {chips.length > 3 && (
                                      <span className="text-[10px] text-gray-400">+{chips.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>

                              {/* Funnel dots */}
                              <td className="px-4 py-3 text-center">
                                <FunnelDots
                                  chips={!!row.reviewChipsSelected}
                                  draft={!!row.reviewDraftPicked}
                                  copied={row.reviewCopied === 1}
                                />
                              </td>

                              {/* Replies */}
                              <td className="px-4 py-3 text-center">
                                {hasReplies ? (
                                  <button
                                    onClick={() => toggleRow(row.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E8735A] hover:underline"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    {row.smsReplies.length}
                                  </button>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>

                              {/* Expand toggle */}
                              <td className="px-2 py-3">
                                <button
                                  onClick={() => toggleRow(row.id)}
                                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                  title={isExpanded ? "Collapse" : "Expand SMS replies"}
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded SMS reply thread */}
                            {isExpanded && (
                              <tr key={`${row.id}-replies`}>
                                <td colSpan={8} className="p-0">
                                  <SmsReplyThread replies={row.smsReplies} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AdminPageGuard>
  );
}
