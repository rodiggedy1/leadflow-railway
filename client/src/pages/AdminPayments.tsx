/**
 * AdminPayments — Stripe card-on-file management page.
 * Route: /admin/payments
 *
 * Tab 1 — Card Links: generate links + recent links table
 * Tab 2 — Cards & Charges: cards on file with inline preauth + authorizations
 */
import { useState, useMemo } from "react";
import {
  CreditCard,
  Copy,
  Check,
  RefreshCw,
  Plus,
  DollarSign,
  XCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  User,
  Phone,
  Calendar,
  MapPin,
  Loader2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { trpc } from "@/lib/trpc";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
function formatTs(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${raw}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    authorized: { label: "Authorized", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    captured:   { label: "Captured",   cls: "bg-green-50 text-green-700 border-green-200" },
    cancelled:  { label: "Cancelled",  cls: "bg-gray-100 text-gray-500 border-gray-200" },
    failed:     { label: "Failed",     cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── TAB 1: Generate Card Link ─────────────────────────────────────────────────
function GenerateLinkPanel() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [jobDate, setJobDate] = useState("");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<{ url: string; expiresAt: number } | null>(null);

  const generate = trpc.stripe.generateCardAuthToken.useMutation({
    onSuccess: (data) => {
      setResult({ url: data.url, expiresAt: data.expiresAt });
      toast.success("Card link generated!");
    },
    onError: (err) => toast.error(err.message || "Failed to generate link"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { toast.error("Phone number is required"); return; }
    generate.mutate({
      customerPhone: normalizePhone(phone.trim()),
      customerName: name.trim() || undefined,
      jobDate: jobDate.trim() || undefined,
      jobAddress: address.trim() || undefined,
    });
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#E8735A]/30 focus:border-[#E8735A]";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[#E8735A]/10 grid place-items-center">
          <Plus className="w-4 h-4 text-[#E8735A]" />
        </div>
        <h2 className="text-base font-bold text-gray-900">Generate Card Link</h2>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}><Phone className="w-3 h-3 inline mr-1" />Customer Phone *</label>
          <Input className={inputCls} placeholder="+1 (555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}><User className="w-3 h-3 inline mr-1" />Customer Name</label>
          <Input className={inputCls} placeholder="Jane Smith" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}><Calendar className="w-3 h-3 inline mr-1" />Job Date</label>
          <Input className={inputCls} placeholder="Thursday, July 10 at 10 AM" value={jobDate} onChange={e => setJobDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}><MapPin className="w-3 h-3 inline mr-1" />Job Address</label>
          <Input className={inputCls} placeholder="123 Main St, Washington DC" value={address} onChange={e => setAddress(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={generate.isPending} className="w-full bg-[#E8735A] hover:bg-[#d4604a] text-white font-bold rounded-xl">
            {generate.isPending
              ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating…</span>
              : <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Generate Secure Card Link</span>}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-bold text-green-700 mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Link ready — expires {formatTs(result.expiresAt)}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-green-200 rounded-lg px-3 py-2 text-gray-700 truncate">{result.url}</code>
            <CopyButton text={result.url} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── TAB 1: Recent Card Links table ────────────────────────────────────────────
function CardLinksTable() {
  const { data, isLoading, refetch, isFetching } = trpc.stripe.listAllCardAuthTokens.useQuery(
    { limit: 50 },
    { staleTime: 30_000, retry: false, throwOnError: false }
  );

  const baseUrl = "https://quote.maidinblack.com";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-50 grid place-items-center">
            <Clock className="w-4 h-4 text-purple-600" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Recent Card Links</h2>
          {data && <span className="text-xs text-gray-400 font-medium">({data.length})</span>}
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No links generated yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4">Customer</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">Link</th>
              </tr>
            </thead>
            <tbody>
              {data.map(t => {
                const expired = t.expiresAt < Date.now();
                const status = t.used ? "used" : expired ? "expired" : "active";
                const statusCls = {
                  used: "bg-green-50 text-green-700 border-green-200",
                  expired: "bg-gray-100 text-gray-500 border-gray-200",
                  active: "bg-blue-50 text-blue-700 border-blue-200",
                }[status];
                const url = `${baseUrl}/pay/${t.token}`;
                return (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-gray-900">{t.customerName || "—"}</div>
                      <div className="text-xs text-gray-400 font-mono">{t.customerPhone}</div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${statusCls}`}>{status}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-400">{formatTs(t.expiresAt)}</td>
                    <td className="py-2.5">{status === "active" && <CopyButton text={url} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── TAB 2: Inline Preauth modal per card row ──────────────────────────────────
function InlinePreauthForm({
  customer,
  onDone,
}: {
  customer: { phone: string; name: string | null; cardBrand?: string | null; cardLast4?: string | null };
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();

  const createPreauth = trpc.stripe.createPreauth.useMutation({
    onSuccess: (data) => {
      toast.success(`Hold placed — ${formatCents(data.amountCents)}`);
      utils.stripe.listPaymentAuthorizations.invalidate();
      onDone();
    },
    onError: (err) => toast.error(err.message || "Preauth failed"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents < 50) { toast.error("Amount must be at least $0.50"); return; }
    createPreauth.mutate({
      customerPhone: customer.phone,
      amountCents: cents,
      jobLabel: jobLabel.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
      {customer.cardBrand && customer.cardLast4 && (
        <div className="sm:col-span-3 flex items-center gap-2 mb-1 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <CreditCard className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          A hold will be placed on <span className="font-bold text-gray-700 capitalize">{customer.cardBrand} ••••{customer.cardLast4}</span> — no charge until you capture.
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Amount (USD) *</label>
        <div className="relative">
          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <Input
            className="pl-6 pr-2 py-2 text-sm rounded-lg border border-gray-200 w-full focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="150.00"
            type="number"
            min="0.50"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            required
            autoFocus
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Job Label</label>
        <Input
          className="py-2 text-sm rounded-lg border border-gray-200 w-full focus:outline-none focus:ring-2 focus:ring-amber-200"
          placeholder="Deep clean — July 10"
          value={jobLabel}
          onChange={e => setJobLabel(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
        <Input
          className="py-2 text-sm rounded-lg border border-gray-200 w-full focus:outline-none focus:ring-2 focus:ring-amber-200"
          placeholder="Optional"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>
      <div className="sm:col-span-3 flex gap-2">
        <Button
          type="submit"
          disabled={createPreauth.isPending}
          size="sm"
          className="bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg gap-1"
        >
          {createPreauth.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
          Place Hold
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} className="rounded-lg">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── TAB 2: Cards on File with inline preauth ──────────────────────────────────
function CardsOnFilePanel() {
  const [search, setSearch] = useState("");
  const [preauthFor, setPreauthFor] = useState<string | null>(null); // phone
  const { data, isLoading, refetch, isFetching } = trpc.stripe.listAllCustomers.useQuery(
    { limit: 100 },
    { staleTime: 30_000, retry: false, throwOnError: false }
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    if (!q) return data;
    return data.filter(c =>
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.cardLast4 ?? "").includes(q)
    );
  }, [data, search]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-50 grid place-items-center">
            <CreditCard className="w-4 h-4 text-blue-600" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Cards on File</h2>
          {data && <span className="text-xs text-gray-400 font-medium">({data.length})</span>}
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <Input
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-200"
        placeholder="Search by phone, name, or last 4…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No cards on file yet.</div>
      ) : (
        <div className="space-y-1">
          {filtered.map(c => (
            <div key={c.id} className="border border-gray-100 rounded-xl px-4 py-3 hover:bg-gray-50/40 transition">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 text-sm">{c.name || "—"}</div>
                  <div className="text-xs text-gray-400 font-mono mt-0.5">{c.phone}</div>
                </div>
                {c.cardLast4 ? (
                  <div className="flex items-center gap-1.5 text-sm text-gray-700">
                    <span className="capitalize text-xs font-semibold text-gray-500">{c.cardBrand}</span>
                    <span className="text-gray-300">••••</span>
                    <span className="font-mono font-bold">{c.cardLast4}</span>
                    <span className="text-gray-400 text-xs">{c.cardExpMonth}/{c.cardExpYear}</span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">No card</span>
                )}
                {c.cardLast4 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-700 border-amber-200 hover:bg-amber-50 text-xs font-bold rounded-lg gap-1 flex-shrink-0"
                    onClick={() => setPreauthFor(preauthFor === c.phone ? null : c.phone)}
                  >
                    <Zap className="w-3 h-3" />
                    {preauthFor === c.phone ? "Cancel" : "Preauthorize"}
                  </Button>
                )}
              </div>
              {preauthFor === c.phone && (
                <InlinePreauthForm
                  customer={{ phone: c.phone, name: c.name ?? null, cardBrand: c.cardBrand, cardLast4: c.cardLast4 }}
                  onDone={() => setPreauthFor(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TAB 2: Auth row ───────────────────────────────────────────────────────────
function AuthRow({ auth, onRefresh }: {
  auth: {
    id: number;
    cleanerJobId: number | null;
    jobLabel: string | null;
    customerPhone: string;
    customerName: string | null;
    stripeCustomerId: string;
    stripePaymentMethodId: string;
    stripePaymentIntentId: string | null;
    amountCents: number;
    currency: string;
    status: string;
    errorMessage: string | null;
    createdBy: string | null;
    actionBy: string | null;
    notes: string | null;
    authorizedAt: number | null;
    capturedAt: number | null;
    cancelledAt: number | null;
    createdAt: Date;
  };
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [captureAmount, setCaptureAmount] = useState("");

  const capture = trpc.stripe.capturePayment.useMutation({
    onSuccess: () => { toast.success("Payment captured!"); onRefresh(); },
    onError: (err) => toast.error(err.message || "Capture failed"),
  });
  const cancel = trpc.stripe.cancelPreauth.useMutation({
    onSuccess: () => { toast.success("Authorization cancelled."); onRefresh(); },
    onError: (err) => toast.error(err.message || "Cancel failed"),
  });

  const canAct = auth.status === "authorized";

  function handleCapture() {
    const cents = captureAmount ? Math.round(parseFloat(captureAmount) * 100) : undefined;
    capture.mutate({ authorizationId: auth.id, amountCents: cents });
  }
  function handleCancel() {
    if (!confirm(`Cancel the ${formatCents(auth.amountCents)} hold for ${auth.customerName || auth.customerPhone}?`)) return;
    cancel.mutate({ authorizationId: auth.id });
  }

  return (
    <div className="border border-gray-100 rounded-xl mb-2 overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/60 select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm truncate">{auth.customerName || auth.customerPhone}</span>
            <StatusBadge status={auth.status} />
            <span className="text-sm font-bold text-gray-700">{formatCents(auth.amountCents)}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
            {auth.jobLabel && <span>{auth.jobLabel}</span>}
            <span>{formatDate(auth.createdAt)}</span>
            {auth.createdBy && <span>by {auth.createdBy}</span>}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50/30">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs text-gray-600">
            <div><span className="font-semibold text-gray-500 block">Phone</span>{auth.customerPhone}</div>
            <div>
              <span className="font-semibold text-gray-500 block">PaymentIntent</span>
              <span className="font-mono">{auth.stripePaymentIntentId?.slice(0, 20) ?? "—"}…</span>
            </div>
            <div><span className="font-semibold text-gray-500 block">Authorized</span>{formatTs(auth.authorizedAt)}</div>
            {auth.capturedAt && <div><span className="font-semibold text-gray-500 block">Captured</span>{formatTs(auth.capturedAt)}</div>}
            {auth.cancelledAt && <div><span className="font-semibold text-gray-500 block">Cancelled</span>{formatTs(auth.cancelledAt)}</div>}
            {auth.actionBy && <div><span className="font-semibold text-gray-500 block">Action by</span>{auth.actionBy}</div>}
            {auth.errorMessage && <div className="col-span-2 sm:col-span-3"><span className="font-semibold text-red-500 block">Error</span>{auth.errorMessage}</div>}
            {auth.notes && <div className="col-span-2 sm:col-span-3"><span className="font-semibold text-gray-500 block">Notes</span>{auth.notes}</div>}
          </div>

          {canAct && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-gray-500">Capture amount (optional):</span>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                  <Input
                    className="w-24 pl-6 pr-2 py-1.5 text-xs rounded-lg border border-gray-200"
                    placeholder={(auth.amountCents / 100).toFixed(2)}
                    value={captureAmount}
                    onChange={e => setCaptureAmount(e.target.value)}
                    type="number"
                    min="0.50"
                    step="0.01"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg gap-1"
                onClick={handleCapture}
                disabled={capture.isPending}
              >
                {capture.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Capture
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50 text-xs font-bold rounded-lg gap-1"
                onClick={handleCancel}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Cancel Hold
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TAB 2: Authorizations ─────────────────────────────────────────────────────
function AuthorizationsPanel() {
  const [filterPhone, setFilterPhone] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "authorized" | "captured" | "cancelled" | "failed">("all");

  const { data, isLoading, refetch, isFetching } = trpc.stripe.listPaymentAuthorizations.useQuery(
    { limit: 100 },
    { staleTime: 30_000, retry: false, throwOnError: false }
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(a => {
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      if (filterPhone) {
        const q = filterPhone.toLowerCase();
        return (a.customerPhone ?? "").includes(q) || (a.customerName ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [data, filterPhone, filterStatus]);

  const totals = useMemo(() => {
    if (!data) return { authorized: 0, captured: 0 };
    return {
      authorized: data.filter(a => a.status === "authorized").reduce((s, a) => s + a.amountCents, 0),
      captured: data.filter(a => a.status === "captured").reduce((s, a) => s + a.amountCents, 0),
    };
  }, [data]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-50 grid place-items-center">
            <DollarSign className="w-4 h-4 text-amber-600" />
          </div>
          <h2 className="text-base font-bold text-gray-900">Authorizations</h2>
          {data && <span className="text-xs text-gray-400 font-medium">({data.length})</span>}
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-blue-500 mb-0.5">Held (authorized)</p>
            <p className="text-xl font-black text-blue-700">{formatCents(totals.authorized)}</p>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-green-500 mb-0.5">Captured (charged)</p>
            <p className="text-xl font-black text-green-700">{formatCents(totals.captured)}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3 flex-wrap">
        <Input
          className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
          placeholder="Filter by phone or name…"
          value={filterPhone}
          onChange={e => setFilterPhone(e.target.value)}
        />
        <select
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
        >
          <option value="all">All statuses</option>
          <option value="authorized">Authorized</option>
          <option value="captured">Captured</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No authorizations found.</div>
      ) : (
        <div>{filtered.map(auth => <AuthRow key={auth.id} auth={auth} onRefresh={refetch} />)}</div>
      )}
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function AdminPayments() {
  const { pagePermissions, isAdmin } = useAgentPermissions();

  return (
    <AdminPageGuard pageId="payments">
      <div className="min-h-screen" style={{ backgroundColor: "#F7F7F7" }}>
        <AdminHeader activeTab="payments" pagePermissions={pagePermissions} isAdmin={isAdmin} />
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="mb-5">
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#E8735A]" />
              Payments
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage card-on-file links, preauthorizations, and captures.
            </p>
          </div>

          <Tabs defaultValue="links">
            <TabsList className="mb-5 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              <TabsTrigger value="links" className="rounded-lg text-sm font-semibold px-5 py-2 data-[state=active]:bg-[#E8735A] data-[state=active]:text-white">
                Card Links
              </TabsTrigger>
              <TabsTrigger value="cards" className="rounded-lg text-sm font-semibold px-5 py-2 data-[state=active]:bg-[#E8735A] data-[state=active]:text-white">
                Cards &amp; Charges
              </TabsTrigger>
            </TabsList>

            <TabsContent value="links">
              <GenerateLinkPanel />
              <CardLinksTable />
            </TabsContent>

            <TabsContent value="cards">
              <CardsOnFilePanel />
              <AuthorizationsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AdminPageGuard>
  );
}
