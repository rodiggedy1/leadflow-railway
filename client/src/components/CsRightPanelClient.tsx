import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone, ChevronRight, Clock3, AlertTriangle, ExternalLink,
  Brain, Tag, RefreshCw, Copy, CircleDot, Briefcase, MapPin,
  TrendingUp, Users, X, ClipboardList,
} from "lucide-react";
import { Bot, CreditCard, User, Edit3, CheckCircle2, XCircle, Link2, Copy, Loader2, Send } from "lucide-react";
import { EXTRAS_LIST, calculateExtrasTotal } from "@shared/extras";
import { toast } from "sonner";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types (minimal — matches what CsInbox passes) ──────────────────────────
interface SelectedConv {
  id: number;
  name: string;
  initials: string;
  phone: string;
  queue: string | null;
  wait: string;
  status?: string;
  stats?: { bookings: number; complaints: number };
  messages?: { sender: string; text: string; ts?: number }[];
}

interface ClientProfile {
  name?: string | null;
  createdAt?: string | Date | null;
  totalBookings?: number | null;
  avgPrice?: number | null;
  frequency?: string | null;
  todayJob?: {
    jobAddress?: string | null;
    serviceType?: string | null;
    jobStatus?: string | null;
    jobTime?: string | null;
    l27Url?: string | null;
    bedrooms?: string | null;
    bathrooms?: string | null;
  } | null;
  recentJobs?: Array<{
    date?: string | null;
    serviceType?: string | null;
    status?: string | null;
    address?: string | null;
    l27Url?: string | null;
  }> | null;
}

const BEDROOM_BASE: Record<number, number> = {
  1: 119, 2: 209, 3: 229, 4: 279, 5: 319, 6: 379, 7: 419,
};
const BATH_PRICE = 30;
const SERVICE_SURCHARGES: Record<string, number> = {
  "Standard Cleaning": 0,
  "Deep Cleaning": 60,
  "Move-In/Move-Out": 60,
  "Post-Construction Cleaning": 60,
};
const SERVICE_TYPES = ["Standard Cleaning", "Deep Cleaning", "Move-In/Move-Out", "Post-Construction Cleaning"];
const BATH_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4];

// Top extras to show in the widget (most common ones)
const WIDGET_EXTRAS = [
  "clean_inside_oven",
  "clean_inside_cabinets",
  "clean_inside_full_fridge",
  "clean_interior_windows",
  "clean_finished_basement",
  "move_in_move_out",
  "i_have_pets",
  "same_day_booking",
];

function SendQuoteWidget({
  mission,
  sessionContext,
  customerName,
}: {
  mission: CsMissionRow;
  sessionContext: SessionContext | null;
  customerName: string;
}) {
  // Parse pre-filled beds/baths from session context
  const initBeds = useMemo(() => {
    const raw = sessionContext?.bedrooms ?? "";
    const m = String(raw).match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 1;
    return Math.min(Math.max(n, 1), 7);
  }, [sessionContext?.bedrooms]);

  const initBaths = useMemo(() => {
    const raw = sessionContext?.bathrooms ?? "";
    const m = String(raw).match(/(\d+\.?\d*)/);
    const n = m ? parseFloat(m[1]) : 1;
    return BATH_OPTIONS.includes(n) ? n : 1;
  }, [sessionContext?.bathrooms]);

  const initServiceType = useMemo(() => {
    const s = sessionContext?.serviceType ?? "";
    return SERVICE_TYPES.find(t => t.toLowerCase().includes(s.toLowerCase().split(" ")[0])) ?? "Standard Cleaning";
  }, [sessionContext?.serviceType]);

  const [beds, setBeds] = useState(initBeds);
  const [baths, setBaths] = useState(initBaths);
  const [serviceType, setServiceType] = useState(initServiceType);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [smsText, setSmsText] = useState("");
  const [step, setStep] = useState<"configure" | "compose">("configure");
  const [notes, setNotes] = useState("");
  const [finalPriceInput, setFinalPriceInput] = useState("");

  const basePrice = (BEDROOM_BASE[beds] ?? 119) + baths * BATH_PRICE + (SERVICE_SURCHARGES[serviceType] ?? 0);
  const extrasTotal = calculateExtrasTotal(selectedExtras);
  const calculatedPrice = basePrice + extrasTotal;
  const finalPrice = finalPriceInput !== "" ? Math.max(0, Number(finalPriceInput) || 0) : calculatedPrice;
  const discount = calculatedPrice - finalPrice;
  const totalPrice = finalPrice;

  const firstName = (sessionContext?.leadName ?? customerName).split(" ")[0] || "there";
  const welcomeUrl = (() => {
    const base = `https://quote.maidinblack.com/welcome/${encodeURIComponent(firstName)}`;
    const p = new URLSearchParams();
    p.set("beds", String(beds));
    p.set("baths", String(baths));
    p.set("type", serviceType);
    p.set("price", String(calculatedPrice));
    if (finalPriceInput !== "") p.set("finalPrice", String(finalPrice));
    if (discount > 0) p.set("discount", String(discount));
    if (notes.trim()) p.set("notes", encodeURIComponent(notes.trim()));
    if (selectedExtras.length > 0) p.set("extras", selectedExtras.join(","));
    return `${base}?${p.toString()}`;
  })();

  const sendQuoteSms = trpc.csMissions.sendQuoteSms.useMutation({
    onSuccess: () => {
      toast.success("Quote sent to customer! ✨");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send SMS");
    },
  });

  function handleGenerate() {
    const discountLine = discount > 0 ? `\nWe've included a special discount for you as well. 🎁` : "";
    setSmsText(
      `Hi ${firstName}! We put together a custom quote just for you 🖤${discountLine}\n\nTap the link to view your personalized pricing and book your first clean:\n\n${welcomeUrl}\n\nAny questions? Just reply here, we're happy to help!`
    );
    setStep("compose");
  }

  function handleSend() {
    if (!smsText.trim()) return;
    sendQuoteSms.mutate({
      missionId: mission.id,
      sessionId: mission.sessionId,
      text: smsText.trim(),
    });
  }

  function toggleExtra(key: string) {
    setSelectedExtras(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      {step === "configure" ? (
        <>
          {/* Beds / Baths / Service Type */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Beds</label>
              <select
                value={beds}
                onChange={e => setBeds(Number(e.target.value))}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {[1,2,3,4,5,6,7].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? "Bed" : "Beds"}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Baths</label>
              <select
                value={baths}
                onChange={e => setBaths(Number(e.target.value))}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {BATH_OPTIONS.map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? "Bath" : "Baths"}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Type</label>
              <select
                value={serviceType}
                onChange={e => setServiceType(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {SERVICE_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(" Cleaning", "").replace("Post-Construction", "Post-Const.")}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Extras */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Extras</label>
            <div className="grid grid-cols-2 gap-1.5">
              {WIDGET_EXTRAS.map(key => {
                const extra = EXTRAS_LIST.find(e => e.key === key);
                if (!extra) return null;
                const selected = selectedExtras.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleExtra(key)}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                      selected
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                    }`}
                  >
                    {extra.label} +${extra.price}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price row: calculated + final price inline */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-between flex-1 px-3 py-2 rounded-xl bg-violet-50 border border-violet-100">
              <span className="text-xs font-semibold text-violet-700">Price</span>
              <span className="text-sm font-bold text-violet-900">${calculatedPrice}</span>
            </div>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">Final $</span>
              <input
                type="number"
                min="0"
                placeholder={String(calculatedPrice)}
                value={finalPriceInput}
                onChange={e => setFinalPriceInput(e.target.value)}
                className="w-full text-xs pl-14 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              />
            </div>
          </div>
          {discount > 0 && (
            <p className="text-[11px] text-emerald-600 font-semibold -mt-1 pl-1">🎁 Special discount for {firstName}: -${discount}</p>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. First visit includes oven cleaning"
              rows={2}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none leading-relaxed"
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            className="w-full text-xs font-bold py-2.5 rounded-xl text-white transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
          >
            <Link2 className="w-3.5 h-3.5" /> Build Welcome Message
          </button>
        </>
      ) : (
        <>
          {/* Welcome link display */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
            <span className="text-[11px] text-emerald-700 font-medium truncate flex-1">{welcomeUrl}</span>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(welcomeUrl); toast.success("Link copied!"); }}
              className="flex-shrink-0 text-emerald-600 hover:text-emerald-800"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Editable SMS */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Message to Customer</label>
            <textarea
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
              rows={6}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none leading-relaxed"
            />
          </div>

          {/* Send + Back */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={sendQuoteSms.isPending || !smsText.trim()}
              className="flex-1 text-xs font-bold py-2.5 rounded-xl text-white disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
            >
              {sendQuoteSms.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Send Quote</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep("configure")}
              className="text-xs font-semibold py-2 px-3 rounded-xl bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            >
              ← Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  selected: SelectedConv;
  setCompose: (v: string) => void;
  messages?: { sender: string; text: string; ts?: number }[];
  missionSection?: React.ReactNode;
  onPaymentLink?: () => void;
}

export default function CsRightPanelClient({ selected, setCompose, messages = [], missionSection, onPaymentLink }: Props) {
  const [debriefDismissed, setDebriefDismissed] = useState<Record<number, boolean>>({});
  const [upsellResult, setUpsellResult] = useState<{ upsell: { signal: string; pitch: string; upsellType: string } | null } | null>(null);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellDismissed, setUpsellDismissed] = useState<number | null>(null);

  const { data: clientProfile } = trpc.leads.getClientProfile.useQuery(
    { phone: selected.phone },
    { enabled: !!selected.phone, refetchOnWindowFocus: false, refetchInterval: 120_000 }
  );

  const { data: callDebrief } = trpc.leads.getLatestCallDebrief.useQuery(
    { sessionId: selected.id },
    { enabled: selected.id > 0, refetchOnWindowFocus: false }
  );

  // ── AI insight — exact copy from CsInbox.tsx ──────────────────────────────
  const [insightData, setInsightData] = useState<{ insight: string } | null>(null);
  const [insightFetchedForId, setInsightFetchedForId] = useState<number | null>(null);
  const insightMutation = trpc.opsChat.getCsConvInsight.useMutation({
    onSuccess: (data) => { setInsightData(data); },
  });
  const insightLoading = insightMutation.isPending;
  const insightMsgHistory = useMemo(() => {
    if (!messages.length) return "[]";
    return JSON.stringify(messages.map(m => ({ role: m.sender === "client" ? "user" : "assistant", content: (m as any).text ?? "" })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id, messages.length]);
  const clientProfileSummary = useMemo(() => {
    if (!clientProfile) return undefined;
    const parts: string[] = [];
    if (clientProfile.name) parts.push(`Name: ${clientProfile.name}`);
    if (clientProfile.totalBookings) parts.push(`Total bookings: ${clientProfile.totalBookings}`);
    if (clientProfile.avgPrice) parts.push(`Avg price: $${clientProfile.avgPrice}`);
    if (clientProfile.frequency) parts.push(`Frequency: ${clientProfile.frequency}`);
    return parts.join(", ");
  }, [clientProfile]);
  // ── Payment link mission — exact copy from AiConcierge.tsx ─────────────────
  interface PaymentLinkConfirmCard {
    recipientName: string; recipientFirstName: string; recipientPhone: string;
    paymentLinkUrl: string; expiresAt: number; smsText: string; command?: string;
  }
  interface PaymentLinkSentCard {
    recipientName: string; recipientPhone: string; paymentLinkUrl: string;
    success: boolean; error?: string;
  }
  const [showQuoteWidget, setShowQuoteWidget] = useState(false);
  const [paymentCard, setPaymentCard] = useState<PaymentLinkConfirmCard | null>(null);
  const [paymentSentCard, setPaymentSentCard] = useState<PaymentLinkSentCard | null>(null);
  const [paymentSmsText, setPaymentSmsText] = useState("");
  const chatMutation = trpc.aiConcierge.chat.useMutation();
  const sendPaymentLinkSms = trpc.aiConcierge.sendPaymentLinkSms.useMutation();
  function firePaymentLink() {
    const name = selected.name ?? "Customer";
    const phone = selected.phone;
    setPaymentCard(null); setPaymentSentCard(null);
    chatMutation.mutate(
      { message: `Send payment link to ${name}`, resolvedClientPhone: phone, resolvedPaymentLink: true, resolvedClientName: name },
      { onSuccess: (result: any) => {
          if (result.type === "payment_link_confirm") {
            setPaymentCard(result as PaymentLinkConfirmCard);
            setPaymentSmsText(result.smsText);
          }
        }
      }
    );
  }
  function handleSendPaymentLink() {
    if (!paymentCard) return;
    sendPaymentLinkSms.mutate(
      { recipientPhone: paymentCard.recipientPhone, recipientName: paymentCard.recipientName, smsText: paymentSmsText, paymentLinkUrl: paymentCard.paymentLinkUrl },
      { onSuccess: (result: any) => { setPaymentSentCard(result); setPaymentCard(null); } }
    );
  }

  useEffect(() => {
    if (!selected || selected.id <= 0 || messages.length === 0) return;
    if (insightFetchedForId !== selected.id) setInsightData(null);
    const key = `${selected.id}:${messages.length}`;
    if (insightFetchedForId === selected.id && insightMutation.variables &&
        `${insightMutation.variables.sessionId}:${JSON.parse(insightMutation.variables.messageHistory ?? '[]').length}` === key) return;
    setInsightFetchedForId(selected.id);
    insightMutation.mutate({
      sessionId: selected.id,
      messageHistory: insightMsgHistory,
      clientName: selected.name ?? undefined,
      queue: selected.queue ?? undefined,
      clientProfile: clientProfileSummary,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id, messages.length, insightMsgHistory]);

  const showDebrief = !!callDebrief && selected?.id != null && !debriefDismissed[selected.id];
  const showUpsell = !!(upsellResult?.upsell && upsellDismissed !== selected?.id);
  const upsellData = upsellResult;
  const showUpsellCard = showUpsell || upsellLoading;

  const customerMemory = useMemo(() => {
    if (!clientProfile) return null;
    const bookings = clientProfile.totalBookings ?? 0;
    const lastBooking = clientProfile.recentJobs?.[0]
      ? `${clientProfile.recentJobs[0].serviceType ?? "Cleaning"} on ${clientProfile.recentJobs[0].date ?? "unknown date"}`
      : "No prior bookings";
    const complaintHistory = bookings === 0 ? "First-time customer — no prior bookings" : `${bookings} prior booking${bookings !== 1 ? "s" : ""} — clean record`;
    const careAbout = bookings === 0
      ? "New or infrequent customer — make a great first impression"
      : clientProfile.frequency && !["one_time","one-time"].includes(clientProfile.frequency.toLowerCase())
        ? `Recurring ${clientProfile.frequency} customer — reliability matters`
        : "One-time customer — upsell to recurring";
    return { lastBooking, complaintHistory, careAbout };
  }, [clientProfile]);

  // ── Render ────────────────────────────────────────────────────────────────
  const gradientPalette = [
    "from-violet-500 to-fuchsia-500",
    "from-rose-500 to-orange-400",
    "from-emerald-500 to-teal-500",
    "from-sky-500 to-cyan-500",
    "from-amber-500 to-yellow-400",
    "from-pink-500 to-rose-400",
    "from-indigo-500 to-blue-500",
    "from-teal-500 to-green-500",
  ];
  const ini = selected.initials || "?";
  const idx = (ini.charCodeAt(0) * 31 + (ini.charCodeAt(1) || 0)) % gradientPalette.length;
  const gradClass = gradientPalette[idx];
  const name = clientProfile?.name ?? selected.name;
  const since = clientProfile?.createdAt ? new Date(clientProfile.createdAt as string).getFullYear() : null;

  return (
    <div className="h-full rounded-[28px] overflow-hidden flex flex-col" style={{background:'#FBFBFC', border:'1px solid rgba(16,24,40,.06)', boxShadow:'0 10px 28px rgba(15,23,42,.05)'}}>
      {/* Header */}
      <div style={{padding:'28px 28px 24px',background:'#FFFFFF',borderBottom:'1px solid rgba(16,24,40,.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'20px'}}>
          <div className={`bg-gradient-to-br ${gradClass}`} style={{width:'56px',height:'56px',borderRadius:'18px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',fontWeight:800,color:'white',flexShrink:0,boxShadow:'0 8px 20px rgba(0,0,0,.10)'}}>
            {ini}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
            <div style={{fontSize:'20px',fontWeight:900,color:'#101828',lineHeight:1.15,letterSpacing:'-0.03em'}}>{name}</div>
            <div style={{fontSize:'12px',color:'#98A2B3',fontWeight:600}}>{since ? `Customer since ${since}` : 'Customer'}</div>
            <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'2px'}}>
              <Phone style={{width:'13px',height:'13px',color:'#10b981',flexShrink:0}} />
              <span style={{fontSize:'14px',fontWeight:600,color:'#101828'}}>{selected.phone}</span>
            </div>
          </div>
        </div>
      </div>
      {/* Scrollable body */}
      <div className="cs-inbox-scroll overflow-y-auto flex-1">
        {/* Missions — inline so they can call firePaymentLink directly */}
        <section style={{flexShrink:0,padding:'14px 16px',borderBottom:'1px solid #eff0f2',background:'#fff'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
            <span style={{fontSize:'11px',fontWeight:800,letterSpacing:'.04em',color:'#344054'}}>Missions</span>
            <span style={{fontSize:'11px',color:'#6d4aff',fontWeight:600,cursor:'pointer'}}>+ Add</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            <div style={{padding:'10px 12px',borderBottom:'1px solid #eff0f2',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:'9px'}}
              onClick={() => { setPaymentCard(null); setPaymentSentCard(null); firePaymentLink(); }}>
              <div style={{width:'28px',height:'28px',borderRadius:'8px',background:'#f0edff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',flexShrink:0}}>💳</div>
              <div><b style={{fontSize:'10px',fontWeight:800}}>Send Payment Link</b><p style={{margin:'3px 0 0',color:'#9298a4',fontSize:'9px'}}>Generate &amp; send a payment link via SMS.</p></div>
            </div>
            <div style={{padding:'10px 12px',borderBottom:'1px solid #eff0f2',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:'9px'}}
              onClick={() => setShowQuoteWidget(v => !v)}>
              <div style={{width:'28px',height:'28px',borderRadius:'8px',background:'#f0edff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',flexShrink:0}}>📋</div>
              <div><b style={{fontSize:'10px',fontWeight:800}}>Send Quote</b><p style={{margin:'3px 0 0',color:'#9298a4',fontSize:'9px'}}>Build &amp; send a personalized quote.</p></div>
            </div>
            <div style={{padding:'10px 12px',opacity:0.42,display:'flex',alignItems:'flex-start',gap:'9px'}}>
              <div style={{width:'28px',height:'28px',borderRadius:'8px',background:'#f0edff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',flexShrink:0}}>🚗</div>
              <div><b style={{fontSize:'10px',fontWeight:800}}>Get ETA</b><p style={{margin:'3px 0 0',color:'#9298a4',fontSize:'9px'}}>Coming soon.</p></div>
            </div>
          </div>
        </section>
        {/* Payment link confirm card — shown inline after clicking Send Payment Link mission */}
        {chatMutation.isPending && !paymentCard && (
          <div className="mx-4 mb-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-xs text-violet-600 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            Generating payment link…
          </div>
        )}
        {paymentCard && !paymentSentCard && (
          <div className="mx-4 mb-3">
            <div className="rounded-2xl overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
              <div className="px-4 py-3 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
                <CreditCard className="w-4 h-4 flex-shrink-0" style={{color:"#7447f5"}} />
                <p className="text-sm font-semibold" style={{color:"#202431"}}>Send Payment Link</p>
              </div>
              <div className="px-4 pt-3 pb-2 flex items-center gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{background:"rgba(116,71,245,0.12)"}}>
                  <User className="w-4 h-4" style={{color:"#7447f5"}} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{color:"#202431"}}>{paymentCard.recipientName}</p>
                  <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{paymentCard.recipientPhone}</p>
                </div>
                <a href={paymentCard.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors flex-shrink-0">
                  <ExternalLink className="w-3 h-3" /> View link
                </a>
              </div>
              <div className="px-4 pb-2">
                <span className="text-[11px]" style={{color:"#8a8a9a"}}>Link expires {new Date(paymentCard.expiresAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
              </div>
              <div className="px-4 pb-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Edit3 className="w-3 h-3" style={{color:"#7447f5"}} />
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#7447f5"}}>Message to send</span>
                </div>
                <textarea value={paymentSmsText} onChange={(e) => setPaymentSmsText(e.target.value)} disabled={sendPaymentLinkSms.isPending} rows={8} className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-colors disabled:opacity-60" style={{background:"rgba(255,255,255,0.8)",border:"1px solid #e5d9ea",color:"#2d3039"}} />
              </div>
              <div className="px-4 pb-4">
                <button onClick={handleSendPaymentLink} disabled={!paymentSmsText.trim() || sendPaymentLinkSms.isPending} className="w-full flex items-center justify-center gap-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-all" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)"}}>
                  {sendPaymentLinkSms.isPending ? (<><div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> Sending…</>) : (<>Send to {paymentCard.recipientFirstName}</>)}
                </button>
              </div>
            </div>
          </div>
        )}
        {paymentSentCard && (
          <div className="mx-4 mb-3">
            <div className="rounded-2xl overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
              <div className="px-4 py-3 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${paymentSentCard.success ? "bg-green-500" : "bg-red-500"}`}>
                  {paymentSentCard.success ? <CheckCircle2 className="w-3.5 h-3.5 text-white" /> : <XCircle className="w-3.5 h-3.5 text-white" />}
                </span>
                <p className="text-sm font-semibold" style={{color:"#202431"}}>{paymentSentCard.success ? `Payment link sent to ${paymentSentCard.recipientName}` : `Failed to send to ${paymentSentCard.recipientName}`}</p>
              </div>
              <div className="px-4 py-3 space-y-1.5">
                <p className="text-xs text-gray-400">{paymentSentCard.recipientPhone}</p>
                {paymentSentCard.success && <a href={paymentSentCard.paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"><ExternalLink className="w-3 h-3" /> View payment link</a>}
                {paymentSentCard.error && <p className="text-xs text-red-400">{paymentSentCard.error}</p>}
              </div>
            </div>
          </div>
        )}
        {/* Send Quote widget — shown inline when Send Quote mission is clicked */}
        {showQuoteWidget && (
          <div className="mx-4 mb-3">
            <SendQuoteWidget
              mission={{ id: 0, sessionId: selected.id, agentId: 0, agentName: null, title: "Send Quote", emoji: "🧾", status: "active" as const, failureReason: null, stages: [], sortOrder: 0, createdAt: null, updatedAt: null, completedAt: null, customerName: selected.name }}
              sessionContext={{ teamName: null, leadPhone: selected.phone, leadName: selected.name, bedrooms: null, bathrooms: null, serviceType: null }}
              customerName={selected.name}
            />
          </div>
        )}
        {/* CLIENT PROFILE metrics */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <div className="p-5 bg-white">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-4">Client profile</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Frequency", value: clientProfile?.frequency ?? "—" },
                  { label: "Avg price", value: clientProfile?.avgPrice ? `$${clientProfile.avgPrice}` : "—" },
                  { label: "Total bookings", value: clientProfile?.totalBookings ?? 0 },
                  { label: "Last booking", value: clientProfile?.recentJobs?.[0]?.date ?? "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">{label}</div>
                    <div className="text-sm font-bold text-slate-800">{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Today's job for client */}
        {clientProfile?.todayJob && (
          <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4" style={{fontSize:'10px',fontWeight:900,letterSpacing:'.22em',textTransform:'uppercase',color:'#98A2B3'}}>
                <Briefcase className="h-3.5 w-3.5" /> Today's job
              </div>
              {(() => {
                const tj = clientProfile.todayJob!;
                const l27Url = tj.l27Url ?? null;
                const CardEl = l27Url ? "a" : "div";
                return (
                  <CardEl
                    {...(l27Url ? { href: l27Url, target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="rounded-2xl border border-slate-200 bg-white p-4 block hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-bold text-slate-800">{tj.jobTime ?? "—"}</span>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${tj.jobStatus === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                        {tj.jobStatus ?? "Scheduled"}
                      </span>
                    </div>
                    {tj.jobAddress && (
                      <div className="flex items-start gap-2 mt-2">
                        <MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <span className="text-xs text-slate-600 leading-snug">{tj.jobAddress}</span>
                      </div>
                    )}
                    {(tj.bedrooms || tj.bathrooms) && (
                      <div className="mt-2 text-xs text-slate-500">{[tj.bedrooms, tj.bathrooms].filter(Boolean).join(" / ")}</div>
                    )}
                    {l27Url && <ExternalLink className="w-3 h-3 text-slate-400 mt-2" />}
                  </CardEl>
                );
              })()}
            </CardContent>
          </Card>
        )}
        {/* Know before you reply */}
        {customerMemory && (() => {
          const isHighRisk = (selected?.stats?.complaints ?? 0) >= 2;
          return (
            <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
              <CardContent className="p-5">
                <div className={`rounded-[24px] border p-4 ${isHighRisk ? "border-rose-300 bg-rose-50 ring-1 ring-rose-200" : "border-amber-200 bg-amber-50"}`}>
                  <div className={`flex items-center gap-2 text-sm font-medium mb-3 ${isHighRisk ? "text-rose-800" : "text-amber-800"}`}>
                    {isHighRisk ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <Brain className="h-4 w-4" />}
                    Know before you reply
                    {isHighRisk && (
                      <span className="ml-auto text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200 rounded-full px-2 py-0.5">Escalate to senior rep</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: "Last job", value: customerMemory.lastBooking },
                      { label: "History", value: customerMemory.complaintHistory },
                      { label: "Profile", value: customerMemory.careAbout },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wide w-16 ${isHighRisk ? "text-rose-400" : "text-amber-500"}`}>{label}</span>
                        <span className={`text-xs leading-4 ${isHighRisk ? "text-rose-900" : "text-amber-900"}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}
        {/* AI insight — exact render from CsInbox.tsx */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
          <CardContent className="p-5">
            <div style={{borderRadius:'20px',border:'1px solid rgba(139,92,246,.12)',background:'rgba(139,92,246,.04)',padding:'16px'}}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{color:'#6D28D9'}}>
                <Bot className="h-4 w-4" /> AI insight
                {insightLoading && <RefreshCw className="h-3 w-3 animate-spin ml-auto" style={{color:'#A78BFA'}} />}
              </div>
              {insightLoading && !insightData?.insight ? (
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-full rounded animate-pulse" style={{background:'rgba(139,92,246,.12)'}} />
                  <div className="h-3 w-4/5 rounded animate-pulse" style={{background:'rgba(139,92,246,.12)'}} />
                  <div className="h-3 w-3/5 rounded animate-pulse" style={{background:'rgba(139,92,246,.12)'}} />
                </div>
              ) : insightData?.insight ? (
                <div className="mt-2 text-sm leading-6" style={{color:'#4C1D95'}}>{insightData.insight}</div>
              ) : (
                <div className="mt-2 text-xs italic" style={{color:'#A78BFA'}}>Select a conversation with messages to generate insight.</div>
              )}
            </div>
          </CardContent>
        </Card>
        {/* Recent jobs */}
        {clientProfile?.recentJobs && clientProfile.recentJobs.length > 0 && (
          <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-4">Recent jobs</div>
              <div className="space-y-2">
                {clientProfile.recentJobs.slice(0, 3).map((job, i) => {
                  const l27Url = job.l27Url ?? null;
                  const CardEl = l27Url ? "a" : "div";
                  return (
                    <CardEl
                      key={i}
                      {...(l27Url ? { href: l27Url, target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 flex items-center justify-between gap-2 hover:shadow-sm transition-shadow"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-700 truncate">{job.serviceType ?? "Cleaning"}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{job.date ?? "—"}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${job.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{job.status ?? "—"}</span>
                        {l27Url && <ExternalLink className="w-3 h-3 text-slate-400" />}
                      </div>
                    </CardEl>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
        {/* Thread status */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Thread status</div>
            <div className="mt-4 space-y-3">
              {[
                { label: selected.queue ?? "Customer", icon: Tag },
                { label: selected.status ?? "Active", icon: CircleDot },
                { label: `${selected.wait} since last message`, icon: Clock3 },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 px-3 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <item.icon className="h-4 w-4 text-slate-400" />
                    {item.label}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
