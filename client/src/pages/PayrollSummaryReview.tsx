import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, ShieldCheck, X } from "lucide-react";
import "./payroll-summary-review.css";

type StaticPayrollJob = {
  label: string;
  service: string;
  amount: number;
  operations: number;
  payout: number;
  manual: number;
};

type StaticPayrollTeam = {
  key: string;
  name: string;
  initials: string;
  jobs: StaticPayrollJob[];
  payoutPct: number;
};

const STATIC_WEEKS = ["Aug 30 – Sep 5, 2026", "Sep 6 – Sep 12, 2026", "Sep 13 – Sep 19, 2026", "Sep 20 – Sep 26, 2026"];

const STATIC_TEAMS: StaticPayrollTeam[] = [
  { key: "north", name: "Team North", initials: "TN", payoutPct: 44, jobs: [{ label: "Static visit A", service: "Recurring home service", amount: 318, operations: 41.34, payout: 122.61, manual: 0 }, { label: "Static visit B", service: "Deep home service", amount: 442, operations: 57.46, payout: 169.20, manual: 15 }, { label: "Static visit C", service: "Recurring home service", amount: 284, operations: 36.92, payout: 108.28, manual: 0 }] },
  { key: "central", name: "Team Central", initials: "TC", payoutPct: 45, jobs: [{ label: "Static visit D", service: "Standard home service", amount: 256, operations: 33.28, payout: 100.22, manual: 0 }, { label: "Static visit E", service: "Move-in service", amount: 468, operations: 60.84, payout: 183.22, manual: -10 }, { label: "Static visit F", service: "Deep home service", amount: 392, operations: 50.96, payout: 153.47, manual: 0 }, { label: "Static visit G", service: "Recurring home service", amount: 308, operations: 40.04, payout: 120.78, manual: 0 }] },
  { key: "west", name: "Team West", initials: "TW", payoutPct: 43, jobs: [{ label: "Static visit H", service: "Recurring home service", amount: 336, operations: 43.68, payout: 125.90, manual: 0 }, { label: "Static visit I", service: "Standard home service", amount: 228, operations: 29.64, payout: 85.22, manual: 0 }, { label: "Static visit J", service: "Post-construction service", amount: 514, operations: 66.82, payout: 193.26, manual: 20 }] },
  { key: "east", name: "Team East", initials: "TE", payoutPct: 44, jobs: [{ label: "Static visit K", service: "Deep home service", amount: 384, operations: 49.92, payout: 147.88, manual: 0 }, { label: "Static visit L", service: "Recurring home service", amount: 292, operations: 37.96, payout: 112.66, manual: 0 }, { label: "Static visit M", service: "Move-out service", amount: 476, operations: 61.88, payout: 183.09, manual: 0 }] },
  { key: "harbor", name: "Team Harbor", initials: "TH", payoutPct: 42, jobs: [{ label: "Static visit N", service: "Standard home service", amount: 244, operations: 31.72, payout: 89.16, manual: 0 }, { label: "Static visit O", service: "Deep home service", amount: 418, operations: 54.34, payout: 152.46, manual: 0 }] },
];

const money = (value: number) => `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (value: number) => value === 0 ? "—" : `${value > 0 ? "+" : "−"}${money(value)}`;

function TeamRow({ team, selected, onSelect }: { team: StaticPayrollTeam; selected: boolean; onSelect: () => void }) {
  const totals = team.jobs.reduce((result, job) => ({
    amount: result.amount + job.amount,
    operations: result.operations + job.operations,
    base: result.base + job.payout,
    manual: result.manual + job.manual,
  }), { amount: 0, operations: 0, base: 0, manual: 0 });
  const finalPay = totals.base + totals.manual;

  return <button type="button" className={`psr-table-row ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-label={`Open static ${team.name} payroll detail`}>
    <span className="psr-team-cell"><i>{team.initials}</i><strong>{team.name}</strong><small>Open static detail</small></span>
    <span>{team.jobs.length}</span>
    <span>{money(totals.amount)}</span>
    <span className="psr-negative">−{money(totals.operations)}</span>
    <span>{money(totals.amount - totals.operations)}</span>
    <span>{team.payoutPct}%</span>
    <span>{money(totals.base)}</span>
    <span className={totals.manual < 0 ? "psr-negative" : totals.manual > 0 ? "psr-positive" : "psr-muted"}>{signedMoney(totals.manual)}</span>
    <strong className="psr-final-pay">{money(finalPay)}</strong>
  </button>;
}

function StaticPayrollDrawer({ team, week, onClose }: { team: StaticPayrollTeam; week: string; onClose: () => void }) {
  const totals = team.jobs.reduce((result, job) => ({
    amount: result.amount + job.amount,
    operations: result.operations + job.operations,
    base: result.base + job.payout,
    manual: result.manual + job.manual,
  }), { amount: 0, operations: 0, base: 0, manual: 0 });
  const finalPay = totals.base + totals.manual;

  return <>
    <button type="button" className="psr-drawer-backdrop" aria-label="Close static payroll detail" onClick={onClose} />
    <aside className="psr-drawer" role="dialog" aria-modal="true" aria-labelledby="psr-drawer-title">
      <header className="psr-drawer-header"><div><span>STATIC PAYROLL DETAIL</span><h2 id="psr-drawer-title">{team.name}</h2><p>{week}</p></div><button type="button" onClick={onClose} aria-label="Close static payroll detail"><X size={18} /></button></header>
      <div className="psr-drawer-scroll">
        <section className="psr-drawer-summary"><div><span>{team.initials}</span><div><small>PAYROLL PERIOD</small><strong>{week}</strong><p>{team.jobs.length} static visits · {team.payoutPct}% payout rate</p></div></div><b>{money(finalPay)}</b></section>
        <section className="psr-reconcile"><CheckCircle2 size={16} /><div><strong>Static period reconciles</strong><span>Detail and summary totals are sample values for visual review only.</span></div></section>
        <section className="psr-detail-table-wrap"><table className="psr-detail-table"><thead><tr><th>Static visit</th><th>Job amount</th><th>13% ops</th><th>Net amount</th><th>Base pay</th><th>Manual</th><th>Final pay</th></tr></thead><tbody>{team.jobs.map(job => <tr key={job.label}><td><strong>{job.label}</strong><small>{job.service}</small></td><td>{money(job.amount)}</td><td className="psr-negative">−{money(job.operations)}</td><td>{money(job.amount - job.operations)}</td><td>{money(job.payout)}</td><td className={job.manual < 0 ? "psr-negative" : job.manual > 0 ? "psr-positive" : "psr-muted"}>{signedMoney(job.manual)}</td><td><strong>{money(job.payout + job.manual)}</strong></td></tr>)}</tbody><tfoot><tr><td>TOTAL</td><td>{money(totals.amount)}</td><td className="psr-negative">−{money(totals.operations)}</td><td>{money(totals.amount - totals.operations)}</td><td>{money(totals.base)}</td><td className={totals.manual < 0 ? "psr-negative" : totals.manual > 0 ? "psr-positive" : "psr-muted"}>{signedMoney(totals.manual)}</td><td>{money(finalPay)}</td></tr></tfoot></table></section>
        <section className="psr-drawer-total"><span>Payroll Summary row total</span><strong>{money(finalPay)}</strong></section>
      </div>
      <footer><button type="button" onClick={onClose}>Back to summary</button><button type="button" onClick={() => undefined}><Download size={14} />Static export</button></footer>
    </aside>
  </>;
}

export default function PayrollSummaryReview() {
  const [weekIndex, setWeekIndex] = useState(2);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const week = STATIC_WEEKS[weekIndex];
  const detailTeam = STATIC_TEAMS.find(team => team.key === detailKey) ?? null;

  const totals = useMemo(() => STATIC_TEAMS.reduce((result, team) => team.jobs.reduce((jobTotals, job) => ({
    amount: jobTotals.amount + job.amount,
    operations: jobTotals.operations + job.operations,
    base: jobTotals.base + job.payout,
    manual: jobTotals.manual + job.manual,
    jobs: jobTotals.jobs + 1,
  }), result), { amount: 0, operations: 0, base: 0, manual: 0, jobs: 0 }), []);
  const finalPayroll = totals.base + totals.manual;

  useEffect(() => { if (!detailTeam) return; const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setDetailKey(null); window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [detailTeam]);
  const staticAction = (label: string) => setNotice(`${label} is review-only — no payroll data or payout was changed.`);

  return <main className="payroll-summary-review" data-review-only="true">
    <header className="psr-header">
      <div className="psr-heading"><button type="button" className="psr-return" onClick={() => staticAction("Team Pay return")}><ArrowLeft size={15} />Team Pay</button><div><p>TEAM OPERATIONS · STATIC REVIEW</p><h1>Payroll Summary</h1><span>All teams · {week}</span></div></div>
      <div className="psr-actions"><div className="psr-week-control"><button type="button" onClick={() => setWeekIndex(index => Math.max(0, index - 1))} disabled={weekIndex === 0} aria-label="Previous static week"><ChevronLeft size={16} /></button><span><CalendarDays size={14} />{week}</span><button type="button" onClick={() => setWeekIndex(index => Math.min(STATIC_WEEKS.length - 1, index + 1))} disabled={weekIndex === STATIC_WEEKS.length - 1} aria-label="Next static week"><ChevronRight size={16} /></button></div><button type="button" className="psr-action-button" onClick={() => staticAction("Summary CSV")}><Download size={14} />Summary CSV</button><button type="button" className="psr-action-button primary" onClick={() => staticAction("Workbook download")}><FileSpreadsheet size={14} />Download Workbook</button></div>
    </header>

    <section className="psr-integrity" aria-label="Static payroll data integrity check"><div><span className="psr-integrity-icon"><ShieldCheck size={17} /></span><p><strong>Data Integrity Check</strong><small>Static visual check for {week}</small></p></div><button type="button" onClick={() => staticAction("Integrity check")}><ShieldCheck size={14} />Run Check</button></section>

    <section className="psr-kpis" aria-label="Static payroll summary metrics">{[
      ["JOB AMOUNT", totals.amount, "default"],
      ["13% OPS COST", totals.operations, "negative"],
      ["NET AMOUNT", totals.amount - totals.operations, "default"],
      ["BASE PAY", totals.base, "default"],
      ["MANUAL ADJ.", totals.manual, totals.manual < 0 ? "negative" : "positive"],
      ["FINAL PAYROLL", finalPayroll, "positive"],
    ].map(([label, value, tone]) => <article key={label as string}><small>{label as string}</small><strong className={`tone-${tone}`}>{tone === "negative" ? "−" : ""}{money(value as number)}</strong><span>{label === "FINAL PAYROLL" ? `${totals.jobs} static visits` : "Static sample total"}</span></article>)}</section>

    {notice && <div className="psr-notice" role="status">{notice}</div>}

    <section className="psr-summary-shell" aria-label="Static Payroll Summary table"><div className="psr-summary-title"><div><span>PAYROLL PERIOD</span><strong>{week}</strong></div><p>Click a team row to inspect its static payroll detail.</p></div><div className="psr-table-scroll"><div className="psr-summary-table"><div className="psr-table-head"><span>TEAM</span><span>JOBS</span><span>JOB AMOUNT</span><span>13% OPS</span><span>NET AMOUNT</span><span>PAYOUT %</span><span>BASE PAY</span><span>MANUAL ADJ.</span><span>FINAL PAY</span></div>{STATIC_TEAMS.map(team => <TeamRow key={team.key} team={team} selected={detailKey === team.key} onSelect={() => setDetailKey(team.key)} />)}<div className="psr-table-total"><span>TOTAL</span><span>{totals.jobs}</span><span>{money(totals.amount)}</span><span className="psr-negative">−{money(totals.operations)}</span><span>{money(totals.amount - totals.operations)}</span><span>—</span><span>{money(totals.base)}</span><span className={totals.manual < 0 ? "psr-negative" : totals.manual > 0 ? "psr-positive" : "psr-muted"}>{signedMoney(totals.manual)}</span><strong>{money(finalPayroll)}</strong></div></div></div></section>

    <footer className="psr-payout-callout"><span>Total payout this period</span><strong>{money(finalPayroll)}</strong><small>Static sample values · no payment is connected</small></footer>
    {detailTeam && <StaticPayrollDrawer team={detailTeam} week={week} onClose={() => setDetailKey(null)} />}
  </main>;
}
