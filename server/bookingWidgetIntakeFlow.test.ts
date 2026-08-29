import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");

describe("booking widget customer-intake flow contract", () => {
  it("runs combined details, schedule, extras, contact, address, and availability checking before the priced result", () => {
    expect(componentSource).toContain('["request", "serviceDetails", "questions", "schedule", "extras", "fullName", "phone", "email", "address", "checking", "quote", "confirm", "complete"]');
    expect(componentSource).toContain('if (step === "serviceDetails") return submitCombinedServiceDetails()');
    expect(componentSource).toContain("confirmScheduleSelection");
    expect(componentSource).toContain('submitIntakeField("fullName", "phone")');
    expect(componentSource).toContain('if (step === "phone") return submitPhone()');
    expect(componentSource).toContain('submitIntakeField("email", "address")');
    expect(componentSource).toContain('setStep("quote")');
  });

  it("requires both combined room counts, then preserves custom questions and editable multi-select extras", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("Enter both bedrooms and bathrooms, for example: 2 bed 2 bath.");
    expect(componentSource).toContain("nextUnansweredCustomQuestionIndex");
    expect(componentSource).toContain('question.role !== "custom"');
    expect(componentSource).toContain('config.questions.find((question) => question.role === "extras")');
    expect(componentSource).toContain("continueMultipleQuestion");
  });

  it("shows the editable availability transition while revealing the result without a timer-dependent state", () => {
    expect(componentSource).toContain("config.availabilityCheckMessage");
    expect(componentSource).toContain('setStep("quote")');
    expect(componentSource).not.toContain('window.setTimeout(() => setStep("quote")');
  });

  it("uses the shared inline calendar and explicit demo time slots instead of typed schedule submission", () => {
    expect(componentSource).toContain('import { Calendar } from "@/components/ui/calendar"');
    expect(componentSource).toContain('mode="single"');
    expect(componentSource).toContain("DEMO_TIME_SLOTS.map");
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

  it("shows the branded result and sends its Book button only to the existing demo payment step", () => {
    expect(componentSource).toContain("config.resultTitle");
    expect(componentSource).toContain("config.resultTrustPoints.map");
    expect(componentSource).toContain('{step === "quote" && (');
    expect(componentSource).toContain('onClick={() => setStep("confirm")}');
    expect(componentSource).toContain('{step === "confirm" && (');
    expect(componentSource).toContain("formatBookingButtonLabel(config.bookingButtonLabel, service.price)");
    expect(componentSource).not.toContain("service.rating");
    expect(componentSource).not.toContain("service.completedJobs");
  });

  it("renders a clearly labeled Stripe-style mock checkout without any Stripe or payment-processing integration", () => {
    expect(componentSource).toContain("Demo checkout");
    expect(componentSource).toContain("Stripe-style payment preview");
    expect(componentSource).toContain('aria-label="Demo card number"');
    expect(componentSource).toContain("Mock fields only. Do not enter real card information.");
    expect(componentSource).toContain("formatBookingButtonLabel(config.confirmButtonLabel, service.price)");
    expect(componentSource).not.toContain("@stripe/");
    expect(componentSource).not.toContain("loadStripe");
    expect(componentSource).not.toContain("PaymentElement");
    expect(componentSource).not.toContain("PaymentIntent");
    expect(componentSource).not.toContain("confirmPayment");
  });

  it("keeps the sticky preview within the viewport with an independently scrolling transcript and pinned composer", () => {
    expect(componentSource).toContain("xl:h-[clamp(420px,calc(100dvh-400px),700px)]");
    expect(componentSource).toContain("xl:h-auto xl:min-h-0 xl:flex-1");
    expect(componentSource).toContain("overscroll-contain");
    expect(componentSource).toContain("const [summaryOpen, setSummaryOpen] = useState(false)");
    expect(componentSource).toContain('behavior: "auto"');
    expect(componentSource).not.toContain('behavior: "smooth"');
    expect(componentSource).toContain('className="shrink-0 border-t border-[#e4e5e7]');
  });

  it("places the full privacy and photo-led proof cards before the address answer", () => {
    const phoneAnswerIndex = componentSource.indexOf('>{demo.phone}</DemoBubble>');
    const privacyIndex = componentSource.indexOf("Your information stays private");
    const addressQuestionIndex = componentSource.indexOf('{reached("address") && <DemoBubble>{config.addressQuestion}</DemoBubble>}');
    const proofIndex = componentSource.indexOf("<img src={CLEANER_TEAM_IMAGE_URL}");
    const addressAnswerIndex = componentSource.indexOf('>{demo.address}</DemoBubble>');

    expect(phoneAnswerIndex).toBeGreaterThan(-1);
    expect(privacyIndex).toBeGreaterThan(phoneAnswerIndex);
    expect(addressQuestionIndex).toBeGreaterThan(privacyIndex);
    expect(proofIndex).toBeGreaterThan(addressQuestionIndex);
    expect(addressAnswerIndex).toBeGreaterThan(proofIndex);
    expect(componentSource).toContain("/manus-storage/book-with-ai-cleaner-team_ea9c2c7d.png");
    expect(componentSource).not.toContain("2,100+ completed cleanings");
  });

  it("positions each active result, checkout, and completion card immediately after its transition", () => {
    expect(componentSource).toContain("const activeStepRef = useRef<HTMLDivElement>(null)");
    expect(componentSource).toContain('step === "quote" || step === "confirm" || step === "complete"');
    expect(componentSource.match(/ref=\{activeStepRef\}/g)?.length).toBe(3);
    expect(componentSource).toContain('onClick={() => setStep("confirm")}');
    expect(componentSource).toContain('setStep("complete")');
  });
});
