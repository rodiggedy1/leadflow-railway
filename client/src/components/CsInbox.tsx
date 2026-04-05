import { useState, useMemo, useRef, useEffect } from "react";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { TypingBubble } from "@/components/TypingBubble";
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
  ChevronLeft,
  CircleDot,
  Clock3,
  Headphones,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PenSquare,
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
  Link2,
  Copy,
  MessageSquarePlus,
  FileText,
  DollarSign,
  ClipboardList,
  TrendingUp,
  Brain,
  BookOpen,
  ShieldAlert,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { senderHex } from "@/lib/senderColor";
import { toast } from "sonner";
import FollowUpsModal from "@/components/FollowUpsModal";
import FAQPanel from "@/components/FAQPanel";
import ObjectionsPanel from "@/components/ObjectionsPanel";
import WorldClassReplyPanel from "@/components/WorldClassReplyPanel";

type Queue = "Priority" | "New" | "Active" | "Resolved" | "Teams";
type MsgSender = "client" | "agent" | "system" | "cleaner";

type Conversation = {
  id: number;
  name: string;
  initials: string;
  queue: Queue | null;
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
  messages: { sender: MsgSender; text: string; time: string; ts?: number; senderName?: string; media?: string[] }[];
  quickActions: string[];
};

const queueStyles: Record<Queue, { tone: string; dot: string }> = {
  "Priority": { tone: "bg-rose-50 text-rose-700 border-rose-200",   dot: "bg-rose-500" },
  "New":      { tone: "bg-blue-50 text-blue-700 border-blue-200",    dot: "bg-blue-500" },
  "Active":   { tone: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  "Resolved": { tone: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  "Teams":    { tone: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
};
const QUEUES: Queue[] = ["Priority", "New", "Active", "Resolved", "Teams"];

const conversations: Conversation[] = [
  {
    id: 1,
    name: "Jillian McMahon",
    initials: "JM",
    queue: "Priority",
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
    queue: "New",
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
    queue: "New",
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
    queue: "Resolved",
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
    queue: "Active",
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
  return { label: queue, ...( queueStyles[queue] ?? queueStyles["Priority"]) };
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

type InboxFilter = "Priority" | "New" | "Active" | "Resolved" | "Teams";
type CsInboxProps = { onSwitchTab?: (tab: "today" | "channels" | "cs") => void };
export default function CsInbox({ onSwitchTab }: CsInboxProps) {
  const [activeFilter, setActiveFilter] = useState<InboxFilter>("New");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compose, setCompose] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  // Follow-up modal state (CS chat — add only, no queue)
  const [addFollowUpOpen, setAddFollowUpOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [objectionsOpen, setObjectionsOpen] = useState(false);
  const [worldClassOpen, setWorldClassOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Unread tracking: sessionId -> timestamp when agent last viewed it
  const [lastViewedMap, setLastViewedMap] = useState<Record<number, number>>({});

  const utils = trpc.useUtils();
  // Track whether the user has manually picked a tab so we don't override their choice
  const userPickedFilter = useRef(false);

  useOpsStream({
    onLeadUpdate: () => {
      utils.leads.listCsInbox.invalidate();
      // Auto-switch to New tab when an inbound message arrives — but only if the
      // user hasn't manually chosen a different tab in this session.
      if (!userPickedFilter.current) {
        setActiveFilter("New");
      }
    },
  });

  const { data: csData, refetch: refetchInbox } = trpc.leads.listCsInbox.useQuery({ showResolved }, {
    refetchOnWindowFocus: false,
    // Polling fallback: catches any messages missed during SSE reconnect windows
    refetchInterval: 30_000,
  });

  // Agent photo map for avatars in message bubbles
  const { data: agentPhotoData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const agentPhotoMap: Record<string, string | null> = useMemo(
    () => agentPhotoData?.photos ?? {},
    [agentPhotoData?.photos]
  );

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
    if (!csData) return []; // loading — show nothing until real data arrives
    if (csData.length === 0) return []; // no real sessions — show empty state
    return csData.map((row) => {
      let msgs: { role: string; content: string; ts?: number; senderName?: string; media?: string[] }[] = [];
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
      // hasUnanswered: server computed, or derive locally as fallback
      const hasUnanswered = (row as any).hasUnanswered ?? (msgs.length > 0 && msgs[msgs.length - 1].role === "user");
      return {
        id: row.id,
        name,
        initials,
        queue: ((row as any).csQueue ?? (row.leadSource === "cs-inbound-cleaner" ? "Teams" : null)) as Queue | null,
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
        hasUnanswered,
        messages: msgs.map((m) => ({
          sender: m.role === "user" ? "client" : m.role === "assistant" ? "agent" : "system" as MsgSender,
          text: m.content,
          time: m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
          ts: m.ts as number | undefined,
          media: (m.media ?? []) as string[],
          senderName: m.senderName,
        })),
        quickActions: [],
        rawName: row.leadName ?? "",
      };
    });
  }, [csData, nameMap]);

  const displayConversations = liveConversations;

  const sendMessage = trpc.leads.sendMessage.useMutation({
    onSuccess: () => {
      setCompose("");
      utils.leads.listCsInbox.invalidate();
    },
  });

  // ── AI priority queue (must be before filtered useMemo) ─────────────────────
  const { data: priorityItems = [], isLoading: priorityLoading } = trpc.leads.getCsPriorityQueue.useQuery(
    undefined,
    { staleTime: 2 * 60 * 1000, refetchInterval: 3 * 60 * 1000 }
  );
  const dismissPriority = trpc.leads.dismissCsPriority.useMutation({
    onSuccess: () => utils.leads.getCsPriorityQueue.invalidate(),
  });

  const filteredRef = useRef<typeof filtered>([]);
  const effectiveSelectedIdRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    return displayConversations.filter((c) => {
      const q = query.trim().toLowerCase();
      const hay = [c.name, c.location, c.lastMessage, c.service, c.status, c.queue, c.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      let matchesFilter = true;
      if (activeFilter === "Priority") {
        matchesFilter = priorityItems.some((p) => p.id === c.id);
      } else if (activeFilter === "New") {
        matchesFilter = !!(c as any).hasUnanswered;
      } else if (activeFilter === "Active") {
        matchesFilter = !(c as any).hasUnanswered && c.queue !== "Teams";
      } else if (activeFilter === "Resolved") {
        matchesFilter = !!(c as any).csResolvedAt;
      } else if (activeFilter === "Teams") {
        matchesFilter = c.queue === "Teams";
      }
      return matchesFilter && (!q || hay.includes(q));
    });
  }, [activeFilter, query, displayConversations, priorityItems]);

  const effectiveSelectedId = selectedId ?? (filtered[0]?.id ?? null);
  const selected = filtered.find((c) => c.id === effectiveSelectedId) || filtered[0] || displayConversations[0];

  // Typing presence — broadcast when this agent is composing, show others typing
  const csChannelKey = effectiveSelectedId ? `cs:${effectiveSelectedId}` : "";
  const { typers, onKeyPress: onTypingKeyPress, onBlur: onTypingBlur } = useTypingIndicator(csChannelKey);

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
      toast.success("Resolved", { description: "Conversation marked as resolved.", duration: 3000 });
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
  // Tracks the last conversation the user explicitly navigated to.
  // Only updated on user click — never by background data refreshes.
  const userNavigatedToId = useRef<number | null>(null);
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
  const syncOutbound = trpc.opsChat.syncCsOutboundMessages.useMutation({
    onSuccess: () => {
      utils.leads.listCsInbox.invalidate();
    },
  });

  // Job drawer state — which job card is open in the side sheet
  type JobItem = NonNullable<typeof cleanerTodayJobs>[number];
  const [selectedJobDrawer, setSelectedJobDrawer] = useState<JobItem | null>(null);

  // Lightbox for photo enlargement (multi-photo swipe)
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null);
  const lightboxUrl = lightbox ? lightbox.urls[lightbox.idx] : null;
  const openLightbox = (urls: string[], idx: number) => setLightbox({ urls, idx });
  const closeLightbox = () => setLightbox(null);
  const lightboxPrev = () => setLightbox(lb => lb && lb.idx > 0 ? { ...lb, idx: lb.idx - 1 } : lb);
  const lightboxNext = () => setLightbox(lb => lb && lb.idx < lb.urls.length - 1 ? { ...lb, idx: lb.idx + 1 } : lb);
  // Keyboard nav for lightbox
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lightboxPrev();
      if (e.key === "ArrowRight") lightboxNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Auto-sync OpenPhone outbound messages when a conversation is selected
  useEffect(() => {
    if (!selectedId || !selected || selected.id <= 0 || !selected.phone) return;
    // Fire-and-forget: silently pull in any outbound messages from the OpenPhone app
    syncOutbound.mutate({ sessionId: selected.id, leadPhone: selected.phone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Magic link for Teams conversations
  const [magicLinkAction, setMagicLinkAction] = useState<"send" | "copy" | null>(null);

  // New conversation from scratch
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvMsg, setNewConvMsg] = useState("");

  // Detect if the typed phone already has an open session in the inbox
  const existingConvForPhone = useMemo(() => {
    if (!newConvPhone.trim()) return null;
    const typed10 = newConvPhone.replace(/[^\d]/g, "").slice(-10);
    if (typed10.length < 10) return null;
    return liveConversations.find((c) => c.phone.replace(/[^\d]/g, "").slice(-10) === typed10) ?? null;
  }, [newConvPhone, liveConversations]);
  const startConv = trpc.opsChat.startCsConversation.useMutation({
    onSuccess: async (data) => {
      setNewConvOpen(false);
      setNewConvPhone("");
      setNewConvMsg("");
      // Refetch the inbox list first so the new session is in the list before we select it
      await refetchInbox();
      setSelectedId(data.sessionId);
      // Scroll to bottom after messages load (slight delay for render)
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 400);
      toast.success(data.isNew ? "Conversation started" : "Existing conversation opened");
    },
    onError: (err) => toast.error(err.message),
  });
  const getMagicLink = trpc.cleaner.getMagicLink.useMutation({
    onSuccess: async ({ url, cleanerName }) => {
      if (magicLinkAction === "copy") {
        navigator.clipboard.writeText(url).then(() => {
          toast.success(`Magic link for ${cleanerName} copied!`);
        }).catch(() => {
          toast.info(`Magic link: ${url}`, { duration: 10000 });
        });
      } else if (magicLinkAction === "send" && selected && selected.id > 0) {
        const msg = `Here's your one-tap login link to the portal:\n${url}`;
        sendMessage.mutate({ sessionId: selected.id, message: msg, fromNumberId: "PN0wVLcpCq" });
        toast.success(`Magic link sent to ${cleanerName}!`);
      }
      setMagicLinkAction(null);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to generate magic link");
      setMagicLinkAction(null);
    },
  });

  const handleMagicLink = (action: "send" | "copy") => {
    if (!cleanerProfile?.id) {
      toast.error("No cleaner profile linked to this conversation.");
      return;
    }
    setMagicLinkAction(action);
    getMagicLink.mutate({ cleanerProfileId: cleanerProfile.id, origin: "https://quote.maidinblack.com" });
  };

  function fireQuickReply(action: "send_quote" | "make_it_right" | "refer_friend" | "running_late" | "on_the_way" | "review_rebook" | "ai_suggest") {
    if (!selected) return;
    setLoadingAction(action);
    csQuickReply.mutate({
      action,
      clientName: selected.name ?? undefined,
      queue: selected.queue ?? undefined,
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

  // Build a brief client profile summary for the AI insight prompt
  const clientProfileSummary = useMemo(() => {
    if (!clientProfile) return undefined;
    const parts: string[] = [];
    if (clientProfile.name) parts.push(`Name: ${clientProfile.name}`);
    if (clientProfile.totalBookings) parts.push(`Total bookings: ${clientProfile.totalBookings}`);
    if (clientProfile.avgPrice) parts.push(`Avg price: $${clientProfile.avgPrice}`);
    if (clientProfile.frequency) parts.push(`Frequency: ${clientProfile.frequency}`);
    if (clientProfile.todayJob) parts.push(`Has a job TODAY at ${clientProfile.todayJob.jobAddress ?? ""} (${clientProfile.todayJob.serviceType ?? ""}), status: ${clientProfile.todayJob.jobStatus ?? ""}`);
    if (clientProfile.recentJobs?.length) {
      const last = clientProfile.recentJobs[0];
      parts.push(`Last job: ${last.date ?? ""} — ${last.serviceType ?? ""} — ${last.status}`);
    }
    return parts.join("; ");
  }, [clientProfile]);

  // AI insight query — fires when a conversation is selected and has messages
  const insightMsgHistory = useMemo(() => {
    if (!selected?.messages?.length) return "[]";
    return JSON.stringify(
      selected.messages.map((m) => ({
        role: m.sender === "client" ? "user" : "assistant",
        content: m.text,
      }))
    );
  }, [selected?.id, selected?.messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: insightData, isFetching: insightLoading } = trpc.leads.getCsConvInsight.useQuery(
    {
      sessionId: selected?.id ?? 0,
      messageHistory: insightMsgHistory,
      clientName: selected?.name ?? undefined,
      queue: selected?.queue ?? undefined,
      clientProfile: clientProfileSummary,
    },
    {
      enabled: !!(selected && selected.id > 0 && selected.messages.length > 0),
      refetchOnWindowFocus: false,
      // Re-fetch when the conversation changes or a new message arrives
      staleTime: 60_000, // treat as fresh for 60s to avoid hammering LLM on every render
    }
  );

  // Upsell opportunity detector — only fires for non-Teams, non-Deep-clean conversations
  const isTeamsConv = selected?.queue === "Teams";
  const [upsellResult, setUpsellResult] = useState<{ upsell: { signal: string; pitch: string; upsellType: string } | null } | null>(null);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellFetchedForId, setUpsellFetchedForId] = useState<number | null>(null);
  const upsellMutation = trpc.leads.getUpsellOpportunity.useMutation({
    onSuccess: (data) => {
      setUpsellResult(data);
      setUpsellLoading(false);
    },
    onError: () => setUpsellLoading(false),
  });
  // Trigger upsell check when conversation changes (if eligible)
  useEffect(() => {
    if (!selected || selected.id <= 0 || selected.messages.length < 3 || isTeamsConv) return;
    if (upsellFetchedForId === selected.id) return; // already fetched for this conversation
    const service = (selected.service ?? "").toLowerCase();
    if (service.includes("deep clean")) return;
    setUpsellFetchedForId(selected.id);
    setUpsellResult(null);
    setUpsellLoading(true);
    upsellMutation.mutate({
      sessionId: selected.id,
      messageHistory: insightMsgHistory,
      clientName: selected.name ?? undefined,
      clientProfile: clientProfileSummary ?? undefined,
      serviceType: selected.service ?? undefined,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, insightMsgHistory]);
  const [upsellDismissed, setUpsellDismissed] = useState<number | null>(null);
  const showUpsell = !!(upsellResult?.upsell && upsellDismissed !== selected?.id);
  // Show card while loading (first fetch) or when result is available
  const showUpsellCard = showUpsell || upsellLoading;
  // Alias upsellData for the render section below
  const upsellData = upsellResult;

  // ── Customer Memory Card — deterministic, no extra API call ──────────────
  // Derived from clientProfile (booking history) + selected (complaint count, queue)
  const customerMemory = useMemo(() => {
    if (!selected) return null;

    // Bullet 1: Last booking
    let lastBooking: string;
    if (clientProfile?.recentJobs?.length) {
      const last = clientProfile.recentJobs[0];
      const parts: string[] = [];
      if (last.date) parts.push(last.date);
      if (last.serviceType) parts.push(last.serviceType);
      if (last.price) parts.push(`$${last.price}`);
      lastBooking = parts.length ? parts.join(' · ') : 'No recent jobs found';
    } else if (clientProfile?.lastBookingDate) {
      lastBooking = clientProfile.lastBookingDate;
    } else if (selected.stats.bookings === 0) {
      lastBooking = 'First-time customer — no prior bookings';
    } else {
      lastBooking = `${selected.stats.bookings} prior booking${selected.stats.bookings !== 1 ? 's' : ''} (dates unavailable)`;
    }

    // Bullet 2: Complaint / issue history
    let complaintHistory: string;
    const complaintCount = selected.stats.complaints;
    if (complaintCount === 0) {
      complaintHistory = 'No complaint history — clean record';
    } else if (complaintCount === 1) {
      complaintHistory = '1 prior complaint on record';
    } else {
      complaintHistory = `${complaintCount} prior complaints — handle with care`;
    }

    // Bullet 3: What they care about (inferred from booking patterns)
    let careAbout: string;
    const freq = clientProfile?.frequency?.toLowerCase() ?? '';
    const totalBookings = clientProfile?.totalBookings ?? selected.stats.bookings;
    const avgPrice = clientProfile?.avgPrice;
    if (freq.includes('weekly')) {
      careAbout = 'Recurring weekly client — values consistency and reliability';
    } else if (freq.includes('biweekly') || freq.includes('bi-weekly') || freq.includes('every 2')) {
      careAbout = 'Biweekly recurring — values routine and a trusted team';
    } else if (freq.includes('monthly')) {
      careAbout = 'Monthly recurring — values a thorough deep clean each visit';
    } else if (totalBookings >= 10) {
      careAbout = `Loyal customer (${totalBookings} bookings) — values trust and familiarity`;
    } else if (totalBookings >= 3) {
      careAbout = `Repeat customer (${totalBookings} bookings) — building a relationship`;
    } else if (selected.queue === 'New') {
      careAbout = 'High-intent new inquiry — values quick, clear responses';
    } else if (avgPrice && avgPrice >= 200) {
      careAbout = `Premium spender (avg $${avgPrice}/visit) — values quality over price`;
    } else {
      careAbout = 'New or infrequent customer — make a great first impression';
    }

    return { lastBooking, complaintHistory, careAbout };
  }, [selected, clientProfile]);

  // ── Post-call AI Debrief — fetched from DB after call.transcript.completed webhook ──
  const { data: callDebrief, isLoading: debriefLoading } = trpc.leads.getLatestCallDebrief.useQuery(
    { sessionId: selected?.id ?? 0 },
    {
      enabled: !!selected?.id,
      staleTime: 60_000,
      refetchInterval: 90_000, // poll every 90s so it appears shortly after the 60s debrief job runs
    }
  );
  const [debriefDismissed, setDebriefDismissed] = useState<Record<number, boolean>>({});
  const showDebrief = !!callDebrief && selected?.id != null && !debriefDismissed[selected.id];

  // ── Call recordings — fetched for the selected session and merged inline ──
  const { data: callRecordings = [] } = trpc.leads.getCallRecordings.useQuery(
    { sessionId: selected?.id ?? 0 },
    { enabled: !!selected?.id, staleTime: 60_000, refetchInterval: 120_000 }
  );

  // Mark conversation as viewed when selected changes
  useEffect(() => {
    if (effectiveSelectedId != null) {
      setLastViewedMap((prev) => ({ ...prev, [effectiveSelectedId]: Date.now() }));
    }
  }, [effectiveSelectedId]);

  // Auto-draft: only fires when the user explicitly clicks a conversation.
  // Background data refreshes (new inbound messages, re-sorts) never trigger this.
  function triggerAutoDraft(conv: typeof selected) {
    if (!conv) return;
    if (autoDraftedForId.current === conv.id) return; // already drafted for this conversation
    autoDraftedForId.current = conv.id;
    setCompose(""); // clear previous draft
    setAutoDraftLoading(true);
    csQuickReply.mutate({
      action: "ai_suggest",
      clientName: conv.name ?? undefined,
      queue: conv.queue ?? undefined,
      messageHistory: JSON.stringify(
        conv.messages.map((m) => ({
          role: m.sender === "client" ? "user" : "assistant",
          content: m.text,
        }))
      ),
    });
  }

  // Auto-scroll to bottom when conversation changes or new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [effectiveSelectedId, selected?.messages?.length]);

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
  const tone = selected?.queue ? queueTone(selected.queue) : { label: null, tone: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400" };

  // ── AI priority queue (moved earlier — see declaration above filtered useMemo) ─

  function priorityTagStyle(tag: string) {
    switch (tag) {
      case "angry":   return { bg: "bg-red-50",    border: "border-red-300",    dot: "bg-red-500",    badge: "bg-red-100 text-red-700",    label: "Angry" };
      case "cancel":  return { bg: "bg-orange-50", border: "border-orange-300", dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700", label: "Cancel risk" };
      case "booking": return { bg: "bg-emerald-50",border: "border-emerald-300",dot: "bg-emerald-500",badge: "bg-emerald-100 text-emerald-700",label: "Booking" };
      default:        return { bg: "bg-amber-50",  border: "border-amber-300",  dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-700",  label: "Urgent" };
    }
  }

  function timeSince(ms: number) {
    const diff = Date.now() - ms;
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return `${Math.floor(diff / 3600_000)}h ago`;
  }

  return (
    <>
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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Inbox</div>
                  <div className="mt-1.5 text-3xl font-semibold">Today</div>
                </div>
              </div>

              <div className="space-y-1">
                {([
                  { id: "Priority" as InboxFilter, dot: "bg-rose-500", icon: <ShieldAlert className="h-4 w-4" />, label: "Priority", count: priorityItems.length },
                  { id: "New" as InboxFilter, dot: "bg-blue-500", icon: <Mail className="h-4 w-4" />, label: "New", count: displayConversations.filter((c) => !!(c as any).hasUnanswered).length },
                  { id: "Active" as InboxFilter, dot: "bg-amber-400", icon: <Clock3 className="h-4 w-4" />, label: "Active", count: displayConversations.filter((c) => !(c as any).hasUnanswered && c.queue !== "Teams").length },
                  { id: "Resolved" as InboxFilter, dot: "bg-emerald-500", icon: <CheckCircle2 className="h-4 w-4" />, label: "Resolved", count: displayConversations.filter((c) => !!(c as any).csResolvedAt).length },
                  { id: "Teams" as InboxFilter, dot: "bg-violet-500", icon: <Users className="h-4 w-4" />, label: "Teams", count: displayConversations.filter((c) => c.queue === "Teams").length },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      userPickedFilter.current = true;
                      setActiveFilter(tab.id);
                      if (tab.id === "Resolved") setShowResolved(true);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                      activeFilter === tab.id
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${tab.dot}`} />
                    <span className="shrink-0 opacity-70">{tab.icon}</span>
                    <span className="flex-1 text-sm font-medium">{tab.label}</span>
                    {tab.count > 0 && (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                        activeFilter === tab.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                      }`}>{tab.count}</span>
                    )}
                  </button>
                ))}
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="h-4 w-4" /> AI priority queue
                  </div>
                  {priorityLoading && <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />}
                </div>
                <div className="mt-3 space-y-2">
                  {priorityItems.length === 0 && !priorityLoading && (
                    <div className="text-xs text-slate-400 text-center py-2">No urgent items right now</div>
                  )}
                  {priorityItems.map((item, idx) => {
                    const style = priorityTagStyle(item.tag);
                    return (
                      <div
                        key={item.id}
                        className={`w-full rounded-2xl border ${style.border} ${style.bg} px-3 py-3 text-left shadow-sm`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            className="flex-1 text-left"
                            onClick={() => {
                              const found = displayConversations.find((c) => c.id === item.id);
                              if (found) {
                                setActiveFilter("Priority");
                                setSelectedId(found.id);
                                userNavigatedToId.current = found.id;
                                triggerAutoDraft(found);
                              } else {
                                // Session exists in DB but not yet in filtered list — force select by id
                                setActiveFilter("Priority");
                                setSelectedId(item.id);
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              {/* Pulse dot */}
                              <span className="relative flex h-2.5 w-2.5 shrink-0">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.dot} opacity-60`} />
                                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${style.dot}`} />
                              </span>
                              <span className="text-sm font-semibold">{idx + 1}. {item.name}</span>
                              <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>{style.label}</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-600 pl-4">{item.reason}</div>
                            <div className="mt-1 text-[10px] text-slate-400 pl-4">{timeSince(item.taggedAt)}</div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); dismissPriority.mutate({ sessionId: item.id }); }}
                            className="shrink-0 mt-0.5 text-slate-300 hover:text-slate-500 transition-colors"
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
                    const q = conversation.queue ? queueTone(conversation.queue) : { tone: "bg-slate-100 text-slate-500 border-slate-200", label: null };
                    const lastViewed = lastViewedMap[(conversation as any).id] ?? 0;
                    const isUnread = (conversation as any).lastInboundTs > lastViewed && selected.id !== (conversation as any).id;
                    return (
                      <div
                        key={conversation.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedId(conversation.id);
                          userNavigatedToId.current = conversation.id;
                          triggerAutoDraft(conversation);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setSelectedId(conversation.id); userNavigatedToId.current = conversation.id; triggerAutoDraft(conversation); } }}
                        className={`w-full rounded-[20px] border px-3.5 py-3.5 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-[1px] group cursor-pointer ${
                          selected.id === conversation.id
                            ? "border-slate-900 bg-white shadow-md ring-1 ring-slate-900/5"
                            : (conversation as any).hasUnanswered
                              ? "border-orange-300 bg-orange-50 shadow-sm shadow-orange-100"
                              : isUnread
                                ? "border-slate-300 bg-white shadow-sm"
                                : "border-slate-200 bg-white shadow-sm"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0">
                            <Avatar className={`h-10 w-10 border ${isUnread ? 'border-teal-300' : 'border-slate-200'}`}>
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
                                <div className={`truncate text-sm ${isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{conversation.name}</div>
                                <div className="text-xs text-slate-400 truncate mt-0.5">{conversation.service}</div>
                              </div>
                              <div className={`text-[11px] whitespace-nowrap ${isUnread ? 'text-teal-600 font-semibold' : 'text-slate-400'}`}>{conversation.wait}</div>
                            </div>
                            <div className={`mt-1.5 text-xs line-clamp-1 ${isUnread ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>{conversation.lastMessage}</div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {conversation.queue && (
                                  <Badge className={`rounded-full border ${q.tone} hover:bg-transparent`}>
                                    {conversation.queue}
                                  </Badge>
                                )}
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
                        {/* Inline resolve button — visible on hover for New/Active tabs */}
                        {(activeFilter === "New" || activeFilter === "Active") && (
                          <div
                            className="mt-2.5 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolveSession.mutate({ sessionId: conversation.id });
                              }}
                              disabled={resolveSession.isPending}
                              className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Resolve
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              </div>
            </CardContent>
          </Card>

          {/* ── CENTER: Thread ── */}
          {!selected ? (
            <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] flex flex-col h-full py-0 gap-0">
              <CardContent className="p-0 flex flex-col flex-1 min-h-0 items-center justify-center">
                <div className="text-center text-slate-400 px-8">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Select a conversation</p>
                  <p className="text-xs mt-1">No conversations in this queue yet</p>
                </div>
              </CardContent>
            </Card>
          ) : (
          <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)] flex flex-col h-full py-0 gap-0">
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
                          <h2 className="text-2xl font-bold tracking-tight text-slate-900">{selected.name}</h2>
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
                            {selected.queue || "Set status"}
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
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-400">
                      {selected.phone && <span className="font-mono tracking-wide">{selected.phone}</span>}
                      {selected.service && <><span className="text-slate-300">·</span><span>{selected.service}</span></>}
                      {selected.amount && <><span className="text-slate-300">·</span><span>{selected.amount}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Call via OpenPhone */}
                    {selected?.phone && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            href={`openphone://call?to=${encodeURIComponent(selected.phone)}`}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Call via OpenPhone</TooltipContent>
                      </Tooltip>
                    )}
                    {/* Sync from OpenPhone */}
                    {selected && selected.id > 0 && selected.phone && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => syncOutbound.mutate({ sessionId: selected.id, leadPhone: selected.phone })}
                            disabled={syncOutbound.isPending}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-40"
                          >
                            <RefreshCw className={`h-4 w-4 ${syncOutbound.isPending ? 'animate-spin' : ''}`} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{syncOutbound.isPending ? 'Syncing…' : 'Sync OpenPhone messages'}</TooltipContent>
                      </Tooltip>
                    )}
                    {/* New SMS */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setNewConvOpen(true)}
                          className="inline-flex items-center justify-center h-9 w-9 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                        >
                          <PenSquare className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">New SMS conversation</TooltipContent>
                    </Tooltip>
                    {/* Resolve */}
                    {selected && selected.id > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => resolveSession.mutate({ sessionId: selected.id })}
                            disabled={resolveSession.isPending}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{resolveSession.isPending ? 'Resolving…' : 'Resolve conversation'}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6 bg-[linear-gradient(180deg,#fcfcfd_0%,#f8fafc_100%)]" ref={scrollRef}>
                <motion.div
                  key={selected?.id ?? 0}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-3"
                >
                  {/* Merge SMS messages and call recordings into a single chronological timeline */}
                  {(() => {
                    type SmsItem = { kind: "sms"; ts: number; message: (typeof selected)["messages"][0]; idx: number };
                    type CallItem = { kind: "call"; ts: number; rec: (typeof callRecordings)[0] };
                    type TimelineItem = SmsItem | CallItem;

                    // Build SMS items with real ts from messageHistory (already passed through)
                    const smsMsgs = selected?.messages ?? [];
                    const smsItems: SmsItem[] = smsMsgs.map((message, idx) => ({
                      kind: "sms" as const,
                      ts: message.ts ?? idx, // real epoch ms if available, else index
                      message,
                      idx,
                    }));

                    // Build call items with real epoch ms from callStartedAt
                    const callItems: CallItem[] = (callRecordings ?? []).map((rec) => ({
                      kind: "call" as const,
                      ts: rec.callStartedAt instanceof Date ? rec.callStartedAt.getTime() : new Date(rec.callStartedAt as string).getTime(),
                      rec,
                    }));

                    // Merge sort both lists by ts
                    const allItems: TimelineItem[] = [...smsItems, ...callItems].sort((a, b) => a.ts - b.ts);

                    // Track last date for date separators
                    let lastDateStr = "";

                    return allItems.flatMap((item, i) => {
                      const itemDate = new Date(item.ts);
                      const dateStr = itemDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
                      const today = new Date();
                      const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                      const isToday = itemDate.toDateString() === today.toDateString();
                      const isYesterday = itemDate.toDateString() === yesterday.toDateString();
                      const displayDate = isToday ? "Today" : isYesterday ? "Yesterday" : dateStr;
                      const showSeparator = item.ts > 100 && dateStr !== lastDateStr;
                      if (showSeparator) lastDateStr = dateStr;
                      const separator = showSeparator ? (
                        <div key={`sep-${dateStr}`} className="flex items-center gap-3 my-2">
                          <div className="flex-1 h-px bg-slate-200" />
                          <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">{displayDate}</span>
                          <div className="flex-1 h-px bg-slate-200" />
                        </div>
                      ) : null;
                      const elements: React.ReactNode[] = separator ? [separator] : [];

                      if (item.kind === "call") {
                        const rec = item.rec;
                        const durationStr = rec.durationSeconds
                          ? rec.durationSeconds >= 60
                            ? `${Math.floor(rec.durationSeconds / 60)}m ${rec.durationSeconds % 60}s`
                            : `${rec.durationSeconds}s`
                          : "";
                        const callTime = rec.callStartedAt instanceof Date
                          ? rec.callStartedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : new Date(rec.callStartedAt as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                        let debriefParsed: { grade?: string; wentWell?: string; improve?: string; nextLine?: string; summary?: string } | null = null;
                        try { if (rec.callDebrief) debriefParsed = JSON.parse(rec.callDebrief as string); } catch { /* ignore */ }
                        const summary = debriefParsed?.summary || debriefParsed?.wentWell || null;
                        const grade = debriefParsed?.grade?.toUpperCase() ?? null;
                        const gradeColor: Record<string, string> = { A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-orange-500", F: "bg-red-500" };
                        const gradeBg = grade ? (gradeColor[grade] ?? "bg-slate-500") : null;
                        const hasRecording = !!(rec.recordingUrl && !(rec.recordingUrl as string).includes("synthetic-backfill"));

                        // Parse transcript for expandable viewer
                        type TranscriptTurn = { identifier: string; content: string; start?: number };
                        let transcriptTurns: TranscriptTurn[] = [];
                        try { if (rec.transcript) transcriptTurns = JSON.parse(rec.transcript as string); } catch { /* ignore */ }

                        elements.push(
                          <motion.div
                            key={`call-${rec.id}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.02, 0.3) }}
                            className="flex justify-start"
                          >
                            <div className="max-w-[82%] rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                              {/* Header */}
                              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border-b border-slate-700">
                                <Phone className="h-3 w-3 text-slate-300" />
                                <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-widest">Call {rec.direction === "incoming" ? "Inbound" : "Outbound"}</span>
                                {durationStr && <span className="text-[10px] text-slate-400">&middot; {durationStr}</span>}
                                {grade && (
                                  <span className={`ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${gradeBg}`}>
                                    {grade}
                                  </span>
                                )}
                                <span className="ml-auto text-[10px] text-slate-500">{callTime}</span>
                              </div>
                              {/* Headline */}
                              <div className="px-3 pt-2.5 pb-1.5 bg-slate-50 border-b border-slate-100">
                                <p className="text-sm font-medium text-slate-700">
                                  {rec.direction === "incoming" ? "Inbound" : "Outbound"} call &middot; {rec.callerPhone}
                                  {rec.status === "no-answer" && <span className="ml-2 text-xs text-red-500">No answer</span>}
                                </p>
                              </div>
                              {/* Summary + recording + transcript */}
                              <div className="px-3 py-2.5 bg-white">
                                {summary && (
                                  <p className="text-sm text-slate-600 leading-relaxed mb-2.5">{summary}</p>
                                )}
                                {hasRecording ? (
                                  <div className="mb-2">
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">🎙️ Recording</p>
                                    <audio
                                      controls
                                      src={rec.recordingUrl as string}
                                      className="w-full h-8 rounded-lg"
                                    />
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 mb-2">
                                    <Phone className="h-2.5 w-2.5" /> No recording
                                  </span>
                                )}
                                {transcriptTurns.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] font-semibold text-violet-600 uppercase tracking-widest select-none hover:text-violet-800">
                                      Transcript ({transcriptTurns.length} turns)
                                    </summary>
                                    <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                      {transcriptTurns.map((turn, ti) => (
                                        <div key={ti} className="text-xs">
                                          <span className={`font-semibold mr-1 ${turn.identifier?.toLowerCase().includes("agent") || turn.identifier?.toLowerCase().includes("assistant") ? "text-violet-600" : "text-slate-500"}`}>
                                            {turn.identifier}:
                                          </span>
                                          <span className="text-slate-600">{turn.content}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                                {!summary && !hasRecording && transcriptTurns.length === 0 && (
                                  <p className="text-xs text-slate-400 italic">No summary available yet</p>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                        return elements;
                      }

                      // SMS bubble
                      const { message, idx } = item;
                      elements.push(
                        <motion.div
                          key={`${message.time}-${idx}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.02, 0.3) }}
                          className={`max-w-[78%] rounded-[22px] border px-4 py-3 shadow-sm ${bubbleStyles(message.sender)}`}
                        >
                          {(() => {
                            const displayName = message.senderName && message.senderName !== "OpenPhone"
                              ? message.senderName
                              : message.sender === "agent" ? "Agent" : message.sender === "client" ? "Customer" : (message.sender as string);
                            const isAgent = message.sender === "agent";
                            const photoUrl = isAgent && displayName !== "Agent" ? (agentPhotoMap[displayName] ?? null) : null;
                            const initials = displayName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
                            const color = senderHex(displayName);
                            return (
                              <div className="flex items-center gap-1.5 mb-1">
                                {isAgent && (
                                  <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 shadow-sm">
                                    {photoUrl ? (
                                      <img src={photoUrl} alt={displayName} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: color }}>
                                        {initials}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <span className="text-xs uppercase tracking-wide opacity-60">{displayName}</span>
                              </div>
                            );
                          })()}
                          {message.text && <div className="mt-1.5 text-sm leading-6">{message.text}</div>}
                          {message.media && message.media.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {message.media.map((url, mi) => (
                                <button
                                  key={mi}
                                  type="button"
                                  onClick={() => openLightbox(message.media!, mi)}
                                  className="focus:outline-none"
                                  title="Click to enlarge"
                                >
                                  <img
                                    src={url}
                                    alt="MMS photo"
                                    className="max-w-[200px] max-h-[200px] rounded-xl object-cover border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 text-xs opacity-60">{message.time}</div>
                        </motion.div>
                      );
                      return elements;
                    });
                  })()}
                </motion.div>
              </div>

              {/* Typing indicator — shows when another agent is composing a reply */}
              {typers.length > 0 && (
                <div className="px-5 pb-1">
                  <TypingBubble typers={typers} />
                </div>
              )}
              <div className="shrink-0 border-t border-slate-100 px-5 py-4 md:px-6 bg-white/95 backdrop-blur-sm">
                <div className="relative">
                  <FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="CS Chat" />
                  <ObjectionsPanel open={objectionsOpen} onClose={() => setObjectionsOpen(false)} />
                  <WorldClassReplyPanel
                    open={worldClassOpen}
                    onClose={() => setWorldClassOpen(false)}
                    onInsert={(text) => { setCompose(text); setWorldClassOpen(false); }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.quickActions.map((action) => (
                    <Button key={action} variant="outline" className="rounded-full h-10">
                      {action}
                    </Button>
                  ))}
                </div>
                <div className={`rounded-[20px] border p-3.5 transition-all duration-200 ${autoDraftLoading ? "border-violet-300 bg-violet-50/60 shadow-sm" : compose ? "border-slate-300 bg-white shadow-sm" : "border-slate-200 bg-slate-50/80"}`}>
                  {autoDraftLoading && (
                    <div className="flex items-center gap-1.5 mb-2.5 text-xs font-medium text-violet-600">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>AI is drafting a reply…</span>
                    </div>
                  )}
                  {!autoDraftLoading && compose && (
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                        <Bot className="h-3 w-3" />
                        AI draft
                      </span>
                      <span className="text-xs text-slate-400">Review before sending</span>
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
                      className="flex-1 rounded-xl bg-transparent border-0 px-1 py-1 text-slate-900 min-h-[80px] resize-none focus:outline-none text-sm leading-relaxed placeholder:text-slate-400"
                      placeholder={autoDraftLoading ? "" : "Type a message or use AI suggestion..."}
                      value={compose}
                      onChange={(e) => { setCompose(e.target.value); }}
                      onKeyDown={(e) => {
                        onTypingKeyPress();
                        if (e.key === "Enter" && !e.shiftKey && compose.trim() && selected) {
                          sendMessage.mutate({ sessionId: selected.id, message: compose.trim(), fromNumberId: "PN0wVLcpCq" });
                        }
                      }}
                      onBlur={onTypingBlur}
                    />
                    <div className="flex flex-col gap-2 shrink-0">
                      <div className="flex flex-row gap-1.5">
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
                        variant="outline"
                        size="icon"
                        className={`rounded-xl h-7 w-7 transition-colors ${
                          worldClassOpen
                            ? "bg-violet-700 text-white border-violet-700"
                            : "bg-violet-600 text-white border-violet-600 hover:bg-violet-700"
                        }`}
                        onClick={() => {
                          setWorldClassOpen((v) => !v);
                          setFaqOpen(false);
                          setObjectionsOpen(false);
                        }}
                        title="World-Class Reply — AI response using Disney, Ritz-Carlton & Zappos principles"
                        type="button"
                      >
                        <Sparkles className="h-3.5 w-3.5 animate-sparkle-shake" />
                      </Button>
                      </div>
                      <Button
                        className="rounded-xl h-10 px-5 bg-slate-900 hover:bg-slate-700 text-white font-semibold text-sm gap-1.5 shrink-0 disabled:opacity-30 transition-all duration-150"
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
                  <div className="mt-3 flex flex-col gap-2">
                    {/* Row 1: AI + Send quote + Make it right + Refer a friend + FAQ */}
                    <div className="flex items-center gap-2">
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
                      <div className="h-5 w-px bg-slate-200" />
                      {([
                        { action: "send_quote",    label: "Send quote",     icon: <Tag className="h-3.5 w-3.5" /> },
                        { action: "make_it_right", label: "Make it right",  icon: <AlertTriangle className="h-3.5 w-3.5" /> },
                        { action: "refer_friend",  label: "Refer a friend", icon: <Users className="h-3.5 w-3.5" /> },
                      ] as const).map(({ action, label, icon }) => (
                        <Button
                          key={action}
                          variant="outline"
                          className="rounded-full text-xs gap-1.5 h-8 px-3"
                          disabled={loadingAction !== null || !selected}
                          onClick={() => fireQuickReply(action)}
                        >
                          {loadingAction === action ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : icon}
                          {label}
                        </Button>
                      ))}
                      <div className="h-5 w-px bg-slate-200" />
                      <Button
                        variant="outline"
                        className="rounded-full text-xs gap-1.5 h-8 px-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => { setFaqOpen(true); setObjectionsOpen(false); setWorldClassOpen(false); }}
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        FAQ
                      </Button>
                    </div>
                    {/* Row 2: Running late + On the way + Review + rebook + Objections */}
                    <div className="flex items-center gap-2">
                      {([
                        { action: "running_late",  label: "Running late",    icon: <Clock3 className="h-3.5 w-3.5" /> },
                        { action: "on_the_way",    label: "On the way",      icon: <MapPin className="h-3.5 w-3.5" /> },
                        { action: "review_rebook", label: "Review + rebook", icon: <Star className="h-3.5 w-3.5" /> },
                      ] as const).map(({ action, label, icon }) => (
                        <Button
                          key={action}
                          variant="outline"
                          className="rounded-full text-xs gap-1.5 h-8 px-3"
                          disabled={loadingAction !== null || !selected}
                          onClick={() => fireQuickReply(action)}
                        >
                          {loadingAction === action ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : icon}
                          {label}
                        </Button>
                      ))}
                      <div className="h-5 w-px bg-slate-200" />
                      <Button
                        variant="outline"
                        className="rounded-full text-xs gap-1.5 h-8 px-3 border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => { setObjectionsOpen(true); setFaqOpen(false); setWorldClassOpen(false); }}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Objections
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

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
                          const launch27Url = job.bookingId
                            ? `https://maidsinblack.launch27.com/admin/bookings/${job.bookingId}`
                            : null;
                          const clientPhone10 = (job.customerPhone ?? "").replace(/[^\d]/g, "").slice(-10);
                          const callHref = clientPhone10 ? `openphone://call?to=+1${clientPhone10}` : null;
                          const smsHref = clientPhone10 ? `sms:+1${clientPhone10}` : null;
                          return (
                            <div
                              key={job.id}
                              className="rounded-[20px] border border-slate-200 bg-white shadow-sm overflow-hidden"
                            >
                              {/* Clickable main body */}
                              <button
                                type="button"
                                className="w-full text-left p-4 space-y-3 hover:bg-slate-50 transition-colors"
                                onClick={() => setSelectedJobDrawer(job)}
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
                                    <span className="leading-5 text-left">{job.jobAddress}</span>
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

                                {/* Hint to open details */}
                                <div className="flex items-center gap-1 text-xs text-slate-400 pt-0.5">
                                  <FileText className="h-3 w-3" />
                                  Tap to view details
                                </div>
                              </button>

                              {/* Action bar */}
                              <div className="flex items-center gap-1 px-3 py-2 border-t border-slate-100 bg-slate-50">
                                {callHref && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={callHref}
                                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                                      >
                                        <Phone className="h-3.5 w-3.5" />
                                        Call client
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>Call {job.customerName}</TooltipContent>
                                  </Tooltip>
                                )}
                                {clientPhone10 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setNewConvPhone(job.customerPhone ?? "");
                                          setNewConvMsg("");
                                          setNewConvOpen(true);
                                        }}
                                      >
                                        <MessageSquarePlus className="h-3.5 w-3.5" />
                                        SMS client
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Text {job.customerName} via CS chat</TooltipContent>
                                  </Tooltip>
                                )}
                                {launch27Url && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={launch27Url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        L27
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>Open in Launch27</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Team Actions — magic link */}
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-4">Team actions</div>
                    <div className="space-y-3">
                      {/* Send magic link via SMS */}
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
                      {/* Copy magic link to clipboard */}
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
                        <p className="text-xs text-slate-400 text-center">
                          No cleaner profile found for this number
                        </p>
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
                      {clientProfile?.todayJob && (() => {
                        const tj = clientProfile.todayJob;
                        const tjUrl = tj.bookingId ? `https://maidsinblack.launch27.com/admin/bookings/${tj.bookingId}` : null;
                        const TjCard = tjUrl ? "a" : "div";
                        return (
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">Today's job</div>
                            <TjCard
                              {...(tjUrl ? { href: tjUrl, target: "_blank", rel: "noopener noreferrer" } : {})}
                              className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-1.5 block${tjUrl ? " hover:border-emerald-400 hover:bg-emerald-100 cursor-pointer transition" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-semibold text-sm text-emerald-900">
                                  {new Date(tj.serviceDateTime!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {tj.serviceType}
                                </div>
                                {tjUrl && <ExternalLink className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />}
                              </div>
                              <div className="text-xs text-emerald-700 flex items-center gap-1">
                                <MapPin className="h-3 w-3" />{tj.jobAddress}
                              </div>
                              {(tj as any).teamName && (
                                <div className="text-xs text-emerald-700 flex items-center gap-1">
                                  <Users className="h-3 w-3" />{(tj as any).teamName}
                                </div>
                              )}
                              <Badge className="text-xs rounded-full bg-emerald-100 text-emerald-800 border-emerald-200">
                                {jobStatusLabel((tj.jobStatus ?? tj.bookingStatus ?? "assigned") as JobStatus)}
                              </Badge>
                            </TjCard>
                          </div>
                        );
                      })()}

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
                              selected.queue === "New"
                                ? "High-intent lead"
                                : selected.queue === "Resolved" ? "Good review moment"
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

                      {/* ─── Customer Memory Card ───────────────────────── */}
                      {customerMemory && (() => {
                        const isHighRisk = (selected?.stats.complaints ?? 0) >= 2;
                        return (
                          <div className={`rounded-[24px] border p-4 ${
                            isHighRisk
                              ? "border-rose-300 bg-rose-50 ring-1 ring-rose-200"
                              : "border-amber-200 bg-amber-50"
                          }`}>
                            <div className={`flex items-center gap-2 text-sm font-medium mb-3 ${
                              isHighRisk ? "text-rose-800" : "text-amber-800"
                            }`}>
                              {isHighRisk
                                ? <AlertTriangle className="h-4 w-4 text-rose-500" />
                                : <Brain className="h-4 w-4" />
                              }
                              Know before you reply
                              {isHighRisk && (
                                <span className="ml-auto text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200 rounded-full px-2 py-0.5">
                                  Escalate to senior rep
                                </span>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-start gap-2">
                                <span className={`mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wide w-16 ${
                                  isHighRisk ? "text-rose-400" : "text-amber-500"
                                }`}>Last job</span>
                                <span className={`text-xs leading-4 ${
                                  isHighRisk ? "text-rose-900" : "text-amber-900"
                                }`}>{customerMemory.lastBooking}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className={`mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wide w-16 ${
                                  isHighRisk ? "text-rose-400" : "text-amber-500"
                                }`}>History</span>
                                <span className={`text-xs leading-4 font-medium ${
                                  isHighRisk ? "text-rose-800" : "text-amber-900"
                                }`}>{customerMemory.complaintHistory}</span>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className={`mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wide w-16 ${
                                  isHighRisk ? "text-rose-400" : "text-amber-500"
                                }`}>Profile</span>
                                <span className={`text-xs leading-4 ${
                                  isHighRisk ? "text-rose-900" : "text-amber-900"
                                }`}>{customerMemory.careAbout}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="rounded-[24px] border border-blue-200 bg-blue-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                          <Bot className="h-4 w-4" /> AI insight
                          {insightLoading && <RefreshCw className="h-3 w-3 animate-spin ml-auto text-blue-400" />}
                        </div>
                        {insightLoading && !insightData?.insight ? (
                          <div className="mt-2 space-y-1.5">
                            <div className="h-3 w-full rounded bg-blue-200/60 animate-pulse" />
                            <div className="h-3 w-4/5 rounded bg-blue-200/60 animate-pulse" />
                            <div className="h-3 w-3/5 rounded bg-blue-200/60 animate-pulse" />
                          </div>
                        ) : insightData?.insight ? (
                          <div className="mt-2 text-sm leading-6 text-blue-900">{insightData.insight}</div>
                        ) : (
                          <div className="mt-2 text-xs text-blue-400 italic">Select a conversation with messages to generate insight.</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* ─── AI Upsell Opportunity card ─────────────────── */}
                {showUpsellCard && (
                  <Card className="rounded-[28px] border-emerald-200 bg-emerald-50 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                        <TrendingUp className="h-4 w-4" /> Upsell opportunity
                        {upsellLoading && <RefreshCw className="h-3 w-3 animate-spin ml-auto text-emerald-400" />}
                        {showUpsell && (
                          <button
                            className="ml-auto text-emerald-400 hover:text-emerald-600 transition-colors"
                            onClick={() => setUpsellDismissed(selected?.id ?? null)}
                            title="Dismiss"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {upsellLoading && !upsellData?.upsell ? (
                        <div className="mt-2 space-y-1.5">
                          <div className="h-3 w-full rounded bg-emerald-200/60 animate-pulse" />
                          <div className="h-3 w-4/5 rounded bg-emerald-200/60 animate-pulse" />
                        </div>
                      ) : showUpsell && upsellData?.upsell ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-xs text-emerald-600 font-medium">{upsellData.upsell.upsellType}</div>
                          <div className="text-xs text-emerald-700 italic">{upsellData.upsell.signal}</div>
                          <div className="rounded-xl bg-white border border-emerald-200 px-3 py-2 text-sm text-emerald-900 leading-5">
                            &ldquo;{upsellData.upsell.pitch}&rdquo;
                          </div>
                          <Button
                            size="sm"
                            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                            onClick={() => {
                              setCompose(upsellData.upsell!.pitch);
                              toast.success("Upsell pitch copied to compose box");
                            }}
                          >
                            Use this pitch
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )}

                {/* ─── Post-call AI Debrief card ───────────────────── */}
                {showDebrief && (() => {
                  const grade = callDebrief!.grade;
                  const gradeColors: Record<string, string> = {
                    A: 'bg-green-100 text-green-700 border-green-300',
                    B: 'bg-blue-100 text-blue-700 border-blue-300',
                    C: 'bg-amber-100 text-amber-700 border-amber-300',
                    D: 'bg-orange-100 text-orange-700 border-orange-300',
                    F: 'bg-red-100 text-red-700 border-red-300',
                  };
                  const gradeColor = grade ? (gradeColors[grade] ?? gradeColors.C) : gradeColors.C;
                  return (
                    <Card className="rounded-[28px] border-purple-200 bg-purple-50 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                      <CardContent className="p-5">
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 border border-purple-200">
                              <Phone className="h-3.5 w-3.5 text-purple-600" />
                            </div>
                            <span className="text-xs font-semibold text-purple-700 uppercase tracking-widest">Call Debrief</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {grade && (
                              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full border-2 text-sm font-bold ${gradeColor}`}>
                                {grade}
                              </span>
                            )}
                            <button
                              onClick={() => setDebriefDismissed((prev) => ({ ...prev, [selected!.id]: true }))}
                              className="flex items-center justify-center w-6 h-6 rounded-full text-purple-300 hover:text-purple-600 hover:bg-purple-100 transition-colors text-base leading-none"
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        {/* Audio player */}
                        {callDebrief!.audioUrl && (
                          <div className="mb-4">
                            <audio
                              controls
                              src={callDebrief!.audioUrl}
                              className="w-full h-8 rounded-xl"
                              style={{ accentColor: '#7c3aed' }}
                            />
                          </div>
                        )}

                        {/* Divider */}
                        <div className="border-t border-purple-200/70 mb-4" />

                        {/* Went well */}
                        <div className="mb-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-green-500 text-xs">✔</span>
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-green-600">Went well</span>
                          </div>
                          <p className="text-xs text-purple-800 leading-relaxed pl-4">{callDebrief!.wentWell}</p>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-purple-200/50 mb-3" />

                        {/* Improve */}
                        <div className="mb-4">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-amber-500 text-xs">▲</span>
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">Improve</span>
                          </div>
                          <p className="text-xs text-purple-800 leading-relaxed pl-4">{callDebrief!.improve}</p>
                        </div>

                        {/* Next line suggestion */}
                        <div className="rounded-2xl bg-white border border-purple-200 px-4 py-3">
                          <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-widest mb-1.5">Next time, say:</p>
                          <p className="text-sm text-purple-900 italic leading-relaxed">&ldquo;{callDebrief!.nextLine}&rdquo;</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ─── Actions card (merged: follow-up + call + share link) ─── */}
                <Card className="rounded-[28px] border-slate-200 shadow-[0_16px_50px_rgba(15,23,42,0.06)]">
                  <CardContent className="p-5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-4">Actions</div>
                    <div className="flex flex-col gap-2.5">

                      {/* Call client */}
                      <button
                        className="group flex items-center gap-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-violet-300 hover:bg-violet-50 transition-all duration-150"
                        onClick={() => {
                          const phone = selected?.phone?.replace(/\D/g, "").slice(-10);
                          if (phone) window.location.href = `openphone://call?to=+1${phone}`;
                        }}
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-violet-100 group-hover:bg-violet-200 transition-colors shrink-0">
                          <Phone className="h-4 w-4 text-violet-600" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">Call client</div>
                          <div className="text-[11px] text-slate-400">Open in OpenPhone</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 ml-auto group-hover:text-violet-400 transition-colors" />
                      </button>

                      {/* Share booking link */}
                      <button
                        className="group flex items-center gap-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50 transition-all duration-150"
                        onClick={() => {
                          const link = `${window.location.origin}/book`;
                          navigator.clipboard.writeText(link).then(() => {
                            const btn = document.activeElement as HTMLButtonElement;
                            if (btn) { const orig = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = orig; }, 1500); }
                          });
                        }}
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-blue-100 group-hover:bg-blue-200 transition-colors shrink-0">
                          <Mail className="h-4 w-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">Share booking link</div>
                          <div className="text-[11px] text-slate-400">Copy to clipboard</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 ml-auto group-hover:text-blue-400 transition-colors" />
                      </button>

                      {/* Add follow-up */}
                      <button
                        className="group flex items-center gap-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-amber-300 hover:bg-amber-50 transition-all duration-150"
                        onClick={() => setAddFollowUpOpen(true)}
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-100 group-hover:bg-amber-200 transition-colors shrink-0">
                          <ClipboardList className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-800">Add follow-up</div>
                          <div className="text-[11px] text-slate-400">Schedule a reminder</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 ml-auto group-hover:text-amber-400 transition-colors" />
                      </button>

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

    {/* New Conversation dialog */}
    {newConvOpen && (
      <div
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={() => setNewConvOpen(false)}
      >
        <div
          className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">New SMS conversation</h3>
            <button
              type="button"
              onClick={() => setNewConvOpen(false)}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phone number</label>
              <input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={newConvPhone}
                onChange={(e) => setNewConvPhone(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                autoFocus
              />
            </div>
            {existingConvForPhone && (
              <div className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>
                  <span className="font-semibold">{existingConvForPhone.name}</span> already has an open conversation.
                  Sending will reopen it.
                </span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">First message</label>
              <textarea
                placeholder="Type your opening message…"
                value={newConvMsg}
                onChange={(e) => setNewConvMsg(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setNewConvOpen(false)}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!newConvPhone.trim() || !newConvMsg.trim() || startConv.isPending}
              onClick={() => startConv.mutate({ phone: newConvPhone.trim(), firstMessage: newConvMsg.trim() })}
              className="rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {startConv.isPending ? "Sending…" : "Send & open"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Job Details Drawer */}
    <Sheet open={!!selectedJobDrawer} onOpenChange={(open) => { if (!open) setSelectedJobDrawer(null); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {selectedJobDrawer && (() => {
          const job = selectedJobDrawer;
          const time = job.serviceDateTime
            ? new Date(job.serviceDateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—";
          const launch27Url = job.bookingId
            ? `https://maidsinblack.launch27.com/admin/bookings/${job.bookingId}`
            : null;
          const clientPhone10 = (job.customerPhone ?? "").replace(/[^\d]/g, "").slice(-10);
          const callHref = clientPhone10 ? `openphone://call?to=+1${clientPhone10}` : null;
          const smsHref = clientPhone10 ? `sms:+1${clientPhone10}` : null;
          let checklist: { text: string; checked: boolean }[] = [];
          try { checklist = JSON.parse(job.checklistItems ?? "[]"); } catch { checklist = []; }
          return (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="text-lg font-semibold">
                  {job.customerName || "Job Details"}
                </SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={`rounded-full border text-xs font-medium hover:bg-transparent ${jobStatusStyle(job.jobStatus as JobStatus)}`}>
                    {jobStatusLabel(job.jobStatus as JobStatus)}
                  </Badge>
                  <span className="text-sm text-slate-500 flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />{time}
                  </span>
                </div>
              </SheetHeader>

              {/* Quick action buttons */}
              <div className="flex flex-wrap gap-2 mb-6">
                {callHref && (
                  <a href={callHref} className="flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                    <Phone className="h-4 w-4" /> Call client
                  </a>
                )}
                {job.customerPhone && (
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                    onClick={() => {
                      setNewConvPhone(job.customerPhone ?? "");
                      setNewConvMsg("");
                      setNewConvOpen(true);
                      setSelectedJobDrawer(null);
                    }}
                  >
                    <MessageSquarePlus className="h-4 w-4" /> SMS client
                  </button>
                )}
                {launch27Url && (
                  <a href={launch27Url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-colors">
                    <ExternalLink className="h-4 w-4" /> Open in Launch27
                  </a>
                )}
              </div>

              <div className="space-y-5">
                {/* Job info */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="text-xs uppercase tracking-[0.15em] text-slate-400 font-medium">Job info</div>
                  {job.jobAddress && (
                    <div className="flex items-start gap-2 text-sm text-slate-700">
                      <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                      <span>{job.jobAddress}</span>
                    </div>
                  )}
                  {job.serviceType && (
                    <div className="flex items-start gap-2 text-sm text-slate-700">
                      <Briefcase className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                      <span>{job.serviceType}</span>
                    </div>
                  )}
                  {(job.bedrooms || job.bathrooms) && (
                    <div className="flex items-center gap-3 text-sm text-slate-600">
                      {job.bedrooms && <span>{job.bedrooms} bed</span>}
                      {job.bathrooms && <span>{job.bathrooms} bath</span>}
                    </div>
                  )}
                  {job.jobRevenue && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <DollarSign className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="font-medium">${job.jobRevenue}</span>
                    </div>
                  )}
                </div>

                {/* Issue / delay alerts */}
                {job.jobStatus === "issue_at_property" && job.issueNote && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-rose-700 mb-1">Issue at property</div>
                      <div className="text-sm text-rose-800">{job.issueNote}</div>
                    </div>
                  </div>
                )}
                {job.jobStatus === "running_late" && job.delayMinutes && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
                    <div className="text-xs font-semibold text-amber-700 mb-1">Running late</div>
                    <div className="text-sm text-amber-800">{job.delayMinutes} minutes behind schedule</div>
                  </div>
                )}

                {/* Customer notes */}
                {job.customerNotes && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">Customer notes</div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{job.customerNotes}</p>
                  </div>
                )}

                {/* AI checklist */}
                {checklist.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-slate-400 font-medium mb-3 flex items-center gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" /> Checklist
                    </div>
                    <div className="space-y-2">
                      {checklist.map((item, i) => (
                        <div key={i} className={`flex items-start gap-2 text-sm ${item.checked ? "text-slate-400 line-through" : "text-slate-700"}`}>
                          <div className={`mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center ${
                            item.checked ? "bg-emerald-100 border-emerald-300" : "border-slate-300"
                          }`}>
                            {item.checked && <Check className="h-2.5 w-2.5 text-emerald-600" />}
                          </div>
                          {item.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Staff notes */}
                {job.staffNotes && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-slate-400 font-medium mb-2">Staff notes</div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{job.staffNotes}</p>
                  </div>
                )}

                {/* Admin notes */}
                {job.adminNotes && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs uppercase tracking-[0.15em] text-amber-600 font-medium mb-2">Admin notes</div>
                    <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{job.adminNotes}</p>
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </SheetContent>
    </Sheet>

    {/* Lightbox overlay */}
    {lightbox && lightboxUrl && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={closeLightbox}
      >
        {/* Close button */}
        <button
          type="button"
          className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
          onClick={closeLightbox}
          title="Close (Esc)"
        >
          <X className="h-6 w-6" />
        </button>
        {/* Open in new tab */}
        <a
          href={lightboxUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-4 left-4 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
          onClick={(e) => e.stopPropagation()}
          title="Open original"
        >
          <ExternalLink className="h-5 w-5" />
        </a>
        {/* Prev arrow */}
        {lightbox.idx > 0 && (
          <button
            type="button"
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/25 p-3 text-white transition-colors"
            onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
            title="Previous (←)"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        )}
        {/* Next arrow */}
        {lightbox.idx < lightbox.urls.length - 1 && (
          <button
            type="button"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/25 p-3 text-white transition-colors"
            onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
            title="Next (→)"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        )}
        {/* Photo counter */}
        {lightbox.urls.length > 1 && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white">
            {lightbox.idx + 1} / {lightbox.urls.length}
          </div>
        )}
        {/* Image */}
        <img
          src={lightboxUrl}
          alt="Enlarged photo"
          className="max-w-[80vw] max-h-[85vh] rounded-2xl object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}

    {/* ─── Add Follow-up modal ─────────────────────────── */}
    <FollowUpsModal
      open={addFollowUpOpen}
      onClose={() => setAddFollowUpOpen(false)}
      initialView="new"
    />
    </>
  );
}
