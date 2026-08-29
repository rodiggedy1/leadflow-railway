import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");

describe("booking widget customer-intake flow contract", () => {
  it("runs combined details, schedule, extras, contact, address, and availability checking before the priced result", () => {
    expect(componentSource).toContain('["request", "serviceDetails", "questions", "schedule", "extras", "fullName", "phone", "email", "address", "checking", "quote", "confirm", "complete"]');
    expect(componentSource).toContain('if (step === "serviceDetails") return submitCombinedServiceDetails()');
    expect(componentSource).toContain('submitIntakeField("schedule", "extras")');
    expect(componentSource).toContain('submitIntakeField("fullName", "phone")');
    expect(componentSource).toContain('if (step === "phone") return submitPhone()');
    expect(componentSource).toContain('submitIntakeField("email", "address")');
    expect(componentSource).toContain('setStep("checking")');
  });

  it("requires both combined room counts, then preserves custom questions and editable multi-select extras", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("Enter both bedrooms and bathrooms, for example: 2 bed 2 bath.");
    expect(componentSource).toContain("nextUnansweredCustomQuestionIndex");
    expect(componentSource).toContain('question.role !== "custom"');
    expect(componentSource).toContain('config.questions.find((question) => question.role === "extras")');
    expect(componentSource).toContain("continueMultipleQuestion");
  });

  it("shows the editable availability transition before revealing the quote", () => {
    expect(componentSource).toContain('if (step !== "checking") return');
    expect(componentSource).toContain('window.setTimeout(() => setStep("quote"), 900)');
    expect(componentSource).toContain("config.availabilityCheckMessage");
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
    expect(componentSource).toContain('setStep("confirm")');
    expect(componentSource).not.toContain("service.rating");
    expect(componentSource).not.toContain("service.completedJobs");
  });
});
