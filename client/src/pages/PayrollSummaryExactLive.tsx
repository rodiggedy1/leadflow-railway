import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { PayrollSummaryRow, PayrollTeamDetail } from "@/lib/payrollWorkbook";
import "./payroll-summary-review.css";
import "./payroll-summary-exact-live.css";

type SummaryRow = {
  teamId: number;
  teamName: string;
  jobs: number;
  payrollMode: "legacy" | "2026-08-16";
  jobRevenue: number;
  operationalCost: number;
  netJobAmount: number;
  basePay: number;
  manualAdj: number;
  payoutPct: number;
  finalPay: number;
};

type TeamDetailJob = {
  id: number;
  teamId: number;
  teamName: string;
  jobDate: string;
  time: string;
  customer: string;
  address: string;
  service: string;
  status: string;
  payrollMode: "legacy" | "2026-08-16";
  jobRevenue: number;
  operationalCost: number;
  netJobAmount: number;
  payoutPct: number;
  basePay: number;
  manualAdj: number;
  finalPay: number;
};

type TeamDetailData = {
  source: "leadflow";
  teamId: number;
  teamName: string;
  weekStart: string;
  weekEnd: string;
  jobs: TeamDetailJob[];
  totalFinalPay: number;
};

function fmt(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPayWeekStart(date: Date): Date {
  const eastern = date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const [month, day, year] = eastern.split("/").map(Number);
  const result = new Date(year!, month! - 1, day!);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function money(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number): string {
  if (value === 0) return "—";
  return `${value > 0 ? "+" : "−"}${money(value)}`;
}

function moneyTone(value: number): string {
  if (value > 0) return "psr-positive";
  if (value < 0) return "psr-negative";
  return "psr-muted";
}

function triggerCsvDownload(csv: string, filename: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function buildSummaryCsv(rows: SummaryRow[], weekStart: string, weekEnd: string): string {
  const headers = ["Team", "Jobs", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Payroll Adj", "Final Pay"];
  const records = rows.map((row) => [
    row.teamName, row.jobs, row.jobRevenue.toFixed(2), row.operationalCost.toFixed(2), row.netJobAmount.toFixed(2),
    `${row.payoutPct}%`, row.basePay.toFixed(2), row.manualAdj.toFixed(2), row.finalPay.toFixed(2),
  ]);
  records.push([
    "TOTAL", rows.reduce((sum, row) => sum + row.jobs, 0),
    rows.reduce((sum, row) => sum + row.jobRevenue, 0).toFixed(2),
    rows.reduce((sum, row) => sum + row.operationalCost, 0).toFixed(2),
    rows.reduce((sum, row) => sum + row.netJobAmount, 0).toFixed(2), "",
    rows.reduce((sum, row) => sum + row.basePay, 0).toFixed(2),
    rows.reduce((sum, row) => sum + row.manualAdj, 0).toFixed(2),
    rows.reduce((sum, row) => sum + row.finalPay, 0).toFixed(2),
  ]);
  return [[`LeadFlow Payroll Summary — ${weekStart} to ${weekEnd}`], [], headers, ...records]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function buildTeamDetailCsv(teamName: string, weekStart: string, weekEnd: string, jobs: TeamDetailJob[], totalFinalPay: number): string {
  const headers = ["Date", "Time", "Customer", "Address", "Service", "Booking Status", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Payroll Adj", "Final Pay"];
  const records = jobs.map((job) => [
    job.jobDate, job.time, job.customer, job.address, job.service, job.status,
    job.jobRevenue.toFixed(2), job.operationalCost.toFixed(2), job.netJobAmount.toFixed(2), `${job.payoutPct}%`,
    job.basePay.toFixed(2), job.manualAdj.toFixed(2), job.finalPay.toFixed(2),
  ]);
  records.push([
    "TOTAL", "", "", "", "", "",
    jobs.reduce((sum, job) => sum + job.jobRevenue, 0).toFixed(2),
    jobs.reduce((sum, job) => sum + job.operationalCost, 0).toFixed(2),
    jobs.reduce((sum, job) => sum + job.netJobAmount, 0).toFixed(2), "",
    jobs.reduce((sum, job) => sum + job.basePay, 0).toFixed(2),
    jobs.reduce((sum, job) => sum + job.manualAdj, 0).toFixed(2), totalFinalPay.toFixed(2),
  ]);
  return [[`${teamName} — LeadFlow Payroll Detail — ${weekStart} to ${weekEnd}`], [], headers, ...records]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/**
 * The workbook's legacy layout expects legacy-table adjustment fields which do
 * not exist in LeadFlow jobs. Its modern layout already carries exactly the
 * LeadFlow/Portal calculation fields returned by this page for every period.
 */
function leadflowWorkbookRows(rows: SummaryRow[]): PayrollSummaryRow[] {
  return rows.map((row) => ({ ...row, payrollMode: "2026-08-16" as const })) as unknown as PayrollSummaryRow[];
}

function leadflowWorkbookDetails(details: TeamDetailData[]): PayrollTeamDetail[] {
  return details.map((detail) => ({
    ...detail,
    jobs: detail.jobs.map((job) => ({ ...job, payrollMode: "2026-08-16" as const })),
  })) as unknown as PayrollTeamDetail[];
}

function TeamDetailDrawer({
  team,
  weekLabel,
  detail,
  isLoading,
  onClose,
  onDownload,
  isDownloading,
}: {
  team: SummaryRow | null;
  weekLabel: string;
  detail: TeamDetailData | undefined;
  isLoading: boolean;
  onClose: () => void;
  onDownload: () => void;
  isDownloading: boolean;
}) {
  if (!team) return null;

  const jobs = detail?.jobs ?? [];
  const calculatedFinalPay = jobs.reduce((sum, job) => sum + job.finalPay, 0);
  const reconciles = Boolean(detail) && Math.abs(calculatedFinalPay - team.finalPay) < 0.01;

  return <>
    <button type="button" className="psr-drawer-backdrop" aria-label="Close payroll detail" onClick={onClose} />
    <aside className="psr-drawer psr-live-drawer" role="dialog" aria-modal="true" aria-labelledby="psr-drawer-title">
      <header className="psr-drawer-header"><div><span>LEADFLOW PAYROLL DETAIL</span><h2 id="psr-drawer-title">{team.teamName}</h2><p>{weekLabel}</p></div><button type="button" onClick={onClose} aria-label="Close payroll detail"><X size={18} /></button></header>
      <div className="psr-drawer-scroll">
        <section className="psr-drawer-summary"><div><span>{team.teamName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><div><small>PAYROLL PERIOD</small><strong>{weekLabel}</strong><p>{team.jobs} LeadFlow job{team.jobs === 1 ? "" : "s"} · {team.payoutPct}% payout rate</p></div></div><b>{money(team.finalPay)}</b></section>
        {isLoading ? <div className="psr-live-state"><Loader2 size={16} className="animate-spin" />Loading LeadFlow payroll detail…</div>
          : !detail ? <div className="psr-live-state">No LeadFlow payroll detail was returned for this period.</div>
          : jobs.length === 0 ? <div className="psr-live-state">No payable LeadFlow bookings were found for this team in the selected pay week.</div>
          : <>
            <section className={`psr-reconcile ${reconciles ? "" : "psr-reconcile--warning"}`}><CheckCircle2 size={16} /><div><strong>{reconciles ? "Matches LeadFlow Summary" : "Detail total needs review"}</strong><span>{reconciles ? "This booking-level detail matches the LeadFlow summary row." : "The booking detail differs from the LeadFlow summary row."}</span></div></section>
            <section className="psr-detail-table-wrap">
              <table className="psr-detail-table"><thead><tr><th>Date / time</th><th>Customer</th><th>Job amount</th><th>13% ops</th><th>Net amount</th><th>Pay rate</th><th>Base pay</th><th>Payroll adj.</th><th>Final pay</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.jobDate}</strong><small>{job.time}</small></td><td><strong>{job.customer}</strong><small>{job.service || job.status}</small></td><td>{money(job.jobRevenue)}</td><td className="psr-negative">−{money(job.operationalCost)}</td><td>{money(job.netJobAmount)}</td><td>{job.payoutPct}%</td><td>{money(job.basePay)}</td><td className={moneyTone(job.manualAdj)}>{signedMoney(job.manualAdj)}</td><td><strong>{money(job.finalPay)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>TOTAL</td><td>{money(jobs.reduce((sum, job) => sum + job.jobRevenue, 0))}</td><td className="psr-negative">−{money(jobs.reduce((sum, job) => sum + job.operationalCost, 0))}</td><td>{money(jobs.reduce((sum, job) => sum + job.netJobAmount, 0))}</td><td>—</td><td>{money(jobs.reduce((sum, job) => sum + job.basePay, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}</td><td>{money(calculatedFinalPay)}</td></tr></tfoot></table>
            </section>
            <section className="psr-drawer-total"><span>LeadFlow Summary row total</span><strong>{money(team.finalPay)}</strong></section>
          </>}
      </div>
      <footer><button type="button" onClick={onClose}>Back to summary</button><button type="button" onClick={onDownload} disabled={isDownloading || !detail}><Download size={14} />{isDownloading ? "Building CSV…" : "Detail CSV"}</button></footer>
    </aside>
  </>;
}

export default function PayrollSummaryExactLive() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [weekStart, setWeekStart] = useState(() => fmt(getPayWeekStart(new Date())));
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isWorkbookDownloading, setIsWorkbookDownloading] = useState(false);
  const [isDetailDownloading, setIsDetailDownloading] = useState(false);

  const weekEnd = useMemo(() => fmt(addDays(new Date(`${weekStart}T00:00:00`), 6)), [weekStart]);
  const weekLabel = useMemo(() => {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(`${weekEnd}T00:00:00`);
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString("en-US", options)} – ${end.toLocaleDateString("en-US", options)}, ${end.getFullYear()}`;
  }, [weekStart, weekEnd]);

  const { data, isLoading, error } = trpc.leadflowJobs.getPayrollSummary.useQuery({ weekStart });
  const detailQuery = trpc.leadflowJobs.getPayrollTeamDetail.useQuery(
    { weekStart, teamId: selectedTeamId ?? 0 },
    { enabled: detailOpen && selectedTeamId !== null },
  );

  const rows = (data?.rows ?? []) as SummaryRow[];
  const selectedTeam = rows.find((row) => row.teamId === selectedTeamId) ?? null;
  const detail = detailQuery.data as TeamDetailData | undefined;
  const totals = useMemo(() => ({
    revenue: rows.reduce((sum, row) => sum + row.jobRevenue, 0),
    operations: rows.reduce((sum, row) => sum + row.operationalCost, 0),
    net: rows.reduce((sum, row) => sum + row.netJobAmount, 0),
    base: rows.reduce((sum, row) => sum + row.basePay, 0),
    manual: rows.reduce((sum, row) => sum + row.manualAdj, 0),
    final: rows.reduce((sum, row) => sum + row.finalPay, 0),
    jobs: rows.reduce((sum, row) => sum + row.jobs, 0),
  }), [rows]);

  useEffect(() => {
    if (!detailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setDetailOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailOpen]);

  const handleSummaryCsvDownload = useCallback(() => {
    if (rows.length === 0) return;
    triggerCsvDownload(buildSummaryCsv(rows, weekStart, data?.weekEnd ?? weekEnd), `leadflow-payroll-summary-${weekStart}-to-${data?.weekEnd ?? weekEnd}.csv`);
  }, [data?.weekEnd, rows, weekEnd, weekStart]);

  const handleWorkbookDownload = useCallback(async () => {
    if (rows.length === 0 || isWorkbookDownloading) return;
    setIsWorkbookDownloading(true);
    try {
      const teamDetails = await Promise.all(rows.map((row) => utils.leadflowJobs.getPayrollTeamDetail.fetch({ teamId: row.teamId, weekStart }))) as TeamDetailData[];
      const { downloadPayrollWorkbook } = await import("@/lib/payrollWorkbook");
      const filename = await downloadPayrollWorkbook({
        rows: leadflowWorkbookRows(rows),
        teamDetails: leadflowWorkbookDetails(teamDetails),
        weekStart,
        weekEnd: data?.weekEnd ?? weekEnd,
      });
      toast.success(`${filename} downloaded with ${teamDetails.length} team tab${teamDetails.length === 1 ? "" : "s"}.`);
    } catch (downloadError) {
      console.error("[LeadFlow Payroll Workbook] Download failed", downloadError);
      toast.error(downloadError instanceof Error ? downloadError.message : "LeadFlow payroll workbook download failed.");
    } finally {
      setIsWorkbookDownloading(false);
    }
  }, [data?.weekEnd, isWorkbookDownloading, rows, utils.leadflowJobs.getPayrollTeamDetail, weekEnd, weekStart]);

  const handleDetailCsvDownload = useCallback(async () => {
    if (!selectedTeam || !detail || isDetailDownloading) return;
    setIsDetailDownloading(true);
    try {
      triggerCsvDownload(
        buildTeamDetailCsv(detail.teamName, detail.weekStart, detail.weekEnd, detail.jobs, detail.totalFinalPay),
        `leadflow-payroll-${detail.teamName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${detail.weekStart}-to-${detail.weekEnd}.csv`,
      );
    } finally {
      setIsDetailDownloading(false);
    }
  }, [detail, isDetailDownloading, selectedTeam]);

  function openTeamDetail(teamId: number) {
    setSelectedTeamId(teamId);
    setDetailOpen(true);
  }

  function onTeamRowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, teamId: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTeamDetail(teamId);
    }
  }

  function prevWeek() { setWeekStart(fmt(addDays(new Date(`${weekStart}T00:00:00`), -7))); }
  function nextWeek() { setWeekStart(fmt(addDays(new Date(`${weekStart}T00:00:00`), 7))); }

  return <main className="payroll-summary-review payroll-summary-exact-live" data-payroll-source="leadflow">
    <header className="psr-header">
      <div className="psr-heading"><button type="button" className="psr-return" onClick={() => navigate("/admin/team-pay")}><ArrowLeft size={15} />Team Pay</button><div><p>LEADFLOW · LIVE PAYROLL</p><h1>Payroll Summary</h1><span>Booking-assigned teams · {weekLabel}</span></div></div>
      <div className="psr-actions"><div className="psr-week-control"><button type="button" onClick={prevWeek} aria-label="Previous pay week"><ChevronLeft size={16} /></button><span><CalendarDays size={14} />{weekLabel}</span><button type="button" onClick={nextWeek} aria-label="Next pay week"><ChevronRight size={16} /></button></div><button type="button" className="psr-action-button" onClick={handleSummaryCsvDownload} disabled={rows.length === 0}><Download size={14} />Summary CSV</button><button type="button" className="psr-action-button primary" onClick={handleWorkbookDownload} disabled={rows.length === 0 || isWorkbookDownloading}>{isWorkbookDownloading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}{isWorkbookDownloading ? "Building workbook…" : "Download Workbook"}</button></div>
    </header>

    <section className="psr-integrity psr-integrity--leadflow" aria-label="LeadFlow payroll source"><div><span className="psr-integrity-icon"><ShieldCheck size={17} /></span><p><strong>LeadFlow payroll source</strong><small>Booking-assigned teams · Cleaner Portal pay percentages · final-payout ledger</small></p></div><span className="psr-leadflow-source-badge">LEADFLOW ONLY</span></section>

    {rows.length > 0 && <section className="psr-kpis" aria-label="LeadFlow payroll summary metrics">{[["JOB AMOUNT", totals.revenue, "default"], ["13% OPS COST", totals.operations, "negative"], ["NET AMOUNT", totals.net, "default"], ["BASE PAY", totals.base, "default"], ["PAYROLL ADJ.", totals.manual, totals.manual < 0 ? "negative" : "positive"], ["FINAL PAYROLL", totals.final, "positive"]].map(([label, value, tone]) => <article key={label as string}><small>{label as string}</small><strong className={`tone-${tone}`}>{tone === "negative" ? "−" : ""}{money(value as number)}</strong><span>{label === "FINAL PAYROLL" ? `${totals.jobs} LeadFlow jobs` : "LeadFlow period total"}</span></article>)}</section>}

    <section className="psr-summary-shell" aria-label="LeadFlow Payroll Summary table"><div className="psr-summary-title"><div><span>PAYROLL PERIOD</span><strong>{weekLabel}</strong></div><p>Click a team row to inspect its LeadFlow booking payroll detail.</p></div><div className="psr-table-scroll">
      {isLoading ? <div className="psr-live-state"><Loader2 size={16} className="animate-spin" />Loading LeadFlow payroll data…</div>
        : error ? <div className="psr-live-state psr-live-state--error">Failed to load LeadFlow payroll data.</div>
        : rows.length === 0 ? <div className="psr-live-state">No payable LeadFlow bookings were found for this period.</div>
        : <div className="psr-summary-table"><div className="psr-table-head"><span>TEAM</span><span>JOBS</span><span>JOB AMOUNT</span><span>13% OPS</span><span>NET AMOUNT</span><span>PAYOUT %</span><span>BASE PAY</span><span>PAYROLL ADJ.</span><span>FINAL PAY</span></div>{rows.map((row) => <button type="button" key={row.teamId} className={`psr-table-row ${selectedTeamId === row.teamId ? "is-selected" : ""}`} aria-label={`View ${row.teamName} LeadFlow payroll detail for ${weekLabel}`} onClick={() => openTeamDetail(row.teamId)} onKeyDown={(event) => onTeamRowKeyDown(event, row.teamId)}><span className="psr-team-cell"><i>{row.teamName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</i><strong>{row.teamName}</strong><small>Open LeadFlow detail</small></span><span>{row.jobs}</span><span>{money(row.jobRevenue)}</span><span className="psr-negative">−{money(row.operationalCost)}</span><span>{money(row.netJobAmount)}</span><span>{row.payoutPct}%</span><span>{money(row.basePay)}</span><span className={moneyTone(row.manualAdj)}>{signedMoney(row.manualAdj)}</span><strong className="psr-final-pay">{money(row.finalPay)}</strong></button>)}<div className="psr-table-total"><span>TOTAL</span><span>{totals.jobs}</span><span>{money(totals.revenue)}</span><span className="psr-negative">−{money(totals.operations)}</span><span>{money(totals.net)}</span><span>—</span><span>{money(totals.base)}</span><span className={moneyTone(totals.manual)}>{signedMoney(totals.manual)}</span><strong>{money(totals.final)}</strong></div></div>}
    </div></section>

    {rows.length > 0 && <footer className="psr-payout-callout"><span>Total LeadFlow payout this period</span><strong>{money(totals.final)}</strong><small>Booking-assigned teams and final-payout ledger adjustments</small></footer>}
    {detailOpen && <TeamDetailDrawer team={selectedTeam} weekLabel={weekLabel} detail={detail} isLoading={detailQuery.isLoading || detailQuery.isFetching} onClose={() => setDetailOpen(false)} onDownload={handleDetailCsvDownload} isDownloading={isDetailDownloading} />}
  </main>;
}
