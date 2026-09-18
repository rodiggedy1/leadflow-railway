import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Bell, CheckCircle2, ChevronRight, CircleAlert, Clock3, CreditCard, Download, FileText, Loader2, Pencil, Plus, Receipt, Search, Send, Sparkles, Trash2, X } from "lucide-react";
import "./invoices-review.css";
import "./invoices-exact-live.css";

type InvoiceState = "open" | "overdue" | "paid";
type InvoiceFilter = "outstanding" | "all" | InvoiceState | "due";
type LineItem = { date: string; description: string; price: number };
type InvoiceRecord = {
  id: number;
  invoiceNumber: number;
  templateId: number;
  customerName: string;
  serviceDate: string;
  billingDate: string;
  stripeLink: string;
  lineItems: unknown;
  totalCents: number;
  pdfUrl: string | null;
  paidAt: Date | string | null;
  createdAt: Date | string;
};
type InvoiceTemplate = {
  id: number;
  customerName: string;
  billTo: string;
  serviceAddress: string;
  stripeLink: string;
  lineItems: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};
type TemplateMode = "generate" | "edit" | "new";

const INVOICE_PORTRAITS = [
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bCfFsxIPapKjJReA.png",
] as const;

const formatCurrency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const formatCents = (value: number) => formatCurrency(value / 100);
const toDate = (value: Date | string) => value instanceof Date ? value : new Date(value);
const portraitFor = (name: string) => INVOICE_PORTRAITS[Math.abs(Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0)) % INVOICE_PORTRAITS.length];
const parseLineItems = (raw: unknown): LineItem[] => Array.isArray(raw) ? raw.map((item) => {
  const value = item as Record<string, unknown>;
  return { date: String(value.date ?? ""), description: String(value.description ?? ""), price: Number(value.price ?? 0) };
}) : [];
const emptyTemplate = () => ({ customerName: "", billTo: "", serviceAddress: "", stripeLink: "", lineItems: [{ date: "", description: "", price: 0 }] as LineItem[] });

function invoiceState(invoice: InvoiceRecord): InvoiceState {
  if (invoice.paidAt) return "paid";
  return Date.now() - toDate(invoice.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000 ? "overdue" : "open";
}

function stateLabel(state: InvoiceState) {
  return state === "paid" ? "Paid" : state === "overdue" ? "Overdue" : "Open";
}

function InvoicePortrait({ customer, className }: { customer: string; className: string }) {
  return <img className={className} src={portraitFor(customer)} alt={`Customer portrait illustration for ${customer}`} />;
}

function InvoiceLineItemsEditor({ items, onChange }: { items: LineItem[]; onChange: (items: LineItem[]) => void }) {
  const update = (index: number, field: keyof LineItem, value: string | number) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  return <div className="invoice-form-items">
    <div className="invoice-form-items-head"><span>Date</span><span>Description</span><span>Price</span><span /></div>
    {items.map((item, index) => <div className="invoice-form-item" key={index}>
      <input value={item.date} onChange={(event) => update(index, "date", event.target.value)} placeholder="Service date" />
      <input value={item.description} onChange={(event) => update(index, "description", event.target.value)} placeholder="Service provided" />
      <input type="number" min="0" step="0.01" value={item.price || ""} onChange={(event) => update(index, "price", Number(event.target.value) || 0)} placeholder="0.00" />
      <button type="button" aria-label="Remove line item" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} disabled={items.length === 1}><X size={14} /></button>
    </div>)}
    <footer><button type="button" onClick={() => onChange([...items, { date: "", description: "", price: 0 }])}><Plus size={13} />Add line item</button><strong>{formatCurrency(items.reduce((sum, item) => sum + (Number(item.price) || 0), 0))}</strong></footer>
  </div>;
}

function InvoiceTemplatePanel({ onBack }: { onBack: () => void }) {
  const utils = trpc.useUtils();
  const [templateSearch, setTemplateSearch] = useState("");
  const { data: templates = [], isLoading } = trpc.invoice.listTemplates.useQuery({ search: templateSearch.trim() || undefined }, { staleTime: 30_000 });
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate | null>(null);
  const [mode, setMode] = useState<TemplateMode>("generate");
  const [form, setForm] = useState(emptyTemplate);
  const [serviceDate, setServiceDate] = useState("");
  const [billingDate, setBillingDate] = useState("");
  const [stripeLink, setStripeLink] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const createTemplate = trpc.invoice.createTemplate.useMutation({
    onSuccess: () => { toast.success("Template created"); void utils.invoice.listTemplates.invalidate(); setMode("generate"); },
    onError: (error) => toast.error(error.message),
  });
  const updateTemplate = trpc.invoice.updateTemplate.useMutation({
    onSuccess: () => { toast.success("Template saved"); void utils.invoice.listTemplates.invalidate(); setMode("generate"); },
    onError: (error) => toast.error(error.message),
  });
  const deleteTemplate = trpc.invoice.deleteTemplate.useMutation({
    onSuccess: () => { toast.success("Template deleted"); setSelectedTemplate(null); void utils.invoice.listTemplates.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const generateInvoice = trpc.invoice.generateInvoice.useMutation({
    onSuccess: () => { toast.success("Invoice PDF generated"); void utils.invoice.listInvoices.invalidate(); onBack(); },
    onError: (error) => toast.error(error.message),
  });

  const selectTemplate = (template: InvoiceTemplate) => {
    setSelectedTemplate(template);
    setMode("generate");
    setForm({ customerName: template.customerName, billTo: template.billTo, serviceAddress: template.serviceAddress, stripeLink: template.stripeLink, lineItems: parseLineItems(template.lineItems) });
    setStripeLink(template.stripeLink);
    setLineItems(parseLineItems(template.lineItems));
  };
  const startNew = () => { setSelectedTemplate(null); setForm(emptyTemplate()); setMode("new"); };
  const startEdit = () => { if (selectedTemplate) setMode("edit"); };
  const saveTemplate = () => {
    if (!form.customerName.trim() || !form.billTo.trim() || !form.serviceAddress.trim() || form.lineItems.length === 0) { toast.error("Customer, bill-to, service address, and a line item are required."); return; }
    if (mode === "edit" && selectedTemplate) updateTemplate.mutate({ id: selectedTemplate.id, ...form });
    if (mode === "new") createTemplate.mutate(form);
  };
  const generate = () => {
    if (!selectedTemplate) { toast.error("Select an invoice template first."); return; }
    if (!serviceDate.trim()) { toast.error("Service date is required."); return; }
    generateInvoice.mutate({ templateId: selectedTemplate.id, serviceDate, billingDate: billingDate || undefined, stripeLink: stripeLink || undefined, lineItems });
  };

  return <article className="invoice-detail invoice-template-detail">
    <header className="invoice-detail-head"><div className="invoice-detail-person"><span className="invoice-template-icon"><FileText size={21} /></span><div><span className="invoices-eyebrow">Invoice builder</span><h2>{mode === "new" ? "New template" : mode === "edit" ? "Edit template" : "Generate invoice"}</h2><p>Use the established template and PDF-generation workflow.</p></div></div><button type="button" className="invoice-close-builder" onClick={onBack} aria-label="Return to invoice board"><X size={17} /></button></header>
    <section className="invoice-template-layout">
      <aside className="invoice-template-list"><header><label><Search size={14} /><input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="Search templates…" /></label><button type="button" onClick={startNew}><Plus size={14} />New template</button></header>{isLoading ? <p className="invoice-template-empty"><Loader2 className="animate-spin" />Loading templates…</p> : templates.length ? templates.map((template: InvoiceTemplate) => <button type="button" key={template.id} className={selectedTemplate?.id === template.id ? "is-selected" : ""} onClick={() => selectTemplate(template)}><strong>{template.customerName}</strong><small>{template.serviceAddress}</small><ChevronRight size={14} /></button>) : <p className="invoice-template-empty">No invoice templates yet.</p>}</aside>
      <section className="invoice-template-form">{mode === "generate" ? <>
        <div className="invoice-template-form-head"><div><span>Template</span><strong>{selectedTemplate?.customerName || "Choose a template"}</strong></div>{selectedTemplate && <div><button type="button" onClick={startEdit}><Pencil size={13} />Edit</button><button type="button" className="is-danger" onClick={() => { if (window.confirm(`Delete template for ${selectedTemplate.customerName}?`)) deleteTemplate.mutate({ id: selectedTemplate.id }); }} disabled={deleteTemplate.isPending}><Trash2 size={13} />Delete</button></div>}</div>
        {selectedTemplate ? <div className="invoice-builder-fields"><label>Service date<input value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} placeholder="June 29, 2026" /></label><label>Billing date <small>Optional</small><input value={billingDate} onChange={(event) => setBillingDate(event.target.value)} placeholder="Today" /></label><label className="is-wide">Stripe payment link <small>Optional override</small><input value={stripeLink} onChange={(event) => setStripeLink(event.target.value)} placeholder="https://buy.stripe.com/..." /></label><div className="is-wide"><span>Line items</span><InvoiceLineItemsEditor items={lineItems} onChange={setLineItems} /></div><footer><button type="button" onClick={onBack}>Cancel</button><button type="button" className="is-primary" onClick={generate} disabled={generateInvoice.isPending}>{generateInvoice.isPending ? <Loader2 className="animate-spin" /> : <FileText size={14} />}Generate PDF</button></footer></div> : <div className="invoice-builder-empty"><Receipt size={25} /><strong>Select an invoice template</strong><p>Templates preserve the existing customer, service-address, and line-item workflow.</p></div>}
      </> : <div className="invoice-builder-fields invoice-template-editor"><label>Customer name<input value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} placeholder="Customer name" /></label><label>Service address<input value={form.serviceAddress} onChange={(event) => setForm((current) => ({ ...current, serviceAddress: event.target.value }))} placeholder="Service address" /></label><label className="is-wide">Bill to<textarea value={form.billTo} onChange={(event) => setForm((current) => ({ ...current, billTo: event.target.value }))} placeholder="Billing address" /></label><label className="is-wide">Stripe payment link<input value={form.stripeLink} onChange={(event) => setForm((current) => ({ ...current, stripeLink: event.target.value }))} placeholder="https://buy.stripe.com/..." /></label><div className="is-wide"><span>Template line items</span><InvoiceLineItemsEditor items={form.lineItems} onChange={(items) => setForm((current) => ({ ...current, lineItems: items }))} /></div><footer><button type="button" onClick={() => setMode("generate")}>Cancel</button><button type="button" className="is-primary" onClick={saveTemplate} disabled={createTemplate.isPending || updateTemplate.isPending}>{createTemplate.isPending || updateTemplate.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={14} />}{mode === "new" ? "Create template" : "Save template"}</button></footer></div>}</section>
    </section>
  </article>;
}

export default function InvoicesExactLive() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvoiceFilter>("outstanding");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const { data: invoiceData = [], isLoading, error } = trpc.invoice.listInvoices.useQuery({ search: search.trim() || undefined, limit: 100 }, { staleTime: 30_000 });
  const invoices = invoiceData as InvoiceRecord[];

  useEffect(() => { setShowShare(false); setShareEmail(""); }, [selectedId]);
  const visibleInvoices = useMemo(() => invoices.filter((invoice) => {
    const state = invoiceState(invoice);
    return filter === "all" || filter === "outstanding" ? filter === "all" || state !== "paid" : filter === "due" ? false : state === filter;
  }), [filter, invoices]);
  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? visibleInvoices[0] ?? invoices[0] ?? null;
  const openInvoices = invoices.filter((invoice) => invoiceState(invoice) !== "paid");
  const overdueInvoices = invoices.filter((invoice) => invoiceState(invoice) === "overdue");
  const paidInvoices = invoices.filter((invoice) => invoiceState(invoice) === "paid");

  const markPaid = trpc.invoice.markAsPaid.useMutation({ onSuccess: () => { toast.success("Invoice marked as paid"); void utils.invoice.listInvoices.invalidate(); }, onError: (invoiceError) => toast.error(invoiceError.message) });
  const unmarkPaid = trpc.invoice.unmarkAsPaid.useMutation({ onSuccess: () => { toast.success("Invoice marked open"); void utils.invoice.listInvoices.invalidate(); }, onError: (invoiceError) => toast.error(invoiceError.message) });
  const deleteInvoice = trpc.invoice.deleteInvoice.useMutation({ onSuccess: () => { toast.success("Invoice deleted"); setSelectedId(null); void utils.invoice.listInvoices.invalidate(); }, onError: (invoiceError) => toast.error(invoiceError.message) });
  const sendInvoice = trpc.invoice.sendByEmail.useMutation({ onSuccess: (result) => { toast.success(`Invoice #${result.invoiceNumber} sent to ${result.toEmail}`); setShowShare(false); setShareEmail(""); }, onError: (invoiceError) => toast.error(invoiceError.message) });

  const downloadInvoice = (invoice: InvoiceRecord) => {
    if (!invoice.pdfUrl) { toast.error("This invoice does not have a PDF."); return; }
    if (invoice.pdfUrl.startsWith("data:")) { const link = document.createElement("a"); link.href = invoice.pdfUrl; link.download = `Invoice_${invoice.invoiceNumber}_${invoice.customerName.replace(/\s+/g, "_")}.pdf`; link.click(); return; }
    window.open(invoice.pdfUrl, "_blank", "noopener,noreferrer");
  };
  const shareInvoice = () => {
    if (!selected || !shareEmail.trim()) { toast.error("Enter a recipient email address."); return; }
    sendInvoice.mutate({ invoiceId: selected.id, toEmail: shareEmail.trim() });
  };

  const selectedState = selected ? invoiceState(selected) : "open";
  return <main className="invoices-review invoices-live-exact" data-live-invoices="true">
    <header className="invoices-utility"><label className="invoices-search"><Search size={16} /><input aria-label="Search invoices or customers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices or customers…" /><kbd>⌘ K</kbd></label><div><button type="button" className="invoices-bell" aria-label="Invoice notifications" disabled><Bell size={17} /></button><span className="invoices-owner">RG</span></div></header>
    <div className="invoices-content">
      <section className="invoices-page-head"><div><span className="invoices-eyebrow">Finance & billing · Live workspace</span><h1><Receipt size={27} />Invoices</h1><p>Review generated invoices, payment status, and customer-ready PDF actions in the existing invoice workflow.</p></div><button type="button" className="invoices-new" onClick={() => setShowBuilder(true)}><Plus size={15} />New invoice</button></section>
      <p className="invoices-notice"><Sparkles size={14} />Generated invoice records and their existing PDF, email, and payment actions are shown here.</p>
      <section className="invoices-metrics" aria-label="Invoice metrics"><article className="is-blue"><span>Open total</span><strong>{formatCents(openInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0))}</strong><small>{openInvoices.length} open invoice{openInvoices.length === 1 ? "" : "s"}</small></article><article className="is-amber"><span>Due today</span><strong>—</strong><small>Due dates are not stored</small></article><article className="is-coral"><span>Needs attention</span><strong>{formatCents(overdueInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0))}</strong><small>{overdueInvoices.length} older than seven days</small></article><article className="is-mint"><span>Settled</span><strong>{formatCents(paidInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0))}</strong><small>{paidInvoices.length} paid invoice{paidInvoices.length === 1 ? "" : "s"}</small></article></section>
      <section className="invoices-workbench" aria-label="Invoice workspace"><aside className="invoices-board"><header className="invoices-board-head"><div><span className="invoices-eyebrow">Invoice board</span><h2>Prioritize payment decisions</h2></div><span className="invoices-board-count">{visibleInvoices.length} shown</span></header><nav className="invoices-filters" aria-label="Invoice state filters"><button type="button" className={filter === "outstanding" ? "is-active" : ""} onClick={() => setFilter("outstanding")}>Open</button><button type="button" className={filter === "overdue" ? "is-active" : ""} onClick={() => setFilter("overdue")}>Overdue</button><button type="button" disabled title="Generated invoices do not store due dates">Due</button><button type="button" className={filter === "paid" ? "is-active" : ""} onClick={() => setFilter("paid")}>Paid</button><button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All</button></nav>{isLoading ? <div className="invoices-empty"><Loader2 className="animate-spin" /><strong>Loading invoices</strong></div> : error ? <div className="invoices-empty"><CircleAlert size={27} /><strong>Could not load invoices</strong><p>{error.message}</p></div> : visibleInvoices.length ? <div className="invoice-list">{visibleInvoices.map((invoice) => { const state = invoiceState(invoice); return <button type="button" key={invoice.id} className={`invoice-row invoice-row--${state} ${selected?.id === invoice.id ? "is-selected" : ""}`} onClick={() => { setSelectedId(invoice.id); setShowBuilder(false); }}><InvoicePortrait customer={invoice.customerName} className="invoice-portrait invoice-portrait--row" /><span className="invoice-row-main"><span><strong>{invoice.customerName}</strong><em>INV-{invoice.invoiceNumber}</em></span><small>{invoice.serviceDate || "Service date not recorded"}</small><i><Clock3 size={11} />{state === "paid" ? "Paid" : state === "overdue" ? "Overdue" : "Open"}</i></span><span className="invoice-row-side"><b>{formatCents(invoice.totalCents)}</b><em className={`invoice-status invoice-status--${state}`}>{stateLabel(state)}</em></span></button>; })}</div> : <div className="invoices-empty"><Receipt size={27} /><strong>No invoices match this view</strong><p>Try another status or clear the search.</p></div>}</aside>{showBuilder ? <InvoiceTemplatePanel onBack={() => setShowBuilder(false)} /> : selected ? <article className={`invoice-detail invoice-detail--${selectedState}`}><header className="invoice-detail-head"><div className="invoice-detail-person"><InvoicePortrait customer={selected.customerName} className="invoice-portrait invoice-portrait--detail" /><div><span className="invoices-eyebrow">Selected invoice</span><h2>{selected.customerName}</h2><p>Invoice recipient is selected when sharing through the existing email flow.</p></div></div><div className="invoice-detail-state"><em className={`invoice-status invoice-status--${selectedState}`}>{stateLabel(selectedState)}</em><strong>INV-{selected.invoiceNumber}</strong></div></header><section className="invoice-total-band"><div><span>Balance</span><strong>{formatCents(selected.totalCents)}</strong></div><p>{selectedState === "paid" ? "Payment recorded" : selectedState === "overdue" ? "Older than seven days" : "Open invoice"}<i />Issued {selected.billingDate}</p></section><section className="invoice-detail-grid"><div className="invoice-detail-summary"><span>Invoice context</span><p>Generated for service on {selected.serviceDate || "a recorded service date"}. The line items and PDF below come from the existing invoice record.</p><small><CreditCard size={13} />{selected.stripeLink ? "Payment link recorded" : "No payment link recorded"}</small></div><div className="invoice-detail-reminder"><span>Follow-up context</span><p>{selectedState === "overdue" ? "Review the customer context before sending a follow-up." : selectedState === "paid" ? "Keep this as a settled invoice record." : "The invoice is open; use the existing share action when ready."}</p></div></section><section className="invoice-line-items"><header><span>Invoice line items</span><small>Generated record</small></header>{parseLineItems(selected.lineItems).length ? parseLineItems(selected.lineItems).map((item, index) => <div key={`${selected.id}-${index}`}><span>{item.description || "Service"}<small>{item.date || selected.serviceDate}</small></span><strong>{formatCurrency(item.price)}</strong></div>) : <div><span>No line items stored</span><strong>—</strong></div>}<footer><span>Total</span><strong>{formatCents(selected.totalCents)}</strong></footer></section><section className="invoice-activity"><header><span>Invoice timeline</span><small>Live record</small></header><div><i className="is-created" /><p><strong>Invoice generated</strong><span>{toDate(selected.createdAt).toLocaleDateString()} · Invoice record created</span></p></div><div><i className={selectedState === "paid" ? "is-paid" : selectedState === "overdue" ? "is-risk" : "is-open"} /><p><strong>{selectedState === "paid" ? "Payment recorded" : selectedState === "overdue" ? "Follow-up needs attention" : "Invoice remains open"}</strong><span>{selectedState === "paid" && selected.paidAt ? toDate(selected.paidAt).toLocaleDateString() : "Existing invoice state"}</span></p></div></section>{showShare && <section className="invoice-share-panel"><label>Send invoice to<input type="email" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} placeholder="customer@example.com" onKeyDown={(event) => { if (event.key === "Enter") shareInvoice(); if (event.key === "Escape") setShowShare(false); }} autoFocus /></label><div><button type="button" onClick={() => setShowShare(false)}>Cancel</button><button type="button" className="is-primary" onClick={shareInvoice} disabled={sendInvoice.isPending || !shareEmail.trim()}>{sendInvoice.isPending ? <Loader2 className="animate-spin" /> : <Send size={13} />}Send invoice</button></div></section>}<footer className="invoice-action-dock"><div><span>Recommended next step</span><strong>{selectedState === "overdue" ? "Review the follow-up context before a customer contact" : selectedState === "paid" ? "Keep as settled reference" : "Review invoice readiness and customer timing"}</strong></div><div><button type="button" className="invoice-action" onClick={() => downloadInvoice(selected)} disabled={!selected.pdfUrl}><Download size={14} />PDF</button><button type="button" className="invoice-action" onClick={() => setShowShare((open) => !open)} disabled={!selected.pdfUrl}><Send size={14} />Share invoice</button><button type="button" className="invoice-action is-primary" onClick={() => selectedState === "paid" ? unmarkPaid.mutate({ invoiceId: selected.id }) : markPaid.mutate({ invoiceId: selected.id })} disabled={markPaid.isPending || unmarkPaid.isPending}>{markPaid.isPending || unmarkPaid.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={14} />}{selectedState === "paid" ? "Unmark paid" : "Mark paid"}</button><button type="button" className="invoice-action is-danger" onClick={() => { if (window.confirm(`Delete invoice #${selected.invoiceNumber}?`)) deleteInvoice.mutate({ id: selected.id }); }} disabled={deleteInvoice.isPending}><Trash2 size={14} />Delete</button></div></footer></article> : <article className="invoice-detail invoice-detail-empty"><Receipt size={28} /><h2>No invoice selected</h2><p>Select an invoice or create one from an existing template.</p><button type="button" className="invoices-new" onClick={() => setShowBuilder(true)}><Plus size={14} />New invoice</button></article>}</section>
    </div>
  </main>;
}
