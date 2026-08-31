import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");
const widgetEmbedSource = fs.readFileSync(path.resolve("server/widgetEmbed.ts"), "utf8");

describe("booking widget customer-intake flow contract", () => {
  it("keeps the deterministic combined-details, calendar, extras, contact, address, quote, checkout, and confirmation steps", () => {
    expect(componentSource).toContain('type DemoStep = "request" | "serviceDetails" | "questions" | "schedule" | "extras" | "fullName" | "phone" | "email" | "address" | "checking" | "quote" | "confirm" | "payment" | "complete"');
    expect(componentSource).toContain("const continueServiceDetails = () => {");
    expect(componentSource).not.toContain('if (step === "serviceDetails") return submitCombinedServiceDetails()');
    expect(componentSource).toContain("confirmScheduleSelection");
    expect(componentSource).toContain('submitIntakeField("fullName", "phone")');
    expect(componentSource).toContain('if (step === "phone") return void submitPhone()');
    expect(componentSource).toContain('submitIntakeField("email", "address")');
    expect(componentSource).toContain('setStep("quote")');
    expect(componentSource).toContain('setStep("confirm")');
    expect(componentSource).toContain('setStep("payment")');
    expect(componentSource).toContain('setStep("complete")');
  });

  it("keeps the booking popup viewport-safe on mobile and never lets its launcher cover the composer", () => {
    expect(widgetEmbedSource).toContain('const WIDGET_VERSION = "2.6.1"');
    expect(widgetEmbedSource).toContain("var isMobile = window.innerWidth < 640;");
    expect(widgetEmbedSource).toContain("top: 'max(12px, env(safe-area-inset-top, 0px))'");
    expect(widgetEmbedSource).toContain("bottom: 'max(12px, env(safe-area-inset-bottom, 0px))'");
    expect(widgetEmbedSource).toContain("width: 'auto'");
    expect(widgetEmbedSource).toContain("height: 'auto'");
    expect(widgetEmbedSource).toContain("btn && CONTENT_MODE === 'booking'");
    expect(widgetEmbedSource).toContain("btn.style.display = val ? 'none' : '-webkit-flex'");
    expect(widgetEmbedSource).toContain("event.data.type !== 'mib-booking-widget-close'");
    expect(componentSource).toContain('window.parent.postMessage({ type: "mib-booking-widget-close" }, "*")');
    expect(componentSource).toContain('aria-label="Close booking widget"');
    expect(componentSource).toContain('text-[16px] shadow-none focus-visible:ring-0 disabled:cursor-default disabled:opacity-100 sm:h-10 sm:text-[12px]');
    expect(componentSource).toContain('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ff684c]');
  });

  it("uses the requested orange booking header while retaining the existing start-over and close controls", () => {
    expect(componentSource).toContain('border-b border-[#d94f35] bg-[linear-gradient(135deg,#ff684c_0%,#e9573e_100%)] text-white');
    expect(componentSource).toContain('border border-white/35 bg-white/15 font-bold text-white transition hover:border-white/55 hover:bg-white/25');
    expect(componentSource).toContain('aria-label="Close booking widget"');
    expect(componentSource).toContain('onClick={startOver}');
  });

  it("adds the supplied Wistia welcome experience only at the beginning of the request stage", () => {
    expect(componentSource).toContain('const WELCOME_VIDEO_WISTIA_MEDIA_ID = "bzlt49ipk1"');
    expect(componentSource).toContain("WELCOME_VIDEO_POSTER_URL");
    expect(componentSource).toContain("de3b8af433c63d912143e78eab71c6b3.jpg?image_crop_resized=960x540");
    expect(componentSource).toContain('src={WELCOME_VIDEO_POSTER_URL} width={960} height={540}');
    expect(componentSource).not.toContain(`/embed/medias/${"bzlt49ipk1"}/swatch`);
    expect(componentSource).toContain("WELCOME_VIDEO_IFRAME_URL");
    expect(componentSource).toContain("Before we get started, here&apos;s a quick hello from our team 👋");
    expect(componentSource).toContain("Meet Maids in Black");
    expect(componentSource).toContain("Watch our 20-second welcome");
    expect(componentSource.indexOf("Before we get started")).toBeLessThan(componentSource.indexOf("<DemoBubble>{config.greeting}</DemoBubble>"));
    expect(componentSource).toContain('aria-label="Play Madison\'s 20-second welcome video"');
    expect(componentSource).toContain('role="dialog" aria-modal="true"');
    expect(componentSource).toContain('allow="autoplay; fullscreen; picture-in-picture"');
  });

  it("keeps welcome-video state isolated from booking history and restores intentional focus", () => {
    expect(componentSource).toContain("const [welcomeVideoOpen, setWelcomeVideoOpen] = useState(false)");
    expect(componentSource).toContain("welcomeVideoCloseRef.current?.focus()");
    expect(componentSource).toContain('welcomeVideoReturnFocusRef = useRef<"trigger" | "prompt">("trigger")');
    expect(componentSource).toContain('welcomeVideoReturnFocusRef.current = "prompt"');
    expect(componentSource).toContain("openingPromptRef.current");
    expect(componentSource).toContain('if (event.key === "Escape")');
    expect(componentSource).toContain("setWelcomeVideoOpen(false)");
    expect(componentSource).not.toContain('{ kind: "video" }');
  });

  it("uses bounded click controls for room counts and preserves custom questions with fixed multi-select extras", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("Enter a bedroom count from 0 through 7.");
    expect(componentSource).toContain('<RoomCountControl label="Bedrooms" value={selectedBedrooms} minimum={0} maximum={7} onChange={updateItemizedBedrooms} />');
    expect(componentSource).toContain('<RoomCountControl label="Bathrooms" value={selectedBathrooms} minimum={0} maximum={20} onChange={updateItemizedBathrooms} />');
    expect(componentSource).toContain('aria-label={`Decrease ${label}`}');
    expect(componentSource).toContain('aria-label={`Increase ${label}`}');
    expect(componentSource).toContain('onClick={continueServiceDetails}');
    expect(componentSource).toContain('Math.min(7, Math.max(0, Math.floor(bedrooms)))');
    expect(componentSource).toContain('Math.min(20, Math.max(0, Math.floor(bathrooms)))');
    expect(componentSource).toContain('["request", "questions", "extras", "fullName", "phone", "email", "address"].includes(step)');
    expect(componentSource).toContain("nextUnansweredCustomQuestionIndex");
    expect(componentSource).toContain('config.questions[index].role === "custom"');
    expect(componentSource).toContain('config.questions.find((question) => question.role === "extras")');
    expect(componentSource).toContain("continueMultipleQuestion");
    expect(componentSource).toContain("continueCustomQuestion");
  });

  it("uses the fixed authoritative extras catalog with inline quantity steppers", () => {
    expect(componentSource).toContain("BOOKING_WIDGET_PRICED_EXTRAS");
    expect(componentSource).toContain("findBookingWidgetPricedExtra");
    expect(componentSource).toContain("extraQuantities: Record<string, number>");
    expect(componentSource).toContain("updateExtraQuantity");
    expect(componentSource).toContain("Decrease ${pricedExtra.label} quantity");
    expect(componentSource).toContain("Increase ${pricedExtra.label} quantity");
    expect(componentSource).toContain("Math.max(1, Math.floor(nextQuantity))");
    expect(componentSource).toContain("Fixed authoritative catalog");
    expect(componentSource).toContain('question.role === "extras" ?');
  });

  it("derives one calculated quote and reuses it in result, checkout, confirmation, and summary", () => {
    expect(componentSource).toContain("calculateBookingWidgetPrice");
    expect(componentSource).toContain("const quotePrice = String(priceBreakdown?.total ?? 0)");
    expect(componentSource).toContain("formatBookingButtonLabel(config.bookingButtonLabel, quotePrice)");
    expect(componentSource).toContain("formatBookingButtonLabel(config.confirmButtonLabel, quotePrice)");
    expect(componentSource).toContain("Authoritative pricing");
    expect(componentSource).not.toContain('aria-label={`${item.id} preview price`}');
    expect(componentSource).not.toContain("formatBookingButtonLabel(config.bookingButtonLabel, service.price)");
    expect(componentSource).not.toContain("formatBookingButtonLabel(config.confirmButtonLabel, service.price)");
  });

  it("keeps the editable availability message while revealing the quote without a timer-dependent terminal state", () => {
    expect(componentSource).toContain("config.availabilityCheckMessage");
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: config.availabilityCheckMessage }');
    expect(componentSource).toContain('setStep("quote")');
    expect(componentSource).not.toContain('window.setTimeout(() => setStep("quote")');
  });

  it("uses the shared inline calendar and explicit demo time slots instead of typed schedule submission", () => {
    expect(componentSource).toContain('import { Calendar } from "@/components/ui/calendar"');
    expect(componentSource).toContain('mode="single"');
    expect(componentSource).toContain("DEMO_TIME_SLOTS.map");
    expect(componentSource).toContain("md:grid-cols-[minmax(0,1.15fr)_minmax(180px,0.85fr)]");
    expect(componentSource).toContain("disabled={!selectedDate || !selectedTime}");
    expect(componentSource).toContain("Choose a date and time above");
    expect(componentSource).not.toContain('submitIntakeField("schedule", "extras")');
  });

  it("keeps the internal editor structurally isolated while live mode uses one progressive funnel identity", () => {
    expect(componentSource).toContain("leadCaptured: true");
    expect(componentSource).toContain('mode = "editor"');
    expect(componentSource).toContain('if (mode !== "live"');
    expect(componentSource).toContain('if (mode === "editor") setStep("complete")');
    expect(componentSource).toContain("trpc.bookingFunnel.begin.useMutation()");
    expect(componentSource).toContain("trpc.bookingFunnel.update.useMutation()");
    expect(componentSource).toContain("trpc.bookingFunnel.reserve.useMutation()");
    expect(componentSource).not.toContain("trpc.bookings.prepare.useMutation()");
    expect(componentSource).not.toContain("prepareBookingMutation.mutateAsync");
    expect(componentSource).not.toContain("createLead");
    expect(componentSource).not.toContain("sendSms");
    expect(componentSource).not.toContain("processPayment");
    expect(componentSource).not.toContain("savePricing");
    expect(componentSource).not.toContain("updatePricing");
  });

  it("creates one lead before phone history advances and locks duplicate submissions while pending", () => {
    const submitPhoneStart = componentSource.indexOf("const submitPhone = async () => {");
    const beginCall = componentSource.indexOf("await beginFunnelMutation.mutateAsync", submitPhoneStart);
    const phoneHistory = componentSource.indexOf("appendHistory(", beginCall);
    const phoneAdvance = componentSource.indexOf('setStep("email")', phoneHistory);
    expect(submitPhoneStart).toBeGreaterThan(-1);
    expect(componentSource).toContain("phoneCaptureInFlightRef.current");
    expect(componentSource).toContain("if (phoneCaptureInFlightRef.current) return");
    expect(componentSource).toContain('source: surface === "popup" ? "widget-popup" : "book-page"');
    expect(beginCall).toBeGreaterThan(submitPhoneStart);
    expect(phoneHistory).toBeGreaterThan(beginCall);
    expect(phoneAdvance).toBeGreaterThan(phoneHistory);
  });

  it("updates the same token-bound funnel record and replaces its optimistic version after success", () => {
    expect(componentSource).toContain('publicFunnelNumber: current.publicFunnelNumber');
    expect(componentSource).toContain("mutationToken: current.mutationToken");
    expect(componentSource).toContain("expectedVersion: current.version");
    expect(componentSource).toContain("rememberFunnelRecord(next)");
    expect(componentSource).toContain('if (field === "email" && mode === "live") await persistFunnelPatch({ customerEmail: trimmed })');
    expect(componentSource).toContain('if (mode === "live") await persistFunnelPatch({ address: trimmed })');
    for (const field of ["serviceId", "serviceName", "bedrooms", "bathrooms", "extras", "specialRequestNotes", "requestedLocalDate", "requestedLocalTime", "requestedTimeZone", "recurrence", "pricingVersion", "firstCleaningTotalCents", "futureVisitTotalCents", "priceSnapshot"]) {
      expect(componentSource).toContain(`${field}:`);
    }
    expect(componentSource).toContain("beginFunnelMutation.isPending || updateFunnelMutation.isPending");
  });

  it("atomically advances the same funnel identity when the final live action succeeds", () => {
    expect(componentSource).toContain("await reserveFunnelMutation.mutateAsync");
    expect(componentSource).toContain("publicFunnelNumber: current.publicFunnelNumber");
    expect(componentSource).toContain("mutationToken: current.mutationToken");
    expect(componentSource).toContain("expectedVersion: current.version");
    expect(componentSource).toContain("rememberFunnelRecord(result)");
    expect(componentSource).toContain("reserveFunnelMutation.isPending");
    expect(componentSource).not.toContain("prepareBookingMutation.mutateAsync");
  });

  it("uses one append-only ordered history data structure for completed messages and cards", () => {
    expect(componentSource).toContain("type DemoHistoryEntry = DemoHistoryItem & { id: number }");
    expect(componentSource).toContain("const [history, setHistory] = useState<DemoHistoryEntry[]>([])");
    expect(componentSource).toContain("setHistory((current) => [...current, ...entries])");
    expect(componentSource).toContain("data-completed-history");
    expect(componentSource).toContain("data-history-entry");
    expect(componentSource).toContain('data-completed-history className="flex shrink-0 flex-col gap-4"');
    expect(componentSource).toContain('data-step={step} className="relative flex shrink-0 flex-col gap-4"');
    expect(componentSource).toContain("history.map((entry)");
    expect(componentSource).not.toContain("reached(");
    expect(componentSource).not.toContain('className="contents"');
  });

  it("appends each finished question and answer before replacing the active stage", () => {
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: config.greeting }');
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: config.combinedDetailsQuestion }');
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: currentQuestion.prompt }');
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: extrasQuestion.prompt }');
    expect(componentSource).toContain('field === "fullName" ? config.fullNameQuestion');
    expect(componentSource).toContain('{ kind: "privacy" }');
    expect(componentSource).toContain('{ kind: "proof" }');
    expect(componentSource).toContain('{ kind: "message", sender: "assistant", text: config.addressQuestion }');
  });

  it("mounts exactly one active stage outside completed history and keeps the composer pinned outside the transcript", () => {
    expect(componentSource).toContain("const activeStage = (() => {");
    expect(componentSource).toContain("data-active-stage");
    expect(componentSource).toContain("data-step={step}");
    expect(componentSource).toContain("{activeStage}");
    expect(componentSource).toContain("overscroll-contain");
    expect(componentSource).toContain('className="shrink-0 border-t border-[rgba(35,35,40,0.08)]');
    expect(componentSource.indexOf("data-completed-history")).toBeLessThan(componentSource.indexOf("data-active-stage"));
    expect(componentSource.indexOf("data-active-stage")).toBeLessThan(componentSource.indexOf('<form onSubmit={(event)'));
  });

  it("replaces quote with a dedicated focused checkout and replaces checkout with confirmation", () => {
    expect(componentSource).toContain("const checkoutRef = useRef<HTMLDivElement>(null)");
    expect(componentSource).toContain("const openCheckout = () => {");
    expect(componentSource).toContain('setItemizationPanel("none")');
    expect(componentSource).toContain('setStep("confirm")');
    expect(componentSource).toContain('if (mode === "editor") setStep("complete")');
    expect(componentSource).toContain('mode === "live" ? () => void submitLiveBooking() : openCheckout');
    expect(componentSource).toContain("onClick={completeCheckout}");
    expect(componentSource).toContain('ref={checkoutRef} tabIndex={-1} aria-label="Demo checkout"');
    expect(componentSource).toContain('checkoutRef.current?.focus({ preventScroll: true })');
    expect(componentSource).toContain('if (step === "quote")');
    expect(componentSource).toContain('if (step === "confirm" && mode === "editor")');
    expect(componentSource).toContain("4242 4242 4242 4242");
  });

  it("uses native buttons for Book and Confirm so pointer, Enter, and Space share the same activation path", () => {
    expect(componentSource).toContain('onClick={mode === "live" ? () => void submitLiveBooking() : openCheckout}');
    expect(componentSource).toContain('<button type="button" onClick={completeCheckout}');
    expect(componentSource).not.toContain("onKeyDown={openCheckout}");
    expect(componentSource).not.toContain("onKeyDown={completeCheckout}");
  });

  it("keeps request language only before booking and uses real-booking confirmation copy after card setup", () => {
    expect(componentSource).toContain('mode === "live" ? "Requested times" : "Available times"');
    expect(componentSource).toContain('mode === "live" ? "REQUESTED DATE & TIME" : "DATE & TIME"');
    expect(componentSource).toContain("Booking confirmed");
    expect(componentSource).toContain("You&apos;re booked, {firstNameFromFullName(demo.fullName)}!");
    expect(componentSource).toContain("Your cleaning is booked. We&apos;ll text your appointment details and arrival updates shortly.");
    expect(componentSource).not.toContain("Request received");
    expect(componentSource).not.toContain("We received your requested date and time. We’ll confirm the appointment after reviewing availability.");
    expect(componentSource).not.toContain("We’ll confirm your recurring schedule when we review your requested appointment.");
  });

  it("renders one editable itemized order with authoritative base, extras, adjustments, and final total", () => {
    expect(componentSource).toContain('type ItemizationPanel = "none" | "base" | "extras" | "note"');
    expect(componentSource).toContain('aria-label="Editable itemized cleaning order"');
    expect(componentSource).toContain("priceBreakdown?.baseCleaningTotal");
    expect(componentSource).toContain("priceBreakdown?.standardSubtotal");
    expect(componentSource).toContain("priceBreakdown?.serviceAdjustment");
    expect(componentSource).not.toContain("roundingAdjustment");
    expect(componentSource).toContain("adjusted totals round to the nearest whole dollar");
    expect(componentSource).toContain("+ Add another extra");
    expect(componentSource).toContain("removeItemizedExtra");
    expect(componentSource).toContain("addItemizedExtra");
  });

  it("uses the authoritative current total for approved recurring future-visit discounts", () => {
    expect(componentSource).toContain("recurringFrequency: BookingWidgetRecurringFrequency");
    expect(componentSource).toContain('recurringFrequency: "one-time"');
    expect(componentSource).toContain("BOOKING_WIDGET_RECURRING_OPTIONS.map");
    expect(componentSource).toContain("calculateBookingWidgetRecurringPrice(priceBreakdown.total, option.id)");
    expect(componentSource).toContain("calculateBookingWidgetRecurringPrice(priceBreakdown.total, demo.recurringFrequency)");
    expect(componentSource).toContain("First clean stays ${quotePrice}");
    expect(componentSource).toContain("Your first cleaning remains full price. Savings begin with visit two.");
    expect(componentSource).toContain("No thanks, keep this as a one-time cleaning");
    expect(componentSource).not.toContain("const FIRST_CLEAN_PRICE = 405");
  });

  it("keeps the default one-time option visibly neutral until the customer explicitly selects it", () => {
    expect(componentSource).toContain('const [recurringChoiceTouched, setRecurringChoiceTouched] = useState(false)');
    expect(componentSource).toContain('const oneTimeSelected = recurringChoiceTouched && demo.recurringFrequency === "one-time"');
    expect(componentSource).toContain('aria-pressed={oneTimeSelected}');
    expect(componentSource).toContain('setRecurringChoiceTouched(true); setDemo((current) => ({ ...current, recurringFrequency: "one-time" }))');
    expect(componentSource).toContain('oneTimeSelected ? <CheckCircle2');
    expect(componentSource).toContain(': <Circle className="h-4 w-4 shrink-0 text-[#8b8e94]" />');
    expect(componentSource).toContain('border-[#dfe0e4] bg-white text-[#5f6168]');
    expect(componentSource).toContain('setRecurringChoiceTouched(false)');
  });

  it("keeps recurring choices compact and removes the requested trust and sample-address UI", () => {
    const quoteSource = componentSource.slice(componentSource.indexOf('if (step === "quote")'), componentSource.indexOf('if (step === "confirm"'));
    expect(componentSource).toContain("mt-2.5 grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-3");
    expect(componentSource).toContain("relative rounded-lg border px-1.5 py-1.5 text-center");
    expect(componentSource).toContain('text-[9px] font-extrabold text-[#3a3c41]');
    expect(componentSource).toContain('text-[13px] text-[#3a3c41]');
    expect(componentSource).not.toContain("mt-3 grid gap-2 sm:grid-cols-3");
    expect(quoteSource).not.toContain("config.resultTrustPoints.map");
    expect(componentSource).not.toContain("Use sample address");
    expect(componentSource).toContain("submitAddress(composerValue)");
  });

  it("uses narrow-popup presentation with blush-stone conversation depth and a distinct pinned composer", () => {
    expect(componentSource).toContain('min-[360px]:grid min-[360px]:grid-cols-[112px_1fr]');
    expect(componentSource).toContain('h-36 w-full bg-[#f7f5f2] object-contain min-[360px]:h-full');
    expect(componentSource).toContain('mode === "live" && surface === "popup" ? "px-4 py-3"');
    expect(componentSource).toContain('mode === "live" && surface === "popup" ? "h-10 w-10 rounded-[14px] text-lg"');
    expect(componentSource).toContain('bg-[radial-gradient(circle_at_90%_5%,rgba(255,224,215,0.32),transparent_34%),linear-gradient(145deg,#faf8f6_0%,#f8f4f1_55%,#fff8f5_100%)]');
    expect(componentSource).toContain('border-[rgba(35,35,40,0.08)] bg-[rgba(255,253,252,0.97)]');
    expect(componentSource).toContain('shadow-[0_-8px_24px_rgba(45,31,26,0.035)]');
    expect(componentSource).toContain('className="mt-4 space-y-3"');
    expect(componentSource).not.toContain('className="mt-5 space-y-5"');
    expect(componentSource).toContain('className="grid gap-3 py-3 sm:grid-cols-3"');
  });

  it("imports the Save Draft loading icon that renders while the async save is pending", () => {
    expect(componentSource).toMatch(/import \{[^}]*\bLoader2\b[^}]*\} from "lucide-react";/);
    expect(componentSource).toContain('saving ? <Loader2 className="h-4 w-4 animate-spin" />');
  });

  it("keeps the first-clean Book total and propagates only future-visit information to checkout and confirmation", () => {
    expect(componentSource).toContain("formatBookingButtonLabel(config.bookingButtonLabel, quotePrice)");
    expect(componentSource).toContain("First cleaning total");
    expect(componentSource).toContain("beginning with visit two");
    expect(componentSource).toContain("/visit from visit two");
    expect(componentSource).not.toContain("createRecurringBooking");
    expect(componentSource).not.toContain("saveRecurringFrequency");
    expect(componentSource).not.toContain("recurringMutation");
  });

  it("places the approved Stripe reservation notice above the mock card fields", () => {
    const notice = "Add a card to reserve your cleaning. You won’t be charged until after service. Your payment information is securely handled by Stripe and is never stored on our servers.";
    expect(componentSource).toContain(notice);
    expect(componentSource.indexOf(notice)).toBeLessThan(componentSource.indexOf('aria-label="Demo card number"'));
    expect(componentSource).toContain("Mock fields only. Do not enter real card information.");
  });

  it("renders the complete relaxed emoji-led post-booking list without removing price or recurring details", () => {
    expect(componentSource).toContain("BOOKING_CONFIRMATION_EXPECTATIONS.map");
    expect(componentSource).toContain('aria-label="What to expect after booking"');
    for (const expectedText of ["📩", "Booking confirmation", "🔔", "Helpful reminders", "🚗", "Track your team", "👋", "Arrival updates", "🧹", "Fully equipped professionals", "💳", "Payment after service", "💬", "Need to change something?"]) {
      expect(componentSource).toContain(expectedText);
    }
    expect(componentSource).toContain('className="mt-4 space-y-3"');
    expect(componentSource).toContain("BOOKING_CONFIRMATION_EXPECTATIONS.map(({ emoji, title, description })");
    expect(componentSource).not.toContain("index === BOOKING_CONFIRMATION_EXPECTATIONS.length - 1");
    expect(componentSource).toContain("selectedRecurringOption && recurringFutureVisitPrice !== null");
    expect(componentSource).toContain("{formatItemizedCurrency(recurringFutureVisitPrice)}/visit from visit two");
    expect(componentSource).toContain('className="text-[#3a3c41]">${quotePrice}</strong>');
  });

  it("adapts the public booking confirmation hierarchy into a compact live widget card", () => {
    const liveCompletionStart = componentSource.indexOf('if (mode === "live") return (');
    const liveCompletionEnd = componentSource.indexOf('\n    return (\n      <div className="flex flex-col gap-4">', liveCompletionStart);
    const liveCompletion = componentSource.slice(liveCompletionStart, liveCompletionEnd);
    for (const expectedText of ["Booking confirmed", "WHEN", "WHERE", "SERVICE", "TOTAL", "What happens next", "Confirmation", "Team updates", "Pay after"]) {
      expect(liveCompletion).toContain(expectedText);
    }
    expect(liveCompletion).not.toContain("Request number");
    expect(liveCompletion).not.toContain("Requested time");
    expect(liveCompletion).not.toContain("Request total");
    expect(liveCompletion).not.toContain("review your requested appointment");
  });

  it("keeps special requests unpriced, persists them as review notes, and clears them on Start over", () => {
    expect(componentSource).toContain("specialRequestNotes: string[]");
    expect(componentSource).toContain("specialRequestNotes: []");
    expect(componentSource).toContain('specialRequestNotes: [...current.specialRequestNotes, note]');
    expect(componentSource).toContain("Needs review");
    expect(componentSource).toContain("removeSpecialRequestNote");
    expect(componentSource).not.toContain("recognizeSpecialRequest");
    expect(componentSource).not.toContain("priceSpecialRequest");
  });

  it("reuses fixed extras and existing browser quantities for quote-stage edits", () => {
    expect(componentSource).toContain("BOOKING_WIDGET_PRICED_EXTRAS.filter");
    expect(componentSource).toContain("updateExtraQuantity(pricedExtra.id, quantity - 1)");
    expect(componentSource).toContain("updateExtraQuantity(pricedExtra.id, quantity + 1)");
    expect(componentSource).toContain('answers: { ...current.answers, [extrasQuestion.id]: remaining.length ? remaining : ["Nothing extra"] }');
    expect(componentSource).toContain("extraQuantities: pricedExtra.quantityUnit");
  });

  it("keeps the responsive transcript, privacy/proof content, and preview-only Stripe boundary", () => {
    expect(componentSource).toContain("xl:top-4 xl:h-[calc(100dvh-2rem)]");
    expect(componentSource).toContain("xl:h-auto xl:min-h-0 xl:flex-1");
    expect(componentSource).toContain("Your information stays private");
    expect(componentSource).toContain("WHY PEOPLE BOOK US");
    expect(componentSource).toContain("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/KoTsWjcUFAcYYhVB.png");
    expect(componentSource).toContain("object-contain");
    expect(componentSource).not.toContain("objectPosition");
    expect(componentSource).toContain("min-[360px]:grid-cols-[112px_1fr]");
    expect(componentSource).toContain("Demo checkout");
    expect(componentSource).toContain("Stripe-style payment preview");
    expect(componentSource).toContain('aria-label="Demo card number"');
    expect(componentSource).not.toContain("2,100+ completed cleanings");
    expect(componentSource).not.toContain("@stripe/");
    expect(componentSource).not.toContain("loadStripe");
    expect(componentSource).not.toContain("PaymentElement");
    expect(componentSource).not.toContain("PaymentIntent");
    expect(componentSource).not.toContain("confirmPayment");
  });
});
