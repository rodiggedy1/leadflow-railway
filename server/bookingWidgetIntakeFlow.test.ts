import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");

describe("booking widget customer-intake flow contract", () => {
  it("runs contact collection and availability checking before the priced opening", () => {
    expect(componentSource).toContain('["request", "questions", "fullName", "phone", "email", "schedule", "checking", "quote", "address", "confirm", "complete"]');
    expect(componentSource).toContain('submitIntakeField("fullName", "phone")');
    expect(componentSource).toContain('submitIntakeField("phone", "email")');
    expect(componentSource).toContain('submitIntakeField("email", "schedule")');
    expect(componentSource).toContain('submitIntakeField("schedule", "checking")');
  });

  it("skips only inferred service questions and preserves configured extras and custom questions", () => {
    expect(componentSource).toContain("buildInferredQuestionAnswers(resolved, config.questions)");
    expect(componentSource).toContain("nextUnansweredQuestionIndex");
    expect(componentSource).toContain("demo.inferredQuestionIds.includes(question.id)");
  });

  it("shows the editable availability transition before revealing the quote", () => {
    expect(componentSource).toContain('if (step !== "checking") return');
    expect(componentSource).toContain('window.setTimeout(() => setStep("quote"), 900)');
    expect(componentSource).toContain("config.availabilityCheckMessage");
  });

  it("keeps customer-entered contact data local to the interactive preview", () => {
    expect(componentSource).not.toContain("createBooking");
    expect(componentSource).not.toContain("sendSms");
    expect(componentSource).not.toContain("processPayment");
  });
});
