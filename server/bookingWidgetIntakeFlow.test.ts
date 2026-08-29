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

  it("requires both combined room counts and preserves custom questions and editable multi-select extras", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("Enter both bedrooms and bathrooms, for example: 2 bed 2 bath.");
    expect(componentSource).toContain("nextUnansweredCustomQuestionIndex");
    expect(componentSource).toContain('config.questions[index].role === "custom"');
    expect(componentSource).toContain('config.questions.find((question) => question.role === "extras")');
    expect(componentSource).toContain("continueMultipleQuestion");
    expect(componentSource).toContain("continueCustomQuestion");
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
    expect(componentSource).toContain('const openCheckout = () => setStep("confirm")');
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

  it("keeps the responsive transcript, privacy/proof content, and preview-only Stripe boundary", () => {
    expect(componentSource).toContain("xl:top-4 xl:h-[calc(100dvh-2rem)]");
    expect(componentSource).toContain("xl:h-auto xl:min-h-0 xl:flex-1");
    expect(componentSource).toContain("Your information stays private");
    expect(componentSource).toContain("WHY PEOPLE BOOK US");
    expect(componentSource).toContain("/manus-storage/book-with-ai-cleaner-team_ea9c2c7d.png");
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
