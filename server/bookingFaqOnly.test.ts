import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = fs.readFileSync(path.resolve("server/bookingFunnelRouter.ts"), "utf8");
const widgetSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");
const sharedSource = fs.readFileSync(path.resolve("shared/bookingFunnel.ts"), "utf8");

describe("booking FAQ-only question handling", () => {
  it("grounds the public booking question endpoint in approved FAQ material with a bounded fallback", () => {
    const faqProcedure = routerSource.slice(routerSource.indexOf("answerFaq:"), routerSource.indexOf("begin: publicProcedure"));
    expect(sharedSource).toContain("question: z.string().trim().min(2).max(700)");
    expect(faqProcedure).toContain("publicProcedure");
    expect(faqProcedure).toContain("bookingFunnelFaqQuestionInputSchema");
    expect(faqProcedure).toContain("MAIDS_IN_BLACK_KNOWLEDGE_BASE");
    expect(faqProcedure).toContain('model: "gpt-5-mini"');
    expect(faqProcedure).toContain("max_completion_tokens: 180");
    expect(faqProcedure).toContain("${ENV.forgeApiUrl.replace(/\\/$/, \"\")}/v1/chat/completions");
    expect(faqProcedure).toContain("authorization: `Bearer ${ENV.forgeApiKey}`");
    expect(faqProcedure).not.toContain("retrieveKnowledge");
    expect(faqProcedure).toContain("Never invent or infer prices, availability, policies, guarantees, or service details.");
    expect(faqProcedure).toContain("BOOKING_FAQ_FALLBACK");
    expect(faqProcedure).not.toContain("getDb()");
    expect(faqProcedure).not.toContain("sendSms");
  });

  it("appends an FAQ question and answer without advancing the current booking stage or changing collected input", () => {
    const composerSource = widgetSource.slice(widgetSource.indexOf("const submitComposer = () =>"), widgetSource.indexOf("const handleSave = async"));
    expect(widgetSource).toContain("trpc.bookingFunnel.answerFaq.useMutation()");
    expect(composerSource).toContain("looksLikeBookingQuestion(question)");
    expect(widgetSource).toContain("const currentUnansweredBookingPrompt = () =>");
    expect(composerSource).toContain("const currentPrompt = currentUnansweredBookingPrompt()");
    expect(composerSource).toContain('appendHistory({ kind: "message", sender: "customer", text: question })');
    expect(composerSource).toContain("bookingFaqMutation.mutateAsync({ question })");
    expect(composerSource).toContain('{ kind: "message", sender: "assistant", text: result.answer },');
    expect(composerSource).toContain('text: currentPrompt');
    expect(composerSource).not.toContain("setStep(");
    expect(composerSource).not.toContain("setDemo(");
    expect(widgetSource).toContain('step === "request" && history.length === 0');
    expect(widgetSource).toContain("!bookingFaqMutation.isPending");
  });
});
