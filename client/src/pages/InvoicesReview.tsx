import { useMemo, useState } from "react";
import { ArrowUpRight, Bell, CheckCircle2, ChevronRight, CircleAlert, Clock3, CreditCard, Download, FileText, Plus, Receipt, Search, Send, Sparkles } from "lucide-react";
import "./invoices-review.css";

type InvoiceState = "due" | "sent" | "overdue" | "paid";
type Invoice = {
  id: string;
  customer: string;
  email: string;
  issued: string;
  due: string;
  amount: number;
  state: InvoiceState;
  detail: string;
  lineItems: Array<{ label: string; quantity: string; amount: number }>;
  reminder?: string;
};

const STATUS_LABELS: Record<InvoiceState, string> = { due: "Payment due", sent: "Sent", overdue: "Overdue", paid: "Paid" };
const INVOICE_PORTRAITS: Record<string, string> = {
  "Jordan Rivera": "/manus-storage/leads-crm-owner-james-taylor_6fac06b4.png",
  "Amelia Carter": "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
  "Sophia Kim": "/manus-storage/leads-crm-owner-hannah-mills_c84fd53e.png",
  "Noah Bennett": "/manus-storage/leads-crm-owner-mark-darnalds_cf661d0b.png",
  "Ethan Wells": "/manus-storage/leads-crm-owner-emma-green_55d28723.png",
  "Olivia Patel": "/manus-storage/leads-crm-owner-sarah-nguyen_2fbb7d63.png",
};
const STATIC_INVOICES: Invoice[] = [
  { id: "INV-2048", customer: "Jordan Rivera", email: "jordan.rivera@example.com", issued: "Sep 16, 2026", due: "Due today", amount: 248, state: "due", detail: "A recurring-service invoice is ready for review in this static workspace.", lineItems: [{ label: "Recurring home service", quantity: "Sep 16", amount: 220 }, { label: "Supplies & care", quantity: "1", amount: 28 }], reminder: "No reminder has been prepared." },
  { id: "INV-2047", customer: "Amelia Carter", email: "amelia.carter@example.com", issued: "Sep 15, 2026", due: "Due Sep 19", amount: 312, state: "sent", detail: "The invoice has been prepared and is awaiting its due date in this static review example.", lineItems: [{ label: "Home service", quantity: "Sep 15", amount: 282 }, { label: "Interior add-on", quantity: "1", amount: 30 }], reminder: "Invoice prepared · no live message sent." },
  { id: "INV-2042", customer: "Sophia Kim", email: "sophia.kim@example.com", issued: "Sep 8, 2026", due: "7 days overdue", amount: 186, state: "overdue", detail: "The overdue state is a static review signal and has no collection or payment action attached.", lineItems: [{ label: "Home service", quantity: "Sep 8", amount: 166 }, { label: "Supplies & care", quantity: "1", amount: 20 }], reminder: "A gentle follow-up is available as a local-only review action." },
  { id: "INV-2039", customer: "Noah Bennett", email: "noah.bennett@example.com", issued: "Sep 6, 2026", due: "Paid Sep 7", amount: 264, state: "paid", detail: "This completed example provides a calm reference for settled invoice history.", lineItems: [{ label: "Recurring home service", quantity: "Sep 6", amount: 240 }, { label: "Service care", quantity: "1", amount: 24 }] },
  { id: "INV-2036", customer: "Ethan Wells", email: "ethan.wells@example.com", issued: "Sep 4, 2026", due: "2 days overdue", amount: 398, state: "overdue", detail: "This larger static invoice demonstrates the coral escalation signal without connecting payment data.", lineItems: [{ label: "Deep home service", quantity: "Sep 4", amount: 348 }, { label: "Interior add-on", quantity: "1", amount: 50 }], reminder: "No live payment or message activity is connected." },
  { id: "INV-2032", customer: "Olivia Patel", email: "olivia.patel@example.com", issued: "Sep 2, 2026", due: "Paid Sep 3", amount: 224, state: "paid", detail: "This static paid invoice provides an outcome contrast to the open review queue.", lineItems: [{ label: "Home service", quantity: "Sep 2", amount: 200 }, { label: "Supplies & care", quantity: "1", amount: 24 }] },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function InvoicePortrait({ customer, className }: { customer: string; className: string }) {
  return <img className={className} src={INVOICE_PORTRAITS[customer]} alt={`Static review portrait for ${customer}`} />;
}

export default function InvoicesReview() {
  const [invoices, setInvoices] = useState(STATIC_INVOICES);
  const [filter, setFilter] = useState<"outstanding" | "all" | InvoiceState>("outstanding");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(STATIC_INVOICES[0].id);
  const [notice, setNotice] = useState("Static review workspace · no invoices, payment methods, reminders, or payment activity are connected");

  const visibleInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const stateMatches = filter === "all" || (filter === "outstanding" ? invoice.state !== "paid" : invoice.state === filter);
      const queryMatches = !query || [invoice.id, invoice.customer, invoice.email, invoice.detail].join(" ").toLowerCase().includes(query);
      return stateMatches && queryMatches;
    });
  }, [filter, invoices, search]);
  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? visibleInvoices[0] ?? invoices[0];
  const outstanding = invoices.filter((invoice) => invoice.state !== "paid");
  const overdue = invoices.filter((invoice) => invoice.state === "overdue");
  const settled = invoices.filter((invoice) => invoice.state === "paid");

  const chooseInvoice = (id: string) => setSelectedId(id);
  const markPaid = (id: string) => {
    const invoice = invoices.find((item) => item.id === id);
    if (!invoice) return;
    setInvoices((items) => items.map((item) => item.id === id ? { ...item, state: "paid", due: "Marked paid in preview" } : item));
    setNotice(`${invoice.id} was marked paid in this static preview only. No payment record changed.`);
  };

  return <main className="invoices-review" data-review-only="true">
    <header className="invoices-utility"><label className="invoices-search"><Search size={16} /><input aria-label="Search static invoices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices or customers…" /><kbd>⌘ K</kbd></label><div><button type="button" className="invoices-bell" aria-label="Static invoice notifications" onClick={() => setNotice("Static preview only — invoice notifications are not connected.")}><Bell size={17} /><i /></button><span className="invoices-owner">RG</span></div></header>
    <div className="invoices-content">
      <section className="invoices-page-head"><div><span className="invoices-eyebrow">Finance & billing · Static preview</span><h1><Receipt size={27} />Invoices</h1><p>A focused place to review payment status, customer context, and invoice readiness without leaving the operating workspace.</p></div><button type="button" className="invoices-new" onClick={() => setNotice("New invoice is a static review control. No invoice was created.")}><Plus size={15} />New invoice</button></section>
      <p className="invoices-notice"><Sparkles size={14} />{notice}</p>

      <section className="invoices-metrics" aria-label="Static invoice metrics">
        <article className="is-blue"><span>Open total</span><strong>{formatCurrency(outstanding.reduce((sum, invoice) => sum + invoice.amount, 0))}</strong><small>{outstanding.length} static invoices in review</small></article>
        <article className="is-amber"><span>Due today</span><strong>{formatCurrency(invoices.filter((invoice) => invoice.state === "due").reduce((sum, invoice) => sum + invoice.amount, 0))}</strong><small>Prioritize the current window</small></article>
        <article className="is-coral"><span>Needs attention</span><strong>{formatCurrency(overdue.reduce((sum, invoice) => sum + invoice.amount, 0))}</strong><small>{overdue.length} overdue static examples</small></article>
        <article className="is-mint"><span>Settled</span><strong>{formatCurrency(settled.reduce((sum, invoice) => sum + invoice.amount, 0))}</strong><small>{settled.length} completed examples</small></article>
      </section>

      <section className="invoices-workbench" aria-label="Static invoice workspace">
        <aside className="invoices-board">
          <header className="invoices-board-head"><div><span className="invoices-eyebrow">Invoice board</span><h2>Prioritize payment decisions</h2></div><span className="invoices-board-count">{visibleInvoices.length} shown</span></header>
          <nav className="invoices-filters" aria-label="Static invoice state filters">
            {[{ value: "outstanding", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "due", label: "Due" }, { value: "paid", label: "Paid" }, { value: "all", label: "All" }].map((item) => <button type="button" key={item.value} className={filter === item.value ? "is-active" : ""} onClick={() => setFilter(item.value as "outstanding" | "all" | InvoiceState)}>{item.label}</button>)}
          </nav>
          {visibleInvoices.length === 0 ? <div className="invoices-empty"><Receipt size={27} /><strong>No static invoices match this view</strong><p>Clear the local search or choose another status.</p></div> : <div className="invoice-list">{visibleInvoices.map((invoice) => <button type="button" key={invoice.id} className={`invoice-row invoice-row--${invoice.state} ${selected.id === invoice.id ? "is-selected" : ""}`} onClick={() => chooseInvoice(invoice.id)}><InvoicePortrait customer={invoice.customer} className="invoice-portrait invoice-portrait--row" /><span className="invoice-row-main"><span><strong>{invoice.customer}</strong><em>{invoice.id}</em></span><small>{invoice.detail}</small><i><Clock3 size={11} />{invoice.due}</i></span><span className="invoice-row-side"><b>{formatCurrency(invoice.amount)}</b><em className={`invoice-status invoice-status--${invoice.state}`}>{STATUS_LABELS[invoice.state]}</em></span></button>)}</div>}
        </aside>

        <article className={`invoice-detail invoice-detail--${selected.state}`}>
          <header className="invoice-detail-head"><div className="invoice-detail-person"><InvoicePortrait customer={selected.customer} className="invoice-portrait invoice-portrait--detail" /><div><span className="invoices-eyebrow">Selected invoice</span><h2>{selected.customer}</h2><p>{selected.email}</p></div></div><div className="invoice-detail-state"><em className={`invoice-status invoice-status--${selected.state}`}>{STATUS_LABELS[selected.state]}</em><strong>{selected.id}</strong></div></header>
          <section className="invoice-total-band"><div><span>Balance</span><strong>{formatCurrency(selected.amount)}</strong></div><p>{selected.due}<i />Issued {selected.issued}</p></section>
          <section className="invoice-detail-grid"><div className="invoice-detail-summary"><span>Invoice context</span><p>{selected.detail}</p><small><CreditCard size={13} />Payment activity is intentionally unavailable in this static review.</small></div><div className="invoice-detail-reminder"><span>Follow-up context</span><p>{selected.reminder ?? "This settled example does not need a follow-up."}</p></div></section>
          <section className="invoice-line-items"><header><span>Invoice line items</span><small>Static composition</small></header>{selected.lineItems.map((item) => <div key={`${selected.id}-${item.label}`}><span>{item.label}<small>{item.quantity}</small></span><strong>{formatCurrency(item.amount)}</strong></div>)}<footer><span>Total</span><strong>{formatCurrency(selected.amount)}</strong></footer></section>
          <section className="invoice-activity"><header><span>Invoice timeline</span><small>Static review detail</small></header><div><i className="is-created" /><p><strong>Invoice prepared</strong><span>{selected.issued} · static example</span></p></div><div><i className={selected.state === "paid" ? "is-paid" : selected.state === "overdue" ? "is-risk" : "is-open"} /><p><strong>{selected.state === "paid" ? "Payment shown as settled" : selected.state === "overdue" ? "Follow-up needs attention" : "Invoice remains open"}</strong><span>{selected.due} · no live event connected</span></p></div></section>
          <footer className="invoice-action-dock"><div><span>Recommended next step</span><strong>{selected.state === "overdue" ? "Review the follow-up context before a customer contact" : selected.state === "paid" ? "Keep as settled reference" : "Review invoice readiness and customer timing"}</strong></div><div><button type="button" className="invoice-action" onClick={() => setNotice(`Download for ${selected.id} is review-only. No PDF was requested.`)}><Download size={14} />Preview PDF</button><button type="button" className="invoice-action" onClick={() => setNotice(`Share action for ${selected.id} is review-only. No message was prepared.`)}><Send size={14} />Share invoice</button>{selected.state !== "paid" && <button type="button" className="invoice-action is-primary" onClick={() => markPaid(selected.id)}><CheckCircle2 size={14} />Mark paid</button>}</div></footer>
        </article>
      </section>
    </div>
  </main>;
}
