import React, { useMemo, useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import {
  Calendar,
  ChevronDown,
  Search,
  Phone,
  BadgeDollarSign,
  CircleDot,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Target,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// All real lead sources from the DB with distinct colors
const sourceColors: Record<string, string> = {
  "google-ads":          "#7dd3fc", // sky blue
  "form":                "#6ee7b7", // emerald
  "widget":              "#93c5fd", // blue
  "bark-sms":            "#64748b", // slate
  "thumbtack-sms":       "#fdba74", // orange
  "thumbtack":           "#fb923c", // orange-dark
  "cs_initiated":        "#c4b5fd", // violet
  "cs-inbound-cleaner":  "#a78bfa", // purple
  "phone":               "#86efac", // green
  "yelp":                "#fca5a5", // red
  "voice":               "#fcd34d", // amber
  "call":                "#f9a8d4", // pink
  "email":               "#67e8f9", // cyan
  "other":               "#cbd5e1", // slate-light
};

// Human-readable labels for each source key
const sourceLabels: Record<string, string> = {
  "google-ads":          "Google Ads",
  "form":                "Form",
  "widget":              "Widget",
  "bark-sms":            "Bark SMS",
  "thumbtack-sms":       "Thumbtack SMS",
  "thumbtack":           "Thumbtack",
  "cs_initiated":        "CS Initiated",
  "cs-inbound-cleaner":  "CS Inbound",
  "phone":               "Phone",
  "yelp":                "Yelp",
  "voice":               "Voice",
  "call":                "Call",
  "email":               "Email",
  "other":               "Other",
};

const ALL_SOURCES = Object.keys(sourceColors);

const label = (src: string) => sourceLabels[src] ?? src;

interface LeadRow {
  id: number;
  source: string;
  lead: string;
  date: string;
  amount: number;
  status: string;
  booking: boolean;
}

// Placeholder data — will be replaced with real tRPC query
const leadData: LeadRow[] = [
  { id: 1,  source: "google-ads",         lead: "Josh Bornstein",   date: "2026-04-21", amount: 594, status: "Open",   booking: false },
  { id: 2,  source: "form",               lead: "Form Lead",        date: "2026-04-21", amount: 149, status: "Quoted", booking: false },
  { id: 3,  source: "thumbtack-sms",      lead: "Laurie Swindull",  date: "2026-04-20", amount: 129, status: "Booked", booking: true  },
  { id: 4,  source: "phone",              lead: "Nnenna Omukwe",    date: "2026-04-20", amount: 270, status: "Booked", booking: true  },
  { id: 5,  source: "yelp",               lead: "Cam Harris",       date: "2026-04-19", amount: 325, status: "Booked", booking: true  },
  { id: 6,  source: "thumbtack",          lead: "Mia Thomas",       date: "2026-04-19", amount: 210, status: "Quoted", booking: false },
  { id: 7,  source: "bark-sms",           lead: "Angela Reed",      date: "2026-04-18", amount: 188, status: "Booked", booking: true  },
  { id: 8,  source: "widget",             lead: "Trevor Hall",      date: "2026-04-18", amount: 420, status: "Booked", booking: true  },
  { id: 9,  source: "email",              lead: "Sara King",        date: "2026-04-17", amount: 155, status: "Open",   booking: false },
  { id: 10, source: "google-ads",         lead: "Dana Scott",       date: "2026-04-17", amount: 305, status: "Booked", booking: true  },
  { id: 11, source: "yelp",               lead: "Marcus Webb",      date: "2026-04-16", amount: 415, status: "Booked", booking: true  },
  { id: 12, source: "cs_initiated",       lead: "Ariel Young",      date: "2026-04-16", amount: 165, status: "Open",   booking: false },
  { id: 13, source: "voice",              lead: "Sam Patel",        date: "2026-04-15", amount: 360, status: "Booked", booking: true  },
  { id: 14, source: "cs-inbound-cleaner", lead: "Monica Price",     date: "2026-04-15", amount: 205, status: "Quoted", booking: false },
  { id: 15, source: "call",               lead: "Lee Watson",       date: "2026-04-14", amount: 255, status: "Booked", booking: true  },
  { id: 16, source: "google-ads",         lead: "Jill Carter",      date: "2026-04-14", amount: 190, status: "Booked", booking: true  },
];

const presets: Record<string, { label: string; days: number | null }> = {
  "7d": { label: "Last 7 days", days: 7 },
  "14d": { label: "Last 14 days", days: 14 },
  "30d": { label: "Last 30 days", days: 30 },
  all: { label: "All time", days: null },
};

const fmtMoney = (n: number) => `$${n.toLocaleString()}`;

export default function Performance() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [datePreset, setDatePreset] = useState("14d");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [view, setView] = useState("source");
  const [search, setSearch] = useState("");

  const filteredLeads = useMemo(() => {
    const today = new Date("2026-04-21T23:59:59");
    const preset = presets[datePreset];

    return leadData.filter((row) => {
      const rowDate = new Date(row.date + "T12:00:00");
      const matchesDate =
        preset.days === null
          ? true
          : (today.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24) <= preset.days;

      const matchesSource = sourceFilter === "all" ? true : row.source === sourceFilter;
      const q = search.toLowerCase();
      const matchesSearch =
        row.lead.toLowerCase().includes(q) ||
        row.source.toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q);

      return matchesDate && matchesSource && matchesSearch;
    });
  }, [datePreset, sourceFilter, search]);

  const summary = useMemo(() => {
    const totalLeads = filteredLeads.length;
    const bookings = filteredLeads.filter((x) => x.booking).length;
    const bookedRevenue = filteredLeads.filter((x) => x.booking).reduce((sum, x) => sum + x.amount, 0);
    const totalQuoted = filteredLeads.reduce((sum, x) => sum + x.amount, 0);
    const conversion = totalLeads ? Math.round((bookings / totalLeads) * 100) : 0;
    return { totalLeads, bookings, bookedRevenue, totalQuoted, conversion };
  }, [filteredLeads]);

  const bySource = useMemo(() => {
    const grouped: Record<string, { source: string; leads: number; bookings: number; amount: number; quoted: number }> = {};
    for (const row of filteredLeads) {
      if (!grouped[row.source]) {
        grouped[row.source] = { source: row.source, leads: 0, bookings: 0, amount: 0, quoted: 0 };
      }
      grouped[row.source].leads += 1;
      grouped[row.source].quoted += row.amount;
      if (row.booking) {
        grouped[row.source].bookings += 1;
        grouped[row.source].amount += row.amount;
      }
    }

    return Object.values(grouped)
      .map((row) => ({
        ...row,
        closeRate: row.leads ? Math.round((row.bookings / row.leads) * 100) : 0,
        revenuePerLead: row.leads ? Math.round(row.amount / row.leads) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredLeads]);

  const pieData = bySource.map((row) => ({ name: row.source, value: row.bookings || 0 }));

  return (
    <AdminPageGuard pageId="performance">
    <div className="hj-theme min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
      <AdminHeader activeTab="performance" pagePermissions={pagePermissions} isAdmin={isAdmin} />
    <div className="bg-[#f6f7f3] p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-500">Leads analytics</div>
            <h1 className="text-3xl font-semibold tracking-tight">Lead Source Performance</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Track leads by source, bookings, booked amount, and close rate with date filtering.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search lead or source..."
                className="h-11 rounded-2xl border-white/80 bg-white pl-10 shadow-sm"
              />
            </div>

            <Select value={datePreset} onValueChange={setDatePreset}>
              <SelectTrigger className="h-11 w-[180px] rounded-2xl border-white/80 bg-white shadow-sm">
                <Calendar className="mr-2 h-4 w-4 text-slate-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-11 w-[200px] rounded-2xl border-white/80 bg-white shadow-sm">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {ALL_SOURCES.map((src) => (
                  <SelectItem key={src} value={src}>{label(src)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={CircleDot} label="Leads" value={summary.totalLeads} sub="Filtered total" />
          <MetricCard icon={CheckCircle2} label="Bookings" value={summary.bookings} sub={`${summary.conversion}% close rate`} />
          <MetricCard icon={BadgeDollarSign} label="Booked amount" value={fmtMoney(summary.bookedRevenue)} sub="Revenue from booked leads" />
          <MetricCard icon={Target} label="Quoted amount" value={fmtMoney(summary.totalQuoted)} sub="All lead values" />
          <MetricCard
            icon={TrendingUp}
            label="Revenue / lead"
            value={fmtMoney(summary.totalLeads ? Math.round(summary.bookedRevenue / summary.totalLeads) : 0)}
            sub="Booked amount divided by leads"
          />
        </div>

        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="inline-flex rounded-2xl bg-white p-1 shadow-sm">
            <button
              onClick={() => setView("source")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                view === "source" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              By source
            </button>
            <button
              onClick={() => setView("lead")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                view === "lead" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Lead log
            </button>
          </div>

          <Button variant="outline" className="rounded-2xl border-white/80 bg-white shadow-sm">
            Export
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-[28px] border-white/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl tracking-tight">
                {view === "source" ? "Source breakdown" : "Lead log"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {view === "source" ? (
                <div className="space-y-4">
                  <div className="h-[310px] rounded-[24px] bg-[#fafaf8] p-3 ring-1 ring-slate-100">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bySource}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="source" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(15,23,42,0.04)" }}
                          contentStyle={{ borderRadius: 16, border: "1px solid #e5e7eb" }}
                        />
                        <Bar dataKey="bookings" radius={[10, 10, 0, 0]} fill="#86efac" name="Bookings" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-slate-100">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Leads</TableHead>
                          <TableHead className="text-right">Bookings</TableHead>
                          <TableHead className="text-right">Close rate</TableHead>
                          <TableHead className="text-right">Booked amount</TableHead>
                          <TableHead className="text-right">/ Lead</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bySource.map((row) => (
                          <TableRow key={row.source}>
                            <TableCell>
                              <div className="flex items-center gap-3 font-medium">
                                <span
                                  className="h-3 w-3 rounded-full"
                                  style={{ backgroundColor: sourceColors[row.source] || "#cbd5e1" }}
                                />
                                {label(row.source)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{row.leads}</TableCell>
                            <TableCell className="text-right">{row.bookings}</TableCell>
                            <TableCell className="text-right">{row.closeRate}%</TableCell>
                            <TableCell className="text-right font-semibold">{fmtMoney(row.amount)}</TableCell>
                            <TableCell className="text-right text-slate-500">{fmtMoney(row.revenuePerLead)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[24px] border border-slate-100">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                        <TableHead>Lead</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLeads.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                                {row.lead.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                              </div>
                              <div>
                                <div className="font-medium">{row.lead}</div>
                                <div className="text-xs text-slate-500">Lead #{row.id}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{label(row.source)}</TableCell>
                          <TableCell>{row.date}</TableCell>
                          <TableCell>
                            <Badge
                              className={
                                row.booking
                                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-700 hover:bg-slate-100"
                              }
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{fmtMoney(row.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-[28px] border-white/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl tracking-tight">Bookings share</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={92}
                        paddingAngle={4}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={sourceColors[entry.name] || "#cbd5e1"} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 16, border: "1px solid #e5e7eb" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 space-y-2">
                  {bySource.slice(0, 5).map((row) => (
                    <div
                      key={row.source}
                      className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: sourceColors[row.source] || "#cbd5e1" }}
                        />
                        <span className="font-medium">{label(row.source)}</span>
                      </div>
                      <div className="text-sm text-slate-500">{row.bookings} bookings</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-white/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                  <Sparkles className="h-5 w-5" />
                  Best performing source
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bySource[0] ? (
                  <div className="rounded-[24px] bg-slate-50 p-4 ring-1 ring-slate-100">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-lg font-semibold">{label(bySource[0].source)}</div>
                      <Button size="sm" variant="outline" className="rounded-xl bg-white">
                        Drill in
                        <ArrowUpRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <MiniStat label="Leads" value={String(bySource[0].leads)} />
                      <MiniStat label="Bookings" value={String(bySource[0].bookings)} />
                      <MiniStat label="Close rate" value={`${bySource[0].closeRate}%`} />
                      <MiniStat label="Booked amount" value={fmtMoney(bySource[0].amount)} />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">No data in this filter range.</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-white/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                  <BarChart3 className="h-5 w-5" />
                  What this page shows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-slate-600">
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">Leads by source</div>
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">Bookings per source</div>
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">Booked amount and quoted amount</div>
                  <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">Date filter + source filter + lead log</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
    </div>
    </AdminPageGuard>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <Card className="rounded-[24px] border-white/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <div className="text-sm font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
          <div className="mt-1 text-sm text-slate-400">{sub}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-2 text-base font-semibold text-slate-800">{value}</div>
    </div>
  );
}
