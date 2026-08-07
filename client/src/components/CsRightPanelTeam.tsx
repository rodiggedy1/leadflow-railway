import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Phone, Briefcase, Clock3, Building2, MapPin, AlertTriangle,
  ExternalLink, RefreshCw, Link2, Copy, CircleDot, ChevronRight
} from "lucide-react";
import { toast } from "sonner";

type JobStatus = "on_the_way" | "arrived" | "running_late" | "in_progress" | "completed" | "issue_at_property" | null | undefined;

function jobStatusLabel(s: JobStatus): string {
  switch (s) {
    case "on_the_way":        return "On the way";
    case "arrived":           return "Arrived";
    case "running_late":      return "Running late";
    case "in_progress":       return "In progress";
    case "completed":         return "Completed";
    case "issue_at_property": return "Issue at property";
    default:                  return "Scheduled";
  }
}

function jobStatusStyle(s: JobStatus): string {
  switch (s) {
    case "on_the_way":        return "bg-blue-50 text-blue-700 border-blue-200";
    case "arrived":           return "bg-teal-50 text-teal-700 border-teal-200";
    case "running_late":      return "bg-amber-50 text-amber-700 border-amber-200";
    case "in_progress":       return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "completed":         return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "issue_at_property": return "bg-rose-50 text-rose-700 border-rose-200";
    default:                  return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

interface SelectedConv {
  id: number;
  name: string;
  initials: string;
  phone: string;
  queue: string | null;
  status?: string;
  wait?: string;
}

interface Props {
  selected: SelectedConv;
}

export default function CsRightPanelTeam({ selected }: Props) {
  // ── Two-step route from skill: getCleanerProfileByPhone → getCleanerTodayJobs ──
  const { data: cleanerProfile } = trpc.leads.getCleanerProfileByPhone.useQuery(
    { phone: selected.phone },
    { enabled: !!selected.phone, refetchOnWindowFocus: false }
  );
  const { data: cleanerTodayJobs } = trpc.leads.getCleanerTodayJobs.useQuery(
    { cleanerProfileId: cleanerProfile?.id ?? 0 },
    { enabled: !!cleanerProfile?.id, refetchOnWindowFocus: false, refetchInterval: 60_000 }
  );

  // Magic link
  const [magicLinkAction, setMagicLinkAction] = useState<"send" | "copy" | null>(null);
  const getMagicLink = trpc.cleaner.getMagicLink.useMutation({
    onSuccess: async ({ url, cleanerName }) => {
      if (magicLinkAction === "copy") {
        navigator.clipboard.writeText(url).then(() => {
          toast.success(`Magic link for ${cleanerName} copied!`);
        }).catch(() => {
          toast.info(`Magic link: ${url}`, { duration: 10000 });
        });
      } else if (magicLinkAction === "send") {
        toast.success(`Magic link sent to ${cleanerName}!`);
      }
      setMagicLinkAction(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to generate magic link");
      setMagicLinkAction(null);
    },
  });
  function handleMagicLink(action: "send" | "copy") {
    if (!cleanerProfile?.id) {
      toast.error("No cleaner profile linked to this conversation.");
      return;
    }
    setMagicLinkAction(action);
    getMagicLink.mutate({ cleanerProfileId: cleanerProfile.id, origin: "https://quote.maidinblack.com" });
  }

  return (
    <div className="h-full rounded-[28px] overflow-hidden flex flex-col" style={{background:'#FBFBFC', border:'1px solid rgba(16,24,40,.06)', boxShadow:'0 10px 28px rgba(15,23,42,.05)'}}>
      {/* Header */}
      <div style={{padding:'28px 28px 24px',background:'#FFFFFF',borderBottom:'1px solid rgba(16,24,40,.06)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'20px'}}>
          <div style={{width:'56px',height:'56px',borderRadius:'18px',background:'linear-gradient(135deg,#14b8a6,#10b981)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',fontWeight:800,color:'white',flexShrink:0,boxShadow:'0 8px 20px rgba(16,185,129,.22)'}}>
            {selected.initials}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
            <div style={{fontSize:'20px',fontWeight:900,color:'#101828',lineHeight:1.15,letterSpacing:'-0.03em'}}>{selected.name}</div>
            <div style={{fontSize:'12px',color:'#98A2B3',fontWeight:600}}>Team Member</div>
            <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'2px'}}>
              <Phone style={{width:'13px',height:'13px',color:'#10b981',flexShrink:0}} />
              <span style={{fontSize:'14px',fontWeight:600,color:'#101828'}}>{selected.phone}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto flex-1" style={{scrollbarWidth:'none'}}>

        {/* Missions */}
        <section style={{flexShrink:0,padding:'14px 16px',borderBottom:'1px solid #eff0f2',background:'#fff'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
            <span style={{fontSize:'13px',fontWeight:800,letterSpacing:'.04em',color:'#344054'}}>Missions</span>
            <span style={{fontSize:'13px',color:'#6d4aff',fontWeight:600,cursor:'pointer'}}>+ Add</span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:0}}>
            <div style={{padding:'10px 12px',opacity:0.42,display:'flex',alignItems:'flex-start',gap:'9px'}}>
              <div style={{width:'32px',height:'32px',borderRadius:'9px',background:'#f0edff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',flexShrink:0}}>🚗</div>
              <div><b style={{fontSize:'13px',fontWeight:700}}>Get ETA</b><p style={{margin:'3px 0 0',color:'#9298a4',fontSize:'11px'}}>Coming soon.</p></div>
            </div>
          </div>
        </section>

        {/* Today's Jobs */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none overflow-hidden">
          <CardContent className="p-0">
            <div className="p-5 bg-white space-y-3">
              <div className="flex items-center gap-2" style={{fontSize:'11px',fontWeight:900,letterSpacing:'.22em',textTransform:'uppercase',color:'#98A2B3'}}>
                <Briefcase className="h-3.5 w-3.5" /> Today's jobs
              </div>
              {!cleanerTodayJobs ? (
                <div className="text-sm text-slate-400 py-2">Loading jobs...</div>
              ) : cleanerTodayJobs.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No jobs scheduled today
                </div>
              ) : (
                cleanerTodayJobs.map((job) => {
                  const time = job.serviceDateTime
                    ? new Date(job.serviceDateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "—";
                  const launch27Url = job.bookingId
                    ? `https://maidsinblack.launch27.com/admin/bookings/${job.bookingId}`
                    : null;
                  const clientPhone10 = (job.customerPhone ?? "").replace(/[^\d]/g, "").slice(-10);
                  const callHref = clientPhone10 ? `openphone://call?to=+1${clientPhone10}` : null;
                  return (
                    <div key={job.id} className="rounded-[20px] border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <div className="w-full text-left p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <Clock3 className="h-4 w-4 text-slate-400" />
                            {time}
                          </div>
                          <Badge className={`rounded-full border text-xs font-medium hover:bg-transparent ${jobStatusStyle(job.jobStatus as JobStatus)}`}>
                            {jobStatusLabel(job.jobStatus as JobStatus)}
                          </Badge>
                        </div>
                        <div className="flex items-start gap-2 text-sm text-slate-700">
                          <Building2 className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                          <span className="font-medium">{job.customerName || "—"}</span>
                        </div>
                        {job.jobAddress && (
                          <div className="flex items-start gap-2 text-sm text-slate-500">
                            <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                            <span className="leading-5">{job.jobAddress}</span>
                          </div>
                        )}
                        {job.serviceType && (
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-1.5 text-xs text-slate-600">
                            {job.serviceType}
                          </div>
                        )}
                        {job.jobStatus === "issue_at_property" && job.issueNote && (
                          <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800 flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            {job.issueNote}
                          </div>
                        )}
                        {job.jobStatus === "running_late" && job.delayMinutes && (
                          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                            Running {job.delayMinutes} min late
                          </div>
                        )}
                      </div>
                      {(callHref || launch27Url) && (
                        <div className="flex items-center gap-1 px-3 py-2 border-t border-slate-100 bg-slate-50">
                          {callHref && (
                            <a href={callHref} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                              <Phone className="h-3.5 w-3.5" /> Call client
                            </a>
                          )}
                          {launch27Url && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a href={launch27Url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors">
                                  <ExternalLink className="h-3.5 w-3.5" /> L27
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>Open in Launch27</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Team Actions */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-4">Team actions</div>
            <div className="space-y-3">
              <Button
                variant="outline"
                className="rounded-2xl justify-start h-12 w-full border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 transition-colors"
                onClick={() => handleMagicLink("send")}
                disabled={getMagicLink.isPending || !cleanerProfile?.id}
                title={cleanerProfile?.id ? "Send one-tap login link via SMS" : "No cleaner profile linked to this conversation"}
              >
                {getMagicLink.isPending && magicLinkAction === "send"
                  ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  : <Link2 className="h-4 w-4 mr-2" />
                }
                Send magic link
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl justify-start h-12 w-full border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => handleMagicLink("copy")}
                disabled={getMagicLink.isPending || !cleanerProfile?.id}
                title={cleanerProfile?.id ? "Copy one-tap login link to clipboard" : "No cleaner profile linked to this conversation"}
              >
                {getMagicLink.isPending && magicLinkAction === "copy"
                  ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  : <Copy className="h-4 w-4 mr-2" />
                }
                Copy magic link
              </Button>
              {!cleanerProfile?.id && (
                <p className="text-xs text-slate-400 text-center">No cleaner profile found for this number</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Thread status */}
        <Card className="rounded-none border-0 border-b border-slate-100 shadow-none">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Thread status</div>
            <div className="mt-4 space-y-3">
              {[
                { label: "Teams", icon: AlertTriangle },
                { label: selected.status ?? "—", icon: CircleDot },
                { label: `${selected.wait ?? "—"} since last message`, icon: Clock3 },
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
