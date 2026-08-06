import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Phone, ChevronRight, Clock3, AlertTriangle, ExternalLink,
  Brain, Tag, RefreshCw, Copy, CircleDot, Briefcase, MapPin,
  TrendingUp, Users, X, ClipboardList,
} from "lucide-react";
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

interface Props {
  selected: SelectedConv;
  setCompose: (v: string) => void;
}

export default function CsRightPanelClient({ selected, setCompose }: Props) {
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
        {/* AI insight placeholder */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span style={{fontSize:'14px'}}>✦</span>
              <span className="text-xs font-semibold text-violet-700 uppercase tracking-widest">AI insight</span>
            </div>
            <p className="text-xs text-slate-400 italic">Select a conversation with messages to generate insight.</p>
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
