import { describe, expect, it } from "vitest";
import {
  buildMadisonCurrentFactContext,
  buildMadisonRelevantConversationContext,
  getMadisonImmediatePriorAssistantMessage,
} from "./madisonSmsAgent";

describe("Madison current-turn draft context", () => {
  it("keeps only fact observations whose evidence is verbatim in the current message", () => {
    const context = buildMadisonCurrentFactContext(
      "I have a second apartment in Annapolis that I need clean",
      [
        {
          factKey: "property_city",
          value: "Annapolis",
          evidenceExcerpt: "Annapolis",
        },
        {
          factKey: "bedrooms",
          value: "2",
          evidenceExcerpt: "two-bedroom",
        },
      ],
    );

    expect(context).toContain("property_city: Annapolis");
    expect(context).not.toContain("bedrooms: 2");
    expect(context).toContain("Do not use facts from earlier conversation history");
  });

  it("does not create a factual context block when Shadow has no validated facts", () => {
    const context = buildMadisonCurrentFactContext(
      "Will do thank you 😊",
      [
        {
          factKey: "property_city",
          value: "Silver Spring",
          evidenceExcerpt: "Silver Spring",
        },
      ],
    );

    expect(context).toContain("No validated current-turn facts were persisted");
    expect(context).not.toContain("Silver Spring");
  });

  it("grounds a short current reply in the immediately preceding assistant turn", () => {
    const prior = getMadisonImmediatePriorAssistantMessage(
      [
        { role: "assistant", content: "Would you like to confirm tomorrow's cleaning?" },
        { role: "user", content: "Yes" },
      ],
      "Yes",
    );

    expect(prior).toBe("Would you like to confirm tomorrow's cleaning?");
  });

  it("keeps only the active exchange and excludes an older unrelated topic", () => {
    const relevant = buildMadisonRelevantConversationContext(
      [
        { role: "assistant", content: "How did your last cleaning go?" },
        { role: "user", content: "It was great." },
        { role: "assistant", content: "Please reply YES to confirm tomorrow's appointment." },
        { role: "user", content: "Yes" },
      ],
      "Yes",
    );

    expect(relevant).toEqual([
      { role: "assistant", content: "Please reply YES to confirm tomorrow's appointment." },
    ]);
    expect(relevant.map((message) => message.content).join(" ")).not.toContain("last cleaning");
  });

  it("does not select an older assistant topic when the current turn is not in the supplied context", () => {
    const prior = getMadisonImmediatePriorAssistantMessage(
      [{ role: "assistant", content: "How did your last cleaning go?" }],
      "Yes",
    );

    expect(prior).toBeNull();
  });

  it("uses the inbound provider message ID when repeated short replies exist", () => {
    const prior = getMadisonImmediatePriorAssistantMessage(
      [
        { role: "assistant", content: "How did your last cleaning go?", messageId: "a1" },
        { role: "user", content: "Yes", messageId: "old-yes" },
        { role: "assistant", content: "Reply YES to confirm tomorrow's appointment.", messageId: "a2" },
        { role: "user", content: "Yes", messageId: "current-yes" },
      ],
      "Yes",
      "current-yes",
    );

    expect(prior).toBe("Reply YES to confirm tomorrow's appointment.");
  });
});
