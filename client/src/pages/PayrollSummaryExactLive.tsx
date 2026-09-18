import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { PayrollSummaryRow, PayrollTeamDetail, PayrollTeamJob } from "@/lib/payrollWorkbook";
import "./payroll-summary-review.css";
import "./payroll-summary-exact-live.css";

type SummaryRow = PayrollSummaryRow;
type TeamDetailJob = PayrollTeamJob;
type TeamDetailData = PayrollTeamDetail;

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

function formatMoney(value: number): string {
  return value === 0 ? "—" : `${value > 0 ? "+" : ""}$${Math.abs(value).toFixed(2)}`;
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
  if (rows[0]?.payrollMode === "2026-08-16") {
    const headers = ["Team", "Jobs", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Manual Adj", "Final Pay"];
    const records = rows.map((row) => [
      row.teamName, row.jobs, (row.jobRevenue ?? 0).toFixed(2), (row.operationalCost ?? 0).toFixed(2),
      (row.netJobAmount ?? 0).toFixed(2), `${row.payoutPct}%`, row.basePay.toFixed(2), row.manualAdj.toFixed(2), row.finalPay.toFixed(2),
    ]);
    records.push([
      "TOTAL", rows.reduce((sum, row) => sum + row.jobs, 0),
      rows.reduce((sum, row) => sum + (row.jobRevenue ?? 0), 0).toFixed(2),
      rows.reduce((sum, row) => sum + (row.operationalCost ?? 0), 0).toFixed(2),
      rows.reduce((sum, row) => sum + (row.netJobAmount ?? 0), 0).toFixed(2), "",
      rows.reduce((sum, row) => sum + row.basePay, 0).toFixed(2),
      rows.reduce((sum, row) => sum + row.manualAdj, 0).toFixed(2),
      rows.reduce((sum, row) => sum + row.finalPay, 0).toFixed(2),
    ]);
    return [[`Payroll Summary — ${weekStart} to ${weekEnd}`], [], headers, ...records]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  const headers = ["Team", "Jobs", "Base Pay", "Rating Adj", "Photo Adj", "Streak Bonus", "Google Review Bonus", "Reclean Penalty", "Complaint Charge", "Manual Adj", "Late Check-ins", "Pay Rate %", "Final Pay"];
  const records = rows.map((row) => [row.teamName, row.jobs, row.basePay.toFixed(2), row.ratingAdj.toFixed(2), row.photoAdj.toFixed(2), row.streakBonus.toFixed(2), row.googleBonus.toFixed(2), row.recleanPenalty.toFixed(2), row.complaintCharge.toFixed(2), row.manualAdj.toFixed(2), row.lateCount, `${row.payoutPct}%`, row.finalPay.toFixed(2)]);
  records.push(["TOTAL", rows.reduce((sum, row) => sum + row.jobs, 0), rows.reduce((sum, row) => sum + row.basePay, 0).toFixed(2), rows.reduce((sum, row) => sum + row.ratingAdj, 0).toFixed(2), rows.reduce((sum, row) => sum + row.photoAdj, 0).toFixed(2), rows.reduce((sum, row) => sum + row.streakBonus, 0).toFixed(2), rows.reduce((sum, row) => sum + row.googleBonus, 0).toFixed(2), rows.reduce((sum, row) => sum + row.recleanPenalty, 0).toFixed(2), rows.reduce((sum, row) => sum + row.complaintCharge, 0).toFixed(2), rows.reduce((sum, row) => sum + row.manualAdj, 0).toFixed(2), rows.reduce((sum, row) => sum + row.lateCount, 0), "", rows.reduce((sum, row) => sum + row.finalPay, 0).toFixed(2)]);
  return [[`Payroll Summary — ${weekStart} to ${weekEnd}`], [], headers, ...records]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function buildTeamDetailCsv(teamName: string, weekStart: string, weekEnd: string, jobs: TeamDetailJob[], totalFinalPay: number): string {
  if (jobs[0]?.payrollMode === "2026-08-16") {
    const headers = ["Date", "Time", "Customer", "Address", "Service", "Status", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Manual Adj", "Final Pay"];
    const records = jobs.map((job) => [job.jobDate, job.time, job.customer, job.address, job.service, job.status, (job.jobRevenue ?? 0).toFixed(2), (job.operationalCost ?? 0).toFixed(2), (job.netJobAmount ?? 0).toFixed(2), `${job.payoutPct ?? 0}%`, job.basePay.toFixed(2), job.manualAdj.toFixed(2), job.finalPay.toFixed(2)]);
    records.push(["TOTAL", "", "", "", "", "", jobs.reduce((sum, job) => sum + (job.jobRevenue ?? 0), 0).toFixed(2), jobs.reduce((sum, job) => sum + (job.operationalCost ?? 0), 0).toFixed(2), jobs.reduce((sum, job) => sum + (job.netJobAmount ?? 0), 0).toFixed(2), "", jobs.reduce((sum, job) => sum + job.basePay, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.manualAdj, 0).toFixed(2), totalFinalPay.toFixed(2)]);
    return [[`${teamName} — Payroll Detail — ${weekStart} to ${weekEnd}`], [], headers, ...records]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  const headers = ["Date", "Time", "Customer", "Address", "Service", "Status", "Base Pay", "Photo Adj", "Rating Adj", "Streak Bonus", "Manual Adj", "Reclean", "Complaint", "Final Pay"];
  const records = jobs.map((job) => [job.jobDate, job.time, job.customer, job.address, job.service, job.status, job.basePay.toFixed(2), job.photoAdj.toFixed(2), job.ratingAdj.toFixed(2), job.streakBonus.toFixed(2), job.manualAdj.toFixed(2), job.reclean.toFixed(2), job.complaint.toFixed(2), job.finalPay.toFixed(2)]);
  records.push(["TOTAL", "", "", "", "", "", jobs.reduce((sum, job) => sum + job.basePay, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.photoAdj, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.ratingAdj, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.streakBonus, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.manualAdj, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.reclean, 0).toFixed(2), jobs.reduce((sum, job) => sum + job.complaint, 0).toFixed(2), totalFinalPay.toFixed(2)]);
  return [[`${teamName} — Payroll Detail — ${weekStart} to ${weekEnd}`], [], headers, ...records]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function TeamDetailDrawer({
  team,
  weekLabel,
  weekStart,
  detail,
  isLoading,
  onClose,
}: {
  team: SummaryRow | null;
  weekLabel: string;
  weekStart: string;
  detail: TeamDetailData | undefined;
  isLoading: boolean;
  onClose: () => void;
}) {
  const { mutate: downloadDetail, isPending: isDownloading } = trpc.teamPay.getTeamDetail.useMutation({
    onSuccess: (data) => {
      const csv = buildTeamDetailCsv(data.teamName, data.weekStart, data.weekEnd, data.jobs as TeamDetailJob[], data.totalFinalPay);
      const safeName = data.teamName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      triggerCsvDownload(csv, `payroll-${safeName}-${data.weekStart}-to-${data.weekEnd}.csv`);
    },
  });

  if (!team) return null;

  const jobs = detail?.jobs ?? [];
  const isNewPayrollPeriod = jobs[0]?.payrollMode === "2026-08-16";
  const calculatedFinalPay = jobs.reduce((sum, job) => sum + job.finalPay, 0);
  const reconciles = Boolean(detail) && Math.abs(calculatedFinalPay - team.finalPay) < 0.01;

  return <>
    <button type="button" className="psr-drawer-backdrop" aria-label="Close payroll detail" onClick={onClose} />
    <aside className="psr-drawer psr-live-drawer" role="dialog" aria-modal="true" aria-labelledby="psr-drawer-title">
      <header className="psr-drawer-header"><div><span>LIVE PAYROLL DETAIL</span><h2 id="psr-drawer-title">{team.teamName}</h2><p>{weekLabel}</p></div><button type="button" onClick={onClose} aria-label="Close payroll detail"><X size={18} /></button></header>
      <div className="psr-drawer-scroll">
        <section className="psr-drawer-summary"><div><span>{team.teamName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><div><small>PAYROLL PERIOD</small><strong>{weekLabel}</strong><p>{team.jobs} live job{team.jobs === 1 ? "" : "s"} · {team.payoutPct}% payout rate</p></div></div><b>{money(team.finalPay)}</b></section>
        {isLoading ? <div className="psr-live-state"><Loader2 size={16} className="animate-spin" />Loading team payroll detail…</div>
          : !detail ? <div className="psr-live-state">No team detail was returned for this payroll period.</div>
          : jobs.length === 0 ? <div className="psr-live-state">No jobs were found for this team in the selected pay week.</div>
          : <>
            <section className={`psr-reconcile ${reconciles ? "" : "psr-reconcile--warning"}`}><CheckCircle2 size={16} /><div><strong>{reconciles ? "Reconciles to Payroll Summary" : "Detail total needs review"}</strong><span>{reconciles ? "This team detail matches the existing Payroll Summary row total." : "The existing detail total differs from the Payroll Summary row total."}</span></div></section>
            <section className="psr-detail-table-wrap">
              {isNewPayrollPeriod ? <table className="psr-detail-table"><thead><tr><th>Date / time</th><th>Customer</th><th>Job amount</th><th>13% ops</th><th>Net amount</th><th>Pay rate</th><th>Base pay</th><th>Manual</th><th>Final pay</th></tr></thead><tbody>{jobs.map((job) => <tr key={`${job.jobDate}-${job.time}-${job.customer}`}><td><strong>{job.jobDate}</strong><small>{job.time}</small></td><td><strong>{job.customer}</strong><small>{job.service || job.status}</small></td><td>{money(job.jobRevenue ?? 0)}</td><td className="psr-negative">−{money(job.operationalCost ?? 0)}</td><td>{money(job.netJobAmount ?? 0)}</td><td>{job.payoutPct ?? 0}%</td><td>{money(job.basePay)}</td><td className={moneyTone(job.manualAdj)}>{signedMoney(job.manualAdj)}</td><td><strong>{money(job.finalPay)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>TOTAL</td><td>{money(jobs.reduce((sum, job) => sum + (job.jobRevenue ?? 0), 0))}</td><td className="psr-negative">−{money(jobs.reduce((sum, job) => sum + (job.operationalCost ?? 0), 0))}</td><td>{money(jobs.reduce((sum, job) => sum + (job.netJobAmount ?? 0), 0))}</td><td>—</td><td>{money(jobs.reduce((sum, job) => sum + job.basePay, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}</td><td>{money(calculatedFinalPay)}</td></tr></tfoot></table>
              : <table className="psr-detail-table psr-detail-table--legacy"><thead><tr><th>Date / time</th><th>Customer</th><th>Base pay</th><th>Photo</th><th>Rating</th><th>Streak</th><th>Manual</th><th>Reclean</th><th>Complaint</th><th>Final pay</th></tr></thead><tbody>{jobs.map((job) => <tr key={`${job.jobDate}-${job.time}-${job.customer}`}><td><strong>{job.jobDate}</strong><small>{job.time}</small></td><td><strong>{job.customer}</strong><small>{job.service || job.status}</small></td><td>{money(job.basePay)}</td><td className={moneyTone(job.photoAdj)}>{formatMoney(job.photoAdj)}</td><td className={moneyTone(job.ratingAdj)}>{formatMoney(job.ratingAdj)}</td><td className={moneyTone(job.streakBonus)}>{formatMoney(job.streakBonus)}</td><td className={moneyTone(job.manualAdj)}>{formatMoney(job.manualAdj)}</td><td className={moneyTone(job.reclean)}>{formatMoney(job.reclean)}</td><td className={moneyTone(job.complaint)}>{formatMoney(job.complaint)}</td><td><strong>{money(job.finalPay)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>TOTAL</td><td>{money(jobs.reduce((sum, job) => sum + job.basePay, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.photoAdj, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.photoAdj, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.ratingAdj, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.ratingAdj, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.streakBonus, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.streakBonus, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.manualAdj, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.reclean, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.reclean, 0))}</td><td className={moneyTone(jobs.reduce((sum, job) => sum + job.complaint, 0))}>{signedMoney(jobs.reduce((sum, job) => sum + job.complaint, 0))}</td><td>{money(calculatedFinalPay)}</td></tr></tfoot></table>}
            </section>
            <section className="psr-drawer-total"><span>Payroll Summary row total</span><strong>{money(team.finalPay)}</strong></section>
          </>}
      </div>
      <footer><button type="button" onClick={onClose}>Back to summary</button><button type="button" onClick={() => downloadDetail({ teamName: team.teamName, weekStart })} disabled={isDownloading || !detail}><Download size={14} />{isDownloading ? "Building CSV…" : "Detail CSV"}</button></footer>
    </aside>
  </>;
}

export default function PayrollSummaryExactLive() {
  const [, navigate] = useLocation();
  const [weekStart, setWeekStart] = useState(() => fmt(getPayWeekStart(new Date())));
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isWorkbookDownloading, setIsWorkbookDownloading] = useState(false);
  const [loadedDetail, setLoadedDetail] = useState<TeamDetailData | undefined>();

  const weekEnd = useMemo(() => fmt(addDays(new Date(`${weekStart}T00:00:00`), 6)), [weekStart]);
  const weekLabel = useMemo(() => {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(`${weekEnd}T00:00:00`);
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString("en-US", options)} – ${end.toLocaleDateString("en-US", options)}, ${end.getFullYear()}`;
  }, [weekStart, weekEnd]);

  const { data, isLoading, error } = trpc.teamPay.getPayrollSummary.useQuery({ weekStart });
  const { mutate: loadTeamDetail, isPending: isTeamDetailLoading } = trpc.teamPay.getTeamDetail.useMutation({ onSuccess: (detail) => setLoadedDetail(detail as TeamDetailData) });
  const { mutateAsync: loadWorkbookTeamDetail } = trpc.teamPay.getTeamDetail.useMutation();
  const { mutate: runIntegrityCheck, data: checkData, isPending: checkLoading } = trpc.teamPay.getIntegrityCheck.useMutation();

  const rows = (data?.rows ?? []) as SummaryRow[];
  const isNewPayrollPeriod = rows[0]?.payrollMode === "2026-08-16";
  const selectedTeam = rows.find((row) => row.teamName === selectedTeamName) ?? null;
  const totals = useMemo(() => ({
    revenue: rows.reduce((sum, row) => sum + (row.jobRevenue ?? 0), 0),
    operations: rows.reduce((sum, row) => sum + (row.operationalCost ?? 0), 0),
    net: rows.reduce((sum, row) => sum + (row.netJobAmount ?? 0), 0),
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
    triggerCsvDownload(buildSummaryCsv(rows, weekStart, weekEnd), `payroll-summary-${weekStart}-to-${weekEnd}.csv`);
  }, [rows, weekStart, weekEnd]);

  const handleWorkbookDownload = useCallback(async () => {
    if (rows.length === 0 || isWorkbookDownloading) return;
    setIsWorkbookDownloading(true);
    try {
      const teamDetails = await Promise.all(rows.map((row) => loadWorkbookTeamDetail({ teamName: row.teamName, weekStart }))) as TeamDetailData[];
      const { downloadPayrollWorkbook } = await import("@/lib/payrollWorkbook");
      const filename = await downloadPayrollWorkbook({ rows, teamDetails, weekStart, weekEnd });
      toast.success(`${filename} downloaded with ${teamDetails.length} team tab${teamDetails.length === 1 ? "" : "s"}.`);
    } catch (downloadError) {
      console.error("[Payroll Workbook] Download failed", downloadError);
      toast.error(downloadError instanceof Error ? downloadError.message : "Payroll workbook download failed.");
    } finally {
      setIsWorkbookDownloading(false);
    }
  }, [rows, isWorkbookDownloading, loadWorkbookTeamDetail, weekStart, weekEnd]);

  function openTeamDetail(teamName: string) {
    setSelectedTeamName(teamName);
    setLoadedDetail(undefined);
    setDetailOpen(true);
    loadTeamDetail({ teamName, weekStart });
  }

  function onTeamRowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, teamName: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTeamDetail(teamName);
    }
  }

  function prevWeek() { setWeekStart(fmt(addDays(new Date(`${weekStart}T00:00:00`), -7))); }
  function nextWeek() { setWeekStart(fmt(addDays(new Date(`${weekStart}T00:00:00`), 7))); }

  return <main className="payroll-summary-review payroll-summary-exact-live">
    <header className="psr-header">
      <div className="psr-heading"><button type="button" className="psr-return" onClick={() => navigate("/admin/team-pay")}><ArrowLeft size={15} />Team Pay</button><div><p>TEAM OPERATIONS · LIVE PAYROLL</p><h1>Payroll Summary</h1><span>All teams · {weekLabel}</span></div></div>
      <div className="psr-actions"><div className="psr-week-control"><button type="button" onClick={prevWeek} aria-label="Previous pay week"><ChevronLeft size={16} /></button><span><CalendarDays size={14} />{weekLabel}</span><button type="button" onClick={nextWeek} aria-label="Next pay week"><ChevronRight size={16} /></button></div><button type="button" className="psr-action-button" onClick={handleSummaryCsvDownload} disabled={rows.length === 0}><Download size={14} />Summary CSV</button><button type="button" className="psr-action-button primary" onClick={handleWorkbookDownload} disabled={rows.length === 0 || isWorkbookDownloading}>{isWorkbookDownloading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}{isWorkbookDownloading ? "Building workbook…" : "Download Workbook"}</button></div>
    </header>

    <section className="psr-integrity" aria-label="Payroll data integrity check"><div><span className="psr-integrity-icon"><ShieldCheck size={17} /></span><p><strong>Data Integrity Check</strong><small>Verify existing sources for {weekLabel}</small></p></div><button type="button" onClick={() => runIntegrityCheck({ weekStart })} disabled={checkLoading}>{checkLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{checkLoading ? "Checking…" : "Run Check"}</button></section>

    {checkData && !checkLoading && <section className="psr-live-integrity-results" aria-label="Payroll integrity results">{[
      ["Payroll Summary vs Team Pay", checkData.payrollSummaryTotal, checkData.teamPayTotal, "Team Pay"],
      ["Payroll Summary vs Cleaning Portal", checkData.payrollSummaryTotal, checkData.cleaningPortalTotal, "Portal"],
      ["Payroll Summary vs Jobs Board", checkData.payrollSummaryTotal, checkData.jobsBoardTotal, "Jobs Board"],
    ].map(([label, expected, actual, source]) => {
      const matches = Math.abs((expected as number) - (actual as number)) < 0.01;
      return <article className={matches ? "is-match" : "is-mismatch"} key={label as string}><strong>{matches ? "Reconciles" : "Needs review"}</strong><span>{label as string}</span><small>Payroll {money(expected as number)} · {source as string} {money(actual as number)}</small></article>;
    })}</section>}

    {isNewPayrollPeriod && rows.length > 0 && <section className="psr-kpis" aria-label="Payroll summary metrics">{[["JOB AMOUNT", totals.revenue, "default"], ["13% OPS COST", totals.operations, "negative"], ["NET AMOUNT", totals.net, "default"], ["BASE PAY", totals.base, "default"], ["MANUAL ADJ.", totals.manual, totals.manual < 0 ? "negative" : "positive"], ["FINAL PAYROLL", totals.final, "positive"]].map(([label, value, tone]) => <article key={label as string}><small>{label as string}</small><strong className={`tone-${tone}`}>{tone === "negative" ? "−" : ""}{money(value as number)}</strong><span>{label === "FINAL PAYROLL" ? `${totals.jobs} live jobs` : "Live period total"}</span></article>)}</section>}

    <section className="psr-summary-shell" aria-label="Payroll Summary table"><div className="psr-summary-title"><div><span>PAYROLL PERIOD</span><strong>{weekLabel}</strong></div><p>Click a team row to inspect its live payroll detail.</p></div><div className="psr-table-scroll">
      {isLoading ? <div className="psr-live-state"><Loader2 size={16} className="animate-spin" />Loading payroll data…</div>
        : error ? <div className="psr-live-state psr-live-state--error">Failed to load payroll data.</div>
        : rows.length === 0 ? <div className="psr-live-state">No team data for this period.</div>
        : isNewPayrollPeriod ? <div className="psr-summary-table"><div className="psr-table-head"><span>TEAM</span><span>JOBS</span><span>JOB AMOUNT</span><span>13% OPS</span><span>NET AMOUNT</span><span>PAYOUT %</span><span>BASE PAY</span><span>MANUAL ADJ.</span><span>FINAL PAY</span></div>{rows.map((row) => <button type="button" key={row.teamName} className={`psr-table-row ${selectedTeamName === row.teamName ? "is-selected" : ""}`} aria-label={`View ${row.teamName} payroll detail for ${weekLabel}`} onClick={() => openTeamDetail(row.teamName)} onKeyDown={(event) => onTeamRowKeyDown(event, row.teamName)}><span className="psr-team-cell"><i>{row.teamName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</i><strong>{row.teamName}</strong><small>Open live detail</small></span><span>{row.jobs}</span><span>{money(row.jobRevenue ?? 0)}</span><span className="psr-negative">−{money(row.operationalCost ?? 0)}</span><span>{money(row.netJobAmount ?? 0)}</span><span>{row.payoutPct}%</span><span>{money(row.basePay)}</span><span className={moneyTone(row.manualAdj)}>{signedMoney(row.manualAdj)}</span><strong className="psr-final-pay">{money(row.finalPay)}</strong></button>)}<div className="psr-table-total"><span>TOTAL</span><span>{totals.jobs}</span><span>{money(totals.revenue)}</span><span className="psr-negative">−{money(totals.operations)}</span><span>{money(totals.net)}</span><span>—</span><span>{money(totals.base)}</span><span className={moneyTone(totals.manual)}>{signedMoney(totals.manual)}</span><strong>{money(totals.final)}</strong></div></div>
        : <div className="psr-summary-table psr-summary-table--legacy"><div className="psr-table-head"><span>TEAM</span><span>JOBS</span><span>BASE PAY</span><span>RATING</span><span>PHOTO</span><span>STREAK</span><span>GOOGLE</span><span>RECLEAN</span><span>COMPLAINT</span><span>MANUAL</span><span>LATE</span><span>RATE</span><span>FINAL PAY</span></div>{rows.map((row) => <button type="button" key={row.teamName} className={`psr-table-row ${selectedTeamName === row.teamName ? "is-selected" : ""}`} aria-label={`View ${row.teamName} payroll detail for ${weekLabel}`} onClick={() => openTeamDetail(row.teamName)} onKeyDown={(event) => onTeamRowKeyDown(event, row.teamName)}><span className="psr-team-cell"><i>{row.teamName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</i><strong>{row.teamName}</strong><small>Open live detail</small></span><span>{row.jobs}</span><span>{money(row.basePay)}</span><span className={moneyTone(row.ratingAdj)}>{formatMoney(row.ratingAdj)}</span><span className={moneyTone(row.photoAdj)}>{formatMoney(row.photoAdj)}</span><span className={moneyTone(row.streakBonus)}>{formatMoney(row.streakBonus)}</span><span className={moneyTone(row.googleBonus)}>{formatMoney(row.googleBonus)}</span><span className={moneyTone(row.recleanPenalty)}>{formatMoney(row.recleanPenalty)}</span><span className={moneyTone(row.complaintCharge)}>{formatMoney(row.complaintCharge)}</span><span className={moneyTone(row.manualAdj)}>{formatMoney(row.manualAdj)}</span><span>{row.lateCount || "—"}</span><span>{row.payoutPct}%</span><strong className="psr-final-pay">{money(row.finalPay)}</strong></button>)}<div className="psr-table-total"><span>TOTAL</span><span>{totals.jobs}</span><span>{money(totals.base)}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.ratingAdj, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.ratingAdj, 0))}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.photoAdj, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.photoAdj, 0))}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.streakBonus, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.streakBonus, 0))}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.googleBonus, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.googleBonus, 0))}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.recleanPenalty, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.recleanPenalty, 0))}</span><span className={moneyTone(rows.reduce((sum, row) => sum + row.complaintCharge, 0))}>{signedMoney(rows.reduce((sum, row) => sum + row.complaintCharge, 0))}</span><span className={moneyTone(totals.manual)}>{signedMoney(totals.manual)}</span><span>{rows.reduce((sum, row) => sum + row.lateCount, 0) || "—"}</span><span>—</span><strong>{money(totals.final)}</strong></div></div>}
    </div></section>

    {rows.length > 0 && <footer className="psr-payout-callout"><span>Total payout this period</span><strong>{money(totals.final)}</strong><small>Existing payroll calculation and payout data</small></footer>}
    {detailOpen && <TeamDetailDrawer team={selectedTeam} weekLabel={weekLabel} weekStart={weekStart} detail={loadedDetail} isLoading={isTeamDetailLoading} onClose={() => setDetailOpen(false)} />}
  </main>;
}
