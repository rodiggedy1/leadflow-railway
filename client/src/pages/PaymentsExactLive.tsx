import { FormEvent, useMemo, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  CreditCard,
  DollarSign,
  Loader2,
  LockKeyhole,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  User,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./payments-review.css";
import "./payments-exact-live.css";

type ReviewState = "held" | "captured" | "review" | "failed" | "released";
type RecordKind = "authorization" | "card" | "link";

type PaymentRecord = {
  id: string;
  kind: RecordKind;
  customer: string;
  phone: string;
  amountCents: number | null;
  state: ReviewState;
  statusLabel: string;
  card: string;
  method: string;
  created: string;
  createdAt: number;
  detail: string;
  note: string;
  invoice: string;
  authorizationId?: number;
  token?: string;
  expiresAt?: number;
  jobLabel?: string | null;
  errorMessage?: string | null;
  authorizedAt?: number;
  capturedAt?: number;
  cancelledAt?: number;
  createdBy?: string | null;
  actionBy?: string | null;
  serviceDate?: string | null;
  serviceAddress?: string | null;
  completedAt?: number;
  captureBefore?: number;
  paymentIntentId?: string | null;
  cardSavedAt?: number;
  cardUpdatedAt?: number;
};

const STATUS: Record<ReviewState, string> = {
  held: "Authorized hold",
  captured: "Captured",
  review: "Needs review",
  failed: "Failed",
  released: "Released",
};

function formatCents(cents: number | null | undefined) {
  return cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`;
}

function formatDate(value: Date | number | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function timestamp(value: Date | number | null | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${raw}`;
}

function cardLabel(card: { cardBrand?: string | null; cardLast4?: string | null; cardExpMonth?: number | null; cardExpYear?: number | null } | undefined) {
  if (!card?.cardLast4) return "No saved card";
  const expiry = card.cardExpMonth && card.cardExpYear ? ` · ${card.cardExpMonth}/${card.cardExpYear}` : "";
  return `${card.cardBrand || "Card"} ·•••• ${card.cardLast4}${expiry}`;
}

function recordState(status: string): ReviewState {
  if (status === "authorized") return "held";
  if (status === "captured") return "captured";
  if (status === "cancelled") return "released";
  if (status === "failed") return "failed";
  return "review";
}

function statusText(status: string) {
  if (status === "authorized") return "Authorized hold";
  if (status === "captured") return "Captured";
  if (status === "cancelled") return "Released";
  if (status === "failed") return "Failed";
  return status;
}

function portraitFor(customer: string) {
  const portraits = [
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bCfFsxIPapKjJReA.png",
  ];
  let sum = 0;
  for (const character of customer) sum = (sum + character.charCodeAt(0)) % portraits.length;
  return portraits[sum];
}

function CustomerPortrait({ customer, className }: { customer: string; className: string }) {
  return <img className={className} src={portraitFor(customer)} alt={`Customer portrait illustration for ${customer}`} />;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return <button type="button" className="payment-action" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : label}</button>;
}

export default function PaymentsExactLive() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"active" | "all" | ReviewState>("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkPhone, setLinkPhone] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkJobDate, setLinkJobDate] = useState("");
  const [linkAddress, setLinkAddress] = useState("");
  const [generatedLink, setGeneratedLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [preauthOpen, setPreauthOpen] = useState(false);
  const [preauthAmount, setPreauthAmount] = useState("");
  const [preauthJobLabel, setPreauthJobLabel] = useState("");
  const [preauthNotes, setPreauthNotes] = useState("");
  const [captureAmount, setCaptureAmount] = useState("");

  const cardLinks = trpc.stripe.listAllCardAuthTokens.useQuery({ limit: 50 }, { staleTime: 30_000, retry: false, throwOnError: false });
  const cards = trpc.stripe.listAllCustomers.useQuery(undefined, { staleTime: 30_000, retry: false, throwOnError: false });
  const authorizations = trpc.stripe.listPaymentAuthorizations.useQuery(undefined, { staleTime: 30_000, retry: false, throwOnError: false });

  const generateLink = trpc.stripe.generateCardAuthToken.useMutation({
    onSuccess: (data) => {
      setGeneratedLink({ url: data.url, expiresAt: data.expiresAt });
      toast.success("Card link generated!");
      void cardLinks.refetch();
    },
    onError: (error) => toast.error(error.message || "Failed to generate link"),
  });
  const createPreauth = trpc.stripe.createPreauth.useMutation({
    onSuccess: (data) => {
      toast.success(`Hold placed — ${formatCents(data.amountCents)}`);
      void utils.stripe.listPaymentAuthorizations.invalidate();
      setPreauthOpen(false);
      setPreauthAmount("");
      setPreauthJobLabel("");
      setPreauthNotes("");
    },
    onError: (error) => toast.error(error.message || "Preauth failed"),
  });
  const capturePayment = trpc.stripe.capturePayment.useMutation({
    onSuccess: () => {
      toast.success("Payment captured!");
      setCaptureAmount("");
      void authorizations.refetch();
    },
    onError: (error) => toast.error(error.message || "Capture failed"),
  });
  const cancelPreauth = trpc.stripe.cancelPreauth.useMutation({
    onSuccess: () => {
      toast.success("Authorization cancelled.");
      void authorizations.refetch();
    },
    onError: (error) => toast.error(error.message || "Cancel failed"),
  });

  const cardsByPhone = useMemo(() => new Map((cards.data ?? []).map(card => [card.phone, card])), [cards.data]);
  const records = useMemo<PaymentRecord[]>(() => {
    const authorizationRecords: PaymentRecord[] = (authorizations.data ?? []).map((authorization) => {
      const card = cardsByPhone.get(authorization.customerPhone);
      const state = recordState(authorization.status);
      return {
        id: `authorization-${authorization.id}`,
        kind: "authorization",
        customer: authorization.customerName || card?.name || authorization.customerPhone,
        phone: authorization.customerPhone,
        amountCents: authorization.amountCents,
        state,
        statusLabel: statusText(authorization.status),
        card: cardLabel(card),
        method: "Saved card authorization",
        created: formatDate(authorization.createdAt),
        createdAt: timestamp(authorization.createdAt),
        detail: authorization.jobLabel || "Existing payment authorization record",
        note: authorization.notes || authorization.errorMessage || "Existing authorization detail",
        invoice: authorization.stripePaymentIntentId ? `Intent ${authorization.stripePaymentIntentId.slice(0, 12)}…` : "Intent unavailable",
        authorizationId: authorization.id,
        jobLabel: authorization.jobLabel,
        errorMessage: authorization.errorMessage,
        authorizedAt: timestamp(authorization.authorizedAt),
        capturedAt: timestamp(authorization.capturedAt),
        cancelledAt: timestamp(authorization.cancelledAt),
        createdBy: authorization.createdBy,
        actionBy: authorization.actionBy,
        captureBefore: timestamp(authorization.captureBefore),
        paymentIntentId: authorization.stripePaymentIntentId,
      };
    });
    const cardRecords: PaymentRecord[] = (cards.data ?? []).filter(card => card.cardLast4).map((card) => ({
      id: `card-${card.id}`,
      kind: "card",
      customer: card.name || card.phone,
      phone: card.phone,
      amountCents: null,
      state: "captured",
      statusLabel: "Card on file",
      card: cardLabel(card),
      method: "Saved payment method",
      created: card.cardSavedAt ? formatDate(card.cardSavedAt) : "Saved card date unavailable",
      createdAt: timestamp(card.cardSavedAt ?? card.updatedAt),
      detail: "Existing card-on-file record. A hold can only be placed from the unchanged staff workflow.",
      note: "No card number or payment data is exposed in this workspace.",
      invoice: "Payment method record",
      cardSavedAt: timestamp(card.cardSavedAt),
      cardUpdatedAt: timestamp(card.updatedAt),
    }));
    const linkRecords: PaymentRecord[] = (cardLinks.data ?? []).map((link) => {
      const expired = link.expiresAt < Date.now();
      const state: ReviewState = link.used ? "captured" : expired ? "released" : "review";
      return {
        id: `link-${link.id}`,
        kind: "link",
        customer: link.customerName || link.customerPhone,
        phone: link.customerPhone,
        amountCents: null,
        state,
        statusLabel: link.used ? "Link used" : expired ? "Link expired" : "Link active",
        card: "Card collection link",
        method: "Secure card link",
        created: formatDate(link.createdAt),
        createdAt: timestamp(link.createdAt),
        detail: link.jobDate || link.jobAddress || "Existing secure card-link record",
        note: link.used ? "This link is already used." : expired ? "This link has expired." : `Expires ${formatDate(link.expiresAt)}.`,
        invoice: "Card link",
        token: link.token,
        expiresAt: link.expiresAt,
        serviceDate: link.jobDate,
        serviceAddress: link.jobAddress,
        completedAt: timestamp(link.completedAt),
      };
    });
    return [...authorizationRecords, ...cardRecords, ...linkRecords].sort((a, b) => b.createdAt - a.createdAt);
  }, [authorizations.data, cards.data, cardsByPhone, cardLinks.data]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesState = filter === "all" || (filter === "active" ? record.kind === "card" || ["held", "review", "failed"].includes(record.state) : record.state === filter);
      const matchesQuery = !query || [record.customer, record.phone, record.card, record.method, record.statusLabel, record.detail].join(" ").toLowerCase().includes(query);
      return matchesState && matchesQuery;
    });
  }, [filter, records, search]);

  const selected = records.find(record => record.id === selectedId) ?? visible[0] ?? records[0] ?? null;
  const metrics = useMemo(() => ({
    held: (authorizations.data ?? []).filter(authorization => authorization.status === "authorized").reduce((sum, authorization) => sum + authorization.amountCents, 0),
    captured: (authorizations.data ?? []).filter(authorization => authorization.status === "captured").reduce((sum, authorization) => sum + authorization.amountCents, 0),
    attention: (authorizations.data ?? []).filter(authorization => authorization.status === "failed").reduce((sum, authorization) => sum + authorization.amountCents, 0),
    links: (cardLinks.data ?? []).filter(link => !link.used && link.expiresAt >= Date.now()).length,
  }), [authorizations.data, cardLinks.data]);

  const loading = cardLinks.isLoading || cards.isLoading || authorizations.isLoading;
  const refresh = () => {
    void cardLinks.refetch();
    void cards.refetch();
    void authorizations.refetch();
  };

  function submitCardLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkPhone.trim()) {
      toast.error("Phone number is required");
      return;
    }
    generateLink.mutate({
      customerPhone: normalizePhone(linkPhone.trim()),
      customerName: linkName.trim() || undefined,
      jobDate: linkJobDate.trim() || undefined,
      jobAddress: linkAddress.trim() || undefined,
    });
  }

  function submitPreauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.kind !== "card") return;
    const cents = Math.round(parseFloat(preauthAmount) * 100);
    if (!cents || cents < 50) {
      toast.error("Amount must be at least $0.50");
      return;
    }
    createPreauth.mutate({
      customerPhone: selected.phone,
      amountCents: cents,
      jobLabel: preauthJobLabel.trim() || undefined,
      notes: preauthNotes.trim() || undefined,
    });
  }

  function captureSelected() {
    if (!selected?.authorizationId) return;
    const cents = captureAmount ? Math.round(parseFloat(captureAmount) * 100) : undefined;
    capturePayment.mutate({ authorizationId: selected.authorizationId, amountCents: cents });
  }

  function cancelSelected() {
    if (!selected?.authorizationId) return;
    if (!window.confirm(`Cancel the ${formatCents(selected.amountCents)} hold for ${selected.customer || selected.phone}?`)) return;
    cancelPreauth.mutate({ authorizationId: selected.authorizationId });
  }

  const primaryActionSlot = !selected ? null : (
    <section className="payment-primary-actions" aria-label="Existing payment actions">
      <header>
        <span>{selected.kind === "authorization" && selected.state === "held" ? "Existing authorization actions" : selected.kind === "card" ? "Existing card-on-file action" : selected.kind === "link" ? "Existing secure card link" : "Existing payment record"}</span>
        <em>Action only after an explicit click</em>
      </header>
      <div className="payment-primary-actions__controls">
        {selected.kind === "link" && selected.token && <CopyButton text={`https://quote.maidinblack.com/pay/${selected.token}`} label="Copy link" />}
        {selected.kind === "card" && <button type="button" className="payment-action is-primary" onClick={() => setPreauthOpen(open => !open)}><Zap size={14} />{preauthOpen ? "Cancel" : "Preauthorize"}</button>}
        {selected.kind === "authorization" && selected.state === "held" && <><label className="payment-primary-capture">Capture amount (optional)<input type="number" min="0.50" step="0.01" value={captureAmount} onChange={(event) => setCaptureAmount(event.target.value)} placeholder={selected.amountCents ? (selected.amountCents / 100).toFixed(2) : "0.00"} /></label><button type="button" className="payment-action is-primary" onClick={captureSelected} disabled={capturePayment.isPending}>{capturePayment.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={14} />}Capture</button><button type="button" className="payment-action is-danger" onClick={cancelSelected} disabled={cancelPreauth.isPending}>{cancelPreauth.isPending ? <Loader2 className="animate-spin" /> : <XCircle size={14} />}Cancel hold</button></>}
        {selected.kind === "authorization" && selected.state !== "held" && <button type="button" className="payment-action" onClick={() => void authorizations.refetch()}><RefreshCw size={14} />Refresh record</button>}
        {selected.kind === "card" && <button type="button" className="payment-action" onClick={() => void cards.refetch()}><RefreshCw size={14} />Refresh record</button>}
      </div>
      {selected.kind === "card" && preauthOpen && <form onSubmit={submitPreauth} className="payment-primary-action-form"><label><DollarSign size={13} />Amount (USD) *<input type="number" min="0.50" step="0.01" value={preauthAmount} onChange={(event) => setPreauthAmount(event.target.value)} placeholder="150.00" required autoFocus /></label><label>Job label<input value={preauthJobLabel} onChange={(event) => setPreauthJobLabel(event.target.value)} placeholder="Deep clean — July 10" /></label><label>Notes<input value={preauthNotes} onChange={(event) => setPreauthNotes(event.target.value)} placeholder="Optional" /></label><button type="submit" className="payment-action is-primary" disabled={createPreauth.isPending}>{createPreauth.isPending ? <Loader2 className="animate-spin" /> : <DollarSign size={14} />}Place hold</button></form>}
    </section>
  );

  return <main className="payments-review payments-live-exact" data-live-payments="true">
    <header className="payments-utility">
      <label className="payments-search"><Search size={16} /><input aria-label="Search payments, cards, or links" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payments, cards, or links…" /><kbd>⌘ K</kbd></label>
      <div><button type="button" className="payments-bell" aria-label="Refresh payment records" onClick={refresh} disabled={cardLinks.isFetching || cards.isFetching || authorizations.isFetching}><RefreshCw size={17} className={cardLinks.isFetching || cards.isFetching || authorizations.isFetching ? "animate-spin" : ""} /><i /></button><span className="payments-owner">RG</span></div>
    </header>
    <div className="payments-content">
      <section className="payments-page-head payments-page-head--compact"><h1><CreditCard size={22} />Payments</h1><button type="button" className="payments-new" onClick={() => { setShowLinkForm(true); setGeneratedLink(null); }}><Plus size={15} />Create payment link</button></section>
      <section className="payments-metrics" aria-label="Payment metrics"><article className="is-blue"><span>Authorized holds</span><strong>{formatCents(metrics.held)}</strong><small>Existing authorization records</small></article><article className="is-mint"><span>Captured</span><strong>{formatCents(metrics.captured)}</strong><small>Existing captured records</small></article><article className="is-coral"><span>Needs attention</span><strong>{formatCents(metrics.attention)}</strong><small>Existing failed records</small></article><article className="is-amber"><span>Active payment links</span><strong>{metrics.links}</strong><small>Existing card-link records</small></article></section>
      <section className="payments-workbench" aria-label="Live payment workspace">
        <aside className="payments-board"><header className="payments-board-head"><div><span className="payments-eyebrow">Payment activity</span><h2>Resolve the right payment state</h2></div><span className="payments-board-count">{visible.length} shown</span></header><nav className="payments-filters" aria-label="Payment filters">{[{ value: "active", label: "Active" }, { value: "held", label: "Holds" }, { value: "review", label: "Review" }, { value: "captured", label: "Captured" }, { value: "all", label: "All" }].map((item) => <button type="button" key={item.value} className={filter === item.value ? "is-active" : ""} onClick={() => setFilter(item.value as "active" | "all" | ReviewState)}>{item.label}</button>)}</nav>{loading ? <div className="payments-empty"><Loader2 className="animate-spin" /><strong>Loading payment records</strong><p>Reading the established card and authorization sources.</p></div> : visible.length === 0 ? <div className="payments-empty"><CreditCard size={26} /><strong>No payment records match this view</strong><p>Clear the local search or choose another state.</p></div> : <div className="payment-list">{visible.map((record) => <button type="button" key={record.id} className={`payment-row payment-row--${record.state} ${selected?.id === record.id ? "is-selected" : ""}`} onClick={() => { setSelectedId(record.id); setPreauthOpen(false); setCaptureAmount(""); }}><CustomerPortrait customer={record.customer} className="payment-portrait payment-portrait--row" /><span className="payment-row-main"><span><strong>{record.customer}</strong><em>{record.kind === "authorization" ? `AUTH-${record.authorizationId}` : record.kind === "card" ? "CARD ON FILE" : "CARD LINK"}</em></span><small>{record.detail}</small><i><Clock3 size={11} />{record.created}</i></span><span className="payment-row-side"><b>{formatCents(record.amountCents)}</b><em className={`payment-status payment-status--${record.state}`}>{record.statusLabel}</em></span></button>)}</div>}</aside>
        {selected ? <article className={`payment-detail payment-detail--${selected.state}`}><header className="payment-detail-head"><div className="payment-detail-person"><CustomerPortrait customer={selected.customer} className="payment-portrait payment-portrait--detail" /><div><span className="payments-eyebrow">Selected payment context</span><h2>{selected.customer}</h2><p>{selected.phone}</p></div></div><div className="payment-detail-state"><em className={`payment-status payment-status--${selected.state}`}>{selected.statusLabel}</em><strong>{selected.kind === "authorization" ? `AUTH-${selected.authorizationId}` : selected.kind === "card" ? "CARD ON FILE" : "CARD LINK"}</strong></div></header><section className="payment-total-band"><div><span>{selected.kind === "authorization" ? "Amount" : "Record type"}</span><strong>{selected.kind === "authorization" ? formatCents(selected.amountCents) : selected.kind === "card" ? "Saved card" : "Secure link"}</strong></div><p>{selected.method}<i />{selected.invoice}</p></section><section className="payment-detail-grid"><div className="payment-detail-summary"><span>Payment context</span><p>{selected.detail}</p><small><LockKeyhole size={13} />Card data remains outside the application and is handled by Stripe.</small></div><div className="payment-detail-card"><span>Payment method</span><strong>{selected.card}</strong><p>{selected.method}</p></div></section>{primaryActionSlot}<section className="payment-lifecycle"><header><span>Payment lifecycle</span><small>Existing record</small></header><div><i className="is-created" /><p><strong>Payment record created</strong><span>{selected.created}</span></p></div><div><i className={selected.state === "captured" ? "is-captured" : selected.state === "failed" ? "is-failed" : selected.state === "review" ? "is-review" : selected.state === "held" ? "is-held" : "is-released"} /><p><strong>{selected.statusLabel}</strong><span>{selected.note}</span></p></div></section>{selected.errorMessage && <section className="payment-live-warning"><CircleAlert size={15} /><span>{selected.errorMessage}</span></section>}<section className="payment-existing-fields payment-existing-fields--complete"><span>Existing record details</span><div>{selected.kind === "link" && <><p><small>Service date</small>{selected.serviceDate || "—"}</p><p className="payment-existing-fields__wide"><small>Service address</small>{selected.serviceAddress || "—"}</p><p><small>Issued</small>{selected.created}</p><p><small>Expires</small>{formatDate(selected.expiresAt)}</p><p><small>Completed</small>{formatDate(selected.completedAt)}</p></>}{selected.kind === "authorization" && <><p><small>Job</small>{selected.jobLabel || "—"}</p><p className="payment-existing-fields__wide"><small>Payment intent</small>{selected.paymentIntentId || "—"}</p><p><small>Authorized</small>{formatDate(selected.authorizedAt)}</p><p><small>Capture by</small>{formatDate(selected.captureBefore)}</p><p><small>Captured</small>{formatDate(selected.capturedAt)}</p><p><small>Released</small>{formatDate(selected.cancelledAt)}</p><p><small>Created by</small>{selected.createdBy || "—"}</p><p><small>Action by</small>{selected.actionBy || "—"}</p></>}{selected.kind === "card" && <><p><small>Card saved</small>{formatDate(selected.cardSavedAt)}</p><p><small>Record updated</small>{formatDate(selected.cardUpdatedAt)}</p><p className="payment-existing-fields__wide"><small>Customer phone</small>{selected.phone}</p></>}</div></section><section className="payment-safety"><ShieldCheck size={15} /><div><strong>Existing card safeguards remain in force</strong><p>All Stripe queries, card-link creation, preauthorization, capture, cancellation, access checks, and confirmation behavior are unchanged.</p></div></section><footer className="payment-action-dock"><div><span>Recommended next step</span><strong>{selected.kind === "authorization" && selected.state === "held" ? "Confirm readiness before a payment decision" : selected.kind === "card" ? "Review the customer context before placing a hold" : selected.kind === "link" ? "Use the established secure-link workflow" : "Review the existing payment context before a customer follow-up"}</strong></div></footer></article> : <article className="payment-detail payment-detail-empty"><CreditCard size={28} /><h2>No payment record selected</h2><p>Select an existing payment, saved card, or card link.</p><button type="button" className="payments-new" onClick={() => setShowLinkForm(true)}><Plus size={14} />Create payment link</button></article>}
      </section>
    </div>
    {showLinkForm && <div className="payments-live-overlay" role="dialog" aria-modal="true" aria-label="Create secure card link"><form className="payments-link-dialog" onSubmit={submitCardLink}><header><div><span className="payments-eyebrow">Existing card-link workflow</span><h2>Generate secure card link</h2><p>The exact existing Stripe mutation and 7-day link behavior are retained.</p></div><button type="button" className="payment-action" onClick={() => setShowLinkForm(false)}><XCircle size={14} />Close</button></header><div className="payments-link-fields"><label><Phone size={13} />Customer phone *<input value={linkPhone} onChange={(event) => setLinkPhone(event.target.value)} placeholder="+1 (555) 000-0000" required autoFocus /></label><label><User size={13} />Customer name<input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Jane Smith" /></label><label><CalendarIcon />Job date<input value={linkJobDate} onChange={(event) => setLinkJobDate(event.target.value)} placeholder="Thursday, July 10 at 10 AM" /></label><label><MapPin size={13} />Job address<input value={linkAddress} onChange={(event) => setLinkAddress(event.target.value)} placeholder="123 Main St, Washington DC" /></label></div>{generatedLink && <div className="payment-link-result"><strong><CheckCircle2 size={14} />Link ready — expires {formatDate(generatedLink.expiresAt)}</strong><code>{generatedLink.url}</code><CopyButton text={generatedLink.url} /></div>}<footer><button type="button" className="payment-action" onClick={() => setShowLinkForm(false)}>Cancel</button><button type="submit" className="payment-action is-primary" disabled={generateLink.isPending}>{generateLink.isPending ? <Loader2 className="animate-spin" /> : <CreditCard size={14} />}Generate secure card link</button></footer></form></div>}
  </main>;
}

function CalendarIcon() {
  return <Clock3 size={13} />;
}
