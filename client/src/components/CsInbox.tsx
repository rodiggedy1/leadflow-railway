import { useState, useMemo, useRef, useEffect } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Briefcase,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Headphones,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Search,
  Send,
  Sparkles,
  Star,
  Tag,
  TriangleAlert,
  Users,
  Wallet,
  RefreshCw,
  Pencil,
  Check,
  X,
  Smile,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Queue = "Needs attention" | "Follow up" | "Hot leads" | "Active jobs" | "Post-job" | "Teams";
type MsgSender = "client" | "agent" | "system" | "cleaner";

type Conversation = {
  id: number;
  name: string;
  initials: string;
  queue: Queue;
  service: string;
  location: string;
  amount: string;
  lastMessage: string;
  wait: string;
  status: string;
  sentiment?: string;
  tags: string[];
  phone: string;
  stats: { bookings: number; rating: string; complaints: number };
  aiInsight: string;
  messages: { sender: MsgSender; text: string; time: string }[];
  quickActions: string[];
};

const queueStyles: Record<Queue, { tone: string; dot: string }> = {
  "Needs attention": { tone: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  "Follow up":       { tone: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  "Hot leads":       { tone: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  "Active jobs":     { tone: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  "Post-job":        { tone: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
  "Teams":           { tone: "bg-teal-50 text-teal-700 border-teal-200", dot: "bg-teal-500" },
};
const QUEUES: Queue[] = ["Needs attention", "Follow up", "Hot leads", "Active jobs", "Post-job", "Teams"];

const conversations: Conversation[] = [
  {
    id: 1,
    name: "Jillian McMahon",
    initials: "JM",
    queue: "Needs attention",
    service: "3 bedroom clean",
    location: "Alexandria, VA 22301",
    amount: "$179.10",
    lastMessage: "hey is someone coming today?",
    wait: "12 min",
    status: "Job starts in 18 min",
    sentiment: "Concerned",
    tags: ["Today", "Assigned", "High priority"],
    phone: "(571) 555-0134",
    stats: { bookings: 6, rating: "4.9", complaints: 1 },
    aiInsight:
      "Likely salvageable if answered immediately. Send running-late update and tracking link, then offer a small make-good only if delay exceeds 20 minutes.",
    messages: [
      { sender: "client", text: "Hey is someone coming today?", time: "12:12 PM" },
      { sender: "system", text: "Your cleaning is scheduled for 12:30 PM today.", time: "12:13 PM" },
      { sender: "cleaner", text: "Running about 15 min behind from prior job.", time: "12:17 PM" },
      { sender: "agent", text: "Thanks — I'm checking with the team now.", time: "12:18 PM" },
    ],
    quickActions: ["Running late", "Send tracking link", "Offer discount", "Call client", "Escalate"],
  },
  {
    id: 2,
    name: "Monica Reed",
    initials: "MR",
    queue: "Hot leads",
    service: "Move-out cleaning",
    location: "Washington, DC 20011",
    amount: "$320.00",
    lastMessage: "can you do tomorrow morning?",
    wait: "4 min",
    status: "Ready to book",
    sentiment: "High intent",
    tags: ["New lead", "Tomorrow", "Large job"],
    phone: "(202) 555-0118",
    stats: { bookings: 0, rating: "—", complaints: 0 },
    aiInsight:
      "High-value lead with immediate intent. Push slot urgency and move to phone confirmation quickly.",
    messages: [
      { sender: "client", text: "Can you do tomorrow morning?", time: "10:04 AM" },
      { sender: "system", text: "Lead came in from quote form. 3 bed / 2 bath move-out.", time: "10:04 AM" },
      { sender: "agent", text: "Yes — we may have either 9 AM or 1 PM. Want me to grab one for you?", time: "10:06 AM" },
    ],
    quickActions: ["Offer 9 AM", "Offer 1 PM", "Send price", "Call lead", "Book now"],
  },
  {
    id: 3,
    name: "Daniel Price",
    initials: "DP",
    queue: "Follow up",
    service: "Recurring clean",
    location: "Arlington, VA 22201",
    amount: "$210.00",
    lastMessage: "let me think about it",
    wait: "19 hr",
    status: "Quote sent",
    sentiment: "Warm",
    tags: ["Quote out", "Follow-up due"],
    phone: "(703) 555-0142",
    stats: { bookings: 1, rating: "5.0", complaints: 0 },
    aiInsight:
      "Soft close opportunity. A short nudge with availability pressure is more likely to convert than a long explanation.",
    messages: [
      { sender: "client", text: "Let me think about it.", time: "Yesterday 3:44 PM" },
      { sender: "agent", text: "Totally — for a home that size most jobs land around $210 depending on condition.", time: "Yesterday 3:39 PM" },
      { sender: "system", text: "Follow-up recommended after 18 hours.", time: "Today 10:00 AM" },
    ],
    quickActions: ["Last-minute opening", "Still interested?", "Resend quote", "Call", "Archive"],
  },
  {
    id: 4,
    name: "Priya Shah",
    initials: "PS",
    queue: "Post-job",
    service: "Standard clean",
    location: "Bethesda, MD 20814",
    amount: "$165.00",
    lastMessage: "looks great thank you",
    wait: "38 min",
    status: "Review opportunity",
    sentiment: "Happy",
    tags: ["5-star vibe", "Rebook chance"],
    phone: "(301) 555-0188",
    stats: { bookings: 3, rating: "5.0", complaints: 0 },
    aiInsight:
      "Best moment for review request and recurring-service ask. High probability of successful rebook while satisfaction is fresh.",
    messages: [
      { sender: "client", text: "Looks great thank you", time: "11:22 AM" },
      { sender: "cleaner", text: "Finished up and did a final check with the client.", time: "11:18 AM" },
      { sender: "system", text: "Post-job automation available: review + rebook.", time: "11:23 AM" },
    ],
    quickActions: ["Send review link", "Offer rebook", "Thank client", "Mark complete", "Call"],
  },
  {
    id: 5,
    name: "Ethan Long",
    initials: "EL",
    queue: "Active jobs",
    service: "Deep clean",
    location: "Fairfax, VA 22030",
    amount: "$260.00",
    lastMessage: "please make sure they do the oven",
    wait: "7 min",
    status: "In progress",
    sentiment: "Specific request",
    tags: ["In progress", "Special request"],
    phone: "(703) 555-0107",
    stats: { bookings: 2, rating: "4.8", complaints: 0 },
    aiInsight:
      "Operational update needed, not sales. Confirm the request is logged and reassure before job completion.",
    messages: [
      { sender: "client", text: "Please make sure they do the oven.", time: "1:07 PM" },
      { sender: "agent", text: "Absolutely — I'm noting that for the team right now.", time: "1:08 PM" },
      { sender: "cleaner", text: "Got it. Adding oven to the checklist.", time: "1:10 PM" },
    ],
    quickActions: ["Confirm request", "Message team", "Call cleaner", "Mark issue", "Complete"],
  },
];

function bubbleStyles(sender: MsgSender) {
  switch (sender) {
    case "client":
      return "bg-white border-slate-200 text-slate-900";
    case "agent":
      return "bg-slate-900 border-slate-900 text-white ml-auto";
    case "system":
      return "bg-blue-50 border-blue-200 text-blue-800";
    case "cleaner":
      return "bg-amber-50 border-amber-200 text-amber-800";
  }
}

function queueTone(queue: Queue) {
  return { label: queue, ...( queueStyles[queue] ?? queueStyles["Needs attention"]) };
}

// ── Status badge helpers for Teams panel ──────────────────────────────────────
type JobStatus = "on_the_way" | "arrived" | "running_late" | "in_progress" | "completed" | "issue_at_property" | null | undefined;

function jobStatusLabel(s: JobStatus): string {
  switch (s) {
    case "on_the_way":          return "On the way";
    case "arrived":             return "Arrived";
    case "running_late":        return "Running late";
    case "in_progress":         return "In progress";
    case "completed":           return "Completed";
    case "issue_at_property":   return "Issue at property";
    default:                    return "Scheduled";
  }
}

function jobStatusStyle(s: JobStatus): string {
  switch (s) {
    case "on_the_way":          return "bg-blue-50 text-blue-700 border-blue-200";
    case "arrived":             return "bg-teal-50 text-teal-700 border-teal-200";
    case "running_late":        return "bg-amber-50 text-amber-700 border-amber-200";
    case "in_progress":         return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "completed":           return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "issue_at_property":   return "bg-rose-50 text-rose-700 border-rose-200";
    default:                    return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

export default function CsInbox({ onSwitchTab }: { onSwitchTab?: (tab: "today" | "channels" | "cs") => void } = {}) {
  const [activeQueue, setActiveQueue] = useState<Queue | "All">("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compose, setCompose] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Unread tracking: sessionId -> timestamp when agent last viewed it
  const [lastViewedMap, setLastViewedMap] = useState<Record<number, number>>({});

  const utils = trpc.useUtils();
  useOpsStream({
    onLeadUpdate: () => {
      utils.leads.listCsInbox.invalidate();
    },
  });

  const { data: csData } = trpc.leads.listCsInbox.useQuery({ showResolved }, { refetchOnWindowFocus: false });

  // Collect all phones from real sessions for batch name resolution
  const allPhones = useMemo(
    () => (csData ?? []).map((r) => r.leadPhone ?? "").filter(Boolean),
    [csData]
  );
  const { data: nameMap } = trpc.leads.batchResolveNames.useQuery(
    { phones: allPhones },
    { enabled: allPhones.length > 0, refetchOnWindowFocus: false }
  );

  // Map DB rows to Conversation shape
  const liveConversations: Conversation[] = useMemo(() => {
    if (!csData) return conversations; // loading — show static demo data
    if (csData.length === 0) return conversations; // no real sessions — show static demo data
    return csData.map((row) => {
      let msgs: { role: string; content: string; ts?: number; senderName?: string }[] = [];
      try { msgs = JSON.parse(row.messageHistory ?? "[]"); } catch { msgs = []; }
      const lastMsg = msgs.filter((m) => m.role === "user").slice(-1)[0];
      const lastTs = msgs.slice(-1)[0]?.ts;
      const waitMs = lastTs ? Date.now() - lastTs : 0;
      const waitMin = Math.round(waitMs / 60000);
      const waitStr = waitMin < 60 ? `${waitMin} min` : `${Math.round(waitMin / 60)} hr`;
      // Resolve name: batch map > leadName > raw phone
      const phone10 = (row.leadPhone ?? "").replace(/[^\d]/g, "").slice(-10);
      const resolvedName = (nameMap && phone10 && nameMap[phone10]) || row.leadName || row.leadPhone || "Unknown";
      const name = resolvedName;
      const initials = name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
      // Last inbound message timestamp for unread detection
      const lastInboundTs = msgs.filter((m) => m.role === "user").slice(-1)[0]?.ts ?? 0;
      return {
        id: row.id,
        name,
        initials,
        queue: ((row as any).csQueue ?? (row.leadSource === "cs-inbound-cleaner" ? "Teams" : "Needs attention")) as Queue,
        service: row.leadSource === "cs-inbound-cleaner" ? "Cleaner" : "CS inquiry",
        location: row.leadPhone || "",
        amount: "",
        lastMessage: lastMsg?.content || "",
        wait: waitStr,
        status: "CS line",
        sentiment: undefined,
        tags: ["CS"],
        phone: row.leadPhone || "",
        stats: { bookings: 0, rating: "—", complaints: 0 },
        aiInsight: "",
        lastInboundTs,
        messages: msgs.map((m) => ({
          sender: m.role === "user" ? "client" : m.role === "assistant" ? "agent" : "system" as MsgSender,
          text: m.content,
          time: m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
          media: (m.media ?? []) as string[],
        })),
        quickActions: [],
        rawName: row.leadName ?? "",
      };
    });
  }, [csData, nameMap]);

  const displayConversations = liveConversations.length > 0 ? liveConversations : conversations;

  const sendMessage = trpc.leads.sendMessage.useMutation({
    onSuccess: () => {
      setCompose("");
      utils.leads.listCsInbox.invalidate();
    },
  });

  const filteredRef = useRef<typeof filtered>([]);
  const effectiveSelectedIdRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    return displayConversations.filter((c) => {
      const matchesQueue = activeQueue === "All" || c.queue === activeQueue;
      const q = query.trim().toLowerCase();
      const hay = [c.name, c.location, c.lastMessage, c.service, c.status, c.queue, c.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      return matchesQueue && (!q || hay.includes(q));
    });
  }, [activeQueue, query, displayConversations]);

  const effectiveSelectedId = selectedId ?? (filtered[0]?.id ?? null);
  const selected = filtered.find((c) => c.id === effectiveSelectedId) || filtered[0] || displayConversations[0];

  // Keep refs in sync so resolveSession.onSuccess can read latest values
  filteredRef.current = filtered;
  effectiveSelectedIdRef.current = effectiveSelectedId;

  const resolveSession = trpc.leads.resolveSession.useMutation({
    onSuccess: () => {
      const f = filteredRef.current;
      const curId = effectiveSelectedIdRef.current;
      const currentIdx = f.findIndex((c) => c.id === curId);
      const nextConv = f[currentIdx + 1] ?? f[currentIdx - 1] ?? null;
      setSelectedId(nextConv?.id ?? null);
      utils.leads.listCsInbox.invalidate();
    },
  });

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const updateCsName = trpc.leads.updateCsName.useMutation({
    onSuccess: () => {
      utils.leads.listCsInbox.invalidate();
      setEditingName(false);
    },
  });

  const updateCsQueue = trpc.leads.updateCsQueue.useMutation({
    onSuccess: () => utils.leads.listCsInbox.invalidate(),
  });
  const backfillCsNames = trpc.leads.backfillCsNames.useMutation({
    onSuccess: (data) => {
      utils.leads.listCsInbox.invalidate();
      utils.leads.batchResolveNames.invalidate();
      alert(`Backfill complete: ${data.fixed} of ${data.total} sessions updated.`);
    },
  });
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [autoDraftLoading, setAutoDraftLoading] = useState(false);
  const autoDraftedForId = useRef<number | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const csQuickReply = trpc.leads.csQuickReply.useMutation({
    onSuccess: (data) => {
      if (data.draft) setCompose(data.draft);
      setLoadingAction(null);
      setAutoDraftLoading(false);
    },
    onError: () => { setLoadingAction(null); setAutoDraftLoading(false); },
  });
  function fireQuickReply(action: "send_quote" | "make_it_right" | "refer_friend" | "running_late" | "on_the_way" | "review_rebook" | "ai_suggest") {
    if (!selected) return;
    setLoadingAction(action);
    csQuickReply.mutate({
      action,
      clientName: selected.name ?? undefined,
      messageHistory: JSON.stringify(selected.messages.map((m) => ({ role: m.sender === "client" ? "user" : "assistant", content: m.text }))),
    });
  }
  // Derive tone badge from last few client messages
  function deriveTone(messages: { sender: MsgSender; text: string }[]): { label: string; className: string } {
    const clientMsgs = messages.filter((m) => m.sender === "client").slice(-3).map((m) => m.text.toLowerCase());
    const all = clientMsgs.join(" ");
    if (/angry|furious|unacceptable|terrible|awful|worst|disgusting|never again|refund|cancel|lawsuit/.test(all))
      return { label: "Frustrated", className: "bg-red-100 text-red-700 border-red-200" };
    if (/upset|disappointed|not happy|not satisfied|issue|problem|wrong|broken|missing|late|where is|still waiting|no show/.test(all))
      return { label: "Concerned", className: "bg-orange-100 text-orange-700 border-orange-200" };
    if (/urgent|asap|emergency|right now|immediately|hurry|quickly/.test(all))
      return { label: "Urgent", className: "bg-rose-100 text-rose-700 border-rose-200" };
    if (/thank|thanks|great|love|amazing|awesome|perfect|happy|wonderful|excellent|best/.test(all))
      return { label: "Happy", className: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    if (/interested|how much|price|cost|quote|book|schedule|available|when can/.test(all))
      return { label: "Interested", className: "bg-blue-100 text-blue-700 border-blue-200" };
    if (clientMsgs.length === 0)
      return { label: "New", className: "bg-slate-100 text-slate-600 border-slate-200" };
    return { label: "Neutral", className: "bg-slate-100 text-slate-500 border-slate-200" };
  }

  // Resolve cleanerProfileId for the selected Teams conversation — MUST be after `selected` is defined
  const selectedPhone = selected?.queue === "Teams" ? (selected?.phone ?? "") : "";
  const { data: cleanerProfile } = trpc.leads.getCleanerProfileByPhone.useQuery(
    { phone: selectedPhone },
    { enabled: !!selectedPhone, refetchOnWindowFocus: false }
  );
  const { data: cleanerTodayJobs } = trpc.leads.getCleanerTodayJobs.useQuery(
    { cleanerProfileId: cleanerProfile?.id ?? 0 },
    { enabled: !!cleanerProfile?.id, refetchOnWindowFocus: false, refetchInterval: 60_000 }
  );

  // Resolve client profile for non-Teams conversations — MUST be after `selected` is defined
  const clientPhone = selected?.queue !== "Teams" ? (selected?.phone ?? "") : "";
  const { data: clientProfile } = trpc.leads.getClientProfile.useQuery(
    { phone: clientPhone },
    { enabled: !!clientPhone, refetchOnWindowFocus: false, refetchInterval: 120_000 }
  );

  // Mark conversation as viewed when selected changes
  useEffect(() => {
    if (effectiveSelectedId != null) {
      setLastViewedMap((prev) => ({ ...prev, [effectiveSelectedId]: Date.now() }));
    }
  }, [effectiveSelectedId]);

  // Auto-draft: when agent opens a conversation, pre-fill compose with an AI suggestion
  useEffect(() => {
    if (!selected) return;
    if (autoDraftedForId.current === selected.id) return; // already drafted for this conversation
    autoDraftedForId.current = selected.id;
    setCompose(""); // clear previous draft
    setAutoDraftLoading(true);
    csQuickReply.mutate({
      action: "ai_suggest",
      clientName: selected.name ?? undefined,
      messageHistory: JSON.stringify(
        selected.messages.map((m) => ({
          role: m.sender === "client" ? "user" : "assistant",
          content: m.text,
        }))
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selected?.messages?.length]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);
  const tone = selected ? queueTone(selected.queue) : { label: "Needs attention" as Queue, ...queueStyles["Needs attention"] };

  const priorityItems = [
    { name: "Jillian", reason: "waiting 12 min • job starts soon", queue: "Needs attention" },
    { name: "Monica", reason: "high-ticket lead • wants tomorrow", queue: "Hot leads" },
    { name: "Priya", reason: "great review moment • rebook chance", queue: "Post-job" },
  ];

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[radial-gradient(circle_at_top,#f8fafc,white_35%,#f8fafc_100%)] px-4 md:px-6 pt-4 md:pt-4 pb-4 md:pb-4 text-slate-900">
      <div className="mx-auto max-w-[1600px] w-full flex flex-col flex-1 min-h-0">
        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_340px] gap-5 flex-1 min-h-0 overflow-hidden" style={{gridAutoRows: '100%', alignItems: 'stretch'}}>
          {/* ── LEFT: Queue sidebar ── */}
          <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col h-full py-0 gap-0">
            <CardContent className="p-0 flex flex-col flex-1 min-h-0">
              <div className="p-4 md:p-5 space-y-5 flex-1 overflow-y-auto">
              {/* Tab switcher — Ops / Chat / CS */}
              {onSwitchTab && (
                <div className="flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
                  {([
                    { id: "today"    as const, label: "Ops",  icon: <CalendarDays className="w-3.5 h-3.5" /> },
                    { id: "channels" as const, label: "Chat", icon: <MessageSquare className="w-3.5 h-3.5" /> },
                    { id: "cs"       as const, label: "CS",   icon: <Headphones    className="w-3.5 h-3.5" /> },
                  ]).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => onSwitchTab(tab.id)}
                      className={cn(
                        "flex-1 relative flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                        tab.id === "cs" ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Inbox</div>
                  <div className="mt-2 text-3xl font-semibold">Today</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-center min-w-[74px]">
                  <div className="text-xl font-semibold">15</div>
                  <div className="text-xs text-slate-500 mt-1">online</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  variant={activeQueue === "All" ? "default" : "outline"}
                  className="w-full rounded-2xl justify-start h-10"
                  onClick={() => setActiveQueue("All")}
                >
                  All conversations
                </Button>
                {QUEUES.map((qLabel) => {
                  const q = queueTone(qLabel);
                  const liveCount = displayConversations.filter((c) => c.queue === qLabel).length;
                  return (
                  <button
                    key={qLabel}
                    onClick={() => setActiveQueue(qLabel)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${q.tone} ${
                      activeQueue === qLabel ? "ring-2 ring-slate-900/10" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-2.5 w-2.5 rounded-full ${q.dot}`} />
                        <div className="font-medium">{qLabel}</div>
                      </div>
                      <div className="text-sm font-semibold">{liveCount}</div>
                    </div>
                  </button>
                );
                })}
              </div>

              {/* Show resolved toggle + backfill names */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowResolved((v) => !v)}
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors px-1 py-1"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {showResolved ? "Hide resolved" : "Show resolved"}
                </button>
                <button
                  onClick={() => backfillCsNames.mutate()}
                  disabled={backfillCsNames.isPending}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors px-1 py-1 disabled:opacity-50"
                  title="Fix missing names from database"
                >
                  <RefreshCw className={`h-3 w-3 ${backfillCsNames.isPending ? 'animate-spin' : ''}`} />
                  Fix names
                </button>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bot className="h-4 w-4" /> AI priority queue
                </div>
                <div className="mt-3 space-y-2">
                  {priorityItems.map((item, idx) => (
                    <button
                      key={item.name}
                      onClick={() => {
                        const found = conversations.find((c) => c.name.startsWith(item.name));
                        if (found) {
                          setActiveQueue("All");
                          setSelectedId(found.id);
                        }
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">
                          {idx + 1}. {item.name}
                        </div>
                        <Badge variant="outline" className="rounded-full">
                          {item.queue}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{item.reason}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search conversations..."
                    className="pl-9 h-11 rounded-2xl border-slate-200"
                  />
                </div>
                <div className="mt-4 space-y-2.5">
                  {filtered.map((conversation) => {
                    const q = queueTone(conversation.queue as Queue);
                    const lastViewed = lastViewedMap[(conversation as any).id] ?? 0;
                    const isUnread = (conversation as any).lastInboundTs > lastViewed && selected.id !== (conversation as any).id;
                    return (
                      <button
                        key={conversation.id}
                        onClick={() => setSelectedId(conversation.id)}
                        className={`w-full rounded-[24px] border bg-white px-4 py-4 text-left shadow-sm transition hover:shadow-md ${
                          selected.id === conversation.id ? "border-slate-900" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0">
                            <Avatar className="h-11 w-11 border border-slate-200">
                              <AvatarFallback className="bg-slate-100 text-slate-700">
                                {conversation.initials}
                              </AvatarFallback>
                            </Avatar>
                            {isUnread && (
                              <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-teal-500 border-2 border-white" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className={`truncate ${isUnread ? "font-bold text-slate-900" : "font-semibold"}`}>{conversation.name}</div>
                                <div className="text-sm text-slate-500 truncate mt-0.5">{conversation.service}</div>
                              </div>
                              <div className="text-xs text-slate-400 whitespace-nowrap">{conversation.wait}</div>
                            </div>
                            <div className="mt-2 text-sm text-slate-600 line-clamp-2">{conversation.lastMessage}</div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge className={`rounded-full border ${q.tone} hover:bg-transparent`}>
                                  {conversation.queue}
                                </Badge>
                                {(() => {
                                  const t = deriveTone(conversation.messages);
                                  return (
                                    <Badge className={`rounded-full border text-[10px] px-1.5 py-0 ${t.className} hover:bg-transparent`}>
                                      {t.label}
                                    </Badge>
                                  );
                                })()}
                              </div>
                              <div className="text-xs text-slate-500 truncate">{conversation.status}</div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              </div>
            </CardContent>
          </Card>

          {/* ── CENTER: Thread ── */}
          <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden flex flex-col h-full py-0 gap-0">
            <CardContent className="p-0 flex flex-col flex-1 min-h-0">
              <div className="border-b border-slate-200 px-5 py-5 md:px-6 bg-white">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {editingName ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (selected.id > 0) updateCsName.mutate({ sessionId: selected.id, name: nameInput });
                          }}
                        >
                          <Input
                            autoFocus
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            className="h-9 text-lg font-semibold w-48"
                            placeholder="Enter name…"
                          />
                          <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" disabled={updateCsName.isPending}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-400" onClick={() => setEditingName(false)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 group">
                          <h2 className="text-3xl font-semibold tracking-tight">{selected.name}</h2>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                            onClick={() => { setNameInput((selected as any).rawName ?? ""); setEditingName(true); }}
                            title="Edit name"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Badge className={`rounded-full border cursor-pointer ${tone.tone} hover:opacity-80 transition-opacity`}>
                            {selected.queue}
                          </Badge>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44">
                          {QUEUES.map((q) => (
                            <DropdownMenuItem
                              key={q}
                              onClick={() => {
                                if (selected.id > 0) updateCsQueue.mutate({ sessionId: selected.id, queue: q });
                              }}
                              className={selected.queue === q ? "font-semibold" : ""}
                            >
                              <span className={`mr-2 h-2 w-2 rounded-full inline-block ${queueStyles[q].dot}`} />
                              {q}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                      <span>{selected.service}</span>
                      <span>•</span>
                      <span>{selected.location}</span>
                      <span>•</span>
                      <span>{selected.amount}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    {/* Resolve button — only for real CS sessions (not static demo) */}
                    {selected && selected.id > 0 && !conversations.find((c) => c.id === selected.id) && (
                      <Button
                        variant="outline"
                        className="rounded-2xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                        onClick={() => resolveSession.mutate({ sessionId: selected.id })}
                        disabled={resolveSession.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        {resolveSession.isPending ? "Resolving…" : "Resolve"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6 bg-[linear-gradient(180deg,#fcfcfd_0%,#f8fafc_100%)]" ref={scrollRef}>
                <div className="space-y-3">
                  {(selected?.messages ?? []).map((message, idx) => (
                    <motion.div
                      key={`${message.time}-${idx}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className={`max-w-[78%] rounded-[22px] border px-4 py-3 shadow-sm ${bubbleStyles(message.sender)}`}
                    >
                      <div className="text-xs uppercase tracking-wide opacity-60">{message.sender}</div>
                      {message.text && <div className="mt-1.5 text-sm leading-6">{message.text}</div>}
                      {message.media && message.media.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.media.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={url}
                                alt="MMS photo"
                                className="max-w-[200px] max-h-[200px] rounded-xl object-cover border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 text-xs opacity-60">{message.time}</div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-200 px-5 py-4 md:px-6 bg-white">
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.quickActions.map((action) => (
                    <Button key={action} variant="outline" className="rounded-full h-10">
                      {action}
                    </Button>
                  ))}
                </div>
                <div className={`rounded-[24px] border p-3 transition-colors ${autoDraftLoading ? "border-violet-200 bg-violet-50/40" : "border-slate-200 bg-slate-50"}`}>
                  {autoDraftLoading && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-violet-600">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      AI is drafting a reply...
                    </div>
                  )}
                  {!autoDraftLoading && compose && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-violet-500">
                      <Bot className="h-3 w-3" />
                      AI draft — review before sending
                    </div>
                  )}
                  <div className="relative flex items-start gap-3">
                    {/* Emoji picker popup */}
                    {showEmojiPicker && (
                      <div ref={emojiPickerRef} className="absolute bottom-full mb-2 left-0 z-50 shadow-xl rounded-2xl overflow-hidden">
                        <Picker
                          data={data}
                          onEmojiSelect={(emoji: { native: string }) => {
                            setCompose((prev) => prev + emoji.native);
                            setShowEmojiPicker(false);
                          }}
                          theme="light"
                          previewPosition="none"
                          skinTonePosition="none"
                        />
                      </div>
                    )}
                    <textarea
                      className="flex-1 rounded-2xl bg-white border border-slate-200 px-4 py-3 text-slate-900 min-h-[96px] resize-none focus:outline-none focus:ring-2 focus:ring-slate-300 text-sm"
                      placeholder={autoDraftLoading ? "" : "Type a message or use AI suggestion..."}
                      value={compose}
                      onChange={(e) => { setCompose(e.target.value); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && compose.trim() && selected) {
                                             sendMessage.mutate({ sessionId: selected.id, message: compose.trim(), fromNumberId: "PN0wVLcpCq" });
                        }
                      }}
                    />
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-xl h-7 w-7 border-slate-200 text-slate-500 hover:text-slate-800"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        title="Add emoji"
                        type="button"
                      >
                        <Smile className="h-4 w-4" />
                      </Button>
                      <Button
                        className="rounded-2xl h-14 px-6 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-base gap-2 shrink-0 disabled:opacity-40"
                        disabled={!compose.trim() || sendMessage.isPending || !selected}
                        onClick={() => {
                          if (!selected || !compose.trim()) return;
                          sendMessage.mutate({ sessionId: selected.id, message: compose.trim(), fromNumberId: "PN0wVLcpCq" });
                        }}
                      >
                        <Send className="h-4 w-4" />
                        {sendMessage.isPending ? "Sending..." : "Send"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    {/* AI Robot button — suggests best action */}
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full h-8 w-8 border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700 shrink-0"
                      disabled={loadingAction !== null || !selected}
                      onClick={() => fireQuickReply("ai_suggest")}
                      title="AI Suggest — picks the best reply for this conversation"
                    >
                      {loadingAction === "ai_suggest" ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </Button>
                    {/* Divider */}
                    <div className="h-5 w-px bg-slate-200" />
                    {([
                      { action: "send_quote",    label: "Send quote",         icon: <Tag className="h-3.5 w-3.5" /> },
                      { action: "make_it_right", label: "Make it right",      icon: <AlertTriangle className="h-3.5 w-3.5" /> },
                      { action: "refer_friend",  label: "Refer a friend",     icon: <Users className="h-3.5 w-3.5" /> },
                      { action: "running_late",  label: "Running late",       icon: <Clock3 className="h-3.5 w-3.5" /> },
                      { action: "on_the_way",    label: "On the way",         icon: <MapPin className="h-3.5 w-3.5" /> },
                      { action: "review_rebook", label: "Review + rebook",    icon: <Star className="h-3.5 w-3.5" /> },
                    ] as const).map(({ action, label, icon }) => (
                      <Button
                        key={action}
                        variant="outline"
                        className="rounded-full text-xs gap-1.5 h-8 px-3"
                        disabled={loadingAction !== null || !selected}
                        onClick={() => fireQuickReply(action)}
                      >
                        {loadingAction === action ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>{icon}</>
                        )}
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── RIGHT: Conditional panel — Teams vs Client ── */}
          <div className="overflow-y-auto space-y-5">
            {selected.queue === "Teams" ? (
              /* ── TEAMS PANEL ── */
              <>
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden">
                  <CardContent className="p-0">
                    {/* Header */}
                    <div className="p-5 bg-teal-50 border-b border-teal-200">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12 border-2 border-teal-200">
                          <AvatarFallback className="bg-teal-100 text-teal-700 font-semibold text-lg">
                            {selected.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold text-lg text-slate-900">{selected.name}</div>
                          <div className="text-sm text-teal-700 flex items-center gap-1 mt-0.5">
                            <Phone className="h-3.5 w-3.5" />
                            {selected.phone}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Today's jobs */}
                    <div className="p-5 bg-white space-y-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400 flex items-center gap-2">
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
                          return (
                            <div
                              key={job.id}
                              className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm space-y-3"
                            >
                              {/* Time + status row */}
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                  <Clock3 className="h-4 w-4 text-slate-400" />
                                  {time}
                                </div>
                                <Badge
                                  className={`rounded-full border text-xs font-medium hover:bg-transparent ${
                                    jobStatusStyle(job.jobStatus as JobStatus)
                                  }`}
                                >
                                  {jobStatusLabel(job.jobStatus as JobStatus)}
                                </Badge>
                              </div>

                              {/* Client name */}
                              <div className="flex items-start gap-2 text-sm text-slate-700">
                                <Building2 className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                                <span className="font-medium">{job.customerName || "—"}</span>
                              </div>

                              {/* Address */}
                              {job.jobAddress && (
                                <div className="flex items-start gap-2 text-sm text-slate-500">
                                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                                  <span className="leading-5">{job.jobAddress}</span>
                                </div>
                              )}

                              {/* Service type */}
                              {job.serviceType && (
                                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-1.5 text-xs text-slate-600">
                                  {job.serviceType}
                                </div>
                              )}

                              {/* Issue note */}
                              {job.jobStatus === "issue_at_property" && job.issueNote && (
                                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800 flex items-start gap-2">
                                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                  {job.issueNote}
                                </div>
                              )}

                              {/* Running late note */}
                              {job.jobStatus === "running_late" && job.delayMinutes && (
                                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                                  Running {job.delayMinutes} min late
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Thread status for Teams */}
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Thread status</div>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: "Teams", icon: AlertTriangle },
                        { label: selected.status, icon: CircleDot },
                        { label: `${selected.wait} since last message`, icon: Clock3 },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-2xl border border-slate-200 px-3 py-3 flex items-center justify-between gap-3"
                        >
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
              </>
            ) : (
              /* ── CLIENT PANEL (enriched with real data) ── */
              <>
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] overflow-hidden">
                  <CardContent className="p-0">
                    <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 text-amber-800 font-medium">
                        <TriangleAlert className="h-4 w-4" /> Flag as needs attention
                      </div>
                      <Badge className="rounded-full border border-amber-200 bg-white text-amber-700 hover:bg-white">
                        Urgent
                      </Badge>
                    </div>
                    <div className="p-5 space-y-5 bg-white">
                      {/* Name + phone + address */}
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Client profile</div>
                        <div className="mt-3 text-2xl font-semibold">
                          {clientProfile?.name ?? selected.name}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-4 w-4" />
                            {selected.phone}
                          </span>
                          {(clientProfile?.address ?? selected.location) && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {clientProfile?.address ?? selected.location}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Frequency</div>
                          <div className="mt-1 font-semibold text-sm">
                            {clientProfile?.frequency ?? selected.service ?? "—"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Avg price</div>
                          <div className="mt-1 font-semibold">
                            {clientProfile?.avgPrice ? `$${clientProfile.avgPrice}` : (selected.amount || "—")}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Total bookings</div>
                          <div className="mt-1 font-semibold">
                            {clientProfile ? clientProfile.totalBookings : selected.stats.bookings}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="text-xs text-slate-400">Last booking</div>
                          <div className="mt-1 font-semibold text-sm">
                            {clientProfile?.lastBookingDate ?? "—"}
                          </div>
                        </div>
                      </div>

                      {/* Today's job if any */}
                      {clientProfile?.todayJob && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">Today's job</div>
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-1.5">
                            <div className="font-semibold text-sm text-emerald-900">
                              {new Date(clientProfile.todayJob.serviceDateTime!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {clientProfile.todayJob.serviceType}
                            </div>
                            <div className="text-xs text-emerald-700 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />{clientProfile.todayJob.jobAddress}
                            </div>
                            {(clientProfile.todayJob as any).teamName && (
                              <div className="text-xs text-emerald-700 flex items-center gap-1">
                                <Users className="h-3 w-3" />{(clientProfile.todayJob as any).teamName}
                              </div>
                            )}
                            <Badge className="text-xs rounded-full bg-emerald-100 text-emerald-800 border-emerald-200">
                              {jobStatusLabel((clientProfile.todayJob.jobStatus ?? clientProfile.todayJob.bookingStatus ?? "assigned") as JobStatus)}
                            </Badge>
                          </div>
                        </div>
                      )}

                      {/* Recent job history */}
                      {clientProfile && clientProfile.recentJobs.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">Recent history</div>
                          <div className="space-y-2">
                            {clientProfile.recentJobs.map((job: { date: string | null; address: string | null; serviceType: string | null; status: string; price: number | null; bookingId: string | null }, i: number) => {
                              const l27Url = job.bookingId
                                ? `https://maidsinblack.launch27.com/admin/bookings/${job.bookingId}`
                                : null;
                              const CardEl = l27Url ? "a" : "div";
                              return (
                                <CardEl
                                  key={i}
                                  {...(l27Url ? { href: l27Url, target: "_blank", rel: "noopener noreferrer" } : {})}
                                  className={`rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center justify-between gap-2 ${l27Url ? "hover:border-slate-400 hover:bg-slate-100 cursor-pointer transition" : ""}`}
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800 truncate">
                                      {job.date} {job.serviceType ? `· ${job.serviceType}` : ""}
                                    </div>
                                    {job.address && (
                                      <div className="text-xs text-slate-500 truncate">{job.address}</div>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right flex flex-col items-end gap-1">
                                    {job.price != null && (
                                      <div className="text-sm font-semibold text-slate-700">${job.price}</div>
                                    )}
                                    <Badge className="text-xs rounded-full bg-slate-100 text-slate-600 border-slate-200">
                                      {job.status}
                                    </Badge>
                                    {l27Url && <ExternalLink className="w-3 h-3 text-slate-400" />}
                                  </div>
                                </CardEl>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Context flags */}
                      {!clientProfile && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Context flags</div>
                          <div className="mt-3 space-y-2">
                            {[
                              selected.stats.bookings === 0
                                ? "First-time customer"
                                : `${selected.stats.bookings} prior bookings`,
                              selected.stats.complaints > 0
                                ? `${selected.stats.complaints} prior complaint`
                                : "No complaint history",
                              selected.queue === "Hot leads"
                                ? "High-intent inquiry"
                                : selected.queue === "Post-job"
                                ? "Good review moment"
                                : "Needs active handling",
                            ].map((flag) => (
                              <div
                                key={flag}
                                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 flex items-center gap-2"
                              >
                                <Tag className="h-4 w-4 text-slate-400" />
                                {flag}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-[24px] border border-blue-200 bg-blue-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                          <Bot className="h-4 w-4" /> AI insight
                        </div>
                        <div className="mt-2 text-sm leading-6 text-blue-900">{selected.aiInsight}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Actions</div>
                    <div className="mt-4 flex flex-col gap-3">
                      <Button
                        variant="outline"
                        className="rounded-2xl justify-start h-12 w-full"
                        onClick={() => {
                          const phone = selected?.phone?.replace(/\D/g, "").slice(-10);
                          if (phone) window.open(`tel:+1${phone}`, "_self");
                        }}
                      >
                        <Phone className="h-4 w-4 mr-2" />
                        Call client
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-2xl justify-start h-12 w-full"
                        onClick={() => {
                          const link = `${window.location.origin}/book`;
                          navigator.clipboard.writeText(link).then(() => {
                            // brief visual feedback via title flash
                            const btn = document.activeElement as HTMLButtonElement;
                            if (btn) { const orig = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = orig; }, 1500); }
                          });
                        }}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Share magic link
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Thread status</div>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: selected.queue, icon: AlertTriangle },
                        { label: selected.status, icon: CircleDot },
                        { label: `${selected.wait} since last client message`, icon: Clock3 },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-2xl border border-slate-200 px-3 py-3 flex items-center justify-between gap-3"
                        >
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
