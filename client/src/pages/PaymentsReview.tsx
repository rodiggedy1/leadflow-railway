import { useMemo, useState } from "react";
import { Bell, CheckCircle2, CircleAlert, Clock3, Copy, CreditCard, DollarSign, LockKeyhole, Plus, Search, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import "./payments-review.css";

type PaymentState = "held" | "captured" | "review" | "failed" | "released";
type StaticPayment = {
  id: string;
  customer: string;
  email: string;
  amount: number;
  state: PaymentState;
  card: string;
  method: string;
  created: string;
  detail: string;
  note: string;
  invoice: string;
};

const STATUS: Record<PaymentState, string> = { held: "Authorized hold", captured: "Captured", review: "Needs review", failed: "Failed", released: "Released" };
const PORTRAITS: Record<string, string> = {
  "Jordan Rivera": "/manus-storage/leads-crm-owner-james-taylor_6fac06b4.png",
  "Amelia Carter": "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
  "Sophia Kim": "/manus-storage/leads-crm-owner-hannah-mills_c84fd53e.png",
  "Noah Bennett": "/manus-storage/leads-crm-owner-mark-darnalds_cf661d0b.png",
  "Ethan Wells": "/manus-storage/leads-crm-owner-emma-green_55d28723.png",
  "Olivia Patel": "/manus-storage/leads-crm-owner-sarah-nguyen_2fbb7d63.png",
};
const STATIC_PAYMENTS: StaticPayment[] = [
  { id: "PAY-8942", customer: "Jordan Rivera", email: "jordan.rivera@example.com", amount: 248, state: "held", card: "Visa ·•••• 4242", method: "Card on file", created: "Today · 10:42 AM", invoice: "INV-2048", detail: "A static authorization hold is ready for an operations review before any follow-up decision.", note: "No live charge, hold, or payment method is connected in this review." },
  { id: "PAY-8941", customer: "Amelia Carter", email: "amelia.carter@example.com", amount: 312, state: "captured", card: "Mastercard ·•••• 8106", method: "Card on file", created: "Today · 9:18 AM", invoice: "INV-2047", detail: "This completed static example represents a settled payment event with a clear receipt state.", note: "Settled examples remain visible for outcome review only." },
  { id: "PAY-8938", customer: "Sophia Kim", email: "sophia.kim@example.com", amount: 186, state: "review", card: "Visa ·•••• 1048", method: "Payment link", created: "Yesterday · 4:26 PM", invoice: "INV-2042", detail: "A follow-up signal needs a human review before any payment or customer contact is attempted.", note: "No local action sends a message or changes a payment." },
  { id: "PAY-8934", customer: "Noah Bennett", email: "noah.bennett@example.com", amount: 264, state: "released", card: "Amex ·•••• 7002", method: "Card on file", created: "Sep 14 · 3:06 PM", invoice: "INV-2039", detail: "This released static example gives the activity board a neutral resolution state.", note: "The reference is retained as static history only." },
  { id: "PAY-8930", customer: "Ethan Wells", email: "ethan.wells@example.com", amount: 398, state: "failed", card: "Visa ·•••• 9912", method: "Payment link", created: "Sep 14 · 1:31 PM", invoice: "INV-2036", detail: "This failed static example carries a coral attention signal but has no retry or payment action connected.", note: "Review the customer context before any operational follow-up." },
  { id: "PAY-8928", customer: "Olivia Patel", email: "olivia.patel@example.com", amount: 224, state: "captured", card: "Mastercard ·•••• 6330", method: "Card on file", created: "Sep 13 · 11:14 AM", invoice: "INV-2032", detail: "A second settled example makes the payment history feel complete without loading live activity.", note: "Static receipt context only." },
];

function money(amount: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount); }
function PaymentPortrait({ customer, className }: { customer: string; className: string }) { return <img className={className} src={PORTRAITS[customer]} alt={`Static review portrait for ${customer}`} />; }

export default function PaymentsReview() {
  const [payments, setPayments] = useState(STATIC_PAYMENTS);
  const [filter, setFilter] = useState<"active" | "all" | PaymentState>("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(STATIC_PAYMENTS[0].id);
  const [notice, setNotice] = useState("Static review workspace · no payment methods, charges, holds, links, or payment activity are connected");
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const matchesState = filter === "all" || (filter === "active" ? ["held", "review", "failed"].includes(payment.state) : payment.state === filter);
      const matchesQuery = !query || [payment.id, payment.customer, payment.email, payment.invoice, payment.card].join(" ").toLowerCase().includes(query);
      return matchesState && matchesQuery;
    });
  }, [filter, payments, search]);
  const selected = payments.find((payment) => payment.id === selectedId) ?? visible[0] ?? payments[0];
  const totals = {
    held: payments.filter((payment) => payment.state === "held").reduce((sum, payment) => sum + payment.amount, 0),
    captured: payments.filter((payment) => payment.state === "captured").reduce((sum, payment) => sum + payment.amount, 0),
    attention: payments.filter((payment) => ["review", "failed"].includes(payment.state)).reduce((sum, payment) => sum + payment.amount, 0),
    links: payments.filter((payment) => payment.method === "Payment link").length,
  };
  const updateState = (id: string, state: PaymentState, text: string) => {
    const record = payments.find((payment) => payment.id === id);
    if (!record) return;
    setPayments((items) => items.map((payment) => payment.id === id ? { ...payment, state, created: `${STATUS[state]} in preview` } : payment));
    setNotice(`${record.id} was updated to ${STATUS[state].toLowerCase()} in this static preview only. No payment activity changed.`);
  };

  return <main className="payments-review" data-review-only="true">
    <header className="payments-utility"><label className="payments-search"><Search size={16} /><input aria-label="Search static payments" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payments, customers, or invoices…" /><kbd>⌘ K</kbd></label><div><button type="button" className="payments-bell" aria-label="Static payment notifications" onClick={() => setNotice("Static preview only — payment notifications are not connected.")}><Bell size={17} /><i /></button><span className="payments-owner">RG</span></div></header>
    <div className="payments-content">
      <section className="payments-page-head"><div><span className="payments-eyebrow">Finance & billing · Static preview</span><h1><CreditCard size={27} />Payments</h1><p>One operational view for authorization context, payment readiness, and human review—without exposing live card or payment activity.</p></div><button type="button" className="payments-new" onClick={() => setNotice("Create payment link is a static review control. No link was generated.")}><Plus size={15} />Create payment link</button></section>
      <p className="payments-notice"><Sparkles size={14} />{notice}</p>
      <section className="payments-metrics" aria-label="Static payment metrics"><article className="is-blue"><span>Authorized holds</span><strong>{money(totals.held)}</strong><small>Awaiting an explicit decision</small></article><article className="is-mint"><span>Captured today</span><strong>{money(totals.captured)}</strong><small>Settled static examples</small></article><article className="is-coral"><span>Needs review</span><strong>{money(totals.attention)}</strong><small>Signals requiring a human read</small></article><article className="is-amber"><span>Payment links</span><strong>{totals.links}</strong><small>Static customer contexts</small></article></section>
      <section className="payments-workbench" aria-label="Static payment workspace">
        <aside className="payments-board"><header className="payments-board-head"><div><span className="payments-eyebrow">Payment activity</span><h2>Resolve the right payment state</h2></div><span className="payments-board-count">{visible.length} shown</span></header><nav className="payments-filters" aria-label="Static payment filters">{[{ value: "active", label: "Active" }, { value: "held", label: "Holds" }, { value: "review", label: "Review" }, { value: "captured", label: "Captured" }, { value: "all", label: "All" }].map((item) => <button type="button" key={item.value} className={filter === item.value ? "is-active" : ""} onClick={() => setFilter(item.value as "active" | "all" | PaymentState)}>{item.label}</button>)}</nav>{visible.length === 0 ? <div className="payments-empty"><CreditCard size={26} /><strong>No static payments match this view</strong><p>Clear the local search or choose another state.</p></div> : <div className="payment-list">{visible.map((payment) => <button type="button" key={payment.id} className={`payment-row payment-row--${payment.state} ${selected.id === payment.id ? "is-selected" : ""}`} onClick={() => setSelectedId(payment.id)}><PaymentPortrait customer={payment.customer} className="payment-portrait payment-portrait--row" /><span className="payment-row-main"><span><strong>{payment.customer}</strong><em>{payment.id}</em></span><small>{payment.detail}</small><i><Clock3 size={11} />{payment.created}</i></span><span className="payment-row-side"><b>{money(payment.amount)}</b><em className={`payment-status payment-status--${payment.state}`}>{STATUS[payment.state]}</em></span></button>)}</div>}</aside>
        <article className={`payment-detail payment-detail--${selected.state}`}><header className="payment-detail-head"><div className="payment-detail-person"><PaymentPortrait customer={selected.customer} className="payment-portrait payment-portrait--detail" /><div><span className="payments-eyebrow">Selected payment context</span><h2>{selected.customer}</h2><p>{selected.email}</p></div></div><div className="payment-detail-state"><em className={`payment-status payment-status--${selected.state}`}>{STATUS[selected.state]}</em><strong>{selected.id}</strong></div></header><section className="payment-total-band"><div><span>Amount</span><strong>{money(selected.amount)}</strong></div><p>{selected.method}<i />{selected.invoice}</p></section><section className="payment-detail-grid"><div className="payment-detail-summary"><span>Payment context</span><p>{selected.detail}</p><small><LockKeyhole size={13} />No live card data is displayed in this static review.</small></div><div className="payment-detail-card"><span>Payment method</span><strong>{selected.card}</strong><p>{selected.method} · static display</p></div></section><section className="payment-lifecycle"><header><span>Payment lifecycle</span><small>Static review detail</small></header><div><i className="is-created" /><p><strong>Payment context prepared</strong><span>{selected.created} · static example</span></p></div><div><i className={selected.state === "captured" ? "is-captured" : selected.state === "failed" ? "is-failed" : selected.state === "review" ? "is-review" : selected.state === "held" ? "is-held" : "is-released"} /><p><strong>{selected.state === "held" ? "Authorization is awaiting review" : selected.state === "captured" ? "Payment shown as captured" : selected.state === "review" ? "Human review is required" : selected.state === "failed" ? "Payment state needs attention" : "Hold shown as released"}</strong><span>{selected.note}</span></p></div></section><section className="payment-safety"><ShieldCheck size={15} /><div><strong>Review-safe payment detail</strong><p>Customer payment methods, charge history, and payment links stay disconnected on this page.</p></div></section><footer className="payment-action-dock"><div><span>Recommended next step</span><strong>{selected.state === "held" ? "Confirm readiness before an operational payment decision" : selected.state === "review" || selected.state === "failed" ? "Review context before any customer or payment follow-up" : selected.state === "captured" ? "Keep as settled reference" : "Retain the release as neutral history"}</strong></div><div><button type="button" className="payment-action" onClick={() => setNotice(`Copy link for ${selected.id} is review-only. No link was copied.`)}><Copy size={14} />Copy link</button><button type="button" className="payment-action" onClick={() => setNotice(`Receipt for ${selected.id} is review-only. No receipt was requested.`)}><Send size={14} />Review receipt</button>{selected.state === "held" && <button type="button" className="payment-action is-primary" onClick={() => updateState(selected.id, "captured", "Capture in preview")}><CheckCircle2 size={14} />Capture hold</button>}{selected.state === "held" && <button type="button" className="payment-action is-danger" onClick={() => updateState(selected.id, "released", "Release in preview")}><XCircle size={14} />Release</button>}{["review", "failed"].includes(selected.state) && <button type="button" className="payment-action is-primary" onClick={() => updateState(selected.id, "captured", "Reviewed in preview")}><CheckCircle2 size={14} />Mark reviewed</button>}</div></footer></article>
      </section>
    </div>
  </main>;
}
