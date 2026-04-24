import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";

const Icon = ({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) => {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  const paths: Record<string, React.ReactNode> = {
    activity: <><path d="M22 12h-4l-3 8L9 4l-3 8H2" /></>,
    down: <><path d="M7 7h10v10" /><path d="M7 17 17 7" /></>,
    up: <><path d="M7 17h10V7" /><path d="M7 7l10 10" /></>,
    calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 10h18" /></>,
    chevron: <><path d="m6 9 6 6 6-6" /></>,
    dollar: <><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
    filter: <><path d="M22 3H2l8 9v7l4 2v-9l8-9z" /></>,
    flame: <><path d="M8.5 14.5A4.5 4.5 0 0 0 12 22a4.5 4.5 0 0 0 3.5-7.5c-1.5-1.8-1.2-3.8-.2-5.5-2.4.7-4.2 2.1-4.8 4.6-.7-1-1.1-2.3-.9-3.6-2.1 1.4-3.4 3.2-3.4 5.5" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-4 4" /></>,
    click: <><path d="M3 3l7.5 18 2.5-7 7-2.5L3 3z" /><path d="m13 13 6 6" /></>,
    phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.4-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z" /></>,
    pie: <><path d="M21 12a9 9 0 1 1-9-9v9z" /><path d="M12 3a9 9 0 0 1 9 9h-9z" /></>,
    refresh: <><path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" /><path d="M3 16v5h5" /><path d="M3 12A9 9 0 0 1 18.5 5.6L21 8" /><path d="M21 8V3h-5" /></>,
    search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
    sparkles: <><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></>,
    star: <><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1L12 2z" /></>,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
    wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h12" /><path d="M20 7v14H5a2 2 0 0 1-2-2V5" /><path d="M16 12h4" /></>,
  };
  return <svg {...common}>{paths[name] || paths.activity}</svg>;
};

// ── Static placeholder data (will be replaced with live DB data) ─────────────
const monthly = [
  { month: "Jan", revenue: 84200, leads: 418, booked: 96, jobs: 214, recurring: 42, conv: 23, avg: 393 },
  { month: "Feb", revenue: 91300, leads: 456, booked: 114, jobs: 236, recurring: 49, conv: 25, avg: 401 },
  { month: "Mar", revenue: 101900, leads: 502, booked: 131, jobs: 269, recurring: 58, conv: 26, avg: 389 },
  { month: "Apr", revenue: 119400, leads: 574, booked: 157, jobs: 311, recurring: 71, conv: 27, avg: 407 },
  { month: "May", revenue: 132800, leads: 621, booked: 176, jobs: 347, recurring: 86, conv: 28, avg: 415 },
  { month: "Jun", revenue: 151600, leads: 690, booked: 207, jobs: 392, recurring: 104, conv: 30, avg: 421 },
  { month: "Jul", revenue: 164900, leads: 734, booked: 225, jobs: 421, recurring: 119, conv: 31, avg: 428 },
  { month: "Aug", revenue: 173200, leads: 762, booked: 239, jobs: 449, recurring: 133, conv: 31, avg: 432 },
  { month: "Sep", revenue: 189600, leads: 824, booked: 268, jobs: 486, recurring: 151, conv: 33, avg: 438 },
  { month: "Oct", revenue: 204300, leads: 881, booked: 297, jobs: 522, recurring: 169, conv: 34, avg: 441 },
  { month: "Nov", revenue: 216700, leads: 928, booked: 321, jobs: 551, recurring: 184, conv: 35, avg: 446 },
  { month: "Dec", revenue: 238900, leads: 1004, booked: 362, jobs: 604, recurring: 211, conv: 36, avg: 452 },
];

const sources = [
  { source: "Google Ads", leads: 326, booked: 96, revenue: 58200, cpl: 31, cac: 104, roas: 5.8 },
  { source: "Google Maps", leads: 274, booked: 91, revenue: 52700, cpl: 0, cac: 0, roas: 0 },
  { source: "Yelp", leads: 212, booked: 54, revenue: 31900, cpl: 42, cac: 165, roas: 3.6 },
  { source: "Thumbtack", leads: 168, booked: 39, revenue: 21400, cpl: 38, cac: 164, roas: 3.2 },
  { source: "Referrals", leads: 104, booked: 52, revenue: 36700, cpl: 0, cac: 0, roas: 0 },
];

const funnel = [
  { step: "Leads", value: 1004, pct: 100 },
  { step: "Reached", value: 841, pct: 84 },
  { step: "Quoted", value: 612, pct: 61 },
  { step: "Booked", value: 362, pct: 36 },
  { step: "Completed", value: 336, pct: 33 },
  { step: "Recurring", value: 91, pct: 9 },
];

const quality = [
  { label: "On-time arrival", value: 94 },
  { label: "5-star jobs", value: 88 },
  { label: "Photo compliance", value: 97 },
  { label: "Rebook rate", value: 31 },
];

const alerts = [
  { title: "Yelp conversion dipped", detail: "Down 4.8% vs last 30 days. Response time is 11 min slower.", type: "warning" },
  { title: "Recurring revenue accelerating", detail: "+$18.4k MRR from 42 new recurring plans this month.", type: "win" },
  { title: "Google Maps is highest margin", detail: "33% booking rate with no direct ad spend. Push review requests this week.", type: "insight" },
];

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function MetricCard({ title, value, change, icon, tone = "blue", sub }: {
  title: string; value: string; change: string; icon: string; tone?: string; sub: string;
}) {
  const positive = change?.startsWith("+");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
          <p className="mt-1 text-sm text-slate-500">{sub}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone === "green" ? "bg-emerald-50 text-emerald-600" : tone === "orange" ? "bg-orange-50 text-orange-600" : tone === "purple" ? "bg-violet-50 text-violet-600" : "bg-blue-50 text-blue-600"}`}>
          <Icon name={icon} size={22} />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-sm">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {positive ? <Icon name="up" size={14} /> : <Icon name="down" size={14} />}
          {change}
        </span>
        <span className="text-slate-500">vs previous period</span>
      </div>
    </motion.div>
  );
}

function ChartCard({ title, subtitle, children, action }: {
  title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="h-72">{children}</div>
    </div>
  );
}

export default function Metrics() {
  const [range, setRange] = useState("12 months");
  const [selectedSource, setSelectedSource] = useState("All sources");
  const latest = monthly[monthly.length - 1];

  const totals = useMemo(() => {
    const revenue = monthly.reduce((s, m) => s + m.revenue, 0);
    const leads = monthly.reduce((s, m) => s + m.leads, 0);
    const booked = monthly.reduce((s, m) => s + m.booked, 0);
    return { revenue, leads, booked, conversion: Math.round((booked / leads) * 100) };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
              <Icon name="sparkles" size={16} /> Performance
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Metrics</h1>
            <p className="mt-1 text-sm text-slate-500">Revenue, leads, bookings, conversion, source ROI, quality, and recurring growth.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm md:flex">
              <Icon name="search" size={16} /> Search metrics
            </button>
            <button className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm">
              <Icon name="download" size={16} /> Export
            </button>
            <button className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
              <Icon name="refresh" size={16} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Range + filter bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {["Today", "7 days", "30 days", "90 days", "12 months"].map((item) => (
              <button
                key={item}
                onClick={() => setRange(item)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${range === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
              <Icon name="calendar" size={16} /> Custom dates
            </button>
            <button className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
              <Icon name="filter" size={16} /> {selectedSource} <Icon name="chevron" size={16} />
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Total revenue" value={money(totals.revenue)} change="+28.7%" sub={`${money(latest.revenue)} this month`} icon="dollar" tone="green" />
          <MetricCard title="Lead volume" value={totals.leads.toLocaleString()} change="+19.4%" sub={`${latest.leads} new leads this month`} icon="users" tone="blue" />
          <MetricCard title="Booking conversion" value={`${totals.conversion}%`} change="+5.1%" sub={`${latest.booked} bookings this month`} icon="target" tone="purple" />
          <MetricCard title="Avg job value" value={money(latest.avg)} change="+7.8%" sub="Includes one-time + recurring" icon="wallet" tone="orange" />
        </section>

        {/* Revenue + funnel */}
        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ChartCard
              title="Revenue, leads, and bookings over time"
              subtitle="The core growth picture: demand, sales efficiency, and revenue expansion."
              action={<span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">Healthy growth</span>}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value: number, name: string) => name === "revenue" ? money(value) : value} />
                  <Legend />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" fillOpacity={0.14} strokeWidth={3} />
                  <Bar yAxisId="right" dataKey="leads" radius={[8, 8, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="booked" strokeWidth={3} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <ChartCard
            title="Sales funnel"
            subtitle="Where money is leaking from lead to recurring customer."
            action={<Icon name="pie" size={18} className="text-slate-400" />}
          >
            <div className="space-y-4 pt-1">
              {funnel.map((item) => (
                <div key={item.step}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">{item.step}</span>
                    <span className="text-slate-500">{item.value} · {item.pct}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${item.pct}%` }} className="h-full rounded-full bg-slate-950" />
                  </div>
                </div>
              ))}
            </div>
          </ChartCard>
        </section>

        {/* Conversion + recurring */}
        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title="Conversion rate over time"
            subtitle="Track if sales process is improving or lead quality is falling."
            action={<Icon name="chart" size={18} className="text-slate-400" />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Line type="monotone" dataKey="conv" strokeWidth={4} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Recurring customer growth"
            subtitle="The compounding metric that stabilizes the business."
            action={<Icon name="flame" size={18} className="text-orange-500" />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="recurring" strokeWidth={3} fillOpacity={0.18} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        {/* Source table + alerts */}
        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-950">Lead source performance</h3>
                <p className="mt-1 text-sm text-slate-500">Compare volume, booking rate, revenue, CPL, CAC, and ROAS.</p>
              </div>
              <button className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">View all</button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Leads</th>
                    <th className="px-4 py-3">Booked</th>
                    <th className="px-4 py-3">Conv.</th>
                    <th className="px-4 py-3">Revenue</th>
                    <th className="px-4 py-3">CAC</th>
                    <th className="px-4 py-3">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {sources.map((s) => (
                    <tr key={s.source} onClick={() => setSelectedSource(s.source)} className="cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-4 font-semibold text-slate-950">{s.source}</td>
                      <td className="px-4 py-4 text-slate-600">{s.leads}</td>
                      <td className="px-4 py-4 text-slate-600">{s.booked}</td>
                      <td className="px-4 py-4 text-slate-600">{Math.round((s.booked / s.leads) * 100)}%</td>
                      <td className="px-4 py-4 font-semibold text-slate-950">{money(s.revenue)}</td>
                      <td className="px-4 py-4 text-slate-600">{s.cac ? money(s.cac) : "Organic"}</td>
                      <td className="px-4 py-4 text-slate-600">{s.roas ? `${s.roas}x` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-slate-950">AI growth alerts</h3>
            <p className="mt-1 text-sm text-slate-500">What changed and what to fix first.</p>
            <div className="mt-5 space-y-3">
              {alerts.map((a) => (
                <div key={a.title} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 rounded-xl p-2 ${a.type === "win" ? "bg-emerald-50 text-emerald-600" : a.type === "warning" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"}`}>
                      {a.type === "win" ? <Icon name="trend" size={16} /> : a.type === "warning" ? <Icon name="activity" size={16} /> : <Icon name="sparkles" size={16} />}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-950">{a.title}</div>
                      <p className="mt-1 text-sm leading-5 text-slate-500">{a.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Job type pie + operational health */}
        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ChartCard
            title="Bookings by job type"
            subtitle="Know what drives revenue: standard, deep, move-out, add-ons."
            action={<Icon name="click" size={18} className="text-slate-400" />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie dataKey="value" data={[
                  { name: "Standard", value: 46 },
                  { name: "Deep clean", value: 28 },
                  { name: "Move out", value: 16 },
                  { name: "Add-ons", value: 10 },
                ]} outerRadius={95} label>
                  {[0, 1, 2, 3].map((i) => <Cell key={i} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-950">Operational health</h3>
                <p className="mt-1 text-sm text-slate-500">Successful home services metrics are not just marketing — they include fulfillment quality.</p>
              </div>
              <Icon name="star" size={18} className="text-amber-500" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {quality.map((q) => (
                <div key={q.label} className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{q.label}</span>
                    <span className="text-sm font-bold text-slate-950">{q.value}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-950" style={{ width: `${q.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Icon name="phone" size={16} /> Avg response time</div>
                <div className="mt-2 text-2xl font-semibold">3m 42s</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Icon name="target" size={16} /> Close rate after quote</div>
                <div className="mt-2 text-2xl font-semibold">59%</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Icon name="activity" size={16} /> Cancel / reschedule rate</div>
                <div className="mt-2 text-2xl font-semibold">6.8%</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
