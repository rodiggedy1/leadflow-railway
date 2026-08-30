import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");

describe("booking widget customer-intake flow contract", () => {
  it("keeps the deterministic combined-details, calendar, extras, contact, address, quote, checkout, and confirmation steps", () => {
    expect(componentSource).toContain('type DemoStep = "request" | "serviceDetails" | "questions" | "schedule" | "extras" | "fullName" | "phone" | "email" | "address" | "checking" | "quote" | "confirm" | "complete"');
    expect(componentSource).toContain('if (step === "serviceDetails") return submitCombinedServiceDetails()');
    expect(componentSource).toContain("confirmScheduleSelection");
    expect(componentSource).toContain('submitIntakeField("fullName", "phone")');
    expect(componentSource).toContain('if (step === "phone") return submitPhone()');
    expect(componentSource).toContain('submitIntakeField("email", "address")');
    expect(componentSource).toContain('setStep("quote")');
    expect(componentSource).toContain('setStep("confirm")');
    expect(componentSource).toContain('setStep("complete")');
  });

  it("adds the supplied Wistia welcome experience only at the beginning of the request stage", () => {
    expect(componentSource).toContain('const WELCOME_VIDEO_WISTIA_MEDIA_ID = "bzlt49ipk1"');
    expect(componentSource).toContain("WELCOME_VIDEO_SWATCH_URL");
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

  it("requires supported combined room counts and preserves custom questions with fixed multi-select extras", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("Enter both bedrooms and bathrooms, for example: 2 bed 2 bath.");
    expect(componentSource).toContain("Enter a bedroom count from 0 through 7.");
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

  it("keeps customer-entered contact data local to the interactive preview", () => {
    expect(componentSource).toContain("leadCaptured: true");
    expect(componentSource).not.toContain("createBooking");
    expect(componentSource).not.toContain("createLead");
    expect(componentSource).not.toContain("sendSms");
    expect(componentSource).not.toContain("processPayment");
    expect(componentSource).not.toContain("savePricing");
    expect(componentSource).not.toContain("updatePricing");
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
    expect(componentSource).toContain('className="shrink-0 border-t border-[#e4e5e7]');
    expect(componentSource.indexOf("data-completed-history")).toBeLessThan(componentSource.indexOf("data-active-stage"));
    expect(componentSource.indexOf("data-active-stage")).toBeLessThan(componentSource.indexOf('<form onSubmit={(event)'));
  });

  it("replaces quote with a dedicated focused checkout and replaces checkout with confirmation", () => {
    expect(componentSource).toContain("const checkoutRef = useRef<HTMLDivElement>(null)");
    expect(componentSource).toContain("const openCheckout = () => {");
    expect(componentSource).toContain('setItemizationPanel("none")');
    expect(componentSource).toContain('setStep("confirm")');
    expect(componentSource).toContain('const completeCheckout = () => setStep("complete")');
    expect(componentSource).toContain("onClick={openCheckout}");
    expect(componentSource).toContain("onClick={completeCheckout}");
    expect(componentSource).toContain('ref={checkoutRef} tabIndex={-1} aria-label="Demo checkout"');
    expect(componentSource).toContain('checkoutRef.current?.focus({ preventScroll: true })');
    expect(componentSource).toContain('if (step === "quote")');
    expect(componentSource).toContain('if (step === "confirm")');
    expect(componentSource).toContain("4242 4242 4242 4242");
  });

  it("uses native buttons for Book and Confirm so pointer, Enter, and Space share the same activation path", () => {
    expect(componentSource).toContain('<button type="button" onClick={openCheckout}');
    expect(componentSource).toContain('<button type="button" onClick={completeCheckout}');
    expect(componentSource).not.toContain("onKeyDown={openCheckout}");
    expect(componentSource).not.toContain("onKeyDown={completeCheckout}");
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

  it("keeps special requests as unpriced browser-only review notes and clears them on Start over", () => {
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
    expect(componentSource).toContain("sm:aspect-[2.75/1]");
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
