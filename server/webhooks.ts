/**
 * OpenPhone Webhook Handler
 *
 * Registers POST /api/webhooks/openphone on the Express app.
 * OpenPhone sends a webhook event whenever a message is received on our number.
 *
 * Webhook payload shape (message.received):
 * {
 *   type: "message.received",
 *   data: {
 *     object: {
 *       id: string,
 *       from: string,        // sender phone (E.164)
 *       to: string[],        // recipient phone(s)
 *       body: string,        // message text
 *       direction: "incoming",
 *       phoneNumberId: string
 *     }
 *   }
 * }
 */

import type { Express } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { processLeadReply } from "./conversationEngine";
import type { ChatMessage, ConversationContext } from "./conversationEngine";
import type { ConversationStage } from "../drizzle/schema";

export function registerWebhookRoutes(app: Express) {
  app.post("/api/webhooks/openphone", async (req, res) => {
    // Acknowledge immediately — OpenPhone expects a 200 within 5 seconds
    res.status(200).json({ received: true });

    try {
      const event = req.body;

      // Only handle inbound SMS messages
      if (event?.type !== "message.received") return;

      const msg = event?.data?.object;
      if (!msg || msg.direction !== "incoming") return;

      const fromPhone: string = msg.from;
      const inboundText: string = msg.body ?? "";

      if (!fromPhone || !inboundText.trim()) return;

      console.log(`[Webhook] Inbound SMS from ${fromPhone}: "${inboundText}"`);

      const db = await getDb();
      if (!db) {
        console.error("[Webhook] No DB connection available");
        return;
      }

      // Look up the conversation session for this phone number
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.leadPhone, fromPhone))
        .limit(1);

      const session = sessions[0];

      if (!session) {
        console.warn(`[Webhook] No conversation session found for ${fromPhone}. Ignoring.`);
        return;
      }

      // Don't respond to completed conversations
      if (session.stage === "DONE") {
        console.log(`[Webhook] Conversation for ${fromPhone} is DONE. Skipping.`);
        return;
      }

      // Parse message history
      let history: ChatMessage[] = [];
      try {
        history = JSON.parse(session.messageHistory ?? "[]");
      } catch {
        history = [];
      }

      // Append the lead's inbound message to history
      history.push({ role: "user", content: inboundText });

      // Build context for the conversation engine
      const context: ConversationContext = {
        stage: session.stage as ConversationStage,
        leadName: session.leadName ?? "there",
        quotedPrice: session.quotedPrice ?? "0",
        serviceType: session.serviceType ?? "Standard Cleaning",
        bedrooms: session.bedrooms ?? "1 Bedroom",
        bathrooms: session.bathrooms ?? "1 Bathroom",
        selectedSlot: session.selectedSlot,
        address: session.address,
        messageHistory: history,
      };

      // Process the reply through the AI engine
      const result = await processLeadReply(inboundText, context);

      console.log(`[Webhook] Stage: ${session.stage} → ${result.nextStage}. Reply: "${result.reply}"`);

      // Append the assistant's reply to history
      history.push({ role: "assistant", content: result.reply });

      // Trim history to last 20 messages to stay within varchar(5000)
      if (history.length > 20) {
        history = history.slice(-20);
      }

      // Update the session in DB
      await db
        .update(conversationSessions)
        .set({
          stage: result.nextStage,
          selectedSlot: result.extractedData?.selectedSlot ?? session.selectedSlot ?? undefined,
          address: result.extractedData?.address ?? session.address ?? undefined,
          callPreference: result.extractedData?.callPreference ?? session.callPreference ?? undefined,
          messageHistory: JSON.stringify(history),
        })
        .where(eq(conversationSessions.id, session.id));

      // Send the reply via OpenPhone
      const smsResult = await sendSms({
        to: fromPhone,
        content: result.reply,
      });

      if (!smsResult.success) {
        console.error(`[Webhook] Failed to send reply to ${fromPhone}:`, smsResult.error);
      }
    } catch (err) {
      console.error("[Webhook] Error processing OpenPhone event:", err);
    }
  });
}
