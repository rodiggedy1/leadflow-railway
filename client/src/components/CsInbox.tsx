import React, { useMemo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, CircleDot, Clock3, Loader2, Mail, MapPin, MessageSquare, Phone, Search, Send, Sparkles, Star, Tag, TriangleAlert, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type MsgSender = "client" | "agent" | "system" | "cleaner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
}

function displayName(leadName: string | null, leadPhone: string): string {
  return leadName ?? formatPhone(leadPhone);
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  return raw;
}

function parseMessages(messageHistory: string | null): { sender: MsgSender; text: string; time: string; ts?: number }[] {
  if (!messageHistory) return [];
  try {
    const raw: Array<{ role: string; content: string; ts?: number }> = JSON.parse(messageHistory);
    return raw.map((m) => ({
      sender: (m.role === "user" ? "client" : m.role === "assistant" ? "agent" : "system") as MsgSender,
      text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      time: m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
      ts: m.ts,
    }));
  } catch { return []; }
}

function timeAgo(date: Date | string | null): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function bubbleStyles(sender: MsgSender) {
  switch (sender) {
    case "client":  return "bg-white border-slate-200 text-slate-900";
    case "agent":   return "bg-slate-900 border-slate-900 text-white ml-auto";
    case "system":  return "bg-blue-50 border-blue-200 text-blue-800";
    case "cleaner": return "bg-amber-50 border-amber-200 text-amber-800";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CsInbox() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Live data
  const { data: sessions = [], isLoading, refetch } = (trpc.leads as any).listCsInbox.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const sendMessage = trpc.leads.sendMessage.useMutation({
    onSuccess: () => {
      setReplyText("");
      refetch();
      toast.success("Message sent");
    },
    onError: (err: any) => toast.error("Send failed", { description: err.message }),
  });

  // Derived
  const filtered = useMemo(() => {
    if (!query.trim()) return sessions as any[];
    const q = query.trim().toLowerCase();
    return (sessions as any[]).filter((s: any) => {
      const hay = [s.leadName ?? "", s.leadPhone, s.lastActivityText ?? "", s.stage].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, query]);

  const selected: any = filtered.find((s: any) => s.id === selectedId) ?? filtered[0] ?? null;
  const selectedMessages = useMemo(() => parseMessages(selected?.messageHistory ?? null), [selected]);

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedMessages.length]);

  function handleSend() {
    if (!selected || !replyText.trim() || sendMessage.isPending) return;
    sendMessage.mutate({ sessionId: selected.id, message: replyText.trim() });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f8fafc,white_35%,#f8fafc_100%)] p-4 md:p-6 text-slate-900">
      <div className="mx-auto max-w-[1600px]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" /> Customer Service SMS Handler
            </div>
            <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">Three-column customer service inbox</h1>
            <p className="mt-2 text-slate-600 max-w-3xl">Conversation-first, job-aware. Built for fast replies, priority handling, and clear context without burying the thread.</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button className="rounded-2xl h-11">AI reply mode</Button>
            <Button variant="outline" className="rounded-2xl h-11">Bulk follow-up</Button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_340px] gap-5">
          {/* LEFT: Queue sidebar */}
          <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden">
            <CardContent className="p-4 md:p-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Inbox</div>
                  <div className="mt-2 text-3xl font-semibold">Today</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-center min-w-[74px]">
                  <div className="text-xl font-semibold">{sessions.length}</div>
                  <div className="text-xs text-slate-500 mt-1">online</div>
                </div>
              </div>

              <div>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations..." className="pl-9 h-11 rounded-2xl border-slate-200" />
                </div>
                <div className="mt-4 space-y-2.5">
                  {filtered.length === 0 && (
                    <div className="text-center py-10 text-slate-400 text-sm">
                      {sessions.length === 0
                        ? "No CS messages yet. Texts to 202-888-5362 will appear here."
                        : "No results for your search."}
                    </div>
                  )}
                  {filtered.map((session: any) => {
                    const msgs = parseMessages(session.messageHistory);
                    const lastMsg = msgs[msgs.length - 1];
                    const isSelected = selected?.id === session.id;
                    const waitText = session.lastCustomerReplyAt ? timeAgo(session.lastCustomerReplyAt) : timeAgo(session.createdAt);
                    return (
                      <button
                        key={session.id}
                        onClick={() => setSelectedId(session.id)}
                        className={`w-full rounded-[24px] border bg-white px-4 py-4 text-left shadow-sm transition hover:shadow-md ${isSelected ? "border-slate-900" : "border-slate-200"}`}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="h-11 w-11 border border-slate-200">
                            <AvatarFallback className="bg-slate-100 text-slate-700">{initials(session.leadName, session.leadPhone)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold truncate">{displayName(session.leadName, session.leadPhone)}</div>
                                <div className="text-sm text-slate-500 truncate mt-0.5">{formatPhone(session.leadPhone)}</div>
                              </div>
                              <div className="text-xs text-slate-400 whitespace-nowrap">{waitText}</div>
                            </div>
                            <div className="mt-2 text-sm text-slate-600 line-clamp-2">{lastMsg?.text ?? "No messages yet"}</div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <Badge className={`rounded-full border ${lastMsg?.sender === "client" ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-50" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                                {lastMsg?.sender === "client" ? "Awaiting reply" : "Replied"}
                              </Badge>
                              <div className="text-xs text-slate-500 truncate">{session.stage}</div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CENTER: Thread */}
          <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden">
            {!selected ? (
              <CardContent className="flex items-center justify-center h-full min-h-[500px]">
                <div className="text-center text-slate-400">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Select a conversation</p>
                </div>
              </CardContent>
            ) : (
              <CardContent className="p-0 h-full flex flex-col">
                <div className="border-b border-slate-200 px-5 py-5 md:px-6 bg-white">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-3xl font-semibold tracking-tight">{displayName(selected.leadName, selected.leadPhone)}</h2>
                        <Badge className="rounded-full border bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-50">CS Inbox</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                        <span>{formatPhone(selected.leadPhone)}</span>
                        <span>•</span>
                        <span>{selected.stage}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" className="rounded-2xl" onClick={() => window.open(`tel:${selected.leadPhone}`, "_self")}>
                        <Phone className="h-4 w-4 mr-2" />Call
                      </Button>
                      <Button variant="outline" className="rounded-2xl">Open full job</Button>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-200 px-5 py-4 md:px-6 bg-slate-50/70">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Live timeline</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className="rounded-full bg-white">CS Line</Badge>
                    <Badge variant="outline" className="rounded-full bg-white">{selected.stage}</Badge>
                    {selectedMessages[selectedMessages.length - 1]?.sender === "client" && (
                      <Badge variant="outline" className="rounded-full bg-white">Tone: Awaiting reply</Badge>
                    )}
                  </div>
                </div>

                <ScrollArea className="flex-1 px-5 py-5 md:px-6 bg-[linear-gradient(180deg,#fcfcfd_0%,#f8fafc_100%)] min-h-[420px]">
                  <div ref={scrollRef} className="space-y-3">
                    {selectedMessages.length === 0 && (
                      <div className="text-center text-slate-400 text-sm py-10">No messages yet.</div>
                    )}
                    {selectedMessages.map((message, idx) => (
                      <motion.div key={`${message.ts ?? idx}-${idx}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }} className={`max-w-[78%] rounded-[22px] border px-4 py-3 shadow-sm ${bubbleStyles(message.sender)}`}>
                        <div className="text-xs uppercase tracking-wide opacity-60">{message.sender}</div>
                        <div className="mt-1.5 text-sm leading-6">{message.text}</div>
                        <div className="mt-2 text-xs opacity-60">{message.time}</div>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="border-t border-slate-200 px-5 py-4 md:px-6 bg-white">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {["Running late", "Send tracking link", "Offer discount", "Call client", "Escalate"].map((action) => (
                      <Button key={action} variant="outline" className="rounded-full h-10">{action}</Button>
                    ))}
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start gap-3">
                      <Textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message or use AI suggestion..."
                        className="flex-1 rounded-2xl bg-white border border-slate-200 px-4 py-3 text-sm min-h-[96px] resize-none focus-visible:ring-1"
                      />
                      <Button className="rounded-2xl h-[96px] px-5" onClick={handleSend} disabled={!replyText.trim() || sendMessage.isPending}>
                        {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" />Send</>}
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" className="rounded-full"><Bot className="h-4 w-4 mr-2" />AI Suggest</Button>
                      <Button variant="outline" className="rounded-full">Running late</Button>
                      <Button variant="outline" className="rounded-full">We're on the way</Button>
                      <Button variant="outline" className="rounded-full">Review + rebook</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* RIGHT: Client profile */}
          <div className="space-y-5">
            {selected && (
              <>
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden">
                  <CardContent className="p-0">
                    <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 text-amber-800 font-medium"><TriangleAlert className="h-4 w-4" /> Flag as needs attention</div>
                      <Badge className="rounded-full border border-amber-200 bg-white text-amber-700 hover:bg-white">Urgent</Badge>
                    </div>
                    <div className="p-5 space-y-5 bg-white">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Client profile</div>
                        <div className="mt-3 text-2xl font-semibold">{displayName(selected.leadName, selected.leadPhone)}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
                          <span className="inline-flex items-center gap-1"><Phone className="h-4 w-4" />{formatPhone(selected.leadPhone)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Service</div>
                          <div className="mt-1 font-semibold">{selected.stage}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Messages</div>
                          <div className="mt-1 font-semibold">{selectedMessages.length}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Bookings</div>
                          <div className="mt-1 font-semibold">—</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Rating</div>
                          <div className="mt-1 font-semibold inline-flex items-center gap-1"><Star className="h-4 w-4 text-amber-500 fill-amber-500" />—</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Context flags</div>
                        <div className="mt-3 space-y-2">
                          {[
                            `${selectedMessages.filter(m => m.sender === "client").length} customer messages`,
                            selectedMessages[selectedMessages.length - 1]?.sender === "client" ? "Awaiting agent reply" : "Agent replied",
                            "Needs active handling",
                          ].map((flag) => (
                            <div key={flag} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 flex items-center gap-2">
                              <Tag className="h-4 w-4 text-slate-400" />{flag}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Actions</div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {[
                        { label: "Call client", icon: Phone, action: () => window.open(`tel:${selected.leadPhone}`, "_self") },
                        { label: "Message client", icon: MessageSquare, action: () => document.querySelector("textarea")?.focus() },
                        { label: "Send tracking link", icon: Mail, action: () => toast.info("Coming soon") },
                        { label: "Approve extra time", icon: Clock3, action: () => toast.info("Coming soon") },
                        { label: "Mark complete", icon: CheckCircle2, action: () => toast.info("Coming soon") },
                        { label: "Offer rebook", icon: Wallet, action: () => toast.info("Coming soon") },
                      ].map((a) => (
                        <Button key={a.label} variant="outline" className="rounded-2xl justify-start h-12" onClick={a.action}>
                          <a.icon className="h-4 w-4 mr-2" />{a.label}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Thread status</div>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: selectedMessages[selectedMessages.length - 1]?.sender === "client" ? "Awaiting reply" : "Agent replied", icon: AlertTriangle },
                        { label: selected.stage, icon: CircleDot },
                        { label: `${timeAgo(selected.lastCustomerReplyAt ?? selected.createdAt)} since last client message`, icon: Clock3 },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border border-slate-200 px-3 py-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm"><item.icon className="h-4 w-4 text-slate-400" />{item.label}</div>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
