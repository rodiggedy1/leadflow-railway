import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, CreditCard, Eye, Home, Lock, MapPin, MessageCircle, Plus, RotateCcw, Save, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildInferredQuestionAnswers,
  buildDemoDetailLine,
  firstNameFromFullName,
  formatBookingButtonLabel,
  formatDemoScheduleSelection,
  formatScheduleQuestion,
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
  type BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";

type BookingWidgetConfigPanelProps = {
  savedValue?: string;
  onSave: (value: string) => Promise<void>;
};

type DemoStep = "request" | "serviceDetails" | "questions" | "schedule" | "extras" | "fullName" | "phone" | "email" | "address" | "checking" | "quote" | "confirm" | "complete";

type DemoHistoryItem =
  | { kind: "message"; sender: "assistant" | "customer"; text: string }
  | { kind: "privacy" }
  | { kind: "proof" };

type DemoHistoryEntry = DemoHistoryItem & { id: number };

type DemoSession = {
  prompt: string;
  serviceDetailsAnswer: string;
  serviceId: BookingWidgetServiceId;
  fallbackBedrooms: number;
  answers: Record<string, string[]>;
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
const CLEANER_TEAM_IMAGE_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/BzlthoPImdsJEqoM.webp";

function normalizeCalendarDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized;
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
  fallbackBedrooms: 3,
  answers: {},
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

function DemoChip({ children, onClick, selected = false, color }: { children: React.ReactNode; onClick: () => void; selected?: boolean; color?: string }) {
  return (
    <button
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
    <div className="ml-10 mr-2 overflow-hidden rounded-[18px] border border-[#e0e1e4] bg-white shadow-[0_8px_24px_rgba(22,20,33,0.05)] sm:grid sm:grid-cols-[42%_1fr]">
      <img
        src={CLEANER_TEAM_IMAGE_URL}
        alt="Maids in Black professional holding cleaning supplies"
        className="h-44 w-full object-cover sm:h-full"
        style={{ objectPosition: "50% 38%" }}
      />
      <div className="flex flex-col justify-center p-5"><span className="text-[10px] font-extrabold tracking-[0.12em] text-[#ff684c]">WHY PEOPLE BOOK US</span><h3 className="mt-3 text-[17px] font-extrabold text-[#3a3c41]">Professional, vetted cleaners</h3><div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[#66736e]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#239268]" /><span>{trustPoints.filter(Boolean).join(" · ")}</span></div><span className="mt-3 text-[11px] font-extrabold text-[#ff684c]">See our happiness promise</span></div>
    </div>
  );
}

export default function BookingWidgetConfigPanel({ savedValue, onSave }: BookingWidgetConfigPanelProps) {
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
  const [history, setHistory] = useState<DemoHistoryEntry[]>([]);
  const conversationRef = useRef<HTMLDivElement>(null);
  const activeStageRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const historyIdRef = useRef(0);
  const demoToday = useMemo(() => normalizeCalendarDate(new Date()), []);
  const demoCalendarEnd = useMemo(() => {
    const end = new Date(demoToday);
    end.setMonth(end.getMonth() + 6);
    return end;
  }, [demoToday]);

  useEffect(() => {
    setConfig(savedConfig);
  }, [savedConfig]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      if (step === "request") {
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

  const serialized = JSON.stringify(config);
  const isDirty = serialized !== JSON.stringify(savedConfig);
  const service = config.services.find((item) => item.id === demo.serviceId) ?? config.services[1];
  const detailLine = buildDemoDetailLine(demo.fallbackBedrooms, config.questions, demo.answers);
  const currentQuestion = config.questions[currentQuestionIndex];
  const extrasQuestion = config.questions.find((question) => question.role === "extras");

  const appendHistory = (...items: DemoHistoryItem[]) => {
    const entries = items.map((item) => ({ ...item, id: ++historyIdRef.current }));
    setHistory((current) => [...current, ...entries]);
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
    appendHistory(
      { kind: "message", sender: "assistant", text: config.greeting },
      { kind: "message", sender: "customer", text: trimmed },
    );
    setDemo({
      ...emptySession,
      prompt: trimmed,
      serviceId: resolved.serviceId,
      fallbackBedrooms: resolved.bedrooms ?? 3,
      answers: inferred.answers,
      inferredQuestionIds: inferred.inferredQuestionIds,
      requestedDay: resolved.requestedDay ?? "",
    });
    setComposerValue("");
    setComposerError("");
    setSelectedDate(suggestedDateForRequest(resolved.requestedDay, demoToday));
    setSelectedTime("");
    if (hasBedrooms && hasBathrooms) nextAfterServiceDetails(inferred.answers);
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
    const inferred = buildInferredQuestionAnswers(resolved, config.questions);
    const nextAnswers = { ...demo.answers, ...inferred.answers };
    const hasBedrooms = config.questions.every((question) => question.role !== "bedrooms" || (nextAnswers[question.id] ?? []).length > 0);
    const hasBathrooms = config.questions.every((question) => question.role !== "bathrooms" || (nextAnswers[question.id] ?? []).length > 0);
    if (!hasBedrooms || !hasBathrooms) {
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
    if (extrasQuestion.selectionMode === "multiple") {
      setDemo((current) => ({
        ...current,
        answers: {
          ...current.answers,
          [extrasQuestion.id]: toggleMultiSelectChoice(current.answers[extrasQuestion.id] ?? [], trimmed),
        },
      }));
      setComposerValue("");
      return;
    }
    appendHistory(
      { kind: "message", sender: "assistant", text: extrasQuestion.prompt },
      { kind: "message", sender: "customer", text: trimmed },
    );
    setDemo((current) => ({ ...current, answers: { ...current.answers, [extrasQuestion.id]: [trimmed] } }));
    setComposerValue("");
    setComposerError("");
    setStep("fullName");
  };

  const continueMultipleQuestion = () => {
    if (!extrasQuestion || (demo.answers[extrasQuestion.id] ?? []).length === 0) return;
    appendHistory(
      { kind: "message", sender: "assistant", text: extrasQuestion.prompt },
      { kind: "message", sender: "customer", text: (demo.answers[extrasQuestion.id] ?? []).join(", ") },
    );
    setStep("fullName");
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

  const submitIntakeField = (field: BookingWidgetIntakeField, nextStep: DemoStep) => {
    const trimmed = composerValue.trim();
    const error = validateBookingWidgetIntakeField(field, trimmed);
    if (error) {
      setComposerError(error);
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

  const submitAddress = (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
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

  const submitPhone = () => {
    const trimmed = composerValue.trim();
    const error = validateBookingWidgetIntakeField("phone", trimmed);
    if (error) {
      setComposerError(error);
      return;
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
    if (step === "request") return selectRequest(composerValue);
    if (step === "serviceDetails") return submitCombinedServiceDetails();
    if (step === "questions") return selectQuestionAnswer(composerValue);
    if (step === "extras") return selectExtrasAnswer(composerValue);
    if (step === "fullName") return submitIntakeField("fullName", "phone");
    if (step === "phone") return submitPhone();
    if (step === "email") return submitIntakeField("email", "address");
    if (step === "address") return submitAddress(composerValue);
  };

  const handleSave = async () => {
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
  const composerEnabled = ["request", "serviceDetails", "questions", "extras", "fullName", "phone", "email", "address"].includes(step);
  const colorValue = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const selectedExtras = extrasQuestion ? (demo.answers[extrasQuestion.id] ?? []).filter((answer) => !isNoSelectionChoice(answer)) : [];
  const roomSummary = detailLine.split(" · ").slice(0, 2).join(" · ");
  const showSummary = !["request", "serviceDetails", "questions"].includes(step);
  const openCheckout = () => setStep("confirm");
  const completeCheckout = () => setStep("complete");

  const activeStage = (() => {
    if (step === "request") {
      return (
        <div className="flex flex-col gap-4">
          <DemoBubble>{config.greeting}</DemoBubble>
          <div className="ml-10 flex flex-wrap gap-2">{config.quickPrompts.map((prompt) => <DemoChip key={prompt} onClick={() => selectRequest(prompt)}>{prompt}</DemoChip>)}</div>
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
                <div className="flex items-center gap-2 text-[12px] font-extrabold text-[#3a3c41]"><Clock className="h-4 w-4 text-[#ff684c]" /> Available times <span className="font-normal text-[#9a9ba5]">(demo)</span></div>
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
            <div className="flex flex-wrap gap-2">{extrasQuestion.choices.map((choice) => <DemoChip key={choice} onClick={() => selectExtrasAnswer(choice)} selected={answer.some((item) => item.toLowerCase() === choice.trim().toLowerCase())} color={config.customerBubbleColor}>{choice}</DemoChip>)}</div>
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
          <div className="flex items-center gap-3 border-b border-[#e4e5e7] pb-4"><span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#e7fbf2] text-[#168d61]"><Check className="h-5 w-5" /></span><div><small className="text-[9px] font-extrabold tracking-[0.1em] text-[#77798b]">{config.openingEyebrow}</small><h2 className="mt-1 text-[18px] font-extrabold text-[#3a3c41]">{config.resultTitle}</h2></div></div>
          <div className="flex items-center border-b border-[#e4e5e7] py-3"><CalendarDays className="mr-2.5 h-5 w-5 shrink-0 text-[#ff684c]" /><span className="grid"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">DATE & TIME</small><strong className="text-[11px] text-[#3a3c41]">{demo.schedule || `${service.availabilityDay} · ${service.availabilityTime}`}</strong></span></div>
          <div className="flex items-center justify-between border-b border-[#e4e5e7] py-3"><div className="flex min-w-0 items-center"><MapPin className="mr-2.5 h-5 w-5 shrink-0 text-[#ff684c]" /><span className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">ADDRESS</small><strong className="truncate text-[11px] text-[#3a3c41]">{demo.address}</strong></span></div><Check className="h-4 w-4 shrink-0 text-[#23b982]" /></div>
          <div className="py-3"><div className="text-[12px] font-extrabold text-[#3a3c41]">{service.name}</div><div className="mt-1 text-[10px] leading-4 text-[#6f7279]">{detailLine}</div></div>
          <div className="space-y-1.5 border-t border-[#e4e5e7] py-3">{config.resultTrustPoints.map((point, index) => <div key={`${point}-${index}`} className="flex items-start gap-2 text-[10px] text-[#5f6168]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#23b982]" /><span>{point}</span></div>)}</div>
          <div className="flex items-center justify-between border-t border-[#e4e5e7] py-3 text-[12px] text-[#5f6168]"><span>Total</span><strong className="text-[22px] text-[#3a3c41]">${service.price || "0"}</strong></div>
          <button type="button" onClick={openCheckout} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff684c] px-4 py-3 text-[12px] font-bold text-white transition hover:bg-[#e9573e]"><CreditCard className="h-4 w-4" />{formatBookingButtonLabel(config.bookingButtonLabel, service.price)}<ArrowRight className="h-4 w-4" /></button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[9px] text-[#77798b]"><ShieldCheck className="h-3.5 w-3.5" />Visual demo only · no charge will be made</p>
        </div>
      );
    }
    if (step === "confirm") {
      return (
        <div ref={checkoutRef} tabIndex={-1} aria-label="Demo checkout" className="ml-10 max-w-[82%] overflow-hidden rounded-[20px] border border-[#e4e5e7] bg-white shadow-[0_14px_36px_rgba(22,20,33,0.08)] outline-none focus:ring-2 focus:ring-[#ff684c]/30">
          <div className="border-b border-[#e4e5e7] bg-gradient-to-br from-white to-[#fff5f2] p-5"><div className="flex items-start justify-between gap-4"><div><div className="text-[20px] font-extrabold text-[#3a3c41]">{renderBookingWidgetTemplate(config.paymentConfirmationTemplate, { cardBrand: config.demoCardBrand, last4: config.demoCardLast4 })}</div><div className="mt-1 text-[11px] text-[#6f7279]">Review your cleaning, then preview payment.</div></div><span className="rounded-full border border-[#ffd2c8] bg-[#fff8f6] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#e9573e]">Demo checkout</span></div><div className="mt-4 space-y-3 rounded-xl border border-[#e4e5e7] bg-white p-4 text-[11px]"><div><div className="font-extrabold text-[#3a3c41]">{demo.schedule || `${service.availabilityDay} · ${service.availabilityTime}`}</div><div className="mt-1 text-[#6f7279]">{service.name} · {detailLine}</div></div><div className="border-t border-[#e4e5e7] pt-3 text-[#6f7279]">{demo.address}</div><div className="flex items-center justify-between border-t border-[#e4e5e7] pt-3"><span className="font-medium text-[#6f7279]">Total</span><strong className="text-[19px] text-[#3a3c41]">${service.price}</strong></div></div></div>
          <div className="p-5"><div className="flex items-center justify-between gap-3"><div className="text-[13px] font-extrabold text-[#3a3c41]">Payment</div><div className="flex items-center gap-1.5 text-[10px] font-bold text-[#6f7279]"><Lock className="h-3.5 w-3.5" /> Stripe-style payment preview</div></div><p className="mt-1 text-[10px] text-[#b46a29]">Mock fields only. Do not enter real card information.</p><div className="mt-4 overflow-hidden rounded-xl border border-[#d7d8dc] bg-white shadow-sm"><div role="textbox" aria-readonly="true" aria-label="Demo card number" tabIndex={0} className="border-b border-[#e4e5e7] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">Card number</div><div className="mt-1 flex items-center justify-between gap-3 font-mono text-[12px] tracking-wide"><span>4242 4242 4242 4242</span><span className="flex items-center gap-1.5 font-sans text-[10px] font-extrabold uppercase text-[#e9573e]"><CreditCard className="h-4 w-4" /> {config.demoCardBrand}</span></div></div><div className="grid grid-cols-2"><div role="textbox" aria-readonly="true" aria-label="Demo card expiry" tabIndex={0} className="px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">MM / YY</div><div className="mt-1 font-mono text-[12px]">12 / 34</div></div><div role="textbox" aria-readonly="true" aria-label="Demo card security code" tabIndex={0} className="border-l border-[#e4e5e7] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">CVC</div><div className="mt-1 flex items-center justify-between font-mono text-[12px]"><span>123</span><Lock className="h-3.5 w-3.5 text-[#9a9ba5]" /></div></div></div></div><div role="textbox" aria-readonly="true" aria-label="Demo name on card" tabIndex={0} className="mt-3 rounded-xl border border-[#d7d8dc] bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#ff684c]/20"><div className="text-[10px] font-medium text-[#6f7279]">Name on card</div><div className="mt-1 text-[12px]">{demo.fullName}</div></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#f5f5f3] p-3 text-[11px] text-[#5f6168]"><input type="checkbox" checked={savePaymentDetails} onChange={(event) => setSavePaymentDetails(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#d7d8dc] accent-[#ff684c]" /><span>Save my payment details for faster bookings next time <span className="text-[9px] text-[#9a9ba5]">(demo only)</span></span></label><p className="mt-4 text-[10px] leading-5 text-[#6f7279]">{config.demoPaymentNotice}</p><button type="button" onClick={completeCheckout} className="mt-4 w-full rounded-xl bg-[#ff684c] px-4 py-3.5 text-[12px] font-bold text-white transition hover:bg-[#e9573e]">{formatBookingButtonLabel(config.confirmButtonLabel, service.price)}</button></div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <DemoBubble customer color={config.customerBubbleColor}>{formatBookingButtonLabel(config.confirmButtonLabel, service.price)}</DemoBubble>
        <div className="ml-10 max-w-[82%] rounded-[20px] border border-[#d9f1e6] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.1em] text-[#168d61]"><CheckCircle2 className="h-4 w-4" />{config.confirmedEyebrow}</div><div className="mt-3 text-[18px] font-extrabold text-[#3a3c41]">{config.confirmedTitle}</div><div className="mt-3 text-[11px] leading-5 text-[#6f7279]">{renderBookingWidgetTemplate(config.confirmedScheduleTemplate, { providerName: service.providerName, day: demo.schedule || `${service.availabilityDay} at ${service.availabilityTime}`, time: service.availabilityTime })}</div><div className="mt-4 space-y-2 rounded-xl border border-[#e4e5e7] p-4 text-[11px]"><div className="flex justify-between gap-4"><span>{service.name}</span><strong>${service.price}</strong></div><div className="flex justify-between gap-4 text-gray-500"><span>Address</span><span className="text-right">{demo.address}</span></div><div className="flex justify-between gap-4 text-gray-500"><span>Payment</span><span>•••• {config.demoCardLast4}</span></div></div><p className="mt-4 text-[10px] text-[#6f7279]">{config.demoPaymentNotice}</p></div>
        <DemoBubble>{config.finalReminder}</DemoBubble>
      </div>
    );
  })();

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <p className="text-sm font-semibold text-violet-900">Fully interactive demo · internal preview only</p>
        <p className="mt-0.5 text-xs leading-relaxed text-violet-700">
          This simulation never saves customer details, creates a lead or booking, processes a card, checks live availability, changes the quote form, or contacts a customer.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,430px)_minmax(560px,1fr)] xl:items-start">
        <div className="space-y-5">
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
            <CardHeader className="pb-3"><CardTitle className="text-base">Questions and choices</CardTitle><CardDescription>Bedrooms and bathrooms are collected together. Their choices still control summary wording; extras and custom questions remain editable.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {config.questions.map((question, questionIndex) => (
                <div key={question.id} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Question {questionIndex + 1}</span>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={questionIndex === 0} onClick={() => moveQuestion(questionIndex, -1)} aria-label={`Move question ${questionIndex + 1} up`}><ChevronUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={questionIndex === config.questions.length - 1} onClick={() => moveQuestion(questionIndex, 1)} aria-label={`Move question ${questionIndex + 1} down`}><ChevronDown className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeQuestion(questionIndex)} aria-label={`Remove question ${questionIndex + 1}`}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <div className="grid grid-cols-[1fr_105px_105px] gap-2">
                    <Input aria-label={`Question ${questionIndex + 1} text`} className={fieldClass} value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} />
                    <select aria-label={`Question ${questionIndex + 1} type`} className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs" value={question.role} onChange={(event) => {
                      const role = event.target.value as BookingWidgetQuestionDraft["role"];
                      updateQuestion(questionIndex, { role, selectionMode: role === "extras" ? "multiple" : question.selectionMode });
                    }}>
                      <option value="bedrooms">Bedrooms</option><option value="bathrooms">Bathrooms</option><option value="extras">Extras</option><option value="custom">Custom</option>
                    </select>
                    <select aria-label={`Question ${questionIndex + 1} selection mode`} className="h-9 rounded-md border border-gray-200 bg-white px-2 text-xs" value={question.selectionMode} onChange={(event) => updateQuestion(questionIndex, { selectionMode: event.target.value as BookingWidgetQuestionDraft["selectionMode"] })}>
                      <option value="single">Single choice</option><option value="multiple">Multiple choice</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    {question.choices.map((choice, choiceIndex) => (
                      <div key={choiceIndex} className="flex items-center gap-1.5 pl-3">
                        <Input aria-label={`Question ${questionIndex + 1} choice ${choiceIndex + 1}`} className={fieldClass} value={choice} onChange={(event) => updateChoice(questionIndex, choiceIndex, event.target.value)} />
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={choiceIndex === 0} onClick={() => moveChoice(questionIndex, choiceIndex, -1)} aria-label={`Move question ${questionIndex + 1} choice ${choiceIndex + 1} up`}><ChevronUp className="h-4 w-4" /></Button>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={choiceIndex === question.choices.length - 1} onClick={() => moveChoice(questionIndex, choiceIndex, 1)} aria-label={`Move question ${questionIndex + 1} choice ${choiceIndex + 1} down`}><ChevronDown className="h-4 w-4" /></Button>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 text-red-500" onClick={() => removeChoice(questionIndex, choiceIndex)} aria-label={`Remove question ${questionIndex + 1} choice ${choiceIndex + 1}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="ml-3 h-9 gap-2" onClick={() => addChoice(questionIndex)}><Plus className="h-4 w-4" /> Add choice</Button>
                  </div>
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
            <CardHeader className="pb-3"><CardTitle className="text-base">Opening and sample pricing</CardTitle><CardDescription>Demo values only; no live pricing or availability is queried.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="opening-eyebrow">Result label</Label><Input id="opening-eyebrow" className={fieldClass} value={config.openingEyebrow} onChange={(event) => update("openingEyebrow", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="result-title">Result title</Label><Input id="result-title" className={fieldClass} value={config.resultTitle} onChange={(event) => update("resultTitle", event.target.value)} /></div>
              <div className="space-y-2"><Label>Trust points</Label>{config.resultTrustPoints.map((point, index) => <Input key={index} aria-label={`Trust point ${index + 1}`} className={fieldClass} value={point} onChange={(event) => update("resultTrustPoints", config.resultTrustPoints.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />)}</div>
              {config.services.map((item, index) => (
                <div key={item.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.id}</div>
                  <div className="grid grid-cols-[1fr_90px] gap-2"><Input aria-label={`${item.id} service name`} className={fieldClass} value={item.name} onChange={(event) => updateService(index, "name", event.target.value)} /><Input aria-label={`${item.id} preview price`} className={fieldClass} value={item.price} onChange={(event) => updateService(index, "price", event.target.value)} /></div>
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
        </div>

        <div className="xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)]">
          <Card className="gap-0 overflow-hidden border-gray-200 py-0 shadow-lg xl:flex xl:h-full xl:flex-col">
            <CardHeader className="border-b border-gray-100 bg-white py-4 xl:shrink-0"><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-[#E8735A]" /> Interactive customer preview</CardTitle><CardDescription>Run the complete demo here. Start over resets only this preview.</CardDescription></CardHeader>
            <CardContent className="bg-[radial-gradient(circle_at_8%_0%,rgba(255,104,76,0.18),transparent_30%),radial-gradient(circle_at_96%_100%,rgba(204,51,102,0.08),transparent_28%),#f5f5f3] p-3 sm:p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
              <div className="mx-auto flex w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-[#dfe0e2] bg-white shadow-[0_28px_80px_rgba(17,17,17,0.16)] xl:min-h-0 xl:flex-1" style={{ color: config.primaryColor }}>
                <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#282828] bg-[#111111] px-5 py-4 text-white sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-xl text-[#ff684c]">{config.brandLogoUrl ? <img src={config.brandLogoUrl} alt="Widget logo preview" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : config.headerIcon || <Bot className="h-5 w-5" />}</div>
                    <div className="min-w-0"><div className="truncate text-[18px] font-extrabold">{config.brandName || "Book with AI"}</div><div className="mt-1 flex items-center text-[12px] text-white/65"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#23b982] shadow-[0_0_0_4px_rgba(35,185,130,0.13)]" />{config.statusText}</div></div>
                  </div>
                  <button type="button" onClick={startOver} className="shrink-0 rounded-full border border-[#4a4a4a] bg-[#242424] px-3.5 py-2 text-[12px] font-bold text-white transition hover:border-[#ff684c] hover:bg-[#ff684c]">Start over</button>
                </div>

                {showSummary && (
                  <div className="shrink-0 border-b border-[#e4e5e7] bg-[#fff8f6]">
                    <button type="button" onClick={() => setSummaryOpen((open) => !open)} aria-expanded={summaryOpen} className="flex w-full items-center gap-2 px-5 py-3 text-left text-[12px] font-extrabold text-[#ff684c] sm:px-6"><Sparkles className="h-3.5 w-3.5" /><span>Your cleaning so far</span><strong className="ml-auto text-[14px] text-[#3a3c41]">${service.price || "0"}</strong><ChevronDown className={`h-4 w-4 text-[#3a3c41] transition ${summaryOpen ? "rotate-180" : ""}`} /></button>
                    {summaryOpen && <div className="grid grid-cols-2 gap-2 px-5 pb-3 sm:grid-cols-3 sm:px-6"><div className="flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Sparkles className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">SERVICE</small><strong className="truncate text-[10px] text-[#3a3c41]">{service.name}</strong></p></div><div className="flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Home className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">HOME</small><strong className="truncate text-[10px] text-[#3a3c41]">{roomSummary}</strong></p></div><div className="col-span-2 flex items-center gap-2 rounded-xl border border-[#e4e5e7] bg-white p-2.5 sm:col-span-1"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#fff0ec] text-[#ff684c]"><Check className="h-4 w-4" /></span><p className="grid min-w-0"><small className="text-[8px] font-extrabold tracking-[0.08em] text-[#77798b]">EXTRAS</small><strong className="truncate text-[10px] text-[#3a3c41]">{selectedExtras.length ? selectedExtras.join(", ") : "None selected"}</strong></p></div></div>}
                  </div>
                )}

                <div ref={conversationRef} className="relative flex h-[680px] flex-col gap-4 overflow-y-auto overscroll-contain bg-gradient-to-b from-white to-[#fcfcfd] px-4 py-5 sm:px-6 xl:h-auto xl:min-h-0 xl:flex-1">
                  <div className="flex shrink-0 items-center gap-3 pb-1"><span className="h-px flex-1 bg-[#e4e5e7]" /><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#a1a2ad]">Today</span><span className="h-px flex-1 bg-[#e4e5e7]" /></div>
                  <div data-completed-history className="flex shrink-0 flex-col gap-4">
                    {history.map((entry) => <div key={entry.id} data-history-entry className="relative min-w-0"><DemoHistoryRow entry={entry} customerColor={config.customerBubbleColor} trustPoints={config.resultTrustPoints} /></div>)}
                  </div>
                  <div ref={activeStageRef} data-active-stage data-step={step} className="relative flex shrink-0 flex-col gap-4">
                    {activeStage}
                  </div>
                </div>

                <form onSubmit={(event) => { event.preventDefault(); submitComposer(); }} className="shrink-0 border-t border-[#e4e5e7] bg-white px-4 py-3 sm:px-5">
                  {step === "address" && <div className="mb-2 flex gap-2"><button type="button" onClick={() => setComposerValue(config.addressExample)} className="rounded-full border border-[#ffd2c8] bg-[#fff8f6] px-3 py-1.5 text-[9px] font-bold text-[#d95740]">Use sample address</button></div>}
                  <div className="flex items-center gap-2 rounded-2xl border border-[#e4e5e7] bg-white p-1.5 pl-3 shadow-[0_5px_18px_rgba(29,25,42,0.04)] focus-within:border-[#ff684c] focus-within:ring-4 focus-within:ring-[#ff684c]/10">
                    <MessageCircle className="h-4 w-4 shrink-0 text-[#a1a2ad]" />
                    <Input value={composerValue} onChange={(event) => { setComposerValue(event.target.value); if (composerError) setComposerError(""); }} disabled={!composerEnabled} placeholder={composerPlaceholder} aria-label="Demo booking response" aria-invalid={Boolean(composerError)} className="h-10 flex-1 border-0 bg-transparent px-1 text-[12px] shadow-none focus-visible:ring-0 disabled:cursor-default disabled:opacity-100" />
                    <button type="submit" aria-label="Send demo response" disabled={!composerEnabled || !composerValue.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ff684c] text-white transition hover:bg-[#e9573e] disabled:bg-[#f1c9c1] disabled:text-white/80"><Send className="h-4 w-4" /></button>
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
