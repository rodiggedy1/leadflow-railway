import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { retrieveKnowledge } from "./madisonKnowledgeRetrieval";

const routerSource = fs.readFileSync(path.resolve("server/bookingFunnelRouter.ts"), "utf8");
const widgetSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");
const sharedSource = fs.readFileSync(path.resolve("shared/bookingFunnel.ts"), "utf8");

describe("booking FAQ-only question handling", () => {
  it("grounds the public booking question endpoint in approved FAQ material with a bounded fallback", () => {
    const faqProcedure = routerSource.slice(routerSource.indexOf("answerFaq:"), routerSource.indexOf("begin: publicProcedure"));
    expect(sharedSource).toContain("question: z.string().trim().min(2).max(700)");
    expect(faqProcedure).toContain("publicProcedure");
    expect(faqProcedure).toContain("bookingFunnelFaqQuestionInputSchema");
    expect(faqProcedure).toContain("await retrieveKnowledge(input.question)");
    expect(faqProcedure).toContain("RETRIEVED APPROVED FAQ INFORMATION");
    expect(faqProcedure).not.toContain("getApprovedBookingFaqAnswer");
    expect(routerSource).toContain('import { invokeLLM } from "./_core/llm"');
    expect(faqProcedure).toContain("await invokeLLM({");
    expect(faqProcedure).not.toContain("ENV.forgeApiUrl");
    expect(faqProcedure).not.toContain("ENV.forgeApiKey");
    expect(faqProcedure).not.toContain("/v1/chat/completions");
    expect(faqProcedure).toContain("await retrieveKnowledge(input.question)");
    expect(faqProcedure).toContain("Never invent or infer prices, availability, policies, guarantees, or service details.");
    expect(faqProcedure).toContain("BOOKING_FAQ_FALLBACK");
    expect(faqProcedure).toContain("[BOOKING_FAQ]");
    expect(faqProcedure).not.toContain("getDb()");
    expect(faqProcedure).not.toContain("sendSms");
  });

  it("retrieves compact approved payment and team passages instead of using a duplicate answer list", async () => {
    await expect(retrieveKnowledge("what form of payment do you take?")).resolves.toContain("Accepts all major credit and debit cards");
    await expect(retrieveKnowledge("how many cleaners come?")).resolves.toContain("Teams of **two cleaners** for most homes");
    expect(routerSource).not.toContain("getApprovedBookingFaqAnswer");
  });

  it("returns the approved pricing passage for the reported guide question without any customer-write path", async () => {
    const pricingKnowledge = await retrieveKnowledge("How does pricing work?");
    const faqProcedure = routerSource.slice(routerSource.indexOf("answerFaq:"), routerSource.indexOf("begin: publicProcedure"));

    expect(pricingKnowledge).toContain("## Pricing");
    expect(pricingKnowledge).toContain("Pricing is based on the number of bedrooms and bathrooms");
    expect(pricingKnowledge.indexOf("## Pricing")).toBeLessThan(pricingKnowledge.indexOf("## Services Offered"));
    for (const prohibitedWritePath of ["getDb()", "bookingFunnelRecords", "sendWidgetLeadCreatedNotifications", "broadcastOpsUpdate", "sendSms", "BookingPaymentCheckout"]) {
      expect(faqProcedure).not.toContain(prohibitedWritePath);
    }
  });

  it("appends an FAQ question and answer without advancing the current booking stage or changing collected input", () => {
    const composerSource = widgetSource.slice(widgetSource.indexOf("const submitComposer = () =>"), widgetSource.indexOf("const handleSave = async"));
    expect(widgetSource).toContain("trpc.bookingFunnel.answerFaq.useMutation()");
    expect(composerSource).toContain("looksLikeBookingQuestion(question)");
    expect(composerSource).toContain('appendHistory({ kind: "message", sender: "customer", text: question })');
    expect(composerSource).toContain("bookingFaqMutation.mutateAsync({ question })");
    expect(composerSource).toContain('appendHistory({ kind: "message", sender: "assistant", text: result.answer })');
    expect(composerSource).not.toContain("currentUnansweredBookingPrompt");
    expect(composerSource).not.toContain("setStep(");
    expect(composerSource).not.toContain("setDemo(");
    expect(widgetSource).toContain('step === "request" && history.length === 0');
    expect(widgetSource).toContain("!bookingFaqMutation.isPending");
  });
});
