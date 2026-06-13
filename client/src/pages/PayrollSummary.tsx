/**
 * PayrollSummary.tsx
 * Spreadsheet-style payroll view — one row per team, all adjustments summed,
 * with a totals row and CSV export.
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, ChevronLeft, ChevronRight } from "lucide-react";
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
  score: number;
  payoutPct: number;
  nextWeekPayout: number;
  finalPay: number;
};

const COLUMNS: Array<{
  key: keyof SummaryRow;
  label: string;
  sub?: string;
  render: (row: SummaryRow) => React.ReactNode;
  total?: (rows: SummaryRow[]) => React.ReactNode;
  align?: "left" | "right";
}> = [
  {
    key: "teamName",
    label: "Team",
    align: "left",
    render: (r) => <span className="font-semibold text-slate-900 whitespace-nowrap">{r.teamName}</span>,
    total: () => <span className="font-bold text-slate-900">TOTAL</span>,
  },
  {
    key: "jobs",
    label: "Jobs",
    align: "right",
    render: (r) => <span className="text-slate-700">{r.jobs}</span>,
    total: (rows) => <span className="font-bold">{rows.reduce((s, r) => s + r.jobs, 0)}</span>,
  },
  {
    key: "basePay",
    label: "Base Pay",
    align: "right",
    render: (r) => <span className="text-slate-900 font-medium">{fmtMoneyAbs(r.basePay)}</span>,
    total: (rows) => <span className="font-bold">{fmtMoneyAbs(rows.reduce((s, r) => s + r.basePay, 0))}</span>,
  },
  {
    key: "ratingAdj",
    label: "Rating Adj",
    sub: "bonus / deduction",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.ratingAdj))}>{fmtMoney(r.ratingAdj)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.ratingAdj, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "photoAdj",
    label: "Photo",
    sub: "bonus / penalty",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.photoAdj))}>{fmtMoney(r.photoAdj)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.photoAdj, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "streakBonus",
    label: "Streak",
    sub: "bonus",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.streakBonus))}>{fmtMoney(r.streakBonus)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.streakBonus, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "googleBonus",
    label: "Google Review",
    sub: "bonus",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.googleBonus))}>{fmtMoney(r.googleBonus)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.googleBonus, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "recleanPenalty",
    label: "Reclean",
    sub: "penalty",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.recleanPenalty))}>{fmtMoney(r.recleanPenalty)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.recleanPenalty, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "complaintCharge",
    label: "Complaint",
    sub: "charge",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.complaintCharge))}>{fmtMoney(r.complaintCharge)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.complaintCharge, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "manualAdj",
    label: "Manual Adj",
    align: "right",
    render: (r) => <span className={cx("font-medium", moneyColor(r.manualAdj))}>{fmtMoney(r.manualAdj)}</span>,
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.manualAdj, 0);
      return <span className={cx("font-bold", moneyColor(t))}>{fmtMoney(t)}</span>;
    },
  },
  {
    key: "lateCount",
    label: "Late",
    sub: "check-ins",
    align: "right",
    render: (r) => (
      <span className={cx("font-medium", r.lateCount > 0 ? "text-amber-700" : "text-slate-400")}>
        {r.lateCount > 0 ? r.lateCount : "—"}
      </span>
    ),
    total: (rows) => {
      const t = rows.reduce((s, r) => s + r.lateCount, 0);
      return <span className={cx("font-bold", t > 0 ? "text-amber-700" : "text-slate-400")}>{t > 0 ? t : "—"}</span>;
    },
  },
  {
    key: "score",
    label: "Score",
    align: "right",
    render: (r) => (
      <Badge
        className={cx(
          "rounded-full text-xs font-semibold px-2 py-0.5",
          r.score >= 100 ? "bg-emerald-100 text-emerald-800" :
          r.score >= 90 ? "bg-blue-100 text-blue-800" :
          r.score >= 80 ? "bg-amber-100 text-amber-800" :
          "bg-rose-100 text-rose-800"
        )}
      >
        {r.score}%
      </Badge>
    ),
    total: () => null,
  },
  {
    key: "payoutPct",
    label: "Payout %",
    sub: "current",
    align: "right",
    render: (r) => <span className="font-semibold text-slate-900">{r.payoutPct}%</span>,
    total: () => null,
  },
  {
    key: "finalPay",
    label: "Final Pay",
    align: "right",
    render: (r) => <span className="font-bold text-slate-900 text-base">{fmtMoneyAbs(r.finalPay)}</span>,
    total: (rows) => (
      <span className="font-bold text-slate-900 text-base">
        {fmtMoneyAbs(rows.reduce((s, r) => s + r.finalPay, 0))}
      </span>
    ),
  },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(rows: SummaryRow[], weekStart: string, weekEnd: string) {
  const headers = [
    "Team", "Jobs", "Base Pay", "Rating Adj", "Photo Adj", "Streak Bonus",
    "Google Review Bonus", "Reclean Penalty", "Complaint Charge", "Manual Adj",
    "Late Check-ins", "Score", "Payout %", "Next Week %", "Final Pay",
  ];
  const dataRows = rows.map((r) => [
    r.teamName, r.jobs, r.basePay, r.ratingAdj, r.photoAdj, r.streakBonus,
    r.googleBonus, r.recleanPenalty, r.complaintCharge, r.manualAdj,
    r.lateCount, `${r.score}%`, `${r.payoutPct}%`, `${r.nextWeekPayout}%`, r.finalPay,
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
    "", "", "",
    rows.reduce((s, r) => s + r.finalPay, 0).toFixed(2),
  ]);

  const csv = [headers, ...dataRows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-${weekStart}-to-${weekEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

  const weekLabel = useMemo(() => {
    const s = new Date(weekStart + "T00:00:00");
    const e = new Date(weekEnd + "T00:00:00");
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}, ${e.getFullYear()}`;
  }, [weekStart, weekEnd]);

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
              onClick={() => rows.length > 0 && exportCsv(rows, weekStart, weekEnd)}
              disabled={rows.length === 0}
              className="rounded-2xl gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
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
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={cx(
                          "px-4 py-3 font-semibold text-slate-700 whitespace-nowrap",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        <div>{col.label}</div>
                        {col.sub && <div className="text-[10px] font-normal text-slate-400 mt-0.5">{col.sub}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.teamName}
                      className={cx(
                        "border-b border-slate-100 transition-colors hover:bg-slate-50/60",
                        i % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                      )}
                    >
                      {COLUMNS.map((col) => (
                        <td
                          key={col.key}
                          className={cx(
                            "px-4 py-3.5 whitespace-nowrap",
                            col.align === "right" ? "text-right" : "text-left"
                          )}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Totals row */}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={cx(
                          "px-4 py-4 whitespace-nowrap",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {col.total ? col.total(rows) : null}
                      </td>
                    ))}
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
