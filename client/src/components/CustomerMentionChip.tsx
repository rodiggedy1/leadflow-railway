/**
 * CustomerMentionChip — renders a @CustomerName chip in chat messages.
 * On hover shows a rich popover card with stats and action buttons.
 *
 * Token format in message body: @[Name|phone]
 * If multiple customers share the same name (ambiguous), the card shows
 * all matches and lets the user pick before taking action.
 */
import React, { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Phone, Mail, MessageSquare, History, Star, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type CustomerData = {
  phone: string;
  name: string;
  email: string | null;
  address: string | null;
  frequency: string | null;
  lastJobDate: string | null;
  ltv: number;
  totalCleans: number;
  isVip: boolean;
  city: string;
};

type Props = {
  /** Display name shown in the chip */
  name: string;
  /** Phone number(s) — if multiple, card shows disambiguation */
  customers: CustomerData[];
};

function formatLtv(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Inner card for a single resolved customer */
function CustomerCard({ customer }: { customer: CustomerData }) {
  const { data: ctx, isLoading } = trpc.opsChat.getCustomerContext.useQuery(
    { phone: customer.phone, name: customer.name },
    { staleTime: 120_000, retry: false }
  );

  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;

  function handleAction(action: string) {
    toast.info(`${action} — coming soon`, { description: `Will connect to ${customer.name}'s ${action.toLowerCase()} flow.` });
  }

  const actions = [
    { icon: MessageSquare, label: "Text", color: "text-green-600", bg: "hover:bg-green-50" },
    { icon: Phone, label: "AI Call", color: "text-blue-600", bg: "hover:bg-blue-50" },
    { icon: Mail, label: "Email", color: "text-violet-600", bg: "hover:bg-violet-50" },
    { icon: History, label: "History", color: "text-slate-600", bg: "hover:bg-slate-100" },
  ];

  return (
    <div className="w-[340px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Hero */}
      <div className="relative px-5 pt-5 pb-4" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg shrink-0 shadow-lg"
            style={{ background: `hsl(${hue}, 55%, 52%)` }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-base truncate">{customer.name}</span>
              {(ctx?.isVip ?? customer.isVip) && (
                <span className="shrink-0 bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <Star className="h-2.5 w-2.5 fill-white" /> VIP
                </span>
              )}
            </div>
            <p className="text-blue-200 text-xs mt-0.5 truncate">
              {customer.frequency ?? "Customer"}
              {customer.city ? ` · ${customer.city}` : ""}
            </p>
            <p className="text-blue-300 text-[11px] mt-0.5">{customer.phone}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50">
        {[
          { label: "LTV", value: formatLtv(ctx?.ltv ?? customer.ltv) },
          { label: "Cleans", value: String(ctx?.totalCleans ?? customer.totalCleans) },
          { label: "Last job", value: timeAgo(ctx?.lastJobDate ?? customer.lastJobDate) },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className="text-sm font-bold text-slate-900">{s.value}</p>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-0 border-b border-slate-100 px-2 py-3">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={() => handleAction(a.label)}
            className={cn("flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl transition-colors", a.bg)}
          >
            <div className={cn("w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center", a.color)}>
              <a.icon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-semibold text-slate-600">{a.label}</span>
          </button>
        ))}
      </div>

      {/* AI Context */}
      <div className="px-4 py-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">AI Context</p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Loading context…</span>
          </div>
        ) : ctx?.aiSummary ? (
          <p className="text-xs text-slate-700 leading-relaxed">{ctx.aiSummary}</p>
        ) : (
          <p className="text-xs text-slate-400 italic">No context available</p>
        )}

        {/* Open quotes */}
        {ctx?.openQuotes && ctx.openQuotes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ctx.openQuotes.map(q => (
              <span key={q.id} className="bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                Open quote ${q.totalPrice ?? "?"}
              </span>
            ))}
          </div>
        )}

        {/* Timeline */}
        {ctx?.timeline && ctx.timeline.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Recent</p>
            {ctx.timeline.slice(0, 3).map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                <span className="font-medium text-slate-400">{t.date}</span>
                <span className="truncate">{t.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Disambiguation picker when multiple customers share the same name */
function DisambiguationCard({ customers, onSelect }: { customers: CustomerData[]; onSelect: (c: CustomerData) => void }) {
  return (
    <div className="w-[280px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs font-bold text-slate-700">Multiple matches — choose one</p>
      </div>
      <div className="divide-y divide-slate-100">
        {customers.map(c => {
          const initials = c.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          const hue = Math.abs(c.phone.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360;
          return (
            <button
              key={c.phone}
              onClick={() => onSelect(c)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                style={{ background: `hsl(${hue}, 55%, 52%)` }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{c.phone}{c.city ? ` · ${c.city}` : ""}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-slate-700">{formatLtv(c.ltv)}</p>
                <p className="text-[10px] text-slate-400">{c.totalCleans} cleans</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomerMentionChip({ name, customers }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerData | null>(customers.length === 1 ? customers[0] : null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = customers[0]
    ? Math.abs(customers[0].phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360
    : 140;

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }
  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  }

  return (
    <span
      className="relative inline-flex items-center gap-1 align-middle"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* The chip */}
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-[13px] cursor-pointer hover:bg-emerald-100 transition-colors select-none">
        <span
          className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-black shrink-0"
          style={{ background: `hsl(${hue}, 55%, 52%)` }}
        >
          {initials}
        </span>
        {name}
        {customers.length > 1 && <ChevronDown className="h-3 w-3 opacity-60" />}
      </span>

      {/* Popover */}
      {open && (
        <span
          className="absolute z-[500] top-full left-0 mt-2 block"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.18))" }}
        >
          {selected ? (
            <CustomerCard customer={selected} />
          ) : (
            <DisambiguationCard
              customers={customers}
              onSelect={c => setSelected(c)}
            />
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Parse a message body and replace @[Name|phone] tokens with CustomerMentionChip components.
 * Also auto-detects bare full names that were resolved at send time.
 * Falls back to plain text for any unrecognized content.
 */
export function renderMessageWithMentions(
  body: string,
  customerMap: Map<string, CustomerData[]>,
  _keyPrefix?: string
): React.ReactNode[] {
  // Token format: @[Name|phone1,phone2]
  const TOKEN_RE = /@\[([^\]|]+)\|([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > last) {
      parts.push(body.slice(last, match.index));
    }
    const name = match[1];
    const phones = match[2].split(",").map(p => p.trim());
    const customers = phones
      .flatMap(p => customerMap.get(p) ?? [])
      .filter((c, i, arr) => arr.findIndex(x => x.phone === c.phone) === i);

    if (customers.length > 0) {
      parts.push(
        <CustomerMentionChip key={match.index} name={name} customers={customers} />
      );
    } else {
      // No customer data — render as plain green text
      parts.push(
        <span key={match.index} className="text-emerald-600 font-semibold">@{name}</span>
      );
    }
    last = match.index + match[0].length;
  }

  if (last < body.length) {
    parts.push(body.slice(last));
  }

  return parts.length > 0 ? parts : [body];
}
