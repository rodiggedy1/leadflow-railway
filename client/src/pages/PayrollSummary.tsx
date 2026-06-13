/**
 * PayrollSummary.tsx
 * Spreadsheet-style payroll view — one row per team, all adjustments summed,
 * with a totals row, summary CSV export, and per-team detail CSV download.
 */
import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, ChevronLeft, ChevronRight, ShieldCheck, Loader2 } from "lucide-react";
import cx from "clsx";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPayWeekStart(date: Date): Date {
  const etStr = date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const [m, day, y] = etStr.split("/").map(Number);
  const et = new Date(y!, m! - 1, day!);
  et.setDate(et.getDate() - et.getDay());
  return et;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtMoney(n: number): string {
  if (n === 0) return "—";
  return (n > 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2);
}

function fmtMoneyAbs(n: number): string {
  return "$" + n.toFixed(2);
}

function moneyColor(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-slate-400";
}

/** Trigger a browser CSV download. Works across all modern browsers. */
function triggerCsvDownload(csv: string, filename: string) {
  const BOM = "\uFEFF"; // UTF-8 BOM for Excel/Google Sheets compatibility
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ─── Column definitions ───────────────────────────────────────────────────────

type SummaryRow = {
  teamName: string;
  jobs: number;
  basePay: number;
  ratingAdj: number;
  photoAdj: number;
  streakBonus: number;
  googleBonus: number;
  recleanPenalty: number;
  complaintCharge: number;
  manualAdj: number;
  lateCount: number;
  missedCheckins: number;
  payoutPct: number;
  finalPay: number;
};

// ─── Summary CSV ──────────────────────────────────────────────────────────────

function buildSummaryCsv(rows: SummaryRow[], weekStart: string, weekEnd: string): string {
  const headers = [
    "Team", "Jobs", "Base Pay", "Rating Adj", "Photo Adj", "Streak Bonus",
    "Google Review Bonus", "Reclean Penalty", "Complaint Charge", "Manual Adj",
    "Late Check-ins", "Pay Rate %", "Final Pay",
  ];
  const dataRows = rows.map((r) => [
    r.teamName, r.jobs, r.basePay.toFixed(2), r.ratingAdj.toFixed(2),
    r.photoAdj.toFixed(2), r.streakBonus.toFixed(2), r.googleBonus.toFixed(2),
    r.recleanPenalty.toFixed(2), r.complaintCharge.toFixed(2), r.manualAdj.toFixed(2),
    r.lateCount, `${r.payoutPct}%`, r.finalPay.toFixed(2),
  ]);
  // Totals row
  dataRows.push([
    "TOTAL",
    rows.reduce((s, r) => s + r.jobs, 0),
    rows.reduce((s, r) => s + r.basePay, 0).toFixed(2),
    rows.reduce((s, r) => s + r.ratingAdj, 0).toFixed(2),
    rows.reduce((s, r) => s + r.photoAdj, 0).toFixed(2),
    rows.reduce((s, r) => s + r.streakBonus, 0).toFixed(2),
    rows.reduce((s, r) => s + r.googleBonus, 0).toFixed(2),
    rows.reduce((s, r) => s + r.recleanPenalty, 0).toFixed(2),
    rows.reduce((s, r) => s + r.complaintCharge, 0).toFixed(2),
    rows.reduce((s, r) => s + r.manualAdj, 0).toFixed(2),
    rows.reduce((s, r) => s + r.lateCount, 0),
    "",
    rows.reduce((s, r) => s + r.finalPay, 0).toFixed(2),
  ]);

  // Header line with period
  const periodLine = `Payroll Summary — ${weekStart} to ${weekEnd}`;
  const csvLines = [
    [periodLine].map((v) => `"${v}"`).join(","),
    "",
    headers.map((v) => `"${v}"`).join(","),
    ...dataRows.map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ),
  ];
  return csvLines.join("\n");
}

// ─── Team detail CSV ──────────────────────────────────────────────────────────

type TeamDetailJob = {
  jobDate: string;
  time: string;
  customer: string;
  address: string;
  service: string;
  status: string;
  basePay: number;
  photoAdj: number;
  ratingAdj: number;
  streakBonus: number;
  manualAdj: number;
  reclean: number;
  complaint: number;
  finalPay: number;
};

function buildTeamDetailCsv(
  teamName: string,
  weekStart: string,
  weekEnd: string,
  jobs: TeamDetailJob[],
  totalFinalPay: number
): string {
  const headers = [
    "Date", "Time", "Customer", "Address", "Service", "Status",
    "Base Pay", "Photo Adj", "Rating Adj", "Streak Bonus",
    "Manual Adj", "Reclean", "Complaint", "Final Pay",
  ];

  const dataRows = jobs.map((j) => [
    j.jobDate, j.time, j.customer, j.address, j.service, j.status,
    j.basePay.toFixed(2), j.photoAdj.toFixed(2), j.ratingAdj.toFixed(2),
    j.streakBonus.toFixed(2), j.manualAdj.toFixed(2), j.reclean.toFixed(2),
    j.complaint.toFixed(2), j.finalPay.toFixed(2),
  ]);

  // Totals row
  dataRows.push([
    "TOTAL", "", "", "", "", "",
    jobs.reduce((s, j) => s + j.basePay, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.photoAdj, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.ratingAdj, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.streakBonus, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.manualAdj, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.reclean, 0).toFixed(2),
    jobs.reduce((s, j) => s + j.complaint, 0).toFixed(2),
    totalFinalPay.toFixed(2),
  ]);

  const periodLine = `${teamName} — Payroll Detail — ${weekStart} to ${weekEnd}`;
  const csvLines = [
    [periodLine].map((v) => `"${v}"`).join(","),
    "",
    headers.map((v) => `"${v}"`).join(","),
    ...dataRows.map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ),
  ];
  return csvLines.join("\n");
}

// ─── Team row download button ─────────────────────────────────────────────────

function TeamDownloadButton({ teamName, weekStart, weekEnd }: { teamName: string; weekStart: string; weekEnd: string }) {
  const { mutate, isPending } = trpc.teamPay.getTeamDetail.useMutation({
    onSuccess: (data) => {
      const csv = buildTeamDetailCsv(
        data.teamName,
        data.weekStart,
        data.weekEnd,
        data.jobs,
        data.totalFinalPay
      );
      const safeName = data.teamName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      triggerCsvDownload(csv, `payroll-${safeName}-${data.weekStart}-to-${data.weekEnd}.csv`);
    },
  });

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        mutate({ teamName, weekStart });
      }}
      disabled={isPending}
      title={`Download ${teamName} detail CSV`}
      className={cx(
        "ml-2 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5",
        "text-slate-400 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50",
        "transition-all duration-150 shadow-sm opacity-0 group-hover/row:opacity-100",
        "focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-300",
        isPending && "opacity-100 cursor-wait"
      )}
    >
      {isPending
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollSummary() {
  const [, navigate] = useLocation();

  // Week navigation
  const [weekStart, setWeekStart] = useState<string>(() => {
    const ws = getPayWeekStart(new Date());
    return fmt(ws);
  });

  const weekEnd = useMemo(() => fmt(addDays(new Date(weekStart + "T00:00:00"), 6)), [weekStart]);

  const { data, isLoading, error } = trpc.teamPay.getPayrollSummary.useQuery({ weekStart });

  const rows = data?.rows ?? [];

  // ─── Integrity check ─────────────────────────────────────────────────────────
  const { mutate: runIntegrityCheck, data: checkData, isPending: checkLoading } =
    trpc.teamPay.getIntegrityCheck.useMutation();

  const weekLabel = useMemo(() => {
    const s = new Date(weekStart + "T00:00:00");
    const e = new Date(weekEnd + "T00:00:00");
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}, ${e.getFullYear()}`;
  }, [weekStart, weekEnd]);

  const handleSummaryCsvDownload = useCallback(() => {
    if (rows.length === 0) return;
    const csv = buildSummaryCsv(rows, weekStart, weekEnd);
    triggerCsvDownload(csv, `payroll-summary-${weekStart}-to-${weekEnd}.csv`);
  }, [rows, weekStart, weekEnd]);

  function prevWeek() {
    setWeekStart(fmt(addDays(new Date(weekStart + "T00:00:00"), -7)));
  }
  function nextWeek() {
    setWeekStart(fmt(addDays(new Date(weekStart + "T00:00:00"), 7)));
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#eef2f7_55%,_#e8edf5)]">
      <div className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/team-pay")}
              className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Team Pay
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
                Payroll Summary
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">All teams · {weekLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Week navigation */}
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button
                onClick={prevWeek}
                className="flex items-center justify-center px-3 py-2 text-slate-600 hover:bg-slate-50 transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 py-2 text-sm font-medium text-slate-700 whitespace-nowrap">{weekLabel}</span>
              <button
                onClick={nextWeek}
                className="flex items-center justify-center px-3 py-2 text-slate-600 hover:bg-slate-50 transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <Button
              onClick={handleSummaryCsvDownload}
              disabled={rows.length === 0}
              className="rounded-2xl gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </div>

        {/* Integrity Check Panel */}
        <div className="mb-6 rounded-[20px] border border-slate-200 bg-white shadow-sm px-5 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-slate-500" />
              <span className="font-semibold text-slate-800 text-sm">Data Integrity Check</span>
              <span className="text-xs text-slate-400">— verify all sources match for {weekLabel}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-2 bg-white"
              onClick={() => { runIntegrityCheck({ weekStart }); }}
              disabled={checkLoading}
            >
              {checkLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <ShieldCheck className="h-3.5 w-3.5" />}
              {checkLoading ? "Checking…" : "Run Check"}
            </Button>
          </div>
          {checkData && !checkLoading && (() => {
            const ps = checkData.payrollSummaryTotal;
            const tp = checkData.teamPayTotal;
            const cp = checkData.cleaningPortalTotal;
            const jb = checkData.jobsBoardTotal;
            const checks = [
              { label: "Payroll Summary vs Team Pay", a: ps, b: tp, aLabel: "Payroll", bLabel: "Team Pay" },
              { label: "Payroll Summary vs Cleaning Portal", a: ps, b: cp, aLabel: "Payroll", bLabel: "Portal" },
              { label: "Payroll Summary vs Jobs Board", a: ps, b: jb, aLabel: "Payroll", bLabel: "Jobs Board" },
            ];
            return (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {checks.map((c) => {
                  const match = Math.abs(c.a - c.b) < 0.01;
                  const diff = Math.round((c.b - c.a) * 100) / 100;
                  return (
                    <div
                      key={c.label}
                      className={`rounded-xl border px-4 py-3 flex flex-col gap-1 ${
                        match ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-base ${match ? "text-emerald-600" : "text-rose-500"}`}>
                          {match ? "✅" : "❌"}
                        </span>
                        <span className="text-xs font-semibold text-slate-700">{c.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-slate-600">
                          {c.aLabel}: <span className="font-semibold text-slate-900">${c.a.toFixed(2)}</span>
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600">
                          {c.bLabel}: <span className="font-semibold text-slate-900">${c.b.toFixed(2)}</span>
                        </span>
                      </div>
                      {!match && (
                        <div className="text-xs font-medium text-rose-600">
                          Difference: {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Table */}
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-500 text-sm">
              Loading payroll data…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-20 text-rose-600 text-sm">
              Failed to load payroll data.
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-slate-500 text-sm">
              No team data for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {/* Team column header */}
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-left">
                      <div>Team</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Jobs</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Base Pay</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Rating Adj</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">bonus / deduction</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Photo</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">bonus / penalty</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Streak</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">bonus</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Google Review</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">bonus</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Reclean</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">penalty</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Complaint</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">charge</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Manual Adj</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Late</div>
                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">check-ins</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Pay Rate</div>
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap text-right">
                      <div>Final Pay</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.teamName}
                      className={cx(
                        "group/row border-b border-slate-100 transition-colors hover:bg-slate-50/60",
                        i % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                      )}
                    >
                      {/* Team name cell with download button */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-left">
                        <div className="flex items-center">
                          <span className="font-semibold text-slate-900">{row.teamName}</span>
                          <TeamDownloadButton
                            teamName={row.teamName}
                            weekStart={weekStart}
                            weekEnd={weekEnd}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-slate-700">{row.jobs}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="text-slate-900 font-medium">{fmtMoneyAbs(row.basePay)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.ratingAdj))}>{fmtMoney(row.ratingAdj)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.photoAdj))}>{fmtMoney(row.photoAdj)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.streakBonus))}>{fmtMoney(row.streakBonus)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.googleBonus))}>{fmtMoney(row.googleBonus)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.recleanPenalty))}>{fmtMoney(row.recleanPenalty)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.complaintCharge))}>{fmtMoney(row.complaintCharge)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", moneyColor(row.manualAdj))}>{fmtMoney(row.manualAdj)}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className={cx("font-medium", row.lateCount > 0 ? "text-amber-700" : "text-slate-400")}>
                          {row.lateCount > 0 ? row.lateCount : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="font-semibold text-slate-900">{row.payoutPct}%</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-right">
                        <span className="font-bold text-slate-900 text-base">{fmtMoneyAbs(row.finalPay)}</span>
                      </td>
                    </tr>
                  ))}

                  {/* Totals row */}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-4 whitespace-nowrap text-left">
                      <span className="font-bold text-slate-900">TOTAL</span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <span className="font-bold">{rows.reduce((s, r) => s + r.jobs, 0)}</span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <span className="font-bold">{fmtMoneyAbs(rows.reduce((s, r) => s + r.basePay, 0))}</span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.ratingAdj, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.photoAdj, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.streakBonus, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.googleBonus, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.recleanPenalty, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.complaintCharge, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.manualAdj, 0); return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      {(() => { const t = rows.reduce((s, r) => s + r.lateCount, 0); return <span className={cx("font-bold", t > 0 ? "text-amber-700" : "text-slate-400")}>{t > 0 ? t : "—"}</span>; })()}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right" />
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <span className="font-bold text-slate-900 text-base">
                        {fmtMoneyAbs(rows.reduce((s, r) => s + r.finalPay, 0))}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Period total callout */}
        {rows.length > 0 && (
          <div className="mt-4 flex justify-end">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-right shadow-sm">
              <div className="text-xs text-emerald-700">Total payout this period</div>
              <div className="mt-0.5 text-2xl font-bold text-emerald-900">
                {fmtMoneyAbs(rows.reduce((s, r) => s + r.finalPay, 0))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
