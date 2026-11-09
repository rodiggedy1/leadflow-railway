import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, CreditCard, FileText, LockKeyhole, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { invoiceBalance, invoiceTotal, type InvoiceClient, type InvoiceService, type PayableInvoice } from "../../../shared/payableInvoice";
import "./invoice-collection.css";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const serviceBalance = (row: InvoiceService) => Math.max(0, row.amountCents - (row.paidCents || 0));
export const isInvoicePayable = (invoice: PayableInvoice) => invoice.status === "open" || invoice.status === "partially_paid";
export const invoiceStatusLabel = (invoice: PayableInvoice) => ({ open: "Open invoice", partially_paid: "Partially paid", paid: "Paid", void: "Voided", payment_review: "Payment under review — not payable" }[invoice.status] || "Not payable");
export const linePaymentLabel = (row: PayableInvoice["lines"][number], invoice: PayableInvoice) => row.paidCents >= row.amountCents ? `${(row.manualPaidCents || 0) > 0 ? "Paid — recorded by staff" : "Paid"}${invoice.status === "payment_review" ? " · adjustment under review" : ""}` : "Remaining";
const sampleClient: InvoiceClient = { id: 1, name: "Example Billing Client", phone: "+12025550100", email: "billing@example.test" };
const sampleServices: InvoiceService[] = ["2026-10-03", "2026-10-17", "2026-10-31"].map((date, index) => ({ id: `sample-${index + 1}`, occurrenceKey: `sample-${index + 1}`, date, description: "Standard cleaning", address: "Example property · Washington, DC", amountCents: 22500, paidCents: index === 0 ? 22500 : 0, paymentSource: index === 0 ? "manual" : null, status: index === 0 ? "Paid — recorded by staff" : "Needs billing review", eligible: true, reason: null }));
export const sampleInvoice: PayableInvoice = { id: 1, number: "INV-REVIEW", clientId: 1, clientName: sampleClient.name, from: "2026-10-01", to: "2026-10-31", dueDate: "2026-11-14", currency: "usd", status: "partially_paid", receipts: [], activeAttemptId: null, lines: sampleServices.map((row, index) => ({ id: index + 1, occurrenceKey: row.occurrenceKey, date: row.date, description: row.description, address: row.address, amountCents: row.amountCents, paidCents: row.paidCents || 0, manualPaidCents: row.paymentSource === "manual" ? row.paidCents || 0 : 0 })) };
type LookupResult = { client: InvoiceClient; services: InvoiceService[]; reviewHash: string };
type IssuedResult = { invoice: PayableInvoice; url: string };
const API = "/api/payable-invoices";
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { method, credentials: "same-origin", referrerPolicy: "no-referrer", signal, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" && data.message ? data.message : "Invoice data is unavailable. Please try again.");
  if (!data) throw new Error("Invoice data is unavailable. Please try again.");
  return data;
}
function Brand() { return <div className="ic-brand"><span>M<span>IB</span></span><div><strong>MAIDS IN BLACK</strong><small>Thoughtful service. Simple payments.</small></div></div>; }
function ReviewNotice() { return <div className="ic-review"><ShieldCheck size={16} /><strong>REVIEW ONLY</strong><span>Sample client, service dates, prices and prior payments. No real payment or invoice is created.</span></div>; }

export function InvoiceCollectionPage({ review = false, onPreview }: { review?: boolean; onPreview?: (invoice: PayableInvoice) => void }) {
  const [phone, setPhone] = useState(review ? sampleClient.phone : "");
  const [email, setEmail] = useState(review ? sampleClient.email! : "");
  const [from, setFrom] = useState(review ? sampleInvoice.from : "");
  const [to, setTo] = useState(review ? sampleInvoice.to : "");
  const [dueDate, setDueDate] = useState(review ? sampleInvoice.dueDate : "");
  const [client, setClient] = useState<InvoiceClient | null>(review ? sampleClient : null);
  const [services, setServices] = useState<InvoiceService[]>(review ? sampleServices : []);
  const [reviewHash, setReviewHash] = useState(review ? "sample-review-only" : "");
  const [selected, setSelected] = useState<string[]>(review ? sampleServices.map(row => row.id) : []);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [sent, setSent] = useState(false);
  const [issued, setIssued] = useState<IssuedResult | null>(null);
  const issueKey = useRef(crypto.randomUUID());
  const markKey = useRef(crypto.randomUUID());
  const sendKey = useRef(crypto.randomUUID());
  const mounted = useRef(false);
  const currentRequest = useRef<AbortController | null>(null);
  const selectedRows = services.filter(row => row.eligible && selected.includes(row.id));
  const eligible = services.filter(row => row.eligible);
  const invoiceRows = eligible.filter(row => serviceBalance(row) > 0);
  const periodTotal = eligible.reduce((sum, row) => sum + row.amountCents, 0);
  const periodPaidTotal = eligible.reduce((sum, row) => sum + (row.paidCents || 0), 0);
  const periodBalance = eligible.reduce((sum, row) => sum + serviceBalance(row), 0);
  const currentlyUnpaid = selectedRows.filter(row => serviceBalance(row) > 0);
  const balance = selectedRows.reduce((sum, row) => sum + serviceBalance(row), 0);
  const current = (abort: AbortController) => mounted.current && !abort.signal.aborted && currentRequest.current === abort;
  const begin = (name: string) => { currentRequest.current?.abort(); const abort = new AbortController(); currentRequest.current = abort; setBusy(true); setAction(name); setError(""); setNotice(""); return abort; };
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    if (!review) request<{ paymentsReady: boolean; message?: string }>("/admin/status", "GET", undefined, abort.signal).then(data => {
      if (!mounted.current || abort.signal.aborted) return;
      setReady(data.paymentsReady); setStatusMessage(data.message || ""); setStatusLoaded(true);
    }).catch(value => {
      if (!mounted.current || abort.signal.aborted) return;
      setReady(false); setStatusLoaded(true); setStatusMessage(value instanceof Error ? value.message : "Invoice configuration could not be checked.");
    });
    return () => { mounted.current = false; abort.abort(); currentRequest.current?.abort(); };
  }, [review]);
  const invalidateSelection = () => { setPaidConfirmed(false); setIssued(null); setSendConfirmed(false); setSent(false); setNotice(""); issueKey.current = crypto.randomUUID(); markKey.current = crypto.randomUUID(); };
  const reset = () => { currentRequest.current?.abort(); currentRequest.current = null; setBusy(false); setAction(""); setClient(null); setServices([]); setReviewHash(""); setSelected([]); setError(""); invalidateSelection(); };
  const changeSelection = (ids: string[]) => { setSelected(ids); setPaidConfirmed(false); setNotice(""); markKey.current = crypto.randomUUID(); };
  const toggle = (id: string) => { if (busy || issued || !invoiceRows.some(row => row.id === id)) return; changeSelection(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]); };
  const load = async () => {
    if (!validDate(from) || !validDate(to) || from > to) { setError("Choose a valid From and To service-date period."); return; }
    if (!review && (!phone.trim() || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) { setError("Enter the client’s exact phone and a valid billing email."); return; }
    const abort = begin("lookup"); setClient(null); setServices([]); setReviewHash(""); setSelected([]); invalidateSelection();
    try {
      const data: LookupResult = review ? { client: sampleClient, services: sampleServices.filter(row => row.date >= from && row.date <= to), reviewHash: "sample-review-only" } : await request<LookupResult>("/admin/lookup", "POST", { phone, email, from, to }, abort.signal);
      if (!current(abort)) return;
      setClient(data.client); setServices(data.services); setReviewHash(data.reviewHash);
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Could not load services."); }
    finally { if (current(abort)) { setBusy(false); setAction(""); } }
  };
  const markPaid = async () => {
    if (busy || !client || !reviewHash || !paidConfirmed || !currentlyUnpaid.length || issued) return;
    const abort = begin("mark");
    try {
      const data: LookupResult = review ? { client, reviewHash: "sample-review-only", services: services.map(row => currentlyUnpaid.some(selectedRow => selectedRow.id === row.id) ? { ...row, paidCents: row.amountCents, paymentSource: "manual", status: "Paid — recorded by staff" } : row) } : await request<LookupResult>("/admin/mark-paid", "POST", { requestId: markKey.current, clientId: client.id, from, to, serviceIds: currentlyUnpaid.map(row => row.id), reviewHash }, abort.signal);
      if (!current(abort)) return;
      setClient(data.client); setServices(data.services); setReviewHash(data.reviewHash);
      setSelected([]);
      setPaidConfirmed(false); issueKey.current = crypto.randomUUID(); markKey.current = crypto.randomUUID();
      setNotice(review ? "Sample prior payment recorded in this review only. No request was made." : "Prior payment recorded. No charge was made. The invoice automatically includes the remaining unpaid services.");
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Prior payment could not be recorded."); }
    finally { if (current(abort)) { setBusy(false); setAction(""); } }
  };
  const issue = async () => {
    if (busy || issued || !client || !invoiceRows.length || !validDate(from) || !validDate(to) || from > to || (!review && (!ready || !validDate(dueDate) || !reviewHash))) return;
    if (review) {
      onPreview?.({ ...sampleInvoice, clientName: client.name, from, to, dueDate: dueDate || sampleInvoice.dueDate, status: invoiceRows.some(row => (row.paidCents || 0) > 0) ? "partially_paid" : "open", lines: invoiceRows.map((row, index) => ({ id: index + 1, occurrenceKey: row.occurrenceKey, date: row.date, description: row.description, address: row.address, amountCents: row.amountCents, paidCents: row.paidCents || 0, manualPaidCents: row.paymentSource === "manual" ? row.paidCents || 0 : 0 })) }); return;
    }
    const abort = begin("issue");
    try {
      const result = await request<IssuedResult>("/admin/issue", "POST", { requestId: issueKey.current, clientId: client.id, from, to, dueDate, serviceIds: invoiceRows.map(row => row.id), reviewHash, confirmedUnpaid: true }, abort.signal);
      if (!current(abort)) return;
      setIssued(result); setSendConfirmed(false); setSent(false); sendKey.current = crypto.randomUUID();
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Invoice could not be issued."); }
    finally { if (current(abort)) { setBusy(false); setAction(""); } }
  };
  const send = async () => {
    if (review || busy || !issued || !client?.email || !sendConfirmed || sent) return;
    const abort = begin("send");
    try {
      const result = await request<{ message?: string }>(`/admin/${issued.invoice.id}/send`, "POST", { requestId: sendKey.current, confirmed: true }, abort.signal);
      if (!current(abort)) return;
      setSent(true); setSendConfirmed(false); setNotice(result.message || "Invoice email sent to the verified billing recipient.");
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Invoice email could not be sent."); }
    finally { if (current(abort)) { setBusy(false); setAction(""); } }
  };
  const copy = async () => { if (!issued) return; try { await navigator.clipboard.writeText(new URL(issued.url, window.location.origin).href); if (mounted.current) setNotice("Invoice link copied."); } catch { if (mounted.current) setError("Could not copy the link. Open the customer page and copy its address."); } };
  return <main className="ic-admin ic-page">{review && <ReviewNotice />}<header className="ic-nav"><Brand /><a href={review ? "#" : "/admin/invoices"} onClick={review ? event => event.preventDefault() : undefined}><ArrowLeft size={15} /> Invoice workspace</a></header>
    <div className="ic-admin-wrap"><div className="ic-page-heading"><span className="ic-eyebrow">FINANCE / INVOICE BUILDER</span><h1>One invoice.<br /><span>Every service date.</span></h1><p>Select your client and billing period, review their services, then create one simple payment page.</p></div>
    <div className="ic-builder-grid"><section className="ic-builder-main"><section className="ic-client-card"><div className="ic-section-title"><span className="ic-step">01</span><div><h2>Client & billing period</h2><p>Match the exact billing contact before pulling services.</p></div><Search size={20} /></div><div className="ic-client-fields"><label>Client phone<input value={phone} onChange={event => { reset(); setPhone(event.target.value); }} autoComplete="off" /></label><label>Billing email<input type="email" value={email} onChange={event => { reset(); setEmail(event.target.value); }} autoComplete="off" /></label><label>From service date<input type="date" value={from} onChange={event => { reset(); setFrom(event.target.value); }} /></label><label>To service date<input type="date" value={to} onChange={event => { reset(); setTo(event.target.value); }} /></label></div><div className="ic-client-footer"><span>{client ? <><Check size={15} /> {client.name}</> : review ? "Choose sample dates to explore the builder" : "Select a verified billing client using their exact phone and email."}</span><button onClick={load} disabled={busy}>{action === "lookup" ? "Loading…" : "Pull bookings"}<ArrowRight size={15} /></button></div></section>
    <section className="ic-service-panel"><div className="ic-section-title"><span className="ic-step">02</span><div><h2>Review service dates</h2><p>All unpaid dates are invoiced automatically. Paid dates remain visible for your records.</p></div><span className="ic-count">{services.length} services</span></div><div className="ic-select-bar"><strong>All unpaid dates are included automatically</strong><span>{invoiceRows.length} unpaid</span></div>
    {services.length ? services.map(row => <label className={`ic-service-row ${selected.includes(row.id) ? "is-selected" : ""} ${serviceBalance(row) === 0 ? "is-paid" : ""}`} key={row.id}><input type="checkbox" aria-label={`Mark ${day(row.date)} service already paid`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} disabled={!row.eligible || serviceBalance(row) === 0 || busy || !!issued} /><div className="ic-date-tile"><b>{new Date(`${row.date}T12:00:00`).getDate()}</b><span>{new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span></div><div className="ic-service-info"><strong>{row.description}</strong><span>{day(row.date)} · {row.address || "Address needs review"}</span><small>{serviceBalance(row) === 0 ? row.paymentSource === "manual" ? "Paid — recorded by staff" : "Paid" : row.reason || (row.paidCents ? `${money(row.paidCents)} payment recorded · review remaining balance` : "Review this unpaid service before issuing")}</small></div><div className="ic-row-price"><b>{money(row.amountCents)}</b><small>{serviceBalance(row) === 0 ? "Paid" : row.paidCents ? `${money(serviceBalance(row))} remaining` : "Unpaid"}</small></div></label>) : <div className="ic-empty"><FileText size={28} /><h3>No services loaded</h3><p>Choose the billing period and pull this client’s bookings. We never fill in missing service dates or prices.</p></div>}
    {services.length > 0 && <div className="ic-mark-paid"><h3>Already paid before this invoice?</h3><p>Use the row checkboxes only to record payments already received. They do not change which unpaid dates are invoiced. No charge is made.</p><label className="ic-confirm"><input type="checkbox" checked={invoiceRows.length > 0 && invoiceRows.every(row => selected.includes(row.id))} disabled={!invoiceRows.length || busy || !!issued} onChange={() => changeSelection(invoiceRows.every(row => selected.includes(row.id)) ? [] : invoiceRows.map(row => row.id))} />Select all unpaid dates to mark paid</label><label className="ic-confirm"><input type="checkbox" checked={paidConfirmed} onChange={event => setPaidConfirmed(event.target.checked)} disabled={busy || !currentlyUnpaid.length || !!issued} />I confirm payment was already received for the {currentlyUnpaid.length} selected unpaid service{currentlyUnpaid.length === 1 ? "" : "s"} ({money(balance)}).</label><button className="ic-secondary" onClick={markPaid} disabled={busy || !client || !reviewHash || !paidConfirmed || !currentlyUnpaid.length || !!issued}>{action === "mark" ? "Recording payment…" : "Mark selected services already paid"}<Check size={15} /></button></div>}</section></section>
    <aside className="ic-summary"><span className="ic-eyebrow">INVOICE SUMMARY</span><h2>{client?.name || "Select a verified client"}</h2><p>{from && to ? `${day(from)} — ${day(to)}` : "Service-date period not selected"}</p><div className="ic-summary-line"><span>Unpaid services</span><strong>{invoiceRows.length}</strong></div><div className="ic-summary-line"><span>Service total</span><strong>{money(periodTotal)}</strong></div><div className="ic-summary-line"><span>Already paid</span><strong>{money(periodPaidTotal)}</strong></div><div className="ic-grand-total"><span>Remaining balance</span><b>{money(periodBalance)}</b><small>All unpaid services in this period. Recorded payments are deducted automatically.</small></div><label className="ic-due">Payment due date<input type="date" value={dueDate} disabled={busy} onChange={event => { setDueDate(event.target.value); invalidateSelection(); }} /></label>
    {!review && !ready && <p className="ic-gate">{statusLoaded ? statusMessage || "Secure payments are not configured. Please contact your administrator." : "Checking invoice configuration…"}</p>}
    {client && !invoiceRows.length && <p className="ic-gate">No eligible unpaid services in this period. Nothing remains to invoice.</p>}
    {!review && client && invoiceRows.length > 0 && !validDate(dueDate) && <p className="ic-gate">Choose a payment due date to create the invoice page.</p>}
    <button className="ic-primary" onClick={issue} disabled={busy || !!issued || !client || !invoiceRows.length || !validDate(from) || !validDate(to) || from > to || (!review && (!ready || !validDate(dueDate) || !reviewHash))}>{action === "issue" ? "Creating invoice…" : review ? "Preview customer page" : "Create invoice page"}<ArrowRight size={16} /></button><div className="ic-secure"><LockKeyhole size={13} /> No charge is made when creating an invoice.</div>{issued && <div className="ic-created"><strong>Invoice page created</strong><a href={issued.url} target="_blank" rel="noopener noreferrer">Open customer page</a><button onClick={copy}><Copy size={13} /> Copy invoice link</button><a href={`${API}/admin/${issued.invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">Download PDF</a><small>{sent ? "Invoice email sent." : "No email or SMS has been sent."}</small>{client?.email ? <><label className="ic-confirm"><input type="checkbox" checked={sendConfirmed} onChange={event => setSendConfirmed(event.target.checked)} disabled={busy || sent} /><span>Send this invoice to the verified billing email: <strong>{client.email}</strong></span></label><button onClick={send} disabled={busy || !sendConfirmed || sent}>{action === "send" ? "Sending invoice…" : sent ? "Invoice sent" : "Send invoice"}<ArrowRight size={13} /></button></> : <small>No verified billing email is stored. The invoice has not been emailed.</small>}</div>}</aside></div>{notice && <p className="ic-notice" role="status">{notice}</p>}{error && <p className="ic-error" role="alert">{error}</p>}</div></main>;
}

export function CustomerInvoicePage({ review = false, reviewInvoice = sampleInvoice }: { review?: boolean; reviewInvoice?: PayableInvoice }) {
  const [invoice, setInvoice] = useState<PayableInvoice | null>(review ? reviewInvoice : null);
  const [ids, setIds] = useState<number[]>(review ? reviewInvoice.lines.filter(row => row.paidCents < row.amountCents).map(row => row.id) : []);
  const [ready, setReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [reviewMessage, setReviewMessage] = useState(false);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const attemptKey = useRef(crypto.randomUUID());
  const currentRequest = useRef<AbortController | null>(null);
  const token = review ? "sample" : window.location.pathname.split("/").filter(Boolean).pop() || "";
  const current = (abort: AbortController) => mounted.current && !abort.signal.aborted && currentRequest.current === abort;
  const refresh = async (abort: AbortController) => {
    if (review) return;
    setError("");
    try {
      const data = await request<{ invoice: PayableInvoice; paymentsReady: boolean; message?: string }>(`/${encodeURIComponent(token)}`, "GET", undefined, abort.signal);
      if (!current(abort)) return;
      setInvoice(data.invoice); setReady(data.paymentsReady); setStatusMessage(data.message || "");
      const unpaid = data.invoice.lines.filter(row => row.paidCents < row.amountCents).map(row => row.id);
      setIds(old => data.invoice.activeAttemptId ? (data.invoice.activeLineIds || unpaid).filter(id => unpaid.includes(id)) : initialized.current ? old.filter(id => unpaid.includes(id)) : unpaid);
      initialized.current = true;
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Invoice unavailable."); }
  };
  useEffect(() => {
    mounted.current = true; initialized.current = false; attemptKey.current = crypto.randomUUID();
    setInvoice(review ? reviewInvoice : null); setIds(review ? reviewInvoice.lines.filter(row => row.paidCents < row.amountCents).map(row => row.id) : []);
    setReviewMessage(false); setError(""); setReady(false); setBusy(false);
    const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]'); const previous = existing?.content;
    const meta = existing || document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; if (!existing) document.head.appendChild(meta);
    const abort = new AbortController(); currentRequest.current = abort; void refresh(abort);
    return () => { mounted.current = false; abort.abort(); currentRequest.current?.abort(); if (!existing) meta.remove(); else if (previous !== undefined) meta.content = previous; };
  }, [token, review, reviewInvoice]);
  const unpaid = invoice?.lines.filter(row => row.paidCents < row.amountCents) || [];
  const selectedRows = unpaid.filter(row => ids.includes(row.id));
  const total = selectedRows.reduce((sum, row) => sum + row.amountCents - row.paidCents, 0);
  const payable = !!invoice && isInvoicePayable(invoice);
  const toggle = (id: number) => { if (busy || !payable || invoice?.activeAttemptId || !unpaid.some(row => row.id === id)) return; setIds(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id]); attemptKey.current = crypto.randomUUID(); setReviewMessage(false); };
  const pay = async () => {
    if (!payable || !selectedRows.length || total <= 0 || busy) return;
    if (review) { setReviewMessage(true); return; }
    if (!ready) return;
    setBusy(true); setAction("pay"); setError(""); currentRequest.current?.abort(); const abort = new AbortController(); currentRequest.current = abort;
    try {
      const data = invoice?.activeAttemptId ? await request<{ url?: string; refresh?: boolean }>(`/${encodeURIComponent(token)}/resume`, "POST", {}, abort.signal) : await request<{ url?: string; refresh?: boolean }>(`/${encodeURIComponent(token)}/checkout`, "POST", { requestId: attemptKey.current, lineIds: selectedRows.map(row => row.id) }, abort.signal);
      if (!current(abort)) return;
      if (data.refresh) { await refresh(abort); return; }
      if (!data.url) throw new Error("Secure checkout is not available yet.");
      const url = new URL(data.url); if (url.origin !== "https://checkout.stripe.com") throw new Error("Secure checkout could not be opened.");
      window.location.assign(url.href);
    } catch (value) { if (current(abort)) setError(value instanceof Error ? value.message : "Could not open secure checkout."); }
    finally { if (current(abort)) { setBusy(false); setAction(""); } }
  };
  const checkStatus = async () => {
    if (review || busy) return;
    currentRequest.current?.abort(); const abort = new AbortController(); currentRequest.current = abort; setBusy(true); setAction("refresh");
    await refresh(abort); if (current(abort)) { setBusy(false); setAction(""); }
  };
  return <main className="ic-customer ic-page">{review && <ReviewNotice />}<header className="ic-nav"><Brand /><span className="ic-private"><LockKeyhole size={14} /> Private invoice</span></header><div className="ic-customer-wrap"><div className="ic-customer-heading"><span className="ic-eyebrow">YOUR MAIDS IN BLACK INVOICE</span><h1>A clean home.<br /><span>A simpler way to pay.</span></h1><p>Review your service dates and pay for one, several, or all unpaid dates in a single secure checkout.</p></div>
    {invoice ? <div className="ic-payment-grid"><section className="ic-customer-document"><header className="ic-document-head"><div><span className="ic-eyebrow">BILLED TO</span><h2>{invoice.clientName}</h2><p>{day(invoice.from)} — {day(invoice.to)}</p></div><div className="ic-doc-number"><strong>{invoice.number}</strong><span>{invoiceStatusLabel(invoice)}</span></div></header><div className="ic-select-bar"><label><input type="checkbox" checked={unpaid.length > 0 && unpaid.every(row => ids.includes(row.id))} disabled={!unpaid.length || busy || !!invoice.activeAttemptId || !payable} onChange={() => { setIds(unpaid.every(row => ids.includes(row.id)) ? [] : unpaid.map(row => row.id)); attemptKey.current = crypto.randomUUID(); setReviewMessage(false); }} />Select all unpaid</label><span>{selectedRows.length} selected</span></div>
    {invoice.lines.map(row => <label key={row.id} className={`ic-service-row ${selectedRows.some(selected => selected.id === row.id) ? "is-selected" : ""} ${row.paidCents >= row.amountCents ? "is-paid" : ""}`}><input type="checkbox" aria-label={`Pay ${day(row.date)} service`} checked={selectedRows.some(selected => selected.id === row.id)} onChange={() => toggle(row.id)} disabled={busy || row.paidCents >= row.amountCents || !!invoice.activeAttemptId || !payable} /><div className="ic-date-tile"><b>{new Date(`${row.date}T12:00:00`).getDate()}</b><span>{new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</span></div><div className="ic-service-info"><strong>{row.description}</strong><span>{day(row.date)}</span><small>{row.address}</small>{(row.manualPaidCents || 0) > 0 && <small>{money(row.manualPaidCents || 0)} recorded by staff</small>}</div><div className="ic-row-price"><b>{money(row.amountCents)}</b><small>{row.paidCents >= row.amountCents ? linePaymentLabel(row, invoice) : row.paidCents > 0 ? `${money(row.amountCents - row.paidCents)} remaining` : "Unpaid"}</small></div></label>)}<footer className="ic-document-footer"><span>Original invoice total</span><strong>{money(invoiceTotal(invoice.lines))}</strong></footer>{invoice.receipts.length > 0 && <section className="ic-receipts"><h3>Payment receipts</h3>{invoice.receipts.map(receipt => <p key={receipt.paymentId}><Check size={16} /><span>{new Date(receipt.paidAt).toLocaleDateString()} · {receipt.lineIds.length} services</span><strong>{money(receipt.amountCents)}</strong>{!!receipt.refundedCents && <span>{money(receipt.refundedCents)} adjustment · under review</span>}</p>)}</section>}</section>
    <aside className="ic-summary"><span className="ic-eyebrow">PAYMENT SUMMARY</span><div className="ic-summary-line"><span>{invoice.status === "payment_review" ? "Recorded payments (under review)" : "Already paid"}</span><strong>{money(invoice.lines.reduce((sum, row) => sum + row.paidCents, 0))}</strong></div><div className="ic-summary-line"><span>Remaining invoice balance</span><strong>{money(invoiceBalance(invoice.lines))}</strong></div><div className="ic-summary-line"><span>Selected service dates</span><strong>{selectedRows.length}</strong></div><div className="ic-grand-total"><span>Total to pay</span><b>{money(total)}</b><small>One payment. All selected unpaid services.</small></div><p className="ic-due-copy">Payment due {day(invoice.dueDate)}</p>{!payable && <p className="ic-gate">{String(invoice.status) === "payment_review" ? "A payment adjustment needs staff review. Online payment is unavailable while it is reviewed; this does not confirm that every service is paid." : invoice.status === "paid" ? "No payment is due on this invoice." : "This invoice is not payable."}</p>}{payable && invoice.activeAttemptId && <p className="ic-gate">A checkout is already in progress. Resume that same checkout or check the latest payment status.</p>}{!review && !ready && payable && <p className="ic-gate">{statusMessage || "Secure payments are not configured for this invoice. Please contact Maids in Black."}</p>}{payable && <button className="ic-primary" onClick={pay} disabled={busy || !selectedRows.length || total <= 0 || (!review && !ready)}><CreditCard size={17} />{action === "pay" ? "Opening secure checkout…" : review ? `Preview ${money(total)} payment` : invoice.activeAttemptId ? "Resume secure checkout" : `Pay ${money(total)}`}</button>}<div className="ic-secure"><LockKeyhole size={13} />{review ? "Review only · no Stripe payment" : "Secure checkout powered by Stripe"}</div><p className="ic-payment-note">Only the unpaid balances you select will be paid. Already-paid dates remain here for your records.</p><button className="ic-refresh" onClick={checkStatus} disabled={review || busy}><RefreshCw size={13} />{action === "refresh" ? "Checking payment status…" : "Check payment status"}</button>{reviewMessage && <p className="ic-review-result" role="status">This would open one Stripe checkout for {money(total)}. No payment request was made.</p>}</aside></div> : <div className="ic-empty"><FileText size={28} /><h3>{error ? "Invoice unavailable" : "Loading your invoice…"}</h3><p>{error || "Your service dates and balance will appear here."}</p>{error && <button className="ic-refresh" onClick={checkStatus} disabled={review || busy}><RefreshCw size={13} />Check payment status</button>}</div>}{error && invoice && <p className="ic-error" role="alert">{error}</p>}<footer className="ic-customer-bottom"><ShieldCheck size={16} /><span>Service you trust. Payments you control.</span><span>Maids in Black</span></footer></div></main>;
}
