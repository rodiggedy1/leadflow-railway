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
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions, alwaysOnEnrollments, smsOptOuts, jobSmsReplies, cleanerJobs, cleanerProfiles } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { processLeadReply } from "./conversationEngine";
import { processLeadReplyV2 } from "./engine";
import type { ChatMessage, ConversationContext } from "./conversationEngine";
import type { ConversationStage } from "../drizzle/schema";
import { normalizePhone } from "./routers";
import { getNextAvailableSlots } from "./availability";
import { markReactivationContactReplied } from "./campaignRouter";
import { markAlwaysOnContactReplied } from "./alwaysOnSend";
import { handleReviewReplyForJob } from "./reviewRouter";
import { handleRatingReply } from "./qualityRouter";
import { processLeadReply as processReactivationReply } from "./conversationEngine";
import { logActivity } from "./activityLogger";
import { registerBarkWebhookRoute } from "./barkWebhook";
import { registerEmailLeadWebhookRoute } from "./emailLeadWebhook";
import { ENV } from "./_core/env";

export function registerWebhookRoutes(app: Express) {
  // Bark.com lead integration (Zapier webhook)
  registerBarkWebhookRoute(app);

  // Email lead integration (Mailgun inbound)
  registerEmailLeadWebhookRoute(app);

  app.post("/api/webhooks/openphone", async (req, res) => {
    // Acknowledge immediately — OpenPhone expects a 200 within 5 seconds
    res.status(200).json({ received: true });

    try {
      const event = req.body;

      // Only handle inbound SMS messages
      if (event?.type !== "message.received") return;

      const msg = event?.data?.object;

      // Log the full payload for debugging
      console.log(`[Webhook] Event type: ${event?.type}, direction: ${msg?.direction}`);
      console.log(`[Webhook] Payload: from=${msg?.from} to=${JSON.stringify(msg?.to)} body=${msg?.body ?? msg?.text}`);

      if (!msg || msg.direction !== "incoming") {
        console.log(`[Webhook] Skipping: not an incoming message (direction=${msg?.direction})`);
        return;
      }
      // Guard: only process messages addressed to THIS project's phone number.
      // Prevents cross-project contamination when multiple projects share the same
      // OpenPhone account or the same webhook URL receives events from other numbers.
      //
      // Three cases:
      //   1. Env is set + payload has ID + they match → allow
      //   2. Env is set + payload has ID + they differ → block (wrong number)
      //   3. Env is set + payload has NO ID            → allow (older API versions omit it)
      //   4. Env is NOT set                            → allow all (misconfigured — log a warning)
      const configuredNumberId = ENV.openPhoneNumberId;
      if (!configuredNumberId) {
        console.warn("[Webhook] OPENPHONE_PHONE_NUMBER_ID is not set — processing messages from ALL numbers. Set this env var to filter by number.");
      } else if (msg.phoneNumberId && msg.phoneNumberId !== configuredNumberId) {
        console.log(`[Webhook] Skipping: phoneNumberId ${msg.phoneNumberId} does not match configured ${configuredNumberId}`);
        return;
      }

      const rawPhone: string = msg.from;
      // OpenPhone uses 'text' field; fall back to 'body' for compatibility
      const inboundText: string = msg.text ?? msg.body ?? "";

      // Idempotency key: OpenPhone has at-least-once delivery semantics and may
      // retry the same event. Use the message ID to deduplicate.
      const inboundMessageId: string | undefined = msg.id;

      if (!rawPhone || !inboundText.trim()) {
        console.warn(`[Webhook] Skipping: empty phone or text (phone=${rawPhone}, text=${inboundText})`);
        return;
      }

      // Normalize to E.164 to match how we stored it
      const fromPhone = normalizePhone(rawPhone);

      console.log(`[Webhook] Inbound SMS from ${fromPhone}: "${inboundText}"`);

      // Fire-and-forget: store this reply against any matching cleaner jobs
      tryStoreJobSmsReply({ fromPhone, inboundText, openPhoneMessageId: inboundMessageId }).catch(() => {});

      // ── STOP / UNSUBSCRIBE detection ─────────────────────────────────────────
      // Only exact single-word matches (case-insensitive, trimmed) to avoid
      // false positives like "stop by the house" or "don't stop texting me".
      const normalizedText = inboundText.trim().toLowerCase();
      if (normalizedText === "stop" || normalizedText === "unsubscribe") {
        const db2 = await getDb();
        if (db2) {
          try {
            await db2.insert(smsOptOuts).values({ phone: fromPhone }).onDuplicateKeyUpdate({ set: { phone: fromPhone } });
            console.log(`[Webhook] Opt-out recorded for ${fromPhone}`);
          } catch {
            // Ignore duplicate key errors — already opted out
          }
          await sendSms({
            to: fromPhone,
            content: "You've been unsubscribed and won't receive further messages from us. Reply START to re-subscribe.",
          });
        }
        return; // Skip all AI processing
      }

      const db = await getDb();
      if (!db) {
        console.error("[Webhook] No DB connection available");
        return;
      }

      // Look up the most recent ACTIVE (non-DONE) session for this phone number.
      // Multiple sessions can exist per phone (e.g. same customer 6 months later).
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.leadPhone, fromPhone))
        .orderBy(conversationSessions.createdAt)
        .limit(50);

      // Prioritize quality rating, review, and reactivation sessions so that a customer
      // who has both a lead session and a reactivation/rating/review session gets their
      // reply routed to the correct scripted flow, not the lead AI engine.
      const reversedSessions = sessions.slice().reverse();
      const reviewSession = reversedSessions.find(
        s => s.stage === "QUALITY_RATING_REQUESTED" || s.stage === "QUALITY_MISSED_FOLLOWUP"
          || s.stage === "REVIEW_REQUESTED" || s.stage === "REVIEW_DONE"
          || s.stage === "REACTIVATION" || s.stage === "REACTIVATION_TIME"
      );
      const activeSession = reviewSession ??
        reversedSessions.find(s => s.stage !== "DONE");

      const session = activeSession ?? sessions[sessions.length - 1]; // fallback to most recent

      if (!session) {
        console.warn(`[Webhook] No conversation session found for ${fromPhone}.`);
        return;
      }

      // Don't respond to completed conversations (only if no active session exists)
      if (session.stage === "DONE") {
        console.log(`[Webhook] All conversations for ${fromPhone} are DONE. Skipping.`);
        return;
      }

      // ── Atomic idempotency claim ───────────────────────────────────────────────
      // OpenPhone has at-least-once delivery and can fire the same webhook 2-3x
      // within seconds. A simple read-then-check guard has a race condition: both
      // calls read the session before either writes lastProcessedMessageId, so both
      // pass the guard and both send SMS.
      //
      // Fix: atomically claim this messageId with an UPDATE that only succeeds if
      // no other instance has already claimed it. The instance that gets 0 affected
      // rows lost the race and must skip.
      if (inboundMessageId) {
        // Fast path: already processed (avoids the UPDATE on most requests)
        if (session.lastProcessedMessageId === inboundMessageId) {
          console.log(`[Webhook] Duplicate event (fast path) — messageId ${inboundMessageId} already processed for session ${session.id}. Skipping.`);
          return;
        }
        // Atomic claim: only the first concurrent call wins.
        // IMPORTANT: Must use isNull() + ne() Drizzle operators, NOT raw sql`!=`.
        // In MySQL, NULL != 'value' evaluates to NULL (not TRUE), so a raw sql
        // template would make the WHERE clause evaluate to NULL when the column
        // is NULL — matching no rows — causing the ?? 1 fallback to fire and
        // letting both concurrent calls through. isNull() generates IS NULL
        // correctly and ne() generates != only for non-null comparisons.
        const claimResult = await db
          .update(conversationSessions)
          .set({ lastProcessedMessageId: inboundMessageId })
          .where(
            and(
              eq(conversationSessions.id, session.id),
              or(
                isNull(conversationSessions.lastProcessedMessageId),
                ne(conversationSessions.lastProcessedMessageId, inboundMessageId)
              )
            )
          );
        // Drizzle mysql2 returns [ResultSetHeader, FieldPacket[]] — affectedRows is at [0].affectedRows
        // IMPORTANT: default to 0 (safe-fail), NOT 1. If the result shape is unexpected,
        // we must NOT proceed — the same ?? 1 fallback caused both outbound and inbound
        // message doubling by letting both concurrent webhook calls through the gate.
        const claimHeader = (claimResult as any)?.[0];
        const claimed = claimHeader?.affectedRows ?? claimHeader?.rowsAffected ?? (claimResult as any)?.affectedRows ?? (claimResult as any)?.rowsAffected ?? 0;
        if (claimed === 0) {
          console.log(`[Webhook] Duplicate event (atomic claim lost) — messageId ${inboundMessageId} already claimed for session ${session.id}. Skipping.`);
          return;
        }
        console.log(`[Webhook] Atomic claim succeeded for messageId ${inboundMessageId}, session ${session.id}.`);
      }

      // ── Supersede stale duplicate sessions ───────────────────────────────────
      // If multiple active sessions exist for this phone (e.g. a WIDGET_SIZING session
      // AND an AVAILABILITY session from a re-submit), mark all non-selected active
      // sessions as DONE immediately. This prevents the same inbound reply from being
      // processed twice — once per active session — which causes duplicate AI responses.
      const otherActiveSessions = sessions.filter(
        s => s.id !== session.id && s.stage !== "DONE"
      );
      if (otherActiveSessions.length > 0) {
        const otherIds = otherActiveSessions.map(s => s.id);
        for (const otherId of otherIds) {
          await db
            .update(conversationSessions)
            .set({ stage: "DONE" as any, autoFollowUpSent: 1 })
            .where(eq(conversationSessions.id, otherId));
        }
        console.log(`[Webhook] Superseded ${otherActiveSessions.length} duplicate active session(s) for ${fromPhone} — keeping session ${session.id}.`);
      }

      // If this phone belongs to a reactivation campaign contact, mark them as REPLIED
      markReactivationContactReplied(fromPhone).catch(err =>
        console.error("[Webhook] Failed to mark reactivation contact replied:", err)
      );

      // If this phone belongs to an always-on enrollment, mark them as REPLIED
      // and send an immediate SMS alert to the admin on first reply
      const alwaysOnReply = await markAlwaysOnContactReplied(fromPhone).catch(err => {
        console.error("[Webhook] Failed to mark always-on contact replied:", err);
        return null;
      });

      if (alwaysOnReply?.isFirstReply) {
        const displayName = alwaysOnReply.name ?? fromPhone;
        const groupLabel = alwaysOnReply.groupType
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        const adminAlertMsg = `🔔 Always-On Reply: ${displayName} (${fromPhone}) just responded to your ${groupLabel} campaign. Check the leads page to follow up.`;
        sendSms({ to: "+13029816191", content: adminAlertMsg }).catch(err =>
          console.error("[Webhook] Failed to send admin always-on alert:", err)
        );
        console.log(`[Webhook] Admin alerted for always-on first reply from ${fromPhone} (${groupLabel}).`);
      }

      // Parse message history
      let history: ChatMessage[] = [];
      try {
        history = JSON.parse(session.messageHistory ?? "[]");
      } catch {
        history = [];
      }

      // Belt-and-suspenders dedup: if the same text was already stored within the
      // last 10 seconds (e.g. OpenPhone retried without a message ID), skip it.
      const now = Date.now();
      const recentDuplicate = history.find(
        m => m.role === "user" && m.content === inboundText && typeof m.ts === "number" && (now - m.ts) < 10_000
      );
      if (recentDuplicate) {
        console.log(`[Webhook] Content dedup: identical message already in history within 10s for session ${session.id}. Skipping.`);
        return;
      }

      // Append the lead's inbound message to history first (always stored)
      history.push({ role: "user", content: inboundText, ts: now });

      // Trim history to last 20 messages to stay within varchar(5000)
      if (history.length > 20) {
        history = history.slice(-20);
      }

      // Log the inbound reply as an activity event
      logActivity({
        eventType: "lead_reply",
        title: `New reply from ${session.leadName ?? fromPhone}`,
        body: inboundText.length > 120 ? inboundText.slice(0, 120) + "…" : inboundText,
        meta: { sessionId: session.id, leadPhone: fromPhone, leadName: session.leadName, stage: session.stage },
      }).catch(() => {});

      // If agent has taken over (aiMode = 0), just store the inbound message and stop.
      // The agent will reply manually from the app.
      if (session.aiMode === 0) {
        console.log(`[Webhook] Manual mode for session ${session.id} — storing inbound, skipping AI reply.`);
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        return;
      }

      // If the lead is already booked, store the inbound message but do NOT send an AI reply.
      // Booked leads should only be contacted by a human agent — the AI must not re-engage them.
      if (session.isBooked === 1) {
        console.log(`[Webhook] Lead ${fromPhone} (session ${session.id}) is already BOOKED — storing inbound, skipping AI reply.`);
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        return;
      }

      // Compute dynamic slots for SLOT_CHOICE stage context
      // These are the next 2 available days from today — matching what was offered
      const dynamicSlots = getNextAvailableSlots(2);
      const offeredSlots: [string, string] | null =
        dynamicSlots.length >= 2
          ? [dynamicSlots[0]!.label, dynamicSlots[1]!.label]
          : null;

      // Parse extras from the session (stored as JSON string)
      let sessionExtras: string[] | null = null;
      if (session.extras) {
        try { sessionExtras = JSON.parse(session.extras); } catch { sessionExtras = null; }
      }

      // Build context for the conversation engine
      const context: ConversationContext = {
        stage: session.stage as ConversationStage,
        leadName: session.leadName ?? "there",
        leadPhone: fromPhone,
        quotedPrice: session.quotedPrice ?? "0",
        serviceType: session.serviceType ?? "Standard Cleaning",
        bedrooms: session.bedrooms ?? "1 Bedroom",
        bathrooms: session.bathrooms ?? "1 Bathroom",
        selectedSlot: session.selectedSlot,
        address: session.address,
        messageHistory: history,
        offeredSlots,
        extras: sessionExtras,
        // Reactivation-specific context (map DB column names to context field names)
        lastPrice: session.reactivationLastPrice ?? undefined,
        discountPct: session.reactivationDiscountPct ?? undefined,
        // Language context — critical for multilingual confirmation flow
        language: session.language ?? "en",
        preLangStage: session.preLangStage ?? undefined,
        // Lead source context (used by Bark leads to skip qualification)
        leadSource: session.leadSource ?? "form",
        barkQA: session.barkQA ?? undefined,
        // SMS flow variant assigned at lead creation ("A" = Madison, "B" = Jade)
        smsFlow: session.smsFlow ?? "B",
      };

      // ── REACTIVATION / REACTIVATION_TIME: Auto-reply DISABLED ───────────────────────────────────
      // Auto-replies are temporarily disabled while the reactivation flow is being
      // refined. Inbound replies are logged to the conversation history so they
      // are visible in the leads drawer, but no outbound SMS is sent.
      // To re-enable: remove this block and uncomment the handler below.
      if (session.stage === "REACTIVATION" || session.stage === "REACTIVATION_TIME") {
        console.log(`[Webhook] Reactivation reply received (auto-reply DISABLED): stage=${session.stage}, from=${fromPhone}, text="${inboundText}"`);
        // NOTE: user message was already appended to history at line 256 above — do NOT push again here.
        // Persisting the already-updated history is all that's needed.
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        return; // No outbound SMS sent
      }
      // ── (DISABLED) Reactivation auto-reply handler — re-enable when flow is ready ──
      // if (session.stage === "REACTIVATION" || session.stage === "REACTIVATION_TIME") {
      //   const reactivationResult = await processReactivationReply(inboundText, context);
      //   const reactivationSmsResult = await sendSms({ to: fromPhone, content: reactivationResult.reply });
      //   history.push({ role: "assistant", content: reactivationResult.reply, ts: Date.now() });
      //   if (history.length > 20) history = history.slice(-20);
      //   await db.update(conversationSessions).set({ stage: reactivationResult.nextStage as any, messageHistory: JSON.stringify(history) }).where(eq(conversationSessions.id, session.id));
      //   return;
      // }

      // ── QUALITY_RATING: Post-job 1-5 star rating flow ───────────────────────────
      if (session.stage === "QUALITY_RATING_REQUESTED" || session.stage === "QUALITY_MISSED_FOLLOWUP") {
        const ratingResult = await handleRatingReply(session.id, fromPhone, inboundText, session.stage);
        console.log(`[Webhook] Quality rating stage: ${session.stage} → ${ratingResult.newStage}. Reply: "${ratingResult.responseText}"`);
        // Send SMS FIRST — before DB update — so a DB error never blocks the thank-you message
        const ratingSmsResult = await sendSms({ to: fromPhone, content: ratingResult.responseText });
        if (!ratingSmsResult.success) {
          console.error(`[Webhook] Failed to send rating reply to ${fromPhone}:`, ratingSmsResult.error);
        }
        history.push({ role: "assistant", content: ratingResult.responseText, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({
            stage: ratingResult.newStage as any,
            messageHistory: JSON.stringify(history),
          })
          .where(eq(conversationSessions.id, session.id));
        return;
      }
      // ── REVIEW_REQUESTED / REVIEW_DONE: Post-cleaning review flow ───────────────
      if (session.stage === "REVIEW_REQUESTED" || session.stage === "REVIEW_DONE") {
        const reviewResult = await handleReviewReplyForJob(session.id, fromPhone, inboundText);
        console.log(`[Webhook] Review stage: ${session.stage} → ${reviewResult.newStage}. Reply: "${reviewResult.responseText}"`);
        history.push({ role: "assistant", content: reviewResult.responseText, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({
            stage: reviewResult.newStage,
            aiMode: reviewResult.switchToManual ? 0 : session.aiMode,
            messageHistory: JSON.stringify(history),
          })
          .where(eq(conversationSessions.id, session.id));
        const reviewSmsResult = await sendSms({ to: fromPhone, content: reviewResult.responseText });
        if (!reviewSmsResult.success) {
          console.error(`[Webhook] Failed to send review reply to ${fromPhone}:`, reviewSmsResult.error);
        }
        return;
      }

      // ── STOP / opt-out detection (before LLM, TCPA compliance) ────────────────
      const isStopReply = /^\s*(stop|unsubscribe|cancel|quit|end|remove me|opt.?out)\s*$/i.test(inboundText.trim());
      if (isStopReply) {
        console.log(`[Webhook] STOP received from ${fromPhone} — marking smsOptOut=1, OPTED_OUT on all enrollments, and ending conversation.`);
        // Mark the conversation session as opted out
        await db
          .update(conversationSessions)
          .set({ smsOptOut: 1, stage: "DONE", messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        // Mark ALL always-on enrollments for this phone as OPTED_OUT (global opt-out).
        // This ensures the phone is excluded from all future campaign batches across all groups.
        await db
          .update(alwaysOnEnrollments)
          .set({ status: "OPTED_OUT" })
          .where(eq(alwaysOnEnrollments.phone, fromPhone))
          .catch((err: unknown) => console.error("[Webhook] Failed to mark always-on enrollments OPTED_OUT:", err));
        // Permanently record in smsOptOuts so ALL future campaign pools exclude this phone.
        // This covers Command Center blasts, Reactivation Campaigns, and Always-On campaigns.
        await db
          .insert(smsOptOuts)
          .values({
            phone: fromPhone,
            optedOutAt: new Date(),
            source: "reply_stop",
            triggerMessage: inboundText.slice(0, 255),
          })
          .onDuplicateKeyUpdate({ set: { optedOutAt: new Date(), source: "reply_stop" } })
          .catch((err: unknown) => console.error("[Webhook] Failed to insert smsOptOuts:", err));
        // Send the required STOP acknowledgement (TCPA compliance)
        await sendSms({
          to: fromPhone,
          content: "You have been unsubscribed from Maids in Black SMS messages. You will receive no further texts. Reply START to re-subscribe.",
        }).catch(() => {});
        return;
      }

      // Process the reply through the LLM-first AI engine
      const result = await processLeadReplyV2(inboundText, context);

      console.log(`[Webhook] Stage: ${session.stage} → ${result.nextStage}. Reply: "${result.reply}"`);

      // Append the assistant's reply to history
      history.push({ role: "assistant", content: result.reply, ts: Date.now() });

      // Trim history to last 20 messages to stay within varchar(5000)
      if (history.length > 20) history = history.slice(-20);

      // Update the session in DB
      // Track lastAiMessageAt so the silence-follow-up cron can detect 5-min inactivity.
      // Reset autoFollowUpSent so a new nudge can fire if the conversation restarts.
      const isTerminalStage = ["DONE", "BOOKED", "NOT_INTERESTED", "FOLLOW_UP_SCHEDULED", "FUTURE_BOOKING"].includes(result.nextStage);

      // Extract language metadata from the result (set by language detection / confirmation)
      const extResult = result as typeof result & {
        _detectedLanguage?: string;
        _detectedLanguageName?: string;
        _preLangStage?: string;
        _confirmedLanguage?: string;
      };

      // Build language update fields
      const langUpdates: { language?: string; preLangStage?: string | null } = {};
      if (extResult._detectedLanguage) {
        // Language detected but not yet confirmed — store it temporarily so LANGUAGE_CONFIRM can use it
        langUpdates.language = extResult._detectedLanguage;
        langUpdates.preLangStage = extResult._preLangStage ?? session.stage;
      } else if (extResult._confirmedLanguage !== undefined) {
        // Language confirmed (yes or no) — finalize it and clear the temporary preLangStage
        langUpdates.language = extResult._confirmedLanguage;
        langUpdates.preLangStage = null; // Explicitly clear so it doesn't re-trigger language confirm
      }

      // Extract engine data (bedrooms, bathrooms, quotedPrice, serviceType) from new engine
      const engineData = (result as typeof result & { _engineData?: Record<string, string | undefined> })._engineData;

        await db
        .update(conversationSessions)
        .set({
          stage: result.nextStage,
          selectedSlot: result.extractedData?.selectedSlot ?? session.selectedSlot ?? undefined,
          address: result.extractedData?.address ?? session.address ?? undefined,
          callPreference: result.extractedData?.callPreference ?? session.callPreference ?? undefined,
          messageHistory: JSON.stringify(history),
          lastAiMessageAt: new Date(),
          autoFollowUpSent: isTerminalStage ? session.autoFollowUpSent : 0,
          // Sync isBooked flag whenever stage transitions to/from BOOKED
          ...(result.nextStage === "BOOKED" && session.stage !== "BOOKED"
            ? { isBooked: 1, bookedAt: new Date() }
            : {}),
          // Persist engine-extracted data (bedrooms, bathrooms, price, service type)
          ...(engineData?.bedrooms    ? { bedrooms:    engineData.bedrooms }    : {}),
          ...(engineData?.bathrooms   ? { bathrooms:   engineData.bathrooms }   : {}),
          ...(engineData?.quotedPrice ? { quotedPrice: engineData.quotedPrice } : {}),
          ...(engineData?.serviceType ? { serviceType: engineData.serviceType } : {}),
          ...(langUpdates.language !== undefined ? { language: langUpdates.language } : {}),
          // preLangStage: null clears it after confirmation; undefined means no change
          ...(langUpdates.preLangStage !== undefined ? { preLangStage: langUpdates.preLangStage } : {}),
          // Idempotency: record the message ID we just processed so duplicate events are dropped
          ...(inboundMessageId ? { lastProcessedMessageId: inboundMessageId } : {}),
        })
        .where(eq(conversationSessions.id, session.id));

      // Send the reply via OpenPhone
      const smsResult = await sendSms({
        to: fromPhone,
        content: result.reply,
      });

      if (!smsResult.success) {
        console.error(`[Webhook] Failed to send reply to ${fromPhone}:`, smsResult.error);
      } else {
        // Log the outbound AI SMS
        logActivity({
          eventType: "ai_sms_sent",
          title: `AI replied to ${session.leadName ?? fromPhone}`,
          body: result.reply.length > 120 ? result.reply.slice(0, 120) + "…" : result.reply,
          meta: { sessionId: session.id, leadPhone: fromPhone, leadName: session.leadName, stage: result.nextStage },
        }).catch(() => {});

        // Log booking event if conversation just reached BOOKED
        if (result.nextStage === "BOOKED" && session.stage !== "BOOKED") {
          logActivity({
            eventType: "booking",
            title: `🎉 Booking confirmed: ${session.leadName ?? fromPhone}`,
            body: `Slot: ${result.extractedData?.selectedSlot ?? session.selectedSlot ?? "TBD"}`,
            meta: { sessionId: session.id, leadPhone: fromPhone, leadName: session.leadName, selectedSlot: result.extractedData?.selectedSlot ?? session.selectedSlot },
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[Webhook] Error processing OpenPhone event:", err);
    }
  });

  // ── Job SMS reply matcher ─────────────────────────────────────────────────────
  // Runs as a fire-and-forget side-effect on every inbound message.
  // Checks if the sender phone matches a client or cleaner on any job within
  // the last 2 days. If so, stores the reply in job_sms_replies for the ops team.
  async function tryStoreJobSmsReply(params: {
    fromPhone: string;
    inboundText: string;
    openPhoneMessageId?: string;
  }): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      const { fromPhone, inboundText, openPhoneMessageId } = params;

      // Look for jobs in the last 2 days where this phone is either the client or cleaner.
      // cleanerJobs has customerPhone for the client; cleaner phone is on cleanerProfiles.
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const matchingJobs = await db
        .select({
          id: cleanerJobs.id,
          customerPhone: cleanerJobs.customerPhone,
          cleanerPhone: cleanerProfiles.phone,
        })
        .from(cleanerJobs)
        .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
        .where(
          and(
            or(
              eq(cleanerJobs.customerPhone, fromPhone),
              eq(cleanerProfiles.phone, fromPhone)
            ),
            // Only jobs from the last 2 days
            sql`${cleanerJobs.serviceDateTime} >= ${twoDaysAgo.toISOString().slice(0, 10)}`
          )
        )
        .limit(5);

      if (matchingJobs.length === 0) return;

      for (const job of matchingJobs) {
        const senderType = job.customerPhone === fromPhone ? "client" : "cleaner";
        await db
          .insert(jobSmsReplies)
          .values({
            cleanerJobId: job.id,
            senderType,
            senderPhone: fromPhone,
            body: inboundText,
            openPhoneMessageId: openPhoneMessageId ?? null,
            receivedAt: new Date(),
          })
          .onDuplicateKeyUpdate({ set: { body: inboundText } }) // idempotent on messageId
          .catch((err: unknown) => {
            // Ignore duplicate key errors (same message matched to same job twice)
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('Duplicate entry')) {
              console.error('[Webhook] Failed to store job SMS reply:', msg);
            }
          });
        console.log(`[Webhook] Stored job SMS reply for job ${job.id} from ${senderType} (${fromPhone})`);
      }
    } catch (err) {
      console.error('[Webhook] tryStoreJobSmsReply error:', err);
    }
  }
}
