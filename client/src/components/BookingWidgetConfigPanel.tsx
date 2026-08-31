import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, CreditCard, Eye, Home, Loader2, Lock, MapPin, MessageCircle, Play, Plus, RotateCcw, Save, Send, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BookingPaymentCheckout } from "@/components/BookingPaymentCheckout";
import {
  NATIVE_BOOKING_PRICING_VERSION,
  type BookingPriceSnapshot,
  type BookingSurface,
  type PrepareBookingResult,
} from "@shared/booking";
import type { BookingFunnelPublicResult, UpdateBookingFunnelInput } from "@shared/bookingFunnel";
import {
  BOOKING_WIDGET_BATHROOM_UNIT_PRICE,
  BOOKING_WIDGET_BEDROOM_BASE_PRICES,
  BOOKING_WIDGET_PRICED_EXTRAS,
  BOOKING_WIDGET_RECURRING_OPTIONS,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildInferredQuestionAnswers,
  buildDemoDetailLine,
  calculateBookingWidgetPrice,
  calculateBookingWidgetRecurringPrice,
  findBookingWidgetPricedExtra,
  firstNameFromFullName,
  formatBookingWidgetExtraSelection,
  formatBookingButtonLabel,
  formatDemoScheduleSelection,
  formatScheduleQuestion,
  getBookingWidgetRoomCount,
  isNoSelectionChoice,
  moveListItem,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
  toggleMultiSelectChoice,
  validateBookingWidgetIntakeField,
  type BookingWidgetDraftConfig,
  type BookingWidgetIntakeField,
  type BookingWidgetQuestionDraft,
  type BookingWidgetRecurringFrequency,
  type BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";

type BookingWidgetConfigPanelProps = {
  savedValue?: string;
  onSave?: (value: string) => Promise<void>;
  mode?: "editor" | "live";
  surface?: BookingSurface;
};

type DemoStep = "request" | "serviceDetails" | "questions" | "schedule" | "extras" | "fullName" | "phone" | "email" | "address" | "checking" | "quote" | "confirm" | "payment" | "complete";
type ItemizationPanel = "none" | "base" | "extras" | "note";

type DemoHistoryItem =
  | { kind: "message"; sender: "assistant" | "customer"; text: string }
  | { kind: "privacy" }
  | { kind: "proof" };

type DemoHistoryEntry = DemoHistoryItem & { id: number };

type DemoSession = {
  prompt: string;
  serviceDetailsAnswer: string;
  serviceId: BookingWidgetServiceId;
  bedrooms?: number;
  bathrooms?: number;
  fallbackBedrooms: number;
  answers: Record<string, string[]>;
  extraQuantities: Record<string, number>;
  specialRequestNotes: string[];
  recurringFrequency: BookingWidgetRecurringFrequency;
  inferredQuestionIds: string[];
  requestedDay: string;
  fullName: string;
  phone: string;
  email: string;
  schedule: string;
  address: string;
  leadCaptured: boolean;
};

const fieldClass = "h-9 bg-white border-gray-200 text-sm";
const DEMO_TIME_SLOTS = ["8:30 AM", "10:30 AM", "1:00 PM", "3:30 PM"] as const;
const BOOKING_CONFIRMATION_EXPECTATIONS = [
  { emoji: "📩", title: "Booking confirmation", description: "You’ll receive a text and email with your appointment details." },
  { emoji: "🔔", title: "Helpful reminders", description: "We’ll text you before your cleaning so nothing sneaks up on you." },
  { emoji: "🚗", title: "Track your team", description: "On the day of service, we’ll send you a tracking link when your cleaning team is on the way." },
  { emoji: "👋", title: "Arrival updates", description: "You’ll know when the team is heading over and when they’ve arrived." },
  { emoji: "🧹", title: "Fully equipped professionals", description: "Your vetted and insured cleaning team will arrive with the supplies needed for your service." },
  { emoji: "💳", title: "Payment after service", description: "Your card is securely kept on file, but you won’t be charged until after the cleaning is completed." },
  { emoji: "💬", title: "Need to change something?", description: "Reply to any of our text messages if you need to update your appointment, add something, or share a special request." },
] as const;
const CLEANER_TEAM_IMAGE_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/KoTsWjcUFAcYYhVB.png";
const WELCOME_VIDEO_WISTIA_MEDIA_ID = "bzlt49ipk1";
const WELCOME_VIDEO_POSTER_URL = "https://embed-ssl.wistia.com/deliveries/de3b8af433c63d912143e78eab71c6b3.jpg?image_crop_resized=960x540";
const WELCOME_VIDEO_IFRAME_URL = `https://fast.wistia.net/embed/iframe/${WELCOME_VIDEO_WISTIA_MEDIA_ID}?seo=false&videoFoam=true&autoplay=1`;

function normalizeCalendarDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized;
}

function createBookingAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function looksLikeBookingQuestion(value: string): boolean {
  const normalized = value.trim();
  return normalized.endsWith("?") || /^(?:can|could|would|will|do|does|did|is|are|what|when|where|why|how)\b/i.test(normalized);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeLabelTo24Hour(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(time.trim());
  if (!match) throw new Error("Select a valid requested time.");
  const rawHour = Number(match[1]);
  const hour = rawHour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function suggestedDateForRequest(requestedDay: string | undefined, today: Date): Date | undefined {
  if (!requestedDay) return undefined;
  const normalizedDay = requestedDay.trim().toLowerCase();
  const date = normalizeCalendarDate(today);
  if (normalizedDay === "today") return date;
  if (normalizedDay === "tomorrow") {
    date.setDate(date.getDate() + 1);
    return date;
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const targetDay = weekdays.indexOf(normalizedDay);
  if (targetDay < 0) return undefined;
  const daysAhead = (targetDay - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysAhead);
  return date;
}

const emptySession: DemoSession = {
  prompt: "",
  serviceDetailsAnswer: "",
  serviceId: "deep",
  fallbackBedrooms: 0,
  answers: {},
  extraQuantities: {},
  specialRequestNotes: [],
  recurringFrequency: "one-time",
  inferredQuestionIds: [],
  requestedDay: "",
  fullName: "",
  phone: "",
  email: "",
  schedule: "",
  address: "",
  leadCaptured: false,
};

function DemoBubble({ children, customer, color, containerRef }: { children: React.ReactNode; customer?: boolean; color?: string; containerRef?: React.Ref<HTMLDivElement> }) {
  if (!customer) {
    return (
      <div ref={containerRef} className="flex items-end gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[#ffe3dc] text-[#ff684c]"><Sparkles className="h-3.5 w-3.5" /></div>
        <div className="max-w-[78%] rounded-[18px_18px_18px_6px] border border-[#e4e5e7] bg-white px-4 py-3 shadow-[0_3px_9px_rgba(22,20,33,0.03)]">
          <span className="mb-1 block text-[10px] font-extrabold tracking-wide text-[#ff684c]">Madison</span>
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-[#3a3c41]">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="ml-auto max-w-[78%] rounded-[18px_18px_6px_18px] border border-[#f1e5c6] px-4 py-3 text-[13px] leading-6 text-[#3a3c41] shadow-[0_3px_9px_rgba(22,20,33,0.03)] whitespace-pre-wrap"
      style={{ backgroundColor: color }}
    >
      {children}
      <span className="mt-1.5 block text-right text-[9px] text-[#9c9279]">Delivered ✓</span>
    </div>
  );
}

function DemoChip({ children, onClick, selected = false, color, buttonRef }: { children: React.ReactNode; onClick: () => void; selected?: boolean; color?: string; buttonRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3.5 py-2 text-left text-[12px] font-bold transition active:scale-[0.98] ${selected ? "border-[#ff684c] text-[#d94f35] shadow-sm" : "border-[#ffd2c8] bg-[#fff8f6] text-[#d95740] hover:border-[#ff9c89] hover:bg-[#fff1ed]"}`}
      style={selected ? { backgroundColor: color } : undefined}
    >
      {children}
    </button>
  );
}

function formatItemizedCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function DemoHistoryRow({ entry, customerColor, trustPoints }: { entry: DemoHistoryEntry; customerColor: string; trustPoints: string[] }) {
  if (entry.kind === "message") {
    return <DemoBubble customer={entry.sender === "customer"} color={customerColor}>{entry.text}</DemoBubble>;
  }
  if (entry.kind === "privacy") {
    return (
      <div className="ml-10 mr-2 flex items-center gap-4 rounded-[18px] border border-[#dfe4e2] bg-[#f5f7f6] p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-white text-[#239268]"><ShieldCheck className="h-6 w-6" /></div>
        <div><strong className="text-[12px] text-[#3a3c41]">Your information stays private</strong><p className="mt-1 text-[11px] leading-5 text-[#6d837a]">We only use it for your booking and arrival updates.</p></div>
      </div>
    );
  }
  return (
    <div className="ml-10 mr-2 overflow-hidden rounded-[18px] border border-[#e0e1e4] bg-white shadow-[0_8px_24px_rgba(22,20,33,0.05)] min-[480px]:grid min-[480px]:grid-cols-[140px_1fr]">
      <img
        src={CLEANER_TEAM_IMAGE_URL}
        alt="Maids in Black professional holding cleaning supplies"
        className="h-36 w-full bg-[#f7f5f2] object-contain min-[480px]:h-full"
      />
      <div className="flex flex-col justify-center p-4"><span className="text-[9px] font-extrabold tracking-[0.12em] text-[#ff684c]">WHY PEOPLE BOOK US</span><h3 className="mt-2 text-[15px] font-extrabold text-[#3a3c41]">Professional, vetted cleaners</h3><div className="mt-2 flex items-start gap-2 text-[10px] leading-4 text-[#66736e]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#239268]" /><span>{trustPoints.filter(Boolean).join(" · ")}</span></div><span className="mt-2 text-[10px] font-extrabold text-[#ff684c]">See our happiness promise</span></div>
    </div>
  );
}

export default function BookingWidgetConfigPanel({ savedValue, onSave, mode = "editor", surface = "full_page" }: BookingWidgetConfigPanelProps) {
  const savedConfig = useMemo(() => parseBookingWidgetDraft(savedValue), [savedValue]);
  const [config, setConfig] = useState<BookingWidgetDraftConfig>(savedConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<DemoStep>("request");
  const [demo, setDemo] = useState<DemoSession>(emptySession);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [composerValue, setComposerValue] = useState("");
  const [composerError, setComposerError] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [savePaymentDetails, setSavePaymentDetails] = useState(false);
  const [itemizationPanel, setItemizationPanel] = useState<ItemizationPanel>("none");
  const [specialRequestDraft, setSpecialRequestDraft] = useState("");
  const [welcomeVideoOpen, setWelcomeVideoOpen] = useState(false);
  const [history, setHistory] = useState<DemoHistoryEntry[]>([]);
  const [acceptedPricing, setAcceptedPricing] = useState({ version: NATIVE_BOOKING_PRICING_VERSION, totalCents: 0 });
  const [priceChange, setPriceChange] = useState<Extract<PrepareBookingResult, { type: "price_changed" }> | null>(null);
  const [preparedBooking, setPreparedBooking] = useState<Extract<PrepareBookingResult, { type: "prepared" }> | null>(null);
  const [funnelRecord, setFunnelRecord] = useState<BookingFunnelPublicResult | null>(null);
  const bookingAttemptIdRef = useRef(createBookingAttemptId());
  const funnelRecordRef = useRef<BookingFunnelPublicResult | null>(null);
  const phoneCaptureInFlightRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeStageRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const welcomeVideoTriggerRef = useRef<HTMLButtonElement>(null);
  const welcomeVideoCloseRef = useRef<HTMLButtonElement>(null);
  const welcomeVideoDialogRef = useRef<HTMLDivElement>(null);
  const openingPromptRef = useRef<HTMLButtonElement>(null);
  const welcomeVideoReturnFocusRef = useRef<"trigger" | "prompt">("trigger");
  const historyIdRef = useRef(0);
  const demoToday = useMemo(() => normalizeCalendarDate(new Date()), []);
  const demoCalendarEnd = useMemo(() => {
    const end = new Date(demoToday);
    end.setMonth(end.getMonth() + 6);
    return end;
  }, [demoToday]);
  const beginFunnelMutation = trpc.bookingFunnel.begin.useMutation();
  const updateFunnelMutation = trpc.bookingFunnel.update.useMutation();
  const reserveFunnelMutation = trpc.bookingFunnel.reserve.useMutation();
  const bookingFaqMutation = trpc.bookingFunnel.answerFaq.useMutation();

  useEffect(() => {
    setConfig(savedConfig);
  }, [savedConfig]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      if (step === "request" && history.length === 0) {
        container.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      const activeStage = activeStageRef.current;
      if (!activeStage) return;
      const containerRect = container.getBoundingClientRect();
      const activeRect = activeStage.getBoundingClientRect();
      container.scrollTo({ top: Math.max(container.scrollTop + activeRect.top - containerRect.top - 12, 0), behavior: "auto" });
      if (step === "confirm") checkoutRef.current?.focus({ preventScroll: true });
    });
  }, [step, currentQuestionIndex, history.length]);

  useEffect(() => {
    if (!welcomeVideoOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => welcomeVideoCloseRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        welcomeVideoReturnFocusRef.current = "trigger";
        setWelcomeVideoOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = welcomeVideoDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, iframe, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => {
        const focusTarget = welcomeVideoReturnFocusRef.current === "prompt" ? openingPromptRef.current : welcomeVideoTriggerRef.current;
        focusTarget?.focus();
        welcomeVideoReturnFocusRef.current = "trigger";
      });
    };
  }, [welcomeVideoOpen]);

  const serialized = JSON.stringify(config);
  const isDirty = serialized !== JSON.stringify(savedConfig);
  const service = config.services.find((item) => item.id === demo.serviceId) ?? config.services[1];
  const currentQuestion = config.questions[currentQuestionIndex];
  const extrasQuestion = config.questions.find((question) => question.role === "extras");
  const selectedExtras = extrasQuestion ? (demo.answers[extrasQuestion.id] ?? []).filter((answer) => !isNoSelectionChoice(answer)) : [];
  const bedroomCount = demo.bedrooms ?? getBookingWidgetRoomCount("bedrooms", config.questions, demo.answers);
  const bathroomCount = demo.bathrooms ?? getBookingWidgetRoomCount("bathrooms", config.questions, demo.answers);
  const priceBreakdown = (() => {
    try {
      return calculateBookingWidgetPrice({
        serviceId: demo.serviceId,
        bedrooms: bedroomCount as number,
        bathrooms: bathroomCount as number,
        selectedExtras,
        extraQuantities: demo.extraQuantities,
      });
    } catch {
      return null;
    }
  })();
  const quotePrice = String(priceBreakdown?.total ?? 0);
  const selectedRecurringOption = BOOKING_WIDGET_RECURRING_OPTIONS.find((option) => option.id === demo.recurringFrequency);
  const recurringFutureVisitPrice = priceBreakdown
    ? calculateBookingWidgetRecurringPrice(priceBreakdown.total, demo.recurringFrequency)
    : null;
  const detailLine = buildDemoDetailLine(demo.fallbackBedrooms, config.questions, demo.answers, demo.extraQuantities);
  const itemizedExtras = selectedExtras.flatMap((choice) => {
    const pricedExtra = findBookingWidgetPricedExtra(choice);
    if (!pricedExtra) return [];
    const quantity = pricedExtra.quantityUnit ? demo.extraQuantities[pricedExtra.id] ?? 1 : 1;
    return [{ pricedExtra, quantity, amount: pricedExtra.unitPrice * quantity }];
  });
  const unselectedPricedExtras = BOOKING_WIDGET_PRICED_EXTRAS.filter((extra) => !selectedExtras.some((choice) => choice.toLowerCase() === extra.label.toLowerCase()));
  const roomItemizationLabel = bedroomCount === 0
    ? `Studio / ${bathroomCount ?? 0} bath${bathroomCount === 1 ? "" : "s"}`
    : `${bedroomCount ?? 0} bed / ${bathroomCount ?? 0} bath`;

  const appendHistory = (...items: DemoHistoryItem[]) => {
    const entries = items.map((item) => ({ ...item, id: ++historyIdRef.current }));
    setHistory((current) => [...current, ...entries]);
  };

  const rememberFunnelRecord = (record: BookingFunnelPublicResult | null) => {
    funnelRecordRef.current = record;
    setFunnelRecord(record);
  };

  const persistFunnelPatch = async (patch: UpdateBookingFunnelInput["patch"]) => {
    const current = funnelRecordRef.current;
    if (mode !== "live" || !current) return current;
    const next = await updateFunnelMutation.mutateAsync({
      publicFunnelNumber: current.publicFunnelNumber,
      mutationToken: current.mutationToken,
      expectedVersion: current.version,
      patch,
    });
    rememberFunnelRecord(next);
    return next;
  };

  const update = <K extends keyof BookingWidgetDraftConfig>(key: K, value: BookingWidgetDraftConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const updatePrompts = (next: string[]) => update("quickPrompts", next);
  const updatePrompt = (index: number, value: string) => updatePrompts(config.quickPrompts.map((prompt, promptIndex) => promptIndex === index ? value : prompt));
  const addPrompt = () => updatePrompts([...config.quickPrompts, "New opening prompt"]);
  const removePrompt = (index: number) => updatePrompts(config.quickPrompts.filter((_, promptIndex) => promptIndex !== index));
  const movePrompt = (index: number, direction: -1 | 1) => updatePrompts(moveListItem(config.quickPrompts, index, index + direction));

  const updateQuestions = (questions: BookingWidgetQuestionDraft[], resetPreview = false) => {
    update("questions", questions);
    if (resetPreview) startOver();
  };

  const updateQuestion = (index: number, patch: Partial<BookingWidgetQuestionDraft>) => {
    updateQuestions(config.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  };

  const addQuestion = () => {
    const id = `custom-${Date.now().toString(36)}`;
    updateQuestions([...config.questions, { id, role: "custom", prompt: "New question", choices: ["Option 1", "Option 2"], selectionMode: "single" }], true);
  };

  const removeQuestion = (index: number) => updateQuestions(config.questions.filter((_, questionIndex) => questionIndex !== index), true);
  const moveQuestion = (index: number, direction: -1 | 1) => updateQuestions(moveListItem(config.questions, index, index + direction), true);

  const updateChoices = (questionIndex: number, choices: string[], resetPreview = false) => {
    updateQuestions(config.questions.map((question, index) => index === questionIndex ? { ...question, choices } : question), resetPreview);
  };

  const updateChoice = (questionIndex: number, choiceIndex: number, value: string) => {
    const choices = config.questions[questionIndex].choices.map((choice, index) => index === choiceIndex ? value : choice);
    updateChoices(questionIndex, choices);
  };

  const addChoice = (questionIndex: number) => updateChoices(questionIndex, [...config.questions[questionIndex].choices, "New choice"]);
  const removeChoice = (questionIndex: number, choiceIndex: number) => updateChoices(questionIndex, config.questions[questionIndex].choices.filter((_, index) => index !== choiceIndex), true);
  const moveChoice = (questionIndex: number, choiceIndex: number, direction: -1 | 1) => updateChoices(questionIndex, moveListItem(config.questions[questionIndex].choices, choiceIndex, choiceIndex + direction), true);

  const updateService = (index: number, key: Exclude<keyof BookingWidgetDraftConfig["services"][number], "id">, value: string) => {
    const next = config.services.map((item, serviceIndex) => serviceIndex === index ? { ...item, [key]: value } : item) as BookingWidgetDraftConfig["services"];
    update("services", next);
  };

  const startOver = () => {
    setWelcomeVideoOpen(false);
    welcomeVideoReturnFocusRef.current = "trigger";
    setStep("request");
    setDemo(emptySession);
    setHistory([]);
    historyIdRef.current = 0;
    setCurrentQuestionIndex(0);
    setComposerValue("");
    setComposerError("");
    setSelectedDate(undefined);
    setSelectedTime("");
    setSummaryOpen(false);
    setSavePaymentDetails(false);
    setItemizationPanel("none");
    setSpecialRequestDraft("");
    setPriceChange(null);
    setPreparedBooking(null);
    rememberFunnelRecord(null);
    setAcceptedPricing({ version: NATIVE_BOOKING_PRICING_VERSION, totalCents: 0 });
    beginFunnelMutation.reset();
    updateFunnelMutation.reset();
    reserveFunnelMutation.reset();
    phoneCaptureInFlightRef.current = false;
    bookingAttemptIdRef.current = createBookingAttemptId();
    requestAnimationFrame(() => conversationRef.current?.scrollTo({ top: 0 }));
  };

  const nextUnansweredCustomQuestionIndex = (fromIndex: number, answers: Record<string, string[]>) => {
    for (let index = Math.max(fromIndex, 0); index < config.questions.length; index += 1) {
      if (config.questions[index].role === "custom" && (answers[config.questions[index].id] ?? []).length === 0) return index;
    }
    return -1;
  };

  const nextAfterServiceDetails = (answers: Record<string, string[]>) => {
    const customQuestionIndex = nextUnansweredCustomQuestionIndex(0, answers);
    if (customQuestionIndex >= 0) {
      setCurrentQuestionIndex(customQuestionIndex);
      setStep("questions");
      return;
    }
    setStep("schedule");
  };

  const selectRequest = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const resolved = resolveDemoRequest(trimmed);
    const inferred = buildInferredQuestionAnswers(resolved, config.questions);
    const hasBedrooms = config.questions.every((question) => question.role !== "bedrooms" || (inferred.answers[question.id] ?? []).length > 0);
    const hasBathrooms = config.questions.every((question) => question.role !== "bathrooms" || (inferred.answers[question.id] ?? []).length > 0);
    const hasUnsupportedBedrooms = resolved.bedrooms !== undefined && BOOKING_WIDGET_BEDROOM_BASE_PRICES[resolved.bedrooms] === undefined;
    appendHistory(
      { kind: "message", sender: "assistant", text: config.greeting },
      { kind: "message", sender: "customer", text: trimmed },
    );
    setDemo({
      ...emptySession,
      prompt: trimmed,
      serviceId: resolved.serviceId,
      bedrooms: resolved.bedrooms,
      bathrooms: resolved.bathrooms,
      fallbackBedrooms: resolved.bedrooms ?? 0,
      answers: inferred.answers,
      inferredQuestionIds: inferred.inferredQuestionIds,
      requestedDay: resolved.requestedDay ?? "",
    });
    setComposerValue("");
    setComposerError(hasUnsupportedBedrooms ? "Enter a bedroom count from 0 through 7." : "");
    setSelectedDate(suggestedDateForRequest(resolved.requestedDay, demoToday));
    setSelectedTime("");
    if (hasUnsupportedBedrooms) setStep("serviceDetails");
    else if (hasBedrooms && hasBathrooms) nextAfterServiceDetails(inferred.answers);
    else setStep("serviceDetails");
  };

  const advanceFromQuestion = (answers = demo.answers) => {
    setComposerValue("");
    setComposerError("");
    const nextQuestionIndex = nextUnansweredCustomQuestionIndex(currentQuestionIndex + 1, answers);
    if (nextQuestionIndex >= 0) setCurrentQuestionIndex(nextQuestionIndex);
    else setStep("schedule");
  };

  const submitCombinedServiceDetails = () => {
    const resolved = resolveDemoRequest(composerValue);
    if (resolved.bedrooms !== undefined && BOOKING_WIDGET_BEDROOM_BASE_PRICES[resolved.bedrooms] === undefined) {
      setComposerError("Enter a bedroom count from 0 through 7.");
      return;
    }
    const inferred = buildInferredQuestionAnswers(resolved, config.questions);
    const nextAnswers = { ...demo.answers, ...inferred.answers };
    const hasBedrooms = config.questions.every((question) => question.role !== "bedrooms" || (nextAnswers[question.id] ?? []).length > 0);
    const hasBathrooms = config.questions.every((question) => question.role !== "bathrooms" || (nextAnswers[question.id] ?? []).length > 0);
    if (!hasBedrooms || !hasBathrooms || resolved.bedrooms === undefined || resolved.bathrooms === undefined) {
      setComposerError("Enter both bedrooms and bathrooms, for example: 2 bed 2 bath.");
      return;
    }
    appendHistory(
      { kind: "message", sender: "assistant", text: config.combinedDetailsQuestion },
      { kind: "message", sender: "customer", text: composerValue.trim() },
    );
    setDemo((current) => ({
      ...current,
      serviceDetailsAnswer: composerValue.trim(),
      bedrooms: resolved.bedrooms,
      bathrooms: resolved.bathrooms,
      fallbackBedrooms: resolved.bedrooms,
      answers: nextAnswers,
      inferredQuestionIds: [...new Set([...current.inferredQuestionIds, ...inferred.inferredQuestionIds])],
    }));
    setComposerValue("");
    setComposerError("");
    nextAfterServiceDetails(nextAnswers);
  };

  const selectQuestionAnswer = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || !currentQuestion) return;
    if (currentQuestion.selectionMode === "multiple") {
      setDemo((current) => ({
        ...current,
        answers: {
          ...current.answers,
          [currentQuestion.id]: toggleMultiSelectChoice(current.answers[currentQuestion.id] ?? [], trimmed),
        },
      }));
      setComposerValue("");
      return;
    }
    const nextAnswers = { ...demo.answers, [currentQuestion.id]: [trimmed] };
    appendHistory(
      { kind: "message", sender: "assistant", text: currentQuestion.prompt },
      { kind: "message", sender: "customer", text: trimmed },
    );
    setDemo((current) => ({ ...current, answers: nextAnswers }));
    advanceFromQuestion(nextAnswers);
  };

  const selectExtrasAnswer = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || !extrasQuestion) return;
    const canonicalChoice = isNoSelectionChoice(trimmed)
      ? "Nothing extra"
      : findBookingWidgetPricedExtra(trimmed)?.label;
    if (!canonicalChoice) {
      setComposerError("Choose one of the priced extras shown above.");
      return;
    }
    if (extrasQuestion.selectionMode === "multiple") {
      setDemo((current) => {
        const nextSelected = toggleMultiSelectChoice(current.answers[extrasQuestion.id] ?? [], canonicalChoice);
        const selectedExtra = findBookingWidgetPricedExtra(canonicalChoice);
        const nextQuantities = { ...current.extraQuantities };
        if (isNoSelectionChoice(canonicalChoice)) {
          for (const key of Object.keys(nextQuantities)) delete nextQuantities[key];
        } else if (selectedExtra?.quantityUnit) {
          if (nextSelected.some((choice) => choice.toLowerCase() === canonicalChoice.toLowerCase())) nextQuantities[selectedExtra.id] ??= 1;
          else delete nextQuantities[selectedExtra.id];
        }
        return {
          ...current,
          answers: { ...current.answers, [extrasQuestion.id]: nextSelected },
          extraQuantities: nextQuantities,
        };
      });
      setComposerValue("");
      setComposerError("");
      return;
    }
    appendHistory(
      { kind: "message", sender: "assistant", text: extrasQuestion.prompt },
      { kind: "message", sender: "customer", text: canonicalChoice },
    );
    setDemo((current) => ({ ...current, answers: { ...current.answers, [extrasQuestion.id]: [canonicalChoice] } }));
    setComposerValue("");
    setComposerError("");
    setStep("fullName");
  };

  const continueMultipleQuestion = () => {
    if (!extrasQuestion || (demo.answers[extrasQuestion.id] ?? []).length === 0) return;
    appendHistory(
      { kind: "message", sender: "assistant", text: extrasQuestion.prompt },
      { kind: "message", sender: "customer", text: (demo.answers[extrasQuestion.id] ?? []).map((choice) => formatBookingWidgetExtraSelection(choice, demo.extraQuantities)).join(", ") },
    );
    setStep("fullName");
  };

  const updateExtraQuantity = (extraId: string, nextQuantity: number) => {
    setDemo((current) => ({
      ...current,
      extraQuantities: { ...current.extraQuantities, [extraId]: Math.max(1, Math.floor(nextQuantity)) },
    }));
  };

  const addItemizedExtra = (extraLabel: string) => {
    if (!extrasQuestion) return;
    const pricedExtra = findBookingWidgetPricedExtra(extraLabel);
    if (!pricedExtra) return;
    setDemo((current) => {
      const selected = (current.answers[extrasQuestion.id] ?? []).filter((choice) => !isNoSelectionChoice(choice));
      if (selected.some((choice) => choice.toLowerCase() === pricedExtra.label.toLowerCase())) return current;
      return {
        ...current,
        answers: { ...current.answers, [extrasQuestion.id]: [...selected, pricedExtra.label] },
        extraQuantities: pricedExtra.quantityUnit
          ? { ...current.extraQuantities, [pricedExtra.id]: 1 }
          : current.extraQuantities,
      };
    });
  };

  const removeItemizedExtra = (extraLabel: string) => {
    if (!extrasQuestion) return;
    const pricedExtra = findBookingWidgetPricedExtra(extraLabel);
    if (!pricedExtra) return;
    setDemo((current) => {
      const remaining = (current.answers[extrasQuestion.id] ?? []).filter((choice) => choice.toLowerCase() !== pricedExtra.label.toLowerCase() && !isNoSelectionChoice(choice));
      const nextQuantities = { ...current.extraQuantities };
      delete nextQuantities[pricedExtra.id];
      return {
        ...current,
        answers: { ...current.answers, [extrasQuestion.id]: remaining.length ? remaining : ["Nothing extra"] },
        extraQuantities: nextQuantities,
      };
    });
  };

  const addSpecialRequestNote = () => {
    const note = specialRequestDraft.trim();
    if (!note) return;
    setDemo((current) => ({ ...current, specialRequestNotes: [...current.specialRequestNotes, note] }));
    setSpecialRequestDraft("");
    setItemizationPanel("none");
  };

  const removeSpecialRequestNote = (index: number) => {
    setDemo((current) => ({ ...current, specialRequestNotes: current.specialRequestNotes.filter((_, noteIndex) => noteIndex !== index) }));
  };

  const updateItemizedBedrooms = (bedrooms: number) => {
    setDemo((current) => {
      const answers = { ...current.answers };
      for (const question of config.questions) {
        if (question.role === "bedrooms") answers[question.id] = [bedrooms === 0 ? "Studio" : `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`];
      }
      return { ...current, bedrooms, fallbackBedrooms: bedrooms, answers };
    });
  };

  const updateItemizedBathrooms = (bathrooms: number) => {
    const nextBathrooms = Math.max(0, Math.floor(bathrooms));
    setDemo((current) => {
      const answers = { ...current.answers };
      for (const question of config.questions) {
        if (question.role === "bathrooms") answers[question.id] = [`${nextBathrooms} bathroom${nextBathrooms === 1 ? "" : "s"}`];
      }
      return { ...current, bathrooms: nextBathrooms, answers };
    });
  };

  const continueCustomQuestion = () => {
    if (!currentQuestion || currentQuestion.role !== "custom" || currentQuestion.selectionMode !== "multiple") return;
    if ((demo.answers[currentQuestion.id] ?? []).length === 0) return;
    appendHistory(
      { kind: "message", sender: "assistant", text: currentQuestion.prompt },
      { kind: "message", sender: "customer", text: (demo.answers[currentQuestion.id] ?? []).join(", ") },
    );
    advanceFromQuestion();
  };

  const submitIntakeField = async (field: BookingWidgetIntakeField, nextStep: DemoStep) => {
    const trimmed = composerValue.trim();
    const error = validateBookingWidgetIntakeField(field, trimmed);
    if (error) {
      setComposerError(error);
      return;
    }
    try {
      if (field === "email" && mode === "live") await persistFunnelPatch({ customerEmail: trimmed });
    } catch (updateError) {
      setComposerError(updateError instanceof Error ? updateError.message : "We could not save your email. Please try again.");
      return;
    }
    const questionText = field === "fullName" ? config.fullNameQuestion : field === "email" ? config.emailQuestion : "";
    if (questionText) {
      appendHistory(
        { kind: "message", sender: "assistant", text: questionText },
        { kind: "message", sender: "customer", text: trimmed },
      );
    }
    setDemo((current) => ({ ...current, [field]: trimmed }));
    setComposerValue("");
    setComposerError("");
    setStep(nextStep);
  };

  const submitAddress = async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    try {
      if (mode === "live") await persistFunnelPatch({ address: trimmed });
    } catch (updateError) {
      setComposerError(updateError instanceof Error ? updateError.message : "We could not save your address. Please try again.");
      return;
    }
    appendHistory(
      { kind: "message", sender: "assistant", text: config.addressQuestion },
      { kind: "proof" },
      { kind: "message", sender: "customer", text: trimmed },
      { kind: "message", sender: "assistant", text: config.availabilityCheckMessage },
    );
    setDemo((current) => ({ ...current, address: trimmed }));
    setComposerValue("");
    setComposerError("");
    setStep("quote");
  };

  const submitPhone = async () => {
    const trimmed = composerValue.trim();
    const error = validateBookingWidgetIntakeField("phone", trimmed);
    if (error) {
      setComposerError(error);
      return;
    }
    if (mode === "live") {
      if (phoneCaptureInFlightRef.current) return;
      phoneCaptureInFlightRef.current = true;
      try {
        const begun = await beginFunnelMutation.mutateAsync({
          idempotencyKey: bookingAttemptIdRef.current,
          source: surface === "popup" ? "widget-popup" : "book-page",
          customerName: demo.fullName,
          customerPhone: trimmed,
        });
        rememberFunnelRecord(begun);
        await persistFunnelPatch({
          serviceId: demo.serviceId,
          serviceName: service.name,
          bedrooms: bedroomCount ?? 0,
          bathrooms: bathroomCount ?? 0,
          extras: itemizedExtras.map(({ pricedExtra, quantity }) => ({ id: pricedExtra.id, quantity })),
          specialRequestNotes: demo.specialRequestNotes,
          requestedLocalDate: selectedDate ? formatLocalDate(selectedDate) : null,
          requestedLocalTime: selectedTime ? timeLabelTo24Hour(selectedTime) : null,
          requestedTimeZone: "America/New_York",
          recurrence: demo.recurringFrequency,
          pricingVersion: NATIVE_BOOKING_PRICING_VERSION,
          firstCleaningTotalCents: Math.round(Number(quotePrice) * 100),
          futureVisitTotalCents: recurringFutureVisitPrice === null ? null : Math.round(recurringFutureVisitPrice * 100),
          priceSnapshot: priceBreakdown,
        });
      } catch (captureError) {
        setComposerError(captureError instanceof Error ? captureError.message : "We could not save your phone number. Please try again.");
        return;
      } finally {
        phoneCaptureInFlightRef.current = false;
      }
    }
    appendHistory(
      { kind: "message", sender: "assistant", text: renderBookingWidgetTemplate(config.phoneQuestionTemplate, { firstName: firstNameFromFullName(demo.fullName) }) },
      { kind: "message", sender: "customer", text: trimmed },
      { kind: "privacy" },
    );
    setDemo((current) => ({ ...current, phone: trimmed, leadCaptured: true }));
    setComposerValue("");
    setComposerError("");
    setStep("email");
  };

  const confirmScheduleSelection = () => {
    if (!selectedDate || !selectedTime) return;
    const schedule = formatDemoScheduleSelection(selectedDate, selectedTime);
    appendHistory(
      { kind: "message", sender: "assistant", text: formatScheduleQuestion(config, demo.requestedDay) },
      { kind: "message", sender: "customer", text: schedule },
    );
    setDemo((current) => ({ ...current, schedule, requestedDay: schedule.split(" · ")[0] }));
    setComposerValue("");
    setComposerError("");
    setStep("extras");
  };

  const submitComposer = () => {
    const question = composerValue.trim();
    if (question && looksLikeBookingQuestion(question)) {
      setComposerError("");
      appendHistory({ kind: "message", sender: "customer", text: question });
      setComposerValue("");
      void bookingFaqMutation.mutateAsync({ question })
        .then((result) => appendHistory({ kind: "message", sender: "assistant", text: result.answer }))
        .catch(() => appendHistory({ kind: "message", sender: "assistant", text: "I’m not completely sure about that. I can have the team help." }));
      return;
    }
    if (step === "request") return selectRequest(composerValue);
    if (step === "serviceDetails") return submitCombinedServiceDetails();
    if (step === "questions") return selectQuestionAnswer(composerValue);
    if (step === "extras") return selectExtrasAnswer(composerValue);
    if (step === "fullName") return void submitIntakeField("fullName", "phone");
    if (step === "phone") return void submitPhone();
    if (step === "email") return void submitIntakeField("email", "address");
    if (step === "address") return void submitAddress(composerValue);
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(serialized);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const resetToReference = () => {
    setConfig(structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT));
    setSaved(false);
    startOver();
  };

  const closePopup = () => {
    if (surface !== "popup" || window.parent === window) return;
    window.parent.postMessage({ type: "mib-booking-widget-close" }, "*");
  };

  const composerPlaceholder = step === "serviceDetails"
    ? config.combinedDetailsPlaceholder
    : step === "fullName"
    ? config.fullNamePlaceholder
    : step === "phone"
      ? config.phonePlaceholder
      : step === "email"
        ? config.emailPlaceholder
        : step === "schedule"
          ? "Choose a date and time above"
          : step === "address"
            ? config.addressPlaceholder
            : config.inputPlaceholder;
  const funnelMutationPending = mode === "live" && (beginFunnelMutation.isPending || updateFunnelMutation.isPending || reserveFunnelMutation.isPending);
  const composerEnabled = ["request", "serviceDetails", "questions", "extras", "fullName", "phone", "email", "address"].includes(step) && !funnelMutationPending && !bookingFaqMutation.isPending;
  const colorValue = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const roomSummary = detailLine.split(" · ").slice(0, 2).join(" · ");
  const showSummary = !["request", "serviceDetails", "questions"].includes(step);
  const openCheckout = () => {
    setItemizationPanel("none");
    setSpecialRequestDraft("");
    setStep("confirm");
  };
  const submitLiveBooking = async (
    pricing = { version: NATIVE_BOOKING_PRICING_VERSION, totalCents: Math.round(Number(quotePrice) * 100) },
  ) => {
    if (mode !== "live" || !funnelRecord || !selectedDate || !selectedTime || !priceBreakdown) return;
    setComposerError("");
    try {
      const current = funnelRecordRef.current;
      if (!current) throw new Error("Lead record is unavailable. Start over and try again.");
      const result = await reserveFunnelMutation.mutateAsync({
        publicFunnelNumber: current.publicFunnelNumber,
        mutationToken: current.mutationToken,
        expectedVersion: current.version,
        patch: {
          customerEmail: demo.email,
          serviceId: demo.serviceId,
          serviceName: service.name,
          bedrooms: bedroomCount ?? 0,
          bathrooms: bathroomCount ?? 0,
          extras: itemizedExtras.map(({ pricedExtra, quantity }) => ({ id: pricedExtra.id, quantity })),
          specialRequestNotes: demo.specialRequestNotes,
          address: demo.address,
          requestedLocalDate: formatLocalDate(selectedDate),
          requestedLocalTime: timeLabelTo24Hour(selectedTime),
          requestedTimeZone: "America/New_York",
          recurrence: demo.recurringFrequency,
          pricingVersion: pricing.version,
          firstCleaningTotalCents: pricing.totalCents,
          futureVisitTotalCents: recurringFutureVisitPrice === null ? null : Math.round(recurringFutureVisitPrice * 100),
          priceSnapshot: priceBreakdown,
        },
      });
      rememberFunnelRecord(result);
      setAcceptedPricing(pricing);
      setPriceChange(null);
      setPreparedBooking({
        type: "prepared",
        publicBookingNumber: result.publicFunnelNumber,
        status: "needs_attention",
        created: result.created,
        replayed: !result.created,
        summary: {
          customerName: demo.fullName,
          serviceName: service.name,
          homeSummary: roomItemizationLabel,
          address: demo.address,
          requestedLocalDate: formatLocalDate(selectedDate),
          requestedLocalTime: timeLabelTo24Hour(selectedTime),
          requestedTimeZone: "America/New_York",
          totalCents: pricing.totalCents,
          recurrence: demo.recurringFrequency,
          futureVisitTotalCents: recurringFutureVisitPrice === null ? null : Math.round(recurringFutureVisitPrice * 100),
        },
      });
      setStep("payment");
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "We could not submit your request. Please try again.");
    }
  };
  const acceptChangedPrice = () => {
    if (!priceChange) return;
    const accepted = { version: priceChange.pricingVersion, totalCents: priceChange.totalCents };
    setAcceptedPricing(accepted);
    void submitLiveBooking(accepted);
  };
  const completeCheckout = () => {
    if (mode === "editor") setStep("complete");
  };
  const openWelcomeVideo = () => {
    welcomeVideoReturnFocusRef.current = "trigger";
    setWelcomeVideoOpen(true);
  };
  const closeWelcomeVideo = () => {
    welcomeVideoReturnFocusRef.current = "trigger";
    setWelcomeVideoOpen(false);
  };
  const startBookingFromWelcomeVideo = () => {
    welcomeVideoReturnFocusRef.current = "prompt";
    setWelcomeVideoOpen(false);
  };

  const activeStage = (() => {
    if (step === "request") {
      return (
        <div className="flex flex-col gap-4">
          <DemoBubble>
            <p>Before we get started, here&apos;s a quick hello from our team 👋</p>
            <button
              ref={welcomeVideoTriggerRef}
              type="button"
              aria-haspopup="dialog"
              aria-label="Play Madison's 20-second welcome video"
              onClick={openWelcomeVideo}
              className="group relative mt-3 h-[146px] w-full overflow-hidden rounded-[14px] bg-[#151515] text-left text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#ff684c] focus:ring-offset-2"
            >
              <img src={WELCOME_VIDEO_POSTER_URL} width={960} height={540} alt="Maids in Black welcome video" className="h-full w-full object-cover object-[center_38%] transition duration-300 group-hover:scale-[1.025]" />
              <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.74),rgba(0,0,0,0.12)),linear-gradient(0deg,rgba(0,0,0,0.35),transparent_60%)]" />
              <span className="absolute left-4 top-4 grid h-[42px] w-[42px] place-items-center rounded-full bg-[#ff684c] shadow-[0_7px_22px_rgba(0,0,0,0.22)]"><Play className="ml-0.5 h-[19px] w-[19px] fill-current" /></span>
              <span className="absolute bottom-[15px] left-4 grid gap-[3px]"><strong className="text-[14px]">Meet Maids in Black</strong><small className="text-[10px] text-white/80">Watch our 20-second welcome</small></span>
              <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/70 px-[7px] py-1 text-[9px] font-bold">0:20</span>
            </button>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[8px] font-bold text-[#7b7d82]"><span>About 60 seconds to book</span><i className="h-[3px] w-[3px] rounded-full bg-[#ff684c]" /><span>Instant pricing</span><i className="h-[3px] w-[3px] rounded-full bg-[#ff684c]" /><span>No phone call</span></div>
          </DemoBubble>
          <DemoBubble>{config.greeting}</DemoBubble>
          <div className="ml-10 flex flex-wrap gap-2">{config.quickPrompts.map((prompt, index) => <DemoChip key={prompt} buttonRef={index === 0 ? openingPromptRef : undefined} onClick={() => selectRequest(prompt)}>{prompt}</DemoChip>)}</div>
        </div>
      );
    }
    if (step === "serviceDetails") return <DemoBubble>{config.combinedDetailsQuestion}</DemoBubble>;
    if (step === "questions" && currentQuestion) {
      const answer = demo.answers[currentQuestion.id] ?? [];
      return (
        <div className="flex flex-col gap-4">
          <DemoBubble>{currentQuestion.prompt}</DemoBubble>
          <div className="ml-10 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">{currentQuestion.choices.map((choice) => <DemoChip key={choice} onClick={() => selectQuestionAnswer(choice)} selected={currentQuestion.selectionMode === "multiple" && answer.some((item) => item.toLowerCase() === choice.trim().toLowerCase())} color={config.customerBubbleColor}>{choice}</DemoChip>)}</div>
            {currentQuestion.selectionMode === "multiple" && <button type="button" onClick={continueCustomQuestion} disabled={answer.length === 0} className="w-fit rounded-xl bg-[#ff684c] px-5 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:opacity-45">Continue</button>}
          </div>
        </div>
      );
    }
    if (step === "schedule") {
      return (
        <div className="flex flex-col gap-4">
          <DemoBubble>{formatScheduleQuestion(config, demo.requestedDay)}</DemoBubble>
          <div className="ml-10 max-w-[82%] rounded-[20px] border border-[#e4e5e7] bg-white p-4 shadow-[0_12px_32px_rgba(22,20,33,0.07)] sm:p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(180px,0.85fr)] md:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12px] font-extrabold text-[#3a3c41]"><CalendarDays className="h-4 w-4 text-[#ff684c]" /> Choose a date</div>
                <Calendar mode="single" selected={selectedDate} onSelect={(date) => { setSelectedDate(date); setSelectedTime(""); }} defaultMonth={selectedDate ?? demoToday} startMonth={demoToday} endMonth={demoCalendarEnd} disabled={{ before: demoToday }} className="mx-auto mt-2 bg-transparent p-0 [--cell-size:2.15rem]" classNames={{ caption_label: "text-[12px] font-extrabold text-[#3a3c41]", button_previous: "size-(--cell-size) rounded-lg border border-[#e4e5e7] bg-white p-0 text-[#3a3c41] hover:bg-[#fff1ed]", button_next: "size-(--cell-size) rounded-lg border border-[#e4e5e7] bg-white p-0 text-[#3a3c41] hover:bg-[#fff1ed]", weekday: "flex-1 text-[10px] font-bold text-[#9a9ba5]", today: "rounded-lg bg-[#fff1ed] text-[#e9573e]" }} />
              </div>
              <div className="border-t border-[#e4e5e7] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                <div className="flex items-center gap-2 text-[12px] font-extrabold text-[#3a3c41]"><Clock className="h-4 w-4 text-[#ff684c]" /> {mode === "live" ? "Requested times" : "Available times"} {mode === "editor" && <span className="font-normal text-[#9a9ba5]">(demo)</span>}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-1">{DEMO_TIME_SLOTS.map((time) => <button key={time} type="button" aria-pressed={selectedTime === time} onClick={() => setSelectedTime(time)} className={`rounded-xl border px-3 py-2.5 text-[12px] font-bold transition ${selectedTime === time ? "border-[#ff684c] bg-[#ff684c] text-white shadow-sm" : "border-[#ffd2c8] bg-[#fff8f6] text-[#d95740] hover:border-[#ff9c89]"}`}>{time}</button>)}</div>
                <div className="mt-4 rounded-xl bg-[#f5f5f3] px-3 py-2.5 text-[12px] text-[#6f7279]">{selectedDate ? selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" }) : "Select a date"}{selectedTime ? ` · ${selectedTime}` : " · Select a time"}</div>
                <button type="button" onClick={confirmScheduleSelection} disabled={!selectedDate || !selectedTime} className="mt-3 w-full rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-bold text-white shadow-sm transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:bg-[#ececef] disabled:text-[#a6a7af]">Continue →</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (step === "extras" && extrasQuestion) {
      const answer = demo.answers[extrasQuestion.id] ?? [];
      return (
        <div className="flex flex-col gap-4">
          <DemoBubble>{extrasQuestion.prompt}</DemoBubble>
          <div className="ml-10 flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">{extrasQuestion.choices.map((choice) => {
              const pricedExtra = findBookingWidgetPricedExtra(choice);
              const selected = answer.some((item) => item.toLowerCase() === choice.trim().toLowerCase());
              const quantity = pricedExtra?.quantityUnit ? demo.extraQuantities[pricedExtra.id] ?? 1 : undefined;
              const unitSuffix = pricedExtra?.quantityUnit ? `/${pricedExtra.quantityUnit}` : "";
              return (
                <div key={choice} className="flex flex-col items-start gap-1.5">
                  <DemoChip onClick={() => selectExtrasAnswer(choice)} selected={selected} color={config.customerBubbleColor}>
                    {pricedExtra ? `${pricedExtra.label} · $${pricedExtra.unitPrice}${unitSuffix}` : choice}
                  </DemoChip>
                  {selected && pricedExtra?.quantityUnit && (
                    <div className="flex items-center gap-2 rounded-full border border-[#ffd2c8] bg-white px-2 py-1 shadow-sm">
                      <button type="button" aria-label={`Decrease ${pricedExtra.label} quantity`} onClick={() => updateExtraQuantity(pricedExtra.id, (quantity ?? 1) - 1)} disabled={quantity === 1} className="grid h-6 w-6 place-items-center rounded-full text-sm font-bold text-[#d95740] transition hover:bg-[#fff1ed] disabled:cursor-not-allowed disabled:opacity-35">−</button>
                      <span className="min-w-[76px] text-center text-[10px] font-bold text-[#5f6168]">{quantity} {quantity === 1 ? pricedExtra.quantityUnit : `${pricedExtra.quantityUnit}s`}</span>
                      <button type="button" aria-label={`Increase ${pricedExtra.label} quantity`} onClick={() => updateExtraQuantity(pricedExtra.id, (quantity ?? 1) + 1)} className="grid h-6 w-6 place-items-center rounded-full text-sm font-bold text-[#d95740] transition hover:bg-[#fff1ed]">+</button>
                    </div>
                  )}
                </div>
              );
            })}</div>
            {extrasQuestion.selectionMode === "multiple" && <button type="button" onClick={continueMultipleQuestion} disabled={answer.length === 0} className="w-fit rounded-xl bg-[#ff684c] px-5 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#e9573e] disabled:cursor-not-allowed disabled:opacity-45">Continue</button>}
          </div>
        </div>
      );
    }
    if (step === "fullName") return <DemoBubble>{config.fullNameQuestion}</DemoBubble>;
    if (step === "phone") return <DemoBubble>{renderBookingWidgetTemplate(config.phoneQuestionTemplate, { firstName: firstNameFromFullName(demo.fullName) })}</DemoBubble>;
    if (step === "email") return <DemoBubble>{config.emailQuestion}</DemoBubble>;
    if (step === "address") {
      return <div className="flex flex-col gap-4"><DemoBubble>{config.addressQuestion}</DemoBubble><DemoHistoryRow entry={{ id: -1, kind: "proof" }} customerColor={config.customerBubbleColor} trustPoints={config.resultTrustPoints} /></div>;
    }
    if (step === "checking") return <DemoBubble>{config.availabilityCheckMessage}</DemoBubble>;
    if (step === "quote") {
      return (
        <div className="ml-10 max-w-[82%] rounded-[20px] border border-[#dcd5ef] bg-gradient-to-br from-white to-[#fffaf8] p-4 shadow-[0_14px_36px_rgba(77,54,139,0.09)]">
          <div className="flex items-center gap-3 border-b border-[#e4e5e7] pb-4"><span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#e7fbf2] text-[#168d61]"><Check className="h-5 w-5" /></span><div><small className="text-[9px] font-extrabold tracking-[0.1em] text-[#77798b]">{mode === "live" ? "REQUEST REVIEW" : config.openingEyebrow}</small><h2 className="mt-1 text-[18px] font-extrabold text-[#3a3c41]">{mode === "live" ? "Your request summary" : config.resultTitle}</h2></div></div>
          <div className="flex items-center border-b border-[#e4e5e7] py-3"><CalendarDays className="mr-2.5 h-5 w-5 shrink-0 text-[#ff684c]" /><span className="grid"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">{mode === "live" ? "REQUESTED DATE & TIME" : "DATE & TIME"}</small><strong className="text-[11px] text-[#3a3c41]">{demo.schedule || `${service.availabilityDay} · ${service.availabilityTime}`}</strong></span></div>
          <div className="flex items-center justify-between border-b border-[#e4e5e7] py-3"><div className="flex min-w-0 items-center"><MapPin className="mr-2.5 h-5 w-5 shrink-0 text-[#ff684c]" /><span className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">ADDRESS</small><strong className="truncate text-[11px] text-[#3a3c41]">{demo.address}</strong></span></div><Check className="h-4 w-4 shrink-0 text-[#23b982]" /></div>
          <section aria-label="Recurring cleaning frequency" className="border-b border-[#e4e5e7] py-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#77798b]">Save on future cleanings</div><h3 className="mt-1 text-[15px] font-extrabold text-[#3a3c41]">Would you like to make it recurring?</h3></div><span className="rounded-full bg-[#fff1ed] px-2.5 py-1 text-[9px] font-extrabold text-[#e9573e]">First clean stays ${quotePrice}</span></div>
            <div className="mt-2.5 grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-3">{BOOKING_WIDGET_RECURRING_OPTIONS.map((option) => {
              const futurePrice = priceBreakdown ? calculateBookingWidgetRecurringPrice(priceBreakdown.total, option.id) : null;
              const selected = demo.recurringFrequency === option.id;
              return (
                <button key={option.id} type="button" aria-pressed={selected} onClick={() => setDemo((current) => ({ ...current, recurringFrequency: option.id }))} className={`relative rounded-lg border px-1.5 py-1.5 text-center transition focus:outline-none focus:ring-2 focus:ring-[#ff684c]/35 ${selected ? "border-[#ff684c] bg-[#fff8f6] shadow-sm" : "border-[#dfe0e4] bg-white hover:border-[#ff9c89]"}`}>
                  {option.badge && <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#3a3c41] px-1.5 py-0.5 text-[5.5px] font-extrabold tracking-wide text-white">{option.badge}</span>}
                  <span className="block text-[9px] font-extrabold text-[#3a3c41]">{option.label}</span><strong className="mt-0.5 block text-[13px] text-[#3a3c41]">{formatItemizedCurrency(futurePrice ?? 0)}<small className="text-[7px] font-medium text-[#77798b]">/visit</small></strong><span className="mt-0.5 block text-[7px] font-extrabold text-[#168d61]">Save {option.discountPercent}%</span>
                </button>
              );
            })}</div>
            <p className="mt-3 text-[10px] leading-5 text-[#6f7279]">Your first cleaning remains full price. Savings begin with visit two.</p>
            <button type="button" aria-pressed={demo.recurringFrequency === "one-time"} onClick={() => setDemo((current) => ({ ...current, recurringFrequency: "one-time" }))} className={`mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[10px] font-bold transition ${demo.recurringFrequency === "one-time" ? "bg-[#eef9f4] text-[#276b53]" : "bg-[#f5f5f3] text-[#5f6168] hover:bg-[#efefec]"}`}><CheckCircle2 className="h-4 w-4 shrink-0" />No thanks, keep this as a one-time cleaning</button>
          </section>
          <section aria-label="Editable itemized cleaning order" className="border-b border-[#e4e5e7] py-4">
            <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#77798b]">Your cleaning</div>
            <div className="mt-3 divide-y divide-[#ececef] rounded-xl border border-[#e4e5e7] bg-white px-3">
              <div className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0"><div className="text-[12px] font-extrabold text-[#3a3c41]">{service.name} · {roomItemizationLabel}</div><div className="mt-1 text-[9px] text-[#77798b]">Bedroom tier {formatItemizedCurrency(priceBreakdown?.bedroomBasePrice ?? 0)} · Bathrooms {formatItemizedCurrency(priceBreakdown?.bathroomTotal ?? 0)}</div></div>
                <div className="shrink-0 text-right"><div className="text-[12px] font-extrabold text-[#3a3c41]">{formatItemizedCurrency(priceBreakdown?.baseCleaningTotal ?? 0)}</div><button type="button" onClick={() => setItemizationPanel((panel) => panel === "base" ? "none" : "base")} className="mt-1 text-[10px] font-bold text-[#e9573e]">{itemizationPanel === "base" ? "Close" : "Change"}</button></div>
              </div>
              {itemizationPanel === "base" && (
                <div className="grid gap-3 py-3 sm:grid-cols-3">
                  <label className="grid gap-1 text-[9px] font-bold text-[#6f7279]">Service<select value={demo.serviceId} onChange={(event) => setDemo((current) => ({ ...current, serviceId: event.target.value as BookingWidgetServiceId }))} className="h-9 rounded-lg border border-[#d7d8dc] bg-white px-2 text-[11px] text-[#3a3c41]">{config.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label className="grid gap-1 text-[9px] font-bold text-[#6f7279]">Bedrooms<select value={bedroomCount ?? 0} onChange={(event) => updateItemizedBedrooms(Number(event.target.value))} className="h-9 rounded-lg border border-[#d7d8dc] bg-white px-2 text-[11px] text-[#3a3c41]">{Object.keys(BOOKING_WIDGET_BEDROOM_BASE_PRICES).map((value) => <option key={value} value={value}>{Number(value) === 0 ? "Studio" : value}</option>)}</select></label>
                  <label className="grid gap-1 text-[9px] font-bold text-[#6f7279]">Bathrooms<input type="number" min={0} step={1} value={bathroomCount ?? 0} onChange={(event) => updateItemizedBathrooms(Number(event.target.value))} className="h-9 rounded-lg border border-[#d7d8dc] bg-white px-2 text-[11px] text-[#3a3c41]" /></label>
                </div>
              )}
              {itemizedExtras.map(({ pricedExtra, quantity, amount }) => (
                <div key={pricedExtra.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0"><div className="text-[11px] font-bold text-[#3a3c41]">{pricedExtra.label}</div>{pricedExtra.quantityUnit && <div className="mt-1 text-[9px] text-[#77798b]">{quantity} × {formatItemizedCurrency(pricedExtra.unitPrice)} per {pricedExtra.quantityUnit}</div>}</div>
                  <div className="shrink-0 text-right"><div className="text-[11px] font-extrabold text-[#3a3c41]">+{formatItemizedCurrency(amount)}</div><div className="mt-1 flex items-center justify-end gap-1.5">{pricedExtra.quantityUnit && <><button type="button" aria-label={`Decrease ${pricedExtra.label} itemized quantity`} onClick={() => updateExtraQuantity(pricedExtra.id, quantity - 1)} disabled={quantity === 1} className="grid h-6 w-6 place-items-center rounded-full border border-[#ffd2c8] text-[11px] font-bold text-[#d95740] disabled:opacity-35">−</button><span className="min-w-5 text-center text-[10px] font-bold text-[#5f6168]">{quantity}</span><button type="button" aria-label={`Increase ${pricedExtra.label} itemized quantity`} onClick={() => updateExtraQuantity(pricedExtra.id, quantity + 1)} className="grid h-6 w-6 place-items-center rounded-full border border-[#ffd2c8] text-[11px] font-bold text-[#d95740]">+</button></>}<button type="button" onClick={() => removeItemizedExtra(pricedExtra.label)} className="ml-1 text-[9px] font-bold text-[#e9573e]">Remove</button></div></div>
                </div>
              ))}
              {demo.specialRequestNotes.map((note, index) => (
                <div key={`${note}-${index}`} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><div className="text-[11px] font-bold text-[#3a3c41]">{note}</div><span className="mt-1 inline-flex rounded-full bg-[#fff4da] px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.08em] text-[#9b6815]">Needs review</span></div><button type="button" onClick={() => removeSpecialRequestNote(index)} className="shrink-0 text-[9px] font-bold text-[#e9573e]">Remove</button></div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold text-[#3a3c41]"><button type="button" onClick={() => setItemizationPanel((panel) => panel === "extras" ? "none" : "extras")}>+ Add another extra</button><button type="button" onClick={() => setItemizationPanel((panel) => panel === "note" ? "none" : "note")}>+ Add a special request</button></div>
            {itemizationPanel === "extras" && <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-[#f5f5f3] p-3">{unselectedPricedExtras.length ? unselectedPricedExtras.map((extra) => <button key={extra.id} type="button" onClick={() => addItemizedExtra(extra.label)} className="rounded-full border border-[#ffd2c8] bg-white px-3 py-2 text-[10px] font-bold text-[#d95740]">{extra.label} · {formatItemizedCurrency(extra.unitPrice)}{extra.quantityUnit ? `/${extra.quantityUnit}` : ""}</button>) : <span className="text-[10px] text-[#77798b]">All priced extras are already selected.</span>}</div>}
            {itemizationPanel === "note" && <div className="mt-3 rounded-xl bg-[#f5f5f3] p-3"><label className="grid gap-1 text-[9px] font-bold text-[#6f7279]">Special request note<textarea value={specialRequestDraft} onChange={(event) => setSpecialRequestDraft(event.target.value)} placeholder="Tell us what you need..." className="min-h-20 rounded-lg border border-[#d7d8dc] bg-white p-2.5 text-[11px] text-[#3a3c41]" /></label><div className="mt-2 flex gap-2"><button type="button" onClick={addSpecialRequestNote} disabled={!specialRequestDraft.trim()} className="rounded-lg bg-[#ff684c] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40">Add note</button><button type="button" onClick={() => { setSpecialRequestDraft(""); setItemizationPanel("none"); }} className="rounded-lg border border-[#d7d8dc] bg-white px-3 py-2 text-[10px] font-bold text-[#5f6168]">Cancel</button></div></div>}
          </section>
          <div className="space-y-1.5 border-t border-[#e4e5e7] py-3 text-[10px] text-[#5f6168]"><div className="flex justify-between gap-4"><span>Standard subtotal</span><strong>{formatItemizedCurrency(priceBreakdown?.standardSubtotal ?? 0)}</strong></div>{(priceBreakdown?.serviceAdjustment ?? 0) > 0 && <><div className="flex justify-between gap-4"><span>{service.name} adjustment · 20%</span><strong>+{formatItemizedCurrency(priceBreakdown?.serviceAdjustment ?? 0)}</strong></div><div className="flex justify-between gap-4"><span>Adjusted subtotal</span><strong>{formatItemizedCurrency(priceBreakdown?.adjustedSubtotal ?? 0)}</strong></div></>}<div className="mt-2 flex items-center justify-between border-t border-[#e4e5e7] pt-3 text-[12px]"><span>Total</span><strong className="text-[22px] text-[#3a3c41]">${quotePrice}</strong></div></div>
          {priceChange && mode === "live" && <div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900"><strong className="block text-[11px]">Your price changed to ${(priceChange.totalCents / 100).toFixed(0)}</strong>Review and accept the updated server-calculated total before sending your request.<button type="button" onClick={acceptChangedPrice} disabled={funnelMutationPending} className="mt-2 w-full rounded-lg bg-amber-700 px-3 py-2 font-bold text-white disabled:opacity-50">Accept updated price &amp; send request</button></div>}
          <button type="button" onClick={mode === "live" ? () => void submitLiveBooking() : openCheckout} disabled={funnelMutationPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-bold text-white transition hover:bg-[#e9573e] disabled:cursor-wait disabled:opacity-60">{mode === "editor" && <CreditCard className="h-4 w-4" />}{funnelMutationPending ? "Saving reservation…" : mode === "live" ? `Book for $${quotePrice}` : formatBookingButtonLabel(config.bookingButtonLabel, quotePrice)}<ArrowRight className="h-4 w-4" /></button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[9px] text-[#77798b]"><ShieldCheck className="h-3.5 w-3.5" />{mode === "live" ? "Secure card entry is next · no charge today" : "Visual demo only · no charge will be made"}</p>
        </div>
      );
    }
    if (step === "confirm" && mode === "editor") {
      return (
        <div ref={checkoutRef} tabIndex={-1} aria-label="Demo checkout" className="ml-10 max-w-[82%] overflow-hidden rounded-[20px] border border-[#e4e5e7] bg-white shadow-[0_14px_36px_rgba(22,20,33,0.08)] outline-none focus:ring-2 focus:ring-[#ff684c]/30">
          <div className="border-b border-[#e4e5e7] bg-gradient-to-br from-white to-[#fff5f2] p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-[20px] font-extrabold text-[#3a3c41]">{renderBookingWidgetTemplate(config.paymentConfirmationTemplate, { cardBrand: config.demoCardBrand, last4: config.demoCardLast4 })}</div><div className="mt-1 text-[11px] text-[#6f7279]">Review your cleaning, then preview payment.</div></div><span className="rounded-full border border-[#ffd2c8] bg-[#fff8f6] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#e9573e]">Demo checkout</span></div><div className="mt-4 space-y-3 rounded-xl border border-[#e4e5e7] bg-white p-4 text-[11px]"><div><div className="font-extrabold text-[#3a3c41]">{demo.schedule || `${service.availabilityDay} · ${service.availabilityTime}`}</div><div className="mt-1 text-[#6f7279]">{service.name} · {detailLine}</div></div><div className="border-t border-[#e4e5e7] pt-3 text-[#6f7279]">{demo.address}</div>{selectedRecurringOption && recurringFutureVisitPrice !== null && <div className="flex items-start justify-between gap-4 border-t border-[#e4e5e7] pt-3"><span className="text-[#6f7279]">Then {selectedRecurringOption.label.toLowerCase()} beginning with visit two</span><strong className="shrink-0 text-[#3a3c41]">{formatItemizedCurrency(recurringFutureVisitPrice)}/visit</strong></div>}<div className="flex items-center justify-between border-t border-[#e4e5e7] pt-3"><span className="font-medium text-[#6f7279]">First cleaning total</span><strong className="text-[19px] text-[#3a3c41]">${quotePrice}</strong></div></div></div>
          <div className="p-5"><div className="flex items-center justify-between gap-3"><div className="text-[13px] font-extrabold text-[#3a3c41]">Payment</div><div className="flex items-center gap-1.5 text-[10px] font-bold text-[#6f7279]"><Lock className="h-3.5 w-3.5" /> Stripe-style payment preview</div></div><p className="mt-1 text-[10px] text-[#b46a29]">Mock fields only. Do not enter real card information.</p><div className="mt-3 flex items-start gap-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-white text-[#168d61] shadow-sm"><ShieldCheck className="h-4 w-4" /></span><p className="text-[10px] leading-5 text-[#41695a]">Add a card to reserve your cleaning. You won’t be charged until after service. Your payment information is securely handled by Stripe and is never stored on our servers.</p></div><div className="mt-4 overflow-hidden rounded-xl border border-[#d7d8dc] bg-white shadow-sm"><div role="textbox" aria-readonly="true" aria-label="Demo card number" tabIndex={0} className="border-b border-[#e4e5e7] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">Card number</div><div className="mt-1 flex items-center justify-between gap-3 font-mono text-[12px] tracking-wide"><span>4242 4242 4242 4242</span><span className="flex items-center gap-1.5 font-sans text-[10px] font-extrabold uppercase text-[#e9573e]"><CreditCard className="h-4 w-4" /> {config.demoCardBrand}</span></div></div><div className="grid grid-cols-2"><div role="textbox" aria-readonly="true" aria-label="Demo card expiry" tabIndex={0} className="px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">MM / YY</div><div className="mt-1 font-mono text-[12px]">12 / 34</div></div><div role="textbox" aria-readonly="true" aria-label="Demo card security code" tabIndex={0} className="border-l border-[#e4e5e7] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">CVC</div><div className="mt-1 flex items-center justify-between font-mono text-[12px]"><span>123</span><Lock className="h-3.5 w-3.5 text-[#9a9ba5]" /></div></div></div></div><div role="textbox" aria-readonly="true" aria-label="Demo name on card" tabIndex={0} className="mt-3 rounded-xl border border-[#d7d8dc] bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">Name on card</div><div className="mt-1 text-[12px]">{demo.fullName}</div></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#f5f5f3] p-3 text-[11px] text-[#5f6168]"><input type="checkbox" checked={savePaymentDetails} onChange={(event) => setSavePaymentDetails(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#d7d8dc] accent-[#ff684c]" /><span>Save my payment details for faster bookings next time <span className="text-[9px] text-[#9a9ba5]">(demo only)</span></span></label><p className="mt-4 text-[10px] leading-5 text-[#6f7279]">{config.demoPaymentNotice}</p><button type="button" onClick={completeCheckout} className="mt-4 w-full rounded-xl bg-[#ff684c] px-4 py-3.5 text-[12px] font-bold text-white transition hover:bg-[#e9573e]">{formatBookingButtonLabel(config.confirmButtonLabel, quotePrice)}</button></div>
        </div>
      );
    }
    if (step === "payment" && mode === "live" && funnelRecord) {
      return <div className="flex flex-col gap-4"><DemoBubble customer color={config.customerBubbleColor}>Book for ${quotePrice}</DemoBubble><div ref={checkoutRef} tabIndex={-1} className="sm:ml-10 sm:max-w-[calc(100%-2.5rem)]"><BookingPaymentCheckout publicFunnelNumber={funnelRecord.publicFunnelNumber} mutationToken={funnelRecord.mutationToken} customerName={demo.fullName} amountCents={acceptedPricing.totalCents} onComplete={(result) => { setPreparedBooking((current) => current ? { ...current, publicBookingNumber: current.publicBookingNumber } : current); setDemo((current) => ({ ...current })); setStep("complete"); }} /></div></div>;
    }
    if (mode === "live") return (
      <div className="flex flex-col gap-4">
        <DemoBubble customer color={config.customerBubbleColor}>Book my cleaning</DemoBubble>
        <div className="max-w-full overflow-hidden rounded-[22px] border border-[#cfe9df] bg-white shadow-[0_16px_40px_rgba(22,141,97,0.11)] sm:ml-10 sm:max-w-[calc(100%-2.5rem)]">
          <div className="border-b border-[#d9f1e6] bg-gradient-to-br from-[#f2fcf7] via-white to-[#fff8f6] p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#168d61] text-white shadow-sm"><CheckCircle2 className="h-6 w-6" /></span>
              <div>
                <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#168d61]">Booking confirmed</div>
                <h2 className="text-[20px] font-extrabold text-[#3a3c41]">You&apos;re booked, {firstNameFromFullName(demo.fullName)}!</h2>
                <p className="mt-2 text-[11px] leading-5 text-[#5f716a]">Your cleaning is booked. We&apos;ll text your appointment details and arrival updates shortly.</p>
              </div>
            </div>
          </div>
          <div className="p-5 text-[11px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 flex items-center gap-2.5 rounded-xl border border-[#e4e5e7] bg-[#fafaf9] p-3"><CalendarDays className="h-4.5 w-4.5 shrink-0 text-[#ff684c]" /><span className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">WHEN</small><strong className="truncate text-[11px] text-[#3a3c41]">{demo.schedule}</strong></span></div>
              <div className="col-span-2 flex items-center gap-2.5 rounded-xl border border-[#e4e5e7] bg-[#fafaf9] p-3"><MapPin className="h-4.5 w-4.5 shrink-0 text-[#ff684c]" /><span className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">WHERE</small><strong className="truncate text-[11px] text-[#3a3c41]">{demo.address}</strong></span></div>
              <div className="flex items-center gap-2.5 rounded-xl border border-[#e4e5e7] bg-[#fafaf9] p-3"><Sparkles className="h-4.5 w-4.5 shrink-0 text-[#ff684c]" /><span className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">SERVICE</small><strong className="truncate text-[11px] text-[#3a3c41]">{service.name}</strong></span></div>
              <div className="flex items-center justify-between gap-2.5 rounded-xl border border-[#e4e5e7] bg-[#fafaf9] p-3"><span><small className="block text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">TOTAL</small><strong className="text-[16px] text-[#3a3c41]">${((preparedBooking?.summary.totalCents ?? acceptedPricing.totalCents) / 100).toFixed(0)}</strong></span><CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-[#168d61]" /></div>
            </div>
            {demo.recurringFrequency !== "one-time" && <div className="mt-3 rounded-xl bg-[#eef9f4] p-3 text-[10px] leading-5 text-[#41695a]"><strong className="block text-[11px] text-[#276b53]">Recurring cleaning: {selectedRecurringOption?.label}</strong>Your recurring plan begins with visit two.</div>}
            <section aria-label="What happens next" className="mt-4"><p className="text-[12px] font-extrabold text-[#3a3c41]">What happens next</p><div className="mt-2 grid grid-cols-3 gap-2"><div className="rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span aria-hidden="true" className="text-[14px]">📩</span><strong className="mt-1 block text-[9px] text-[#3a3c41]">Confirmation</strong><p className="mt-1 text-[8px] leading-4 text-[#6f7279]">We&apos;ll text your details.</p></div><div className="rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span aria-hidden="true" className="text-[14px]">🚗</span><strong className="mt-1 block text-[9px] text-[#3a3c41]">Team updates</strong><p className="mt-1 text-[8px] leading-4 text-[#6f7279]">Updates on service day.</p></div><div className="rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span aria-hidden="true" className="text-[14px]">💳</span><strong className="mt-1 block text-[9px] text-[#3a3c41]">Pay after</strong><p className="mt-1 text-[8px] leading-4 text-[#6f7279]">No charge today.</p></div></div></section>
          </div>
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <DemoBubble customer color={config.customerBubbleColor}>{formatBookingButtonLabel(config.confirmButtonLabel, quotePrice)}</DemoBubble>
        <div className="max-w-full overflow-hidden rounded-[22px] border border-[#cfe9df] bg-white shadow-[0_16px_40px_rgba(22,141,97,0.11)] sm:ml-10 sm:max-w-[calc(100%-2.5rem)]">
          <div className="border-b border-[#d9f1e6] bg-gradient-to-br from-[#f2fcf7] via-white to-[#fff8f6] p-5">
            <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#168d61] text-white shadow-sm"><CheckCircle2 className="h-6 w-6" /></span><div className="min-w-0"><div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#168d61]">{config.confirmedEyebrow}</div><h2 className="mt-1 text-[20px] font-extrabold text-[#3a3c41]">{config.confirmedTitle}</h2><p className="mt-2 text-[11px] leading-5 text-[#5f716a]">{renderBookingWidgetTemplate(config.confirmedScheduleTemplate, { providerName: service.providerName, day: demo.schedule || `${service.availabilityDay} at ${service.availabilityTime}`, time: service.availabilityTime })}</p></div></div>
          </div>
          <div className="p-5">
            <div className="space-y-2 rounded-xl border border-[#e4e5e7] bg-[#fafaf9] p-4 text-[11px]"><div className="flex justify-between gap-4"><span className="font-bold text-[#3a3c41]">{service.name}</span><strong className="text-[#3a3c41]">${quotePrice}</strong></div><div className="flex justify-between gap-4 text-[#6f7279]"><span>Address</span><span className="text-right">{demo.address}</span></div>{selectedRecurringOption && recurringFutureVisitPrice !== null && <div className="flex justify-between gap-4 text-[#6f7279]"><span>{selectedRecurringOption.label}</span><span className="text-right">{formatItemizedCurrency(recurringFutureVisitPrice)}/visit from visit two</span></div>}<div className="flex justify-between gap-4 text-[#6f7279]"><span>Payment</span><span>{config.demoCardBrand} •••• {config.demoCardLast4}</span></div></div>
            <section aria-label="What to expect after booking" className="mt-5"><p className="text-[13px] font-bold leading-6 text-[#3a3c41]">We’ll take it from here. Here’s what to expect:</p><div className="mt-4 space-y-3">{BOOKING_CONFIRMATION_EXPECTATIONS.map(({ emoji, title, description }) => <div key={title}><h3 className="text-[12px] font-extrabold text-[#3a3c41]"><span aria-hidden="true">{emoji}</span> {title}</h3><p className="mt-1 pl-7 text-[10px] leading-5 text-[#6f7279]">{description}</p></div>)}</div></section>
            <p className="mt-4 rounded-xl bg-[#f5f5f3] px-3.5 py-3 text-[9px] leading-4 text-[#6f7279]">{config.demoPaymentNotice}</p>
          </div>
        </div>
        <DemoBubble>{config.finalReminder}</DemoBubble>
      </div>
    );
  })();

  const welcomeVideoDialog = welcomeVideoOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWelcomeVideo(); }}>
      <div ref={welcomeVideoDialogRef} role="dialog" aria-modal="true" aria-labelledby="welcome-video-title" aria-describedby="welcome-video-description" className="relative my-auto w-full max-w-[700px] overflow-hidden rounded-[24px] bg-white shadow-[0_35px_110px_rgba(0,0,0,0.42)]">
        <button ref={welcomeVideoCloseRef} type="button" onClick={closeWelcomeVideo} aria-label="Close welcome video" className="absolute right-3.5 top-3.5 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-black/45 text-white transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white"><X className="h-5 w-5" /></button>
        <div className="relative aspect-video overflow-hidden bg-[#111]">
          <iframe src={WELCOME_VIDEO_IFRAME_URL} title="Welcome to Maids in Black" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="absolute inset-0 h-full w-full border-0" />
        </div>
        <div className="px-5 py-5 sm:px-[26px] sm:pb-[25px] sm:pt-[22px]">
          <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#ff684c]">WELCOME FROM MADISON</span>
          <h2 id="welcome-video-title" className="mt-1 text-[22px] font-extrabold text-[#3a3c41]">We&apos;ll take it from here.</h2>
          <p id="welcome-video-description" className="mb-4 mt-1.5 text-[12px] leading-[1.55] text-[#6f7279]">Answer a few simple questions and I&apos;ll show you your price and available appointments.</p>
          <button type="button" onClick={startBookingFromWelcomeVideo} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-extrabold text-white transition hover:bg-[#e9573e] focus:outline-none focus:ring-2 focus:ring-[#ff684c] focus:ring-offset-2">Start my booking <ArrowRight className="h-[17px] w-[17px]" /></button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={mode === "live" ? surface === "popup" ? "h-dvh bg-[#f5f5f3] p-0" : "min-h-screen bg-[radial-gradient(circle_at_8%_0%,rgba(255,104,76,0.18),transparent_30%),radial-gradient(circle_at_96%_100%,rgba(204,51,102,0.08),transparent_28%),#f5f5f3] p-3 sm:p-6" : "space-y-5"}>
      {welcomeVideoDialog}
      {mode === "editor" && <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <p className="text-sm font-semibold text-violet-900">Fully interactive demo · internal preview only</p>
        <p className="mt-0.5 text-xs leading-relaxed text-violet-700">
          This simulation never saves customer details, creates a lead or booking, processes a card, checks live availability, changes the quote form, or contacts a customer.
        </p>
      </div>}

      <div className={mode === "editor" ? "grid gap-5 xl:grid-cols-[minmax(0,430px)_minmax(560px,1fr)] xl:items-start" : surface === "popup" ? "h-dvh w-full max-w-none" : "mx-auto w-full max-w-[760px]"}>
        {mode === "editor" && <div className="space-y-5">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-[#E8735A]" /> Brand and opening</CardTitle>
              <CardDescription>Configure the first screen of the demo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div className="space-y-1.5"><Label htmlFor="widget-brand-name">Widget title</Label><Input id="widget-brand-name" className={fieldClass} value={config.brandName} onChange={(event) => update("brandName", event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="widget-header-icon">Icon</Label><Input id="widget-header-icon" className={fieldClass} value={config.headerIcon} onChange={(event) => update("headerIcon", event.target.value)} maxLength={8} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="widget-logo-url">Logo URL <span className="font-normal text-gray-400">(optional)</span></Label><Input id="widget-logo-url" className={fieldClass} placeholder="https://..." value={config.brandLogoUrl} onChange={(event) => update("brandLogoUrl", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="widget-status">Online status</Label><Input id="widget-status" className={fieldClass} value={config.statusText} onChange={(event) => update("statusText", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="widget-greeting">Opening message</Label><Textarea id="widget-greeting" className="min-h-24 resize-y bg-white border-gray-200 text-sm" value={config.greeting} onChange={(event) => update("greeting", event.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Text color</Label><div className="flex gap-2"><input type="color" aria-label="Widget text color" className="h-9 w-11 rounded border border-gray-200 bg-white p-1" value={colorValue(config.primaryColor, DEFAULT_BOOKING_WIDGET_DRAFT.primaryColor)} onChange={(event) => update("primaryColor", event.target.value)} /><Input className={fieldClass} value={config.primaryColor} onChange={(event) => update("primaryColor", event.target.value)} /></div></div>
                <div className="space-y-1.5"><Label>Accent color</Label><div className="flex gap-2"><input type="color" aria-label="Widget accent color" className="h-9 w-11 rounded border border-gray-200 bg-white p-1" value={colorValue(config.customerBubbleColor, DEFAULT_BOOKING_WIDGET_DRAFT.customerBubbleColor)} onChange={(event) => update("customerBubbleColor", event.target.value)} /><Input className={fieldClass} value={config.customerBubbleColor} onChange={(event) => update("customerBubbleColor", event.target.value)} /></div></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="widget-helper-text">Footer note</Label><Input id="widget-helper-text" className={fieldClass} value={config.helperText} onChange={(event) => update("helperText", event.target.value)} /></div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Opening prompts</CardTitle><CardDescription>Edit, add, remove, or reorder the first choices customers see.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {config.quickPrompts.map((value, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <Input aria-label={`Opening prompt ${index + 1}`} className={fieldClass} value={value} onChange={(event) => updatePrompt(index, event.target.value)} />
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={index === 0} onClick={() => movePrompt(index, -1)} aria-label={`Move opening prompt ${index + 1} up`}><ChevronUp className="h-4 w-4" /></Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={index === config.quickPrompts.length - 1} onClick={() => movePrompt(index, 1)} aria-label={`Move opening prompt ${index + 1} down`}><ChevronDown className="h-4 w-4" /></Button>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={() => removePrompt(index)} aria-label={`Remove opening prompt ${index + 1}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" className="mt-1 w-full gap-2" onClick={addPrompt}><Plus className="h-4 w-4" /> Add opening prompt</Button>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Questions and choices</CardTitle><CardDescription>Question wording and custom questions remain editable. Priced extras use the fixed approved catalog below.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {config.questions.map((question, questionIndex) => (
                <div key={question.id} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Question {questionIndex + 1}</span>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={questionIndex === 0} onClick={() => moveQuestion(questionIndex, -1)} aria-label={`Move question ${questionIndex + 1} up`}><ChevronUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={questionIndex === config.questions.length - 1} onClick={() => moveQuestion(questionIndex, 1)} aria-label={`Move question ${questionIndex + 1} down`}><ChevronDown className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 text-red-500" disabled={question.role === "extras"} onClick={() => removeQuestion(questionIndex)} aria-label={`Remove question ${questionIndex + 1}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-[1fr_105px_105px] gap-2">
                    <Input aria-label={`Question ${questionIndex + 1} text`} className={fieldClass} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} />
                    <select aria-label={`Question ${questionIndex + 1} type`} disabled={question.role === "extras"} className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs disabled:bg-gray-100 disabled:text-gray-500" value={question.role} onChange={(event) => {
                      const role = event.target.value as BookingWidgetQuestionDraft["role"];
                      updateQuestion(questionIndex, { role, selectionMode: role === "extras" ? "multiple" : question.selectionMode });
                    }}>
                      <option value="bedrooms">Bedrooms</option><option value="bathrooms">Bathrooms</option>{question.role === "extras" && <option value="extras">Extras</option>}<option value="custom">Custom</option>
                    </select>
                    <select aria-label={`Question ${questionIndex + 1} selection mode`} disabled={question.role === "extras"} className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs disabled:bg-gray-100 disabled:text-gray-500" value={question.selectionMode} onChange={(event) => updateQuestion(questionIndex, { selectionMode: event.target.value as BookingWidgetQuestionDraft["selectionMode"] })}>
                      <option value="single">Single choice</option><option value="multiple">Multiple choice</option>
                    </select>
                  </div>
                  {question.role === "extras" ? (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-[11px] font-semibold text-amber-900">Fixed authoritative catalog</div>
                      <div className="grid gap-1.5 text-xs text-amber-950 sm:grid-cols-2">
                        <div className="rounded-md bg-white/80 px-2.5 py-2">Nothing extra</div>
                        {BOOKING_WIDGET_PRICED_EXTRAS.map((extra) => <div key={extra.id} className="rounded-md bg-white/80 px-2.5 py-2">{extra.label} · ${extra.unitPrice}{extra.quantityUnit ? `/${extra.quantityUnit}` : ""}</div>)}
                      </div>
                    </div>
                  ) : <div className="space-y-2">
                    {question.choices.map((choice, choiceIndex) => (
                      <div key={choiceIndex} className="flex items-center gap-1.5 pl-3">
                        <Input aria-label={`Question ${questionIndex + 1} choice ${choiceIndex + 1}`} className={fieldClass} value={choice} onChange={(event) => updateChoice(questionIndex, choiceIndex, event.target.value)} />
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={choiceIndex === 0} onClick={() => moveChoice(questionIndex, choiceIndex, -1)} aria-label={`Move question ${questionIndex + 1} choice ${choiceIndex + 1} up`}><ChevronUp className="h-4 w-4" /></Button>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={choiceIndex === question.choices.length - 1} onClick={() => moveChoice(questionIndex, choiceIndex, 1)} aria-label={`Move question ${questionIndex + 1} choice ${choiceIndex + 1} down`}><ChevronDown className="h-4 w-4" /></Button>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={() => removeChoice(questionIndex, choiceIndex)} aria-label={`Remove question ${questionIndex + 1} choice ${choiceIndex + 1}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="ml-3 h-9 gap-2" onClick={() => addChoice(questionIndex)}><Plus className="h-4 w-4" /> Add choice</Button>
                  </div>}
                </div>
              ))}
              <Button type="button" variant="outline" className="w-full gap-2" onClick={addQuestion}><Plus className="h-4 w-4" /> Add question</Button>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer intake and availability</CardTitle><CardDescription>Configure the combined service details, schedule, contact, address, and sample availability transition.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[1fr_170px] gap-2"><Input aria-label="Combined bedroom and bathroom question" className={fieldClass} value={config.combinedDetailsQuestion} onChange={(event) => update("combinedDetailsQuestion", event.target.value)} /><Input aria-label="Combined details placeholder" className={fieldClass} value={config.combinedDetailsPlaceholder} onChange={(event) => update("combinedDetailsPlaceholder", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="schedule-question">Schedule question</Label><Input id="schedule-question" className={fieldClass} value={config.scheduleQuestion} onChange={(event) => update("scheduleQuestion", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="schedule-question-day">Schedule question when the request includes a day</Label><Input id="schedule-question-day" className={fieldClass} value={config.scheduleQuestionWithDayTemplate} onChange={(event) => update("scheduleQuestionWithDayTemplate", event.target.value)} /><p className="text-xs text-gray-400">Use <code>{"{day}"}</code> for the requested day.</p></div>
              <Input aria-label="Schedule placeholder" className={fieldClass} value={config.schedulePlaceholder} onChange={(event) => update("schedulePlaceholder", event.target.value)} />
              <div className="grid grid-cols-[1fr_170px] gap-2"><Input aria-label="Full name question" className={fieldClass} value={config.fullNameQuestion} onChange={(event) => update("fullNameQuestion", event.target.value)} /><Input aria-label="Full name placeholder" className={fieldClass} value={config.fullNamePlaceholder} onChange={(event) => update("fullNamePlaceholder", event.target.value)} /></div>
              <div className="grid grid-cols-[1fr_170px] gap-2"><Input aria-label="Phone question" className={fieldClass} value={config.phoneQuestionTemplate} onChange={(event) => update("phoneQuestionTemplate", event.target.value)} /><Input aria-label="Phone placeholder" className={fieldClass} value={config.phonePlaceholder} onChange={(event) => update("phonePlaceholder", event.target.value)} /></div>
              <p className="-mt-1 text-xs text-gray-400">Use <code>{"{firstName}"}</code> in the phone question.</p>
              <div className="grid grid-cols-[1fr_170px] gap-2"><Input aria-label="Email question" className={fieldClass} value={config.emailQuestion} onChange={(event) => update("emailQuestion", event.target.value)} /><Input aria-label="Email placeholder" className={fieldClass} value={config.emailPlaceholder} onChange={(event) => update("emailPlaceholder", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="address-question">Address question</Label><Input id="address-question" className={fieldClass} value={config.addressQuestion} onChange={(event) => update("addressQuestion", event.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Address input placeholder" className={fieldClass} value={config.addressPlaceholder} onChange={(event) => update("addressPlaceholder", event.target.value)} /><Input aria-label="Sample address" className={fieldClass} value={config.addressExample} onChange={(event) => update("addressExample", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="availability-check-message">Availability transition</Label><Textarea id="availability-check-message" className="min-h-20 bg-white border-gray-200 text-sm" value={config.availabilityCheckMessage} onChange={(event) => update("availabilityCheckMessage", event.target.value)} /></div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Opening and calculated pricing</CardTitle><CardDescription>Availability remains a demo. Prices use the approved authoritative rules and cannot be overridden here.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                <div className="font-semibold">Authoritative pricing</div>
                <div className="mt-2 leading-5">Studio $99 · 1BR $119 · 2BR $179 · 3BR $199 · 4BR $249 · 5BR $289 · 6BR $349 · 7BR $389</div>
                <div className="mt-1 leading-5">Bathrooms ${BOOKING_WIDGET_BATHROOM_UNIT_PRICE} each · Deep and move-out +20% · adjusted totals round to the nearest whole dollar.</div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="opening-eyebrow">Result label</Label><Input id="opening-eyebrow" className={fieldClass} value={config.openingEyebrow} onChange={(event) => update("openingEyebrow", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="result-title">Result title</Label><Input id="result-title" className={fieldClass} value={config.resultTitle} onChange={(event) => update("resultTitle", event.target.value)} /></div>
              <div className="space-y-2"><Label>Trust points</Label>{config.resultTrustPoints.map((point, index) => <Input key={index} aria-label={`Trust point ${index + 1}`} className={fieldClass} value={point} onChange={(event) => update("resultTrustPoints", config.resultTrustPoints.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />)}</div>
              {config.services.map((item, index) => (
                <div key={item.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.id}</div>
                  <Input aria-label={`${item.id} service name`} className={fieldClass} value={item.name} onChange={(event) => updateService(index, "name", event.target.value)} />
                  <div className="grid grid-cols-2 gap-2"><Input aria-label={`${item.id} day`} className={fieldClass} value={item.availabilityDay} onChange={(event) => updateService(index, "availabilityDay", event.target.value)} /><Input aria-label={`${item.id} time`} className={fieldClass} value={item.availabilityTime} onChange={(event) => updateService(index, "availabilityTime", event.target.value)} /></div>
                </div>
              ))}
              <div className="space-y-1.5"><Label htmlFor="widget-book-label">Book button</Label><Input id="widget-book-label" className={fieldClass} value={config.bookingButtonLabel} onChange={(event) => update("bookingButtonLabel", event.target.value)} /><p className="text-xs text-gray-400">Use <code>{"${price}"}</code> for the demo price.</p></div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Demo payment area and completion</CardTitle><CardDescription>Configure the visual payment mock shown after the branded result. It never connects to Stripe or processes a payment.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="payment-confirmation">Payment heading</Label><Textarea id="payment-confirmation" className="min-h-20 bg-white border-gray-200 text-sm" value={config.paymentConfirmationTemplate} onChange={(event) => update("paymentConfirmationTemplate", event.target.value)} /><p className="text-xs text-gray-400">Displayed above the mock card fields.</p></div>
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Demo card brand" className={fieldClass} value={config.demoCardBrand} onChange={(event) => update("demoCardBrand", event.target.value)} /><Input aria-label="Demo card last four" className={fieldClass} value={config.demoCardLast4} onChange={(event) => update("demoCardLast4", event.target.value)} /></div>
              <div className="space-y-1.5"><Input aria-label="Confirm booking button" className={fieldClass} value={config.confirmButtonLabel} onChange={(event) => update("confirmButtonLabel", event.target.value)} /><p className="text-xs text-gray-400">Use <code>{"${price}"}</code> for the demo price.</p></div>
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Confirmed label" className={fieldClass} value={config.confirmedEyebrow} onChange={(event) => update("confirmedEyebrow", event.target.value)} /><Input aria-label="Confirmed title" className={fieldClass} value={config.confirmedTitle} onChange={(event) => update("confirmedTitle", event.target.value)} /></div>
              <Textarea aria-label="Confirmed schedule template" className="min-h-20 bg-white border-gray-200 text-sm" value={config.confirmedScheduleTemplate} onChange={(event) => update("confirmedScheduleTemplate", event.target.value)} />
              <Input aria-label="Demo payment notice" className={fieldClass} value={config.demoPaymentNotice} onChange={(event) => update("demoPaymentNotice", event.target.value)} />
              <Textarea aria-label="Final reminder" className="min-h-20 bg-white border-gray-200 text-sm" value={config.finalReminder} onChange={(event) => update("finalReminder", event.target.value)} />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <Button type="button" variant="outline" className="gap-2" onClick={resetToReference}><RotateCcw className="h-4 w-4" /> Reset to reference</Button>
            <div className="flex items-center gap-3">
              {saved && <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Draft saved</span>}
              <Button type="button" className="gap-2 bg-[#E8735A] text-white hover:bg-[#d4614a]" disabled={!isDirty || saving} onClick={handleSave}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save draft"}</Button>
            </div>
          </div>
        </div>}

        <div className={mode === "editor" ? "xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)]" : surface === "popup" ? "h-dvh" : "min-h-[calc(100dvh-1.5rem)] sm:min-h-[calc(100dvh-3rem)]"}>
          <Card className={`gap-0 overflow-hidden py-0 ${mode === "editor" ? "border-gray-200 shadow-lg xl:flex xl:h-full xl:flex-col" : surface === "popup" ? "flex h-dvh flex-col rounded-none border-0 shadow-none" : "min-h-[calc(100dvh-1.5rem)] border-gray-200 shadow-lg xl:flex xl:flex-col sm:min-h-[calc(100dvh-3rem)]"}`}>
            {mode === "editor" && <CardHeader className="border-b border-gray-100 bg-white py-4 xl:shrink-0"><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-[#E8735A]" /> Interactive customer preview</CardTitle><CardDescription>Run the complete demo here. Start over resets only this preview.</CardDescription></CardHeader>}
            <CardContent className={`bg-[radial-gradient(circle_at_8%_0%,rgba(255,104,76,0.18),transparent_30%),radial-gradient(circle_at_96%_100%,rgba(204,51,102,0.08),transparent_28%),#f5f5f3] ${mode === "live" && surface === "popup" ? "flex min-h-0 flex-1 flex-col overflow-hidden p-0" : "p-3 sm:p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden"}`}>
              <div className={`mx-auto flex w-full flex-col overflow-hidden bg-white ${mode === "live" && surface === "popup" ? "min-h-0 flex-1 max-w-none rounded-none border-0 shadow-none" : "max-w-[720px] rounded-[28px] border border-[#dfe0e2] shadow-[0_28px_80px_rgba(17,17,17,0.16)] xl:min-h-0 xl:flex-1"}`} style={{ color: config.primaryColor }}>
                <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-[#282828] bg-[#111111] text-white ${mode === "live" && surface === "popup" ? "px-4 py-3" : "px-5 py-4 sm:px-6"}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-white text-[#ff684c] ${mode === "live" && surface === "popup" ? "h-10 w-10 rounded-[14px] text-lg" : "h-11 w-11 rounded-2xl text-xl"}`}>{config.brandLogoUrl ? <img src={config.brandLogoUrl} alt="Widget logo preview" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : config.headerIcon || <Bot className="h-5 w-5" />}</div>
                    <div className="min-w-0"><div className={`truncate font-extrabold ${mode === "live" && surface === "popup" ? "text-[16px]" : "text-[18px]"}`}>{config.brandName || "Book with AI"}</div><div className={`mt-0.5 flex items-center text-white/65 ${mode === "live" && surface === "popup" ? "text-[11px]" : "text-[12px]"}`}><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#23b982] shadow-[0_0_0_4px_rgba(35,185,130,0.13)]" />{config.statusText}</div></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={startOver} className={`rounded-full border border-[#4a4a4a] bg-[#242424] font-bold text-white transition hover:border-[#ff684c] hover:bg-[#ff684c] ${mode === "live" && surface === "popup" ? "px-3 py-1.5 text-[11px]" : "px-3.5 py-2 text-[12px]"}`}>Start over</button>
                    {mode === "live" && surface === "popup" && <button type="button" onClick={closePopup} aria-label="Close booking widget" className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4a4a4a] bg-[#242424] text-white transition hover:border-[#ff684c] hover:bg-[#ff684c]"><X className="h-4 w-4" /></button>}
                  </div>
                </div>

                {showSummary && (
                  <div className="shrink-0 border-b border-[#e4e5e7] bg-[#fff8f6]">
                    <button type="button" onClick={() => setSummaryOpen((open) => !open)} aria-expanded={summaryOpen} className="flex w-full items-center gap-2 px-5 py-3 text-left text-[12px] font-extrabold text-[#ff684c] sm:px-6"><Sparkles className="h-3.5 w-3.5" /><span>Your cleaning so far</span><strong className="ml-auto text-[14px] text-[#3a3c41]">${quotePrice}</strong><ChevronDown className={`h-4 w-4 text-[#3a3c41] transition ${summaryOpen ? "rotate-180" : ""}`} /></button>
                    {summaryOpen && <div className="grid grid-cols-2 gap-2 px-5 pb-3 sm:grid-cols-3 sm:px-6"><div className="flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Sparkles className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">SERVICE</small><strong className="truncate text-[10px] text-[#3a3c41]">{service.name}</strong></p></div><div className="flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Home className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">HOME</small><strong className="truncate text-[10px] text-[#3a3c41]">{roomSummary}</strong></p></div><div className="col-span-2 flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5 sm:col-span-1"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Check className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">EXTRAS</small><strong className="truncate text-[10px] text-[#3a3c41]">{selectedExtras.length ? selectedExtras.map((choice) => formatBookingWidgetExtraSelection(choice, demo.extraQuantities)).join(", ") : "None selected"}</strong></p></div></div>}
                  </div>
                )}

                <div ref={conversationRef} className={`relative flex flex-col gap-4 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_90%_5%,rgba(255,224,215,0.32),transparent_34%),linear-gradient(145deg,#faf8f6_0%,#f8f4f1_55%,#fff8f5_100%)] px-4 py-5 sm:px-6 ${mode === "live" && surface === "popup" ? "min-h-0 flex-1" : "h-[680px] xl:h-auto xl:min-h-0 xl:flex-1"}`}>
                  <div className="flex shrink-0 items-center gap-3 pb-1"><span className="h-px flex-1 bg-[#e4e5e7]" /><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#a1a2ad]">Today</span><span className="h-px flex-1 bg-[#e4e5e7]" /></div>
                  <div data-completed-history className="flex shrink-0 flex-col gap-4">
                    {history.map((entry) => <div key={entry.id} data-history-entry className="relative min-w-0"><DemoHistoryRow entry={entry} customerColor={config.customerBubbleColor} trustPoints={config.resultTrustPoints} /></div>)}
                  </div>
                  <div ref={activeStageRef} data-active-stage data-step={step} className="relative flex shrink-0 flex-col gap-4">
                    {activeStage}
                  </div>
                </div>

                <form onSubmit={(event) => { event.preventDefault(); submitComposer(); }} className="shrink-0 border-t border-[rgba(35,35,40,0.08)] bg-[rgba(255,253,252,0.97)] px-4 py-3 shadow-[0_-8px_24px_rgba(45,31,26,0.035)] sm:px-5">
                  <div className="flex items-center gap-2 rounded-2xl border border-[#e4e5e7] bg-white p-1.5 pl-3 shadow-[0_5px_18px_rgba(29,25,42,0.04)] focus-within:border-[#ff684c] focus-within:ring-4 focus-within:ring-[#ff684c]/10">
                    <MessageCircle className="h-4 w-4 shrink-0 text-[#a1a2ad]" />
                    <Input value={composerValue} onChange={(event) => { setComposerValue(event.target.value); if (composerError) setComposerError(""); }} disabled={!composerEnabled} placeholder={composerPlaceholder} aria-label={mode === "live" ? "Booking response" : "Demo booking response"} aria-invalid={Boolean(composerError)} className="h-11 flex-1 border-0 bg-transparent px-1 text-[16px] shadow-none focus-visible:ring-0 disabled:cursor-default disabled:opacity-100 sm:h-10 sm:text-[12px]" />
                    <button type="submit" aria-label={mode === "live" ? "Send booking response" : "Send demo response"} disabled={!composerEnabled || !composerValue.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ff684c] text-white transition hover:bg-[#e9573e] disabled:bg-[#f1c9c1] disabled:text-white/80 sm:h-10 sm:w-10"><Send className="h-4 w-4" /></button>
                  </div>
                  {composerError && <p className="mt-2 text-[10px] font-bold text-red-600" role="alert">{composerError}</p>}
                  <p className="mt-2 text-center text-[9px] text-[#a1a2ad]">{composerEnabled ? "Press Enter to send · " : ""}{config.helperText}</p>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
