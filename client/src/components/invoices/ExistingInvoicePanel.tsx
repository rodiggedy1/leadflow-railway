import { useEffect, useRef, useState } from "react";
import { invoiceBalance, invoiceTotal, safeSum, type InvoiceExistingSearchInput, type InvoiceExistingSearchResult, type InvoiceExistingSummary, type InvoiceExistingView, type PayableInvoice } from "../../../../shared/payableInvoice";
import "./existing-invoice-panel.css";

export type ExistingInvoiceRequest = <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (value: string) => {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Date needs review";
};
const statusLabel = (status: PayableInvoice["status"]) => ({ open: "Open invoice", partially_paid: "Partially paid", paid: "Paid", void: "Voided", payment_review: "Payment under review" }[status] || "Needs review");

/** Only the server's opaque customer path on the current configured origin. */
export function existingInvoicePublicUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.search || url.hash || !/^\/invoice\/[a-f0-9]{64}$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function existingInvoiceAmounts(invoice: PayableInvoice) {
  try {
    const amountCents = invoiceTotal(invoice.lines);
    const paidCents = safeSum(invoice.lines.map(row => row.paidCents));
    const balanceCents = invoiceBalance(invoice.lines);
    safeSum(invoice.lines.map(row => row.manualPaidCents || 0));
    if (invoice.lines.some(row => (row.manualPaidCents || 0) > row.paidCents)) return null;
    return { amountCents, paidCents, balanceCents };
  } catch { return null; }
}
const editable = (invoice: PayableInvoice) => (invoice.status === "open" || invoice.status === "partially_paid") && !invoice.activeAttemptId;
const eligibleLine = (row: PayableInvoice["lines"][number]) => Number.isSafeInteger(row.id) && row.id > 0 && row.paidCents === 0 && row.amountCents > 0;

export default function ExistingInvoicePanel({ request, onCreateNew }: { request: ExistingInvoiceRequest; onCreateNew: () => void }) {
  const [search, setSearch] = useState("");
  const [matchedSearch, setMatchedSearch] = useState<string | null>(null);
  const [results, setResults] = useState<InvoiceExistingSummary[]>([]);
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [view, setView] = useState<InvoiceExistingView | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const currentRequest = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const saving = useRef(false);
  const markKey = useRef(crypto.randomUUID());
  const copyVersion = useRef(0);
  const current = (abort: AbortController) => mounted.current && !abort.signal.aborted && currentRequest.current === abort;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentRequest.current?.abort(); currentRequest.current = null; copyVersion.current++; };
  }, []);
  const clearSelection = () => { setSelected([]); setPaidConfirmed(false); markKey.current = crypto.randomUUID(); copyVersion.current++; };
  const begin = (name: string) => {
    currentRequest.current?.abort();
    const abort = new AbortController(); currentRequest.current = abort;
    busyRef.current = true; saving.current = name === "save";
    setBusy(true); setAction(name); setError(""); setNotice(""); copyVersion.current++;
    return abort;
  };
  const finish = (abort: AbortController) => {
    if (!current(abort)) return;
    busyRef.current = false; saving.current = false; setBusy(false); setAction("");
  };
  const changeSearch = (value: string) => {
    if (!mounted.current || saving.current) return;
    currentRequest.current?.abort(); currentRequest.current = null; busyRef.current = false;
    setBusy(false); setAction(""); setSearch(value); setMatchedSearch(null); setResults([]); setBeforeId(null); setView(null); clearSelection(); setError(""); setNotice("");
  };
  const find = async (more = false) => {
    if (!mounted.current || busyRef.current || (more && (!beforeId || matchedSearch === null || search.trim() !== matchedSearch))) return;
    const query = more ? matchedSearch! : search.trim();
    const input: InvoiceExistingSearchInput = { search: query, ...(more ? { beforeId: beforeId! } : {}) };
    const abort = begin("search");
    if (!more) { setMatchedSearch(null); setResults([]); setBeforeId(null); setView(null); clearSelection(); }
    try {
      const data = await request<InvoiceExistingSearchResult>("/admin/existing/search", "POST", input, abort.signal);
      if (!current(abort)) return;
      // The server bounds each page to 50; preserve stable IDs when appending.
      const page = data.invoices.slice(0, 50);
      setResults(old => Array.from(new Map((more ? [...old, ...page] : page).map(row => [row.id, row])).values()));
      setMatchedSearch(query);
      setBeforeId(Number.isSafeInteger(data.nextBeforeId) && data.nextBeforeId! > 0 && (!more || data.nextBeforeId! < input.beforeId!) ? data.nextBeforeId : null);
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Could not find invoices. Please try again."); }
    finally { finish(abort); }
  };
  const replaceView = (data: InvoiceExistingView) => {
    setView(data); clearSelection();
    const totals = existingInvoiceAmounts(data.invoice);
    if (totals) setResults(old => old.map(row => row.id === data.invoice.id ? { id: data.invoice.id, number: data.invoice.number, clientName: data.invoice.clientName, from: data.invoice.from, to: data.invoice.to, dueDate: data.invoice.dueDate, status: data.invoice.status, ...totals } : row));
  };
  const open = async (id: number, refresh = false) => {
    if (!mounted.current || saving.current || !Number.isSafeInteger(id) || id <= 0 || (refresh && busyRef.current)) return;
    const abort = begin(refresh ? "refresh" : "open");
    clearSelection(); if (!refresh) setView(null);
    try {
      const data = await request<InvoiceExistingView>(`/admin/existing/${id}`, "GET", undefined, abort.signal);
      if (!current(abort)) return;
      if (data.invoice.id !== id) throw new Error("Invoice data could not be verified. Refresh saved invoice.");
      replaceView(data);
    } catch (value) { if (current(abort)) { setView(null); setError(value instanceof Error ? value.message : "Could not open this invoice. Please try again."); } }
    finally { finish(abort); }
  };
  const invoice = view?.invoice;
  const totals = invoice ? existingInvoiceAmounts(invoice) : null;
  const canEdit = !!invoice && !!totals && editable(invoice) && new Set(invoice.lines.map(row => row.id)).size === invoice.lines.length && /^[a-f0-9]{64}$/.test(view!.reviewHash);
  const eligible = canEdit ? invoice!.lines.filter(eligibleLine) : [];
  const selectedRows = eligible.filter(row => selected.includes(row.id));
  const selectedAmount = safeSum(selectedRows.map(row => row.amountCents));
  const changeSelection = (ids: number[]) => {
    if (!mounted.current || busyRef.current || !canEdit) return;
    setSelected(Array.from(new Set(ids)).filter(id => eligible.some(row => row.id === id))); setPaidConfirmed(false); setError(""); setNotice(""); markKey.current = crypto.randomUUID();
  };
  const save = async () => {
    if (!mounted.current || busyRef.current || !view || !canEdit || !paidConfirmed || !selectedRows.length) return;
    const id = view.invoice.id;
    const abort = begin("save");
    try {
      const data = await request<InvoiceExistingView>(`/admin/existing/${id}/mark-paid`, "POST", { requestId: markKey.current, lineIds: selectedRows.map(row => row.id), reviewHash: view.reviewHash, confirmed: true }, abort.signal);
      if (!current(abort)) return;
      if (data.invoice.id !== id) throw new Error("Invoice data could not be verified. Refresh saved invoice.");
      replaceView(data); setNotice("Invoice updated. Payment recorded by staff. No charge was made and no email or SMS was sent. The invoice number and customer link are unchanged.");
    } catch (value) {
      // Keep the same UUID and selection after ambiguous failures; no automatic retry.
      if (current(abort)) setError(value instanceof Error ? value.message : "Invoice updates could not be saved. Retry the same selection or refresh saved invoice before changing it.");
    } finally { finish(abort); }
  };
  const publicUrl = view && typeof window !== "undefined" ? existingInvoicePublicUrl(view.url, window.location.origin) : null;
  const copy = async () => {
    if (!mounted.current || busyRef.current || !publicUrl) return;
    const version = ++copyVersion.current;
    try { await navigator.clipboard.writeText(publicUrl); if (mounted.current && copyVersion.current === version) { setNotice("Invoice link copied."); setError(""); } }
    catch { if (mounted.current && copyVersion.current === version) setError("Could not copy the link. Open the customer page and copy its address."); }
  };
  return <section className="ic-existing" aria-label="Existing invoices">
    <header className="ic-existing-heading"><div><span className="ic-existing-eyebrow">FINANCE / EXISTING INVOICES</span><h1>Open an existing invoice</h1><p>Find a saved invoice and record payments already received. Keep the same invoice and customer link.</p></div><button type="button" className="ic-existing-secondary" disabled={busy} onClick={() => { if (mounted.current && !busyRef.current) onCreateNew(); }}>Create new invoice</button></header>
    <form className="ic-existing-search" onSubmit={event => { event.preventDefault(); void find(); }}><label htmlFor="ic-existing-search">Invoice number, client name, phone or email<input id="ic-existing-search" value={search} maxLength={320} disabled={action === "save"} onChange={event => changeSearch(event.target.value)} autoComplete="off" /></label><button type="submit" disabled={busy}>{action === "search" ? "Finding…" : "Find invoices"}</button><p>Leave the search blank to find recent invoices. Nothing loads until you click Find invoices.</p></form>
    {matchedSearch !== null && <section className="ic-existing-results" aria-label="Invoice search results"><h2>{results.length ? "Saved invoices" : "No matching invoices"}</h2>{results.map(row => <div className="ic-existing-result" key={row.id}><div><strong>{row.number} · {row.clientName}</strong><span>{day(row.from)} — {day(row.to)} · {statusLabel(row.status)}</span></div><div><strong>{money(row.balanceCents)} remaining</strong><button type="button" disabled={action === "save" || action === "search"} onClick={() => void open(row.id)}>Open {row.number}</button></div></div>)}{beforeId && <button type="button" className="ic-existing-secondary" disabled={busy} onClick={() => void find(true)}>Load more invoices</button>}</section>}
    {action === "open" && <p role="status">Opening saved invoice…</p>}
    {view && invoice && <div className="ic-existing-grid"><section className="ic-existing-document"><header><div><h2>{invoice.number}</h2><strong>{view.client.name}</strong><p>{day(invoice.from)} — {day(invoice.to)} · Due {day(invoice.dueDate)}</p></div><span className="ic-existing-status">{statusLabel(invoice.status)}</span></header>
      <div className="ic-existing-select"><label><input type="checkbox" checked={eligible.length > 0 && eligible.every(row => selected.includes(row.id))} disabled={busy || !eligible.length} onChange={() => changeSelection(eligible.every(row => selected.includes(row.id)) ? [] : eligible.map(row => row.id))} />Select all fully unpaid lines</label><span>{selectedRows.length} selected</span></div>
      {invoice.lines.map(row => <label className={`ic-existing-line ${selected.includes(row.id) ? "is-selected" : ""}`} key={row.id}><input type="checkbox" aria-label={`Mark ${day(row.date)} service already paid`} checked={selected.includes(row.id)} disabled={busy || !canEdit || !eligibleLine(row)} onChange={() => changeSelection(selected.includes(row.id) ? selected.filter(id => id !== row.id) : [...selected, row.id])} /><div><strong>{row.description}</strong><span>{day(row.date)} · {row.address || "Address needs review"}</span>{(row.manualPaidCents || 0) > 0 && <small>{money(row.manualPaidCents!)} recorded by staff</small>}<small>{row.paidCents >= row.amountCents ? (row.manualPaidCents || 0) > 0 ? "Paid — recorded by staff" : "Paid" : row.paidCents > 0 ? "Partially paid — needs staff review; this line is read-only." : "Unpaid"}</small></div><div className="ic-existing-line-amounts"><strong>Original price {money(row.amountCents)}</strong><span>Already paid {money(row.paidCents)}</span><span>Remaining {money(row.amountCents - row.paidCents)}</span></div></label>)}
    </section><aside className="ic-existing-summary"><span className="ic-existing-eyebrow">SAVED INVOICE SUMMARY</span>{totals ? <><div><span>Original invoice total</span><strong>{money(totals.amountCents)}</strong></div><div><span>Already paid</span><strong>{money(totals.paidCents)}</strong></div><div className="ic-existing-balance"><span>Remaining balance</span><strong>{money(totals.balanceCents)}</strong></div></> : <p role="alert">Invoice amounts need review. No payment can be recorded here.</p>}
      {!editable(invoice) && <p className="ic-existing-note">{invoice.activeAttemptId ? "A checkout is in progress. This invoice is read-only until that attempt is resolved. Refresh saved invoice to read the latest saved state; this does not contact Stripe." : invoice.status === "paid" ? "This invoice is fully paid and read-only. No payment is due." : invoice.status === "void" ? "This invoice is voided and read-only." : "A payment adjustment needs review. This invoice is read-only; recorded payments do not confirm that every line is paid."}</p>}
      {canEdit && <><h3>Payment already received?</h3><p>Selected service lines: <strong>{selectedRows.length}</strong> · <strong>{money(selectedAmount)}</strong>. This records payment only; it does not charge the customer.</p>{invoice.lines.some(row => row.paidCents > 0 && row.paidCents < row.amountCents) && <p className="ic-existing-note">Partially paid lines, including partial Stripe payments, need staff review and cannot be selected here.</p>}<label className="ic-existing-confirm"><input type="checkbox" checked={paidConfirmed} disabled={busy || !selectedRows.length} onChange={event => { if (!busyRef.current) setPaidConfirmed(event.target.checked); }} />I confirm payment was already received for the {selectedRows.length} selected service line{selectedRows.length === 1 ? "" : "s"} ({money(selectedAmount)}).</label><button type="button" disabled={busy || !paidConfirmed || !selectedRows.length} onClick={() => void save()}>{action === "save" ? "Saving invoice updates…" : "Save invoice updates"}</button></>}
      <button type="button" className="ic-existing-secondary" disabled={busy} onClick={() => void open(invoice.id, true)}>{action === "refresh" ? "Refreshing…" : "Refresh saved invoice"}</button><small className="ic-existing-note">Refresh reads saved invoice data only. No Stripe check or reconciliation is performed.</small>
      {publicUrl ? <div className="ic-existing-links"><a href={publicUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open customer page</a><button type="button" className="ic-existing-secondary" disabled={busy} onClick={() => void copy()}>Copy invoice link</button></div> : <p className="ic-existing-note">The customer link is unavailable on this domain. Open the configured invoice workspace to use it.</p>}
      <small className="ic-existing-note">No new invoice, automatic email or SMS is created by these updates.</small>
    </aside></div>}
    {notice && <p className="ic-existing-notice" role="status">{notice}</p>}{error && <p className="ic-existing-error" role="alert">{error}</p>}
  </section>;
}
