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
import { and, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions, alwaysOnEnrollments, smsOptOuts, jobSmsReplies, cleanerJobs, cleanerProfiles, cleanerRatingSmsLog, openphoneCallRecordings, opsChatMessages, completedJobs, quoteLeads, agents, candidates } from "../drizzle/schema";
import { sendSms, fetchCallRecordings } from "./openphone";
import { transcribeAudio } from "./_core/voiceTranscription";
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
import { notifyOwner } from "./_core/notification";
import { invokeLLM } from "./_core/llm";
import { sendPushToAll } from "./webPush";
import { registerBarkWebhookRoute } from "./barkWebhook";
import { registerEmailLeadWebhookRoute } from "./emailLeadWebhook";
import { registerThumbTackWebhookRoute } from "./thumbtackWebhook";
import { ENV } from "./_core/env";

export function registerWebhookRoutes(app: Express) {
  // Bark.com lead integration (Zapier webhook)
  registerBarkWebhookRoute(app);

  // Thumbtack lead integration (Zapier webhook)
  registerThumbTackWebhookRoute(app);

  // Email lead integration (Mailgun inbound)
  registerEmailLeadWebhookRoute(app);

  app.post("/api/webhooks/openphone", async (req, res) => {
    // Acknowledge immediately — OpenPhone expects a 200 within 5 seconds
    res.status(200).json({ received: true });

    try {
      const event = req.body;

      // Route by event type
      if (event?.type === "call.recording.completed") {
        await handleCallRecordingCompleted(event);
        return;
      }

      if (event?.type === "call.transcript.completed" || event?.type === "callTranscript") {
        await handleCallTranscriptCompleted(event);
        return;
      }

      // Track agent on-call status
      if (event?.type === "call.ringing" || event?.type === "call.answered" || event?.type === "call.initiated") {
        console.log(`[CallStatus] ${event.type} raw payload:`, JSON.stringify(event?.data?.object ?? event, null, 2));
        handleCallAnswered(event).catch(e => console.error("[CallStatus] answered error:", e));
        return;
      }

      if (event?.type === "call.completed") {
        console.log(`[CallStatus] call.completed raw payload:`, JSON.stringify(event?.data?.object ?? event, null, 2));
        handleCallCompleted(event).catch(e => console.error("[CallStatus] completed error:", e));
        return;
      }

      if (event?.type === "call.summary.completed") {
        handleCallSummaryCompleted(event).catch(e => console.error("[CallStatus] summary error:", e));
        return;
      }

      // Only handle inbound SMS messages
      if (event?.type !== "message.received") {
        // Log unhandled event types so we can see what OpenPhone actually sends
        if (event?.type?.startsWith('call.')) {
          console.log(`[Webhook] Unhandled call event type: "${event?.type}"`, JSON.stringify(event?.data?.object ?? {}, null, 2));
        }
        return;
      }

      const msg = event?.data?.object;
      // Log the full payload for debugging
      console.log(`[Webhook] Event type: ${event?.type}, direction: ${msg?.direction}`);
      console.log(`[Webhook] Payload: from=${msg?.from} to=${JSON.stringify(msg?.to)} body=${msg?.body ?? msg?.text}`);
      // ── CS line intercept ──────────────────────────────────────────────────
      // Messages to the CS line (202-888-5362, phoneNumberId=PN0wVLcpCq) are
      // stored as cs-inbound sessions and skipped from the main lead AI engine.
      // NOTE: This must run BEFORE the direction check so outbound agent replies
      // from the OpenPhone app are mirrored into the CS chat (direction=outgoing).
      const csNumberId = ENV.openPhoneCsNumberId;
      if (!csNumberId) {
        console.error("[Webhook] OPENPHONE_CS_PHONE_NUMBER_ID is not set — CS messages will NOT be intercepted and may be silently dropped. Set this env var immediately.");
      }
      if (csNumberId && msg?.phoneNumberId === csNumberId) {
        if (msg.direction === "outgoing") {
          // Agent replied directly from OpenPhone app — mirror into CS chat
          await handleCsOutboundMessage(msg);
        } else {
          await handleCsInboundMessage(msg);
        }
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
      if (!msg || msg.direction !== "incoming") {
        console.log(`[Webhook] Skipping: not an incoming message (direction=${msg?.direction})`);
        return;
      }
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
      const mediaUrls: string[] = (msg.media ?? []).map((m: any) => m.url ?? m.src ?? m.mediaUrl).filter(Boolean);

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

      // ── Cleaner rating reply detection ──────────────────────────────────────
      // If this inbound SMS is from a cleaner's phone (matched via cleaner_rating_sms_log),
      // post a system card to both the job thread and the command channel.
      tryHandleCleanerRatingReply({ fromPhone, inboundText }).catch(() => {});

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

      // ── Thumbtack SMS opportunity alert ─────────────────────────────────────
      // Thumbtack sends automated opportunity alerts from +16505164957.
      // Format: "New Thumbtack opportunity: B. P. needs Junk Removal in Lanham. Reply STOP..."
      // We parse the name, service, and city, then create a lead with a placeholder phone
      // so the agent can add the real customer number later and SMS them from the drawer.
      const THUMBTACK_ALERT_NUMBER = "+16505164957";
      if (
        fromPhone === THUMBTACK_ALERT_NUMBER &&
        /new thumbtack opportunity/i.test(inboundText)
      ) {
        console.log(`[Webhook] Thumbtack SMS opportunity detected: "${inboundText}"`);
        const dbTT = await getDb();
        if (dbTT) {
          // Parse: "New Thumbtack opportunity: <Name> needs <Service> in <City>."
          const match = inboundText.match(
            /new thumbtack opportunity[:\s]+(.+?)\s+needs\s+(.+?)\s+in\s+([^.]+)/i
          );
          const ttName    = match?.[1]?.trim() ?? "Thumbtack Lead";
          const ttService = match?.[2]?.trim() ?? "Cleaning";
          const ttCity    = match?.[3]?.trim() ?? "";
          // Extract the short URL (thmtk.com/... or any URL in the text)
          const urlMatch  = inboundText.match(/https?:\/\/\S+|thmtk\.com\/\S+/);
          const ttUrl     = urlMatch?.[0] ?? null;

          // ── Duplicate detection ─────────────────────────────────────────────
          // If the same name + service + city arrived within the last 24 hours,
          // skip creating a new session and just add a note to the existing one.
          const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
          const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
          const existingDupes = await dbTT
            .select()
            .from(conversationSessions)
            .where(
              and(
                eq(conversationSessions.leadName, ttName),
                eq(conversationSessions.serviceType, ttService),
                eq(conversationSessions.leadSource, "thumbtack-sms"),
                gte(conversationSessions.createdAt, cutoff)
              )
            )
            .limit(1);

          if (existingDupes.length > 0) {
            const dupe = existingDupes[0];
            console.log(`[Webhook] Thumbtack SMS duplicate detected — skipping, existing sessionId=${dupe.id}`);
            // Append a note to the existing session's message history
            try {
              const existing = dupe.messageHistory ? JSON.parse(dupe.messageHistory as string) : [];
              existing.push({
                role: "system",
                content: `[Duplicate Thumbtack alert received] ${inboundText}`,
                ts: Date.now(),
              });
              await dbTT
                .update(conversationSessions)
                .set({ messageHistory: JSON.stringify(existing) })
                .where(eq(conversationSessions.id, dupe.id));
            } catch (err) {
              console.error("[Webhook] Failed to append duplicate note:", err);
            }
            return; // Do not create a new session
          }

          const placeholderPhone = `thumbtack-sms-${Date.now()}`;
          const now = Date.now();
          const initialHistory = JSON.stringify([
            { role: "system", content: `Thumbtack SMS opportunity: ${inboundText}`, ts: now },
          ]);

          let ttSessionId: number | null = null;
          try {
            const [ins] = await dbTT.insert(conversationSessions).values({
              leadPhone: placeholderPhone,
              leadName: ttName,
              stage: "QUOTE_SENT" as any,
              serviceType: ttService,
              messageHistory: initialHistory,
              leadSource: "thumbtack-sms",
              aiMode: 0, // no AI — no real customer phone yet
              barkQA: ttCity ? `City: ${ttCity}${ttUrl ? ` | Link: ${ttUrl}` : ""}` : (ttUrl ?? null),
            } as any);
            ttSessionId = (ins as any).insertId ?? null;
            console.log(`[Webhook] Thumbtack SMS lead created — sessionId=${ttSessionId}, name=${ttName}, service=${ttService}, city=${ttCity}`);
          } catch (err) {
            console.error("[Webhook] Failed to create Thumbtack SMS session:", err);
          }

          // Post new_lead card to Command Chat
          const cardLines = [
            `📌 **Thumbtack Opportunity** · ${ttName}`,
            `🏠 **${ttService}**${ttCity ? ` · ${ttCity}` : ""}`,
            ttUrl ? `🔗 ${ttUrl}` : null,
            `⚠️ No phone yet — add customer number in lead to start SMS`,
          ].filter(Boolean).join("\n");

          const cardMeta = JSON.stringify({
            leadName: ttName,
            leadPhone: null,
            serviceType: ttService,
            size: ttCity || "",
            price: null,
            utmSource: "thumbtack-sms",
            sessionId: ttSessionId,
            arrivedAt: now,
            thumbtackUrl: ttUrl ? (ttUrl.startsWith('http') ? ttUrl : `https://${ttUrl}`) : null,
          });

          try {
            await dbTT.insert(opsChatMessages).values({
              cleanerJobId: null,
              channel: "command",
              authorName: "📌 Thumbtack Opportunity",
              authorRole: "system",
              body: cardLines,
              mediaUrl: null,
              quickAction: "new_lead",
              metadata: cardMeta,
            });
          } catch (err) {
            console.error("[Webhook] Failed to post Thumbtack SMS card:", err);
          }

          // Alert CS team
          const alertMsg = `📌 Thumbtack Opportunity: ${ttName} needs ${ttService}${ttCity ? ` in ${ttCity}` : ""}${ttUrl ? ` — ${ttUrl}` : ""}`;
          sendSms({ to: "+12028885362", content: alertMsg }).catch(() => {});
          sendSms({ to: "+13029816191", content: alertMsg }).catch(() => {});

          notifyOwner({
            title: `New Thumbtack Opportunity: ${ttName}`,
            content: `${ttService}${ttCity ? ` in ${ttCity}` : ""}${ttUrl ? `\n${ttUrl}` : ""}`,
          }).catch(() => {});
          void sendPushToAll({
            title: `📌 New Thumbtack Opportunity`,
            body: `${ttName} needs ${ttService}${ttCity ? ` in ${ttCity}` : ""}`,
            tag: `new-lead-thumbtack-${ttSessionId}`,
            url: "/ops-chat",
            playSound: true,
          });

          logActivity({
            eventType: "new_lead",
            title: `Thumbtack Opportunity: ${ttName}`,
            body: `${ttService}${ttCity ? ` in ${ttCity}` : ""}`,
            meta: { leadName: ttName, serviceType: ttService, city: ttCity, url: ttUrl, source: "thumbtack-sms" },
          }).catch(() => {});
        }
        return; // Do not process as a regular inbound SMS
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
          || s.stage === "REVIEW_REBOOKING_REQUESTED" || s.stage === "REVIEW_REBOOKING_DONE"
          || s.stage === "REACTIVATION" || s.stage === "REACTIVATION_TIME"
          || s.stage === "INTERVIEW_LINK_SENT" || s.stage === "INTERVIEW_NUDGE_1" || s.stage === "INTERVIEW_NUDGE_2"
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
      history.push({ role: "user", content: inboundText, ts: now, ...(mediaUrls.length > 0 ? { media: mediaUrls } : {}) } as any);

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

      // If the lead was booked within the last 30 days, do NOT send an AI auto-reply.
      // A booking older than 30 days is considered lapsed — the lead is fair game for re-engagement.
      const BOOKED_SILENCE_DAYS = 30;
      const bookedAt = session.bookedAt ? new Date(session.bookedAt).getTime() : null;
      const bookedRecently = session.isBooked === 1 && bookedAt !== null &&
        (Date.now() - bookedAt) < BOOKED_SILENCE_DAYS * 24 * 60 * 60 * 1000;
      if (bookedRecently) {
        console.log(`[Webhook] Lead ${fromPhone} (session ${session.id}) was booked ${Math.floor((Date.now() - bookedAt!) / 86400000)}d ago — storing inbound, skipping AI reply.`);
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

      // ── REVIEW_REBOOKING_REQUESTED: Post-review rebooking pitch reply ─────────
      if (session.stage === "REVIEW_REBOOKING_REQUESTED" || session.stage === "REVIEW_REBOOKING_DONE") {
        const firstName = (session.leadName ?? "there").split(" ")[0] ?? "there";
        const lc = inboundText.trim().toLowerCase();
        const isYes = /\b(yes|yeah|yep|sure|ok|okay|sounds good|please|definitely|absolutely|let's do it|lets do it|yes please|i'd like that|id like that)\b/i.test(lc);
        const isNo = /\b(no|nope|not now|maybe later|not interested|no thanks|no thank you|nah|pass)\b/i.test(lc);
        let replyMsg: string;
        // ALL replies surface in the pipeline so agents can see and act on them.
        // isYes  → CONFIRMATION ("New Leads" column — ready to book)
        // isNo   → UNHANDLED   ("Follow Up" column — agent can decide)
        // other  → UNHANDLED   ("Follow Up" column — agent can decide)
        let newStage: ConversationStage;
        if (isYes) {
          replyMsg = `Amazing, ${firstName}! 🎉 I'll have someone reach out shortly to lock in your spot. Talk soon!`;
          newStage = "CONFIRMATION";
        } else if (isNo) {
          replyMsg = `No worries at all, ${firstName}! If you ever need us again, just text back. 😊`;
          newStage = "UNHANDLED";
        } else {
          replyMsg = `Thanks for the reply, ${firstName}! I'll have someone from the team follow up with you. 😊`;
          newStage = "UNHANDLED";
        }
        history.push({ role: "user", content: inboundText, ts: Date.now() });
        history.push({ role: "assistant", content: replyMsg, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({ stage: newStage, messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        const replyResult = await sendSms({ to: fromPhone, content: replyMsg });
        if (!replyResult.success) {
          console.error(`[Webhook] Failed to send rebooking reply to ${fromPhone}:`, replyResult.error);
        }
        console.log(`[Webhook] Review rebooking reply: ${session.stage} → ${newStage}. isYes=${isYes}, isNo=${isNo}`);
        return;
      }

      // ── INTERVIEW_LINK_SENT / NUDGE: Candidate interview link flow ──────────────
      if (
        session.stage === "INTERVIEW_LINK_SENT" ||
        session.stage === "INTERVIEW_NUDGE_1" ||
        session.stage === "INTERVIEW_NUDGE_2"
      ) {
        // Any reply from the candidate — just acknowledge and mark done
        const firstName = (session.leadName ?? "there").split(" ")[0] ?? "there";
        const replyMsg = `Thanks ${firstName}! When you're ready, just use the link we sent you to start your interview. 😊`;
        const smsResult = await sendSms({ to: fromPhone, content: replyMsg });
        if (!smsResult.success) {
          console.error(`[Webhook] Failed to send interview reply to ${fromPhone}:`, smsResult.error);
        }
        history.push({ role: "user", content: inboundText, ts: Date.now() });
        history.push({ role: "assistant", content: replyMsg, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({ stage: "INTERVIEW_LINK_SENT", messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        console.log(`[Webhook] Interview link reply: ${session.stage} → INTERVIEW_LINK_SENT`);
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

  // ── Cleaner rating reply handler ──────────────────────────────────────────────
  // Runs fire-and-forget on every inbound SMS.
  // If the sender's phone matches a recent entry in cleaner_rating_sms_log,
  // posts a system card to both the job thread and the command channel.
  async function tryHandleCleanerRatingReply(params: {
    fromPhone: string;
    inboundText: string;
  }): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;

      const { fromPhone, inboundText } = params;

      // Look for the most recent rating SMS sent to this cleaner phone (within 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const logRows = await db
        .select()
        .from(cleanerRatingSmsLog)
        .where(
          and(
            eq(cleanerRatingSmsLog.cleanerPhone, fromPhone),
            sql`${cleanerRatingSmsLog.sentAt} >= ${sevenDaysAgo.toISOString().slice(0, 10)}`
          )
        )
        .orderBy(sql`${cleanerRatingSmsLog.sentAt} DESC`)
        .limit(1);

      const logRow = logRows[0];
      if (!logRow) return; // Not a cleaner rating reply

      const teamName = logRow.cleanerName ?? fromPhone;
      const starsStr = '★'.repeat(logRow.rating) + '☆'.repeat(5 - logRow.rating);
      const cardBody = `🧹 **${teamName}** replied to rating alert (${logRow.rating}-star ${starsStr}):\n"${inboundText}"`;

      // Post to job thread
      await db.insert(opsChatMessages).values({
        cleanerJobId: logRow.cleanerJobId,
        channel: null,
        authorName: '📱 Cleaner Reply',
        authorRole: 'system',
        body: cardBody,
        metadata: JSON.stringify({ cleanerPhone: fromPhone, cleanerJobId: logRow.cleanerJobId, rating: logRow.rating }),
      });

      // Post to command channel
      await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: 'command',
        authorName: '📱 Cleaner Reply',
        authorRole: 'system',
        body: cardBody,
        metadata: JSON.stringify({ cleanerPhone: fromPhone, cleanerJobId: logRow.cleanerJobId, rating: logRow.rating }),
      });

      console.log(`[Webhook] Cleaner rating reply from ${fromPhone} posted to job ${logRow.cleanerJobId} thread + command chat`);
    } catch (err) {
      console.error('[Webhook] tryHandleCleanerRatingReply error:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleCallRecordingCompleted
// Fired when OpenPhone finishes processing a call recording.
// Payload shape:
//   event.data.object = {
//     id: string,           // callId
//     direction: "incoming" | "outgoing",
//     participants: [{ phoneNumber: string, type: "user" | "external" }],
//     createdAt: string,    // ISO 8601 — when the call started
//     duration: number,     // seconds
//   }
// ─────────────────────────────────────────────────────────────────────────────
async function handleCallRecordingCompleted(event: any): Promise<void> {
  try {
    const call = event?.data?.object;
    if (!call?.id) {
      console.warn("[CallRecording] Missing call object or id in payload");
      return;
    }

    const callId: string = call.id;
    const direction: string = call.direction ?? "incoming";
    const callStartedAt = call.createdAt ? new Date(call.createdAt) : new Date();
    const durationSeconds: number = call.duration ?? 0;

    // Extract the external (lead) phone number from participants.
    // OpenPhone sends participants as a flat string array of phone numbers.
    // The internal/agent numbers are the CS line and main line — the external
    // participant is whichever number is NOT one of those.
    const participants: string[] = call.participants ?? [];
    const internalNumbers = [
      normalizePhone(ENV.openPhoneFromNumber ?? ""),
      normalizePhone("+12028885362"), // CS line
    ].filter(Boolean);
    const rawPhone = participants.find(p => !internalNumbers.includes(normalizePhone(p)));
    if (!rawPhone) {
      console.warn(`[CallRecording] No external participant phone for callId=${callId}, participants=${JSON.stringify(participants)}`);
      return;
    }
    const leadPhone = normalizePhone(rawPhone);

    console.log(`[CallRecording] Processing callId=${callId} direction=${direction} leadPhone=${leadPhone}`);

    // Fetch the recording URL from OpenPhone API
    const recordings = await fetchCallRecordings(callId);
    if (recordings.length === 0) {
      console.warn(`[CallRecording] No recordings returned for callId=${callId}`);
      return;
    }
    const recording = recordings[0]; // take the first (usually only one)

    const db = await getDb();
    if (!db) {
      console.error("[CallRecording] No DB connection");
      return;
    }

    // Match to the most recent active conversation session for this phone
    const sessions = await db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.leadPhone, leadPhone))
      .orderBy(conversationSessions.createdAt)
      .limit(50);

    const session =
      sessions.slice().reverse().find(s => s.stage !== "DONE") ??
      sessions[sessions.length - 1];

    if (!session) {
      console.warn(`[CallRecording] No session found for leadPhone=${leadPhone} — skipping storage`);
      return;
    }

    // Insert with ON DUPLICATE KEY UPDATE for idempotency
    // (openphoneCallId has a UNIQUE constraint — duplicate webhooks are silently ignored)
    await db
      .insert(openphoneCallRecordings)
      .values({
        sessionId: session.id,
        openphoneCallId: callId,
        callerPhone: leadPhone,
        direction: direction === "outgoing" ? "outgoing" : "incoming",
        durationSeconds,
        recordingUrl: recording.url,
        status: recording.status ?? "completed",
        callStartedAt,
      })
      .onDuplicateKeyUpdate({
        set: { recordingUrl: recording.url, status: recording.status ?? "completed" },
      });

    console.log(`[CallRecording] Stored recording for callId=${callId} sessionId=${session.id}`);

    // Fire Whisper transcription + debrief in the background (non-blocking).
    // Runs regardless of whether OpenPhone sends a transcript webhook.
    if (recording.url && durationSeconds >= 20) {
      setTimeout(() => {
        transcribeAndDebriefRecording(callId, recording.url as string).catch((err) =>
          console.error(`[CallRecording] Background transcribe/debrief failed for callId=${callId}:`, err)
        );
      }, 5_000); // 5s delay to let the recording settle
    }
  } catch (err) {
    console.error("[CallRecording] handleCallRecordingCompleted error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// transcribeAndDebriefRecording
// Uses Whisper to transcribe a recording URL, stores the transcript, then runs
// generatePostCallDebrief. Called as a background job after recording is stored.
// ─────────────────────────────────────────────────────────────────────────────
async function transcribeAndDebriefRecording(callId: string, recordingUrl: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Skip if transcript already exists (e.g. OpenPhone transcript webhook arrived first)
  const existing = await db
    .select({ transcript: openphoneCallRecordings.transcript })
    .from(openphoneCallRecordings)
    .where(eq(openphoneCallRecordings.openphoneCallId, callId))
    .limit(1);
  if (existing[0]?.transcript) {
    console.log(`[Whisper] Transcript already exists for callId=${callId} — skipping`);
    return;
  }

  console.log(`[Whisper] Transcribing callId=${callId}`);
  const result = await transcribeAudio({ audioUrl: recordingUrl });

  if ('error' in result) {
    console.warn(`[Whisper] Transcription failed for callId=${callId}: ${result.error}`);
    return;
  }

  // Convert Whisper segments to OpenPhone-style dialogue turns
  const rawText = result.text ?? '';
  if (!rawText.trim()) {
    console.warn(`[Whisper] Empty transcript for callId=${callId}`);
    return;
  }

  // Store as a single-turn transcript (Whisper doesn't diarize speakers)
  const dialogue = [{ identifier: 'transcript', content: rawText, start: 0, end: result.segments?.length ? result.segments[result.segments.length - 1].end : 0 }];

  await db
    .update(openphoneCallRecordings)
    .set({ transcript: JSON.stringify(dialogue) })
    .where(eq(openphoneCallRecordings.openphoneCallId, callId));

  console.log(`[Whisper] Transcript stored for callId=${callId}`);

  // Generate debrief
  await generatePostCallDebrief(callId, dialogue);
}

// ─────────────────────────────────────────────────────────────────────────────
// handleCallTranscriptCompleted
// Fired when OpenPhone finishes generating a call transcript.
// Payload shape (event.data.object):
//   callId: string
//   dialogue: [{ identifier: string, content: string, start: number, end: number }]
//   duration: number
//   status: "completed"
//
// Strategy: patch the existing openphone_call_recordings row (matched by callId)
// with the transcript JSON. If the recording row doesn't exist yet (transcript
// arrived before recording), we log a warning and skip — the recording webhook
// will arrive shortly and the transcript can be fetched on demand if needed.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCallTranscriptCompleted(event: any): Promise<void> {
  try {
    const obj = event?.data?.object;
    const callId: string | undefined = obj?.callId;
    if (!callId) {
      console.warn("[CallTranscript] Missing callId in payload");
      return;
    }

    const dialogue = obj?.dialogue;
    if (!Array.isArray(dialogue) || dialogue.length === 0) {
      console.warn(`[CallTranscript] Empty or missing dialogue for callId=${callId}`);
      return;
    }

    const transcriptJson = JSON.stringify(dialogue);

    const db = await getDb();
    if (!db) {
      console.error("[CallTranscript] No DB connection");
      return;
    }

    // Patch the recording row that was created by call.recording.completed
    const result = await db
      .update(openphoneCallRecordings)
      .set({ transcript: transcriptJson })
      .where(eq(openphoneCallRecordings.openphoneCallId, callId));

    const affectedRows = (result as any)?.[0]?.affectedRows ?? 0;
    if (affectedRows === 0) {
      console.warn(`[CallTranscript] No recording row found for callId=${callId} — transcript will be lost`);
    } else {
      console.log(`[CallTranscript] Transcript saved for callId=${callId} (${dialogue.length} turns)`);
      // Fire post-call debrief job 60 seconds after transcript arrives
      setTimeout(() => {
        generatePostCallDebrief(callId, dialogue).catch((err) =>
          console.error(`[CallDebrief] Background job failed for callId=${callId}:`, err)
        );
      }, 60_000);
    }
  } catch (err) {
    console.error("[CallTranscript] handleCallTranscriptCompleted error:", err);
  }
}

/**
 * generatePostCallDebrief — runs 60s after a call transcript is saved.
 * Produces a 3-bullet AI debrief (what went well, what to improve, exact line to use next time)
 * and stores it in openphone_call_recordings.callDebrief as JSON.
 * The CS inbox reads this and renders it as a card in the conversation thread.
 */
async function generatePostCallDebrief(
  callId: string,
  dialogue: { identifier: string; content: string; start: number; end: number }[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Format transcript for the AI
  const transcriptText = dialogue
    .map((turn) => `${turn.identifier === 'agent' ? 'Agent' : 'Customer'}: ${turn.content}`)
    .join('\n');

  const systemPrompt = `You are an expert home services sales coach. Analyze this call transcript and produce a concise debrief for the agent.

Return ONLY a JSON object with exactly these keys:
{
  "grade": "A single letter grade: A, B, C, D, or F",
  "wentWell": "One sentence — what the agent did well on this call",
  "improve": "One sentence — the single most important thing to improve",
  "nextLine": "The exact word-for-word line the agent should use next time to handle the key moment better"
}

Grade criteria:
- A: Excellent — closed or made a strong attempt, great rapport, handled objections well
- B: Good — solid process, minor missed opportunities
- C: Average — adequate but missed key objection handling or follow-through
- D: Poor — poor engagement, lost the lead unnecessarily
- F: Failed — unprofessional or completely failed to follow process

Be specific and actionable. Reference actual moments from the transcript. No fluff.`;

  const userPrompt = `Call transcript:\n${transcriptText}`;

  let debrief: { grade: string; wentWell: string; improve: string; nextLine: string; generatedAt: number } | null = null;
  try {
    const response = await invokeLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const rawContent = response?.choices?.[0]?.message?.content ?? '';
    const raw = typeof rawContent === 'string' ? rawContent : '';
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.wentWell && parsed.improve && parsed.nextLine) {
      const validGrades = ['A', 'B', 'C', 'D', 'F'];
      if (!validGrades.includes(parsed.grade)) parsed.grade = 'C';
      debrief = { ...parsed, generatedAt: Date.now() };
    }
  } catch (err) {
    console.error(`[CallDebrief] AI parse error for callId=${callId}:`, err);
    return;
  }

  if (!debrief) {
    console.warn(`[CallDebrief] No valid debrief produced for callId=${callId}`);
    return;
  }

  await db
    .update(openphoneCallRecordings)
    .set({ callDebrief: JSON.stringify(debrief) } as any)
    .where(eq(openphoneCallRecordings.openphoneCallId, callId));

  console.log(`[CallDebrief] Debrief stored for callId=${callId}`);

  // Fetch the recording URL and caller phone so we can look up the name
  const [rec] = await db
    .select({ recordingUrl: openphoneCallRecordings.recordingUrl, callerPhone: openphoneCallRecordings.callerPhone })
    .from(openphoneCallRecordings)
    .where(eq(openphoneCallRecordings.openphoneCallId, callId))
    .limit(1);

  // Look up caller name from multiple sources: leads, cleaners, team, candidates
  let callerName: string | null = null;
  if (rec?.callerPhone) {
    const cp = rec.callerPhone;
    // 1. quoteLeads (inbound leads)
    const [lead] = await db.select({ name: quoteLeads.name }).from(quoteLeads).where(eq(quoteLeads.phone, cp)).limit(1);
    if (lead?.name) { callerName = lead.name; }
    // 2. cleanerProfiles (team / cleaners)
    if (!callerName) {
      const [cleaner] = await db.select({ name: cleanerProfiles.name }).from(cleanerProfiles).where(eq(cleanerProfiles.phone, cp)).limit(1);
      if (cleaner?.name) { callerName = cleaner.name; }
    }
    // 3. candidates (hiring pipeline)
    if (!callerName) {
      const [cand] = await db.select({ firstName: candidates.firstName, lastName: candidates.lastName }).from(candidates).where(eq(candidates.phone, cp)).limit(1);
      if (cand?.firstName) { callerName = `${cand.firstName} ${cand.lastName}`.trim(); }
    }
  }

  // Post a new call_debrief card to the command channel
  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "🎙️ Call Debrief",
      authorRole: "system",
      body: callerName ? `Call debrief ready · ${callerName} · Grade: ${debrief.grade}` : `Call debrief ready · Grade: ${debrief.grade}`,
      quickAction: "call_debrief",
      metadata: JSON.stringify({
        callId,
        recordingUrl: rec?.recordingUrl ?? null,
        callerName,
        callerPhone: rec?.callerPhone ?? null,
        grade: debrief.grade,
        wentWell: debrief.wentWell,
        improve: debrief.improve,
        nextLine: debrief.nextLine,
      }),
    });
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("new_message", { channel: "command" });
    console.log(`[CallDebrief] Debrief card posted for callId=${callId}`);
  } catch (e) {
    console.error("[CallDebrief] Failed to post debrief card:", e);
  }
}

/**
 * handleCsInboundMessage — stores inbound texts to the CS line (202-888-5362)
 * as cs-inbound sessions without running AI or auto-reply logic.
 */
// In-memory dedup for CS inbound: prevents double-appends from OpenPhone at-least-once delivery.
const csMessageDedup = new Map<string, number>();

async function handleCsInboundMessage(msg: any) {
  const db = await getDb();
  if (!db) {
    console.error("[CS] No DB connection");
    return;
  }

  const fromPhone = msg.from;
  const inboundText = msg.text ?? msg.body ?? "";
  const messageId: string | undefined = msg.id;
  const now = Date.now();
  // Extract MMS media URLs — OpenPhone may use 'media', 'attachments', or 'mediaUrls'
  const rawMediaArray: any[] = msg.media ?? msg.attachments ?? msg.mediaUrls ?? [];
  const mediaUrls: string[] = rawMediaArray
    .map((m: any) => typeof m === 'string' ? m : (m.url ?? m.src ?? m.mediaUrl ?? m.href ?? null))
    .filter(Boolean);

  // Dedup by messageId — OpenPhone retries can fire the same event twice
  if (messageId) {
    if (csMessageDedup.has(messageId)) {
      console.log(`[CS] Duplicate messageId ${messageId} — skipping`);
      return;
    }
    csMessageDedup.set(messageId, now);
    setTimeout(() => csMessageDedup.delete(messageId), 60_000);
  }

  // Resolve name by checking multiple sources in priority order:
  // 1. cleanerProfiles (team members) — determines cs-inbound-cleaner vs cs-inbound
  // 2. completedJobs (past customers, E.164 phone)
  // 3. cleanerJobs.customerName (phone stored as (xxx) xxx-xxxx)
  // 4. quoteLeads (leads who filled out the form)
  // 5. Other conversationSessions with same phone that have a leadName
  // 6. OpenPhone contacts API (fallback for contacts known to OpenPhone but not in DB)
  const fromPhoneDigits = fromPhone.replace(/^\+1/, "").replace(/[^\d]/g, "");

  // 1. cleanerProfiles
  const [cleanerProfile] = await db
    .select({ name: cleanerProfiles.name })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.phone, fromPhoneDigits))
    .limit(1);
  const isCleaner = !!cleanerProfile;

  let resolvedName: string | null = cleanerProfile?.name ?? null;

  if (!resolvedName) {
    // 2. completedJobs (E.164 format)
    const [cj] = await db
      .select({ name: completedJobs.name })
      .from(completedJobs)
      .where(eq(completedJobs.phone, fromPhone))
      .limit(1);
    if (cj?.name) resolvedName = cj.name;
  }

  if (!resolvedName) {
    // 3. cleanerJobs.customerName (formatted phone)
    const [cjob] = await db
      .select({ customerName: cleanerJobs.customerName })
      .from(cleanerJobs)
      .where(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${fromPhoneDigits}`)
      .limit(1);
    if (cjob?.customerName) resolvedName = cjob.customerName;
  }

  if (!resolvedName) {
    // 4. quoteLeads
    const [ql] = await db
      .select({ name: quoteLeads.name })
      .from(quoteLeads)
      .where(sql`REGEXP_REPLACE(${quoteLeads.phone}, '[^0-9]', '') LIKE ${'%' + fromPhoneDigits}`)
      .limit(1);
    if (ql?.name) resolvedName = ql.name;
  }

  if (!resolvedName) {
    // 5. Other conversationSessions with same phone that have a leadName
    const [otherSession] = await db
      .select({ leadName: conversationSessions.leadName })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.leadPhone, fromPhone),
          sql`${conversationSessions.leadName} IS NOT NULL AND ${conversationSessions.leadName} != ''`
        )
      )
      .orderBy(desc(conversationSessions.updatedAt))
      .limit(1);
    if (otherSession?.leadName) resolvedName = otherSession.leadName;
  }

  // 6. OpenPhone contacts API — fallback when all DB checks return null
  if (!resolvedName) {
    try {
      const opApiKey = process.env.OPENPHONE_API_KEY;
      if (opApiKey) {
        // OpenPhone contacts API doesn't filter by phone server-side, so we paginate and match client-side
        let pageToken: string | undefined;
        let found = false;
        do {
          const url = `https://api.openphone.com/v1/contacts?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
          const opRes = await fetch(url, { headers: { Authorization: opApiKey, "Content-Type": "application/json" } });
          if (!opRes.ok) break;
          const opData = await opRes.json() as any;
          const contacts: any[] = opData?.data ?? [];
          const match = contacts.find((c: any) =>
            (c.defaultFields?.phoneNumbers ?? []).some((p: any) => p.value === fromPhone)
          );
          if (match) {
            const first = (match.defaultFields?.firstName ?? "").trim();
            const last = (match.defaultFields?.lastName ?? "").trim();
            const combined = last ? `${first} ${last}` : first;
            if (combined) resolvedName = combined;
            found = true;
          }
          pageToken = opData?.nextPageToken;
          if (found || !pageToken) break;
        } while (true);
      }
    } catch (err) {
      console.warn("[CS] OpenPhone contacts lookup failed:", err);
    }
  }

  const sessionSource = isCleaner ? "cs-inbound-cleaner" : "cs-inbound";

  // Find the most recent matching session for this phone
  const [existingSession] = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.leadPhone, fromPhone),
        eq(conversationSessions.leadSource, sessionSource)
      )
    )
    .orderBy(desc(conversationSessions.updatedAt))
    .limit(1);

  if (existingSession) {
    // Append to existing session.
    // Re-read history fresh from DB to avoid a race condition where the agent
    // sends a reply (via sendMessage) between our initial session read and this
    // write — using the stale snapshot would overwrite the agent's message.
    const [freshSession] = await db
      .select({ messageHistory: conversationSessions.messageHistory })
      .from(conversationSessions)
      .where(eq(conversationSessions.id, existingSession.id))
      .limit(1);
    let history: Array<{ role: string; content: string; ts?: number }> = [];
    try { history = JSON.parse(freshSession?.messageHistory ?? "[]"); } catch { history = []; }

    // Dedup by messageId first (most reliable) — OpenPhone retries can fire the same event twice
    if (messageId && history.some((h: any) => h.opMsgId === messageId)) {
      console.log(`[CS] messageId dedup: ${messageId} already in history for session ${existingSession.id}. Skipping.`);
      return;
    }
    // Content dedup fallback: skip if identical non-empty message already stored within 10s
    // Never dedup photo-only messages (empty text) — each photo is a distinct message
    const recent = history.slice(-3);
    const isDup = inboundText.trim() !== "" && recent.some(m => m.role === "user" && m.content === inboundText && now - (m.ts ?? 0) < 10_000);
    if (isDup) {
      console.log(`[CS] Content dedup: identical message already in history for session ${existingSession.id}. Skipping.`);
      return;
    }
    history.push({ role: "user", content: inboundText, ts: now, opMsgId: messageId, ...(mediaUrls.length > 0 ? { media: mediaUrls } : {}) } as any);
    if (history.length > 200) history = history.slice(-200);

    // Also backfill leadName if it was previously null and we now resolved one
    const updatePayload: Record<string, unknown> = { messageHistory: JSON.stringify(history), updatedAt: new Date() };
    if (resolvedName && !existingSession.leadName) {
      updatePayload.leadName = resolvedName;
    }
    // Auto-unresolve: if this session was resolved, a new inbound message reopens it
    if ((existingSession as any).csResolvedAt) {
      updatePayload.csResolvedAt = null;
      console.log(`[CS] Auto-unresolving session ${existingSession.id} — new inbound message received`);
    }
    await db
      .update(conversationSessions)
      .set(updatePayload as any)
      .where(eq(conversationSessions.id, existingSession.id));

    console.log(`[CS] Appended to session ${existingSession.id} for ${fromPhone}${resolvedName && !existingSession.leadName ? ` (backfilled name: ${resolvedName})` : ""}`);
  } else {
    // Create new cs-inbound session
    const history = [{ role: "user", content: inboundText, ts: now, ...(mediaUrls.length > 0 ? { media: mediaUrls } : {}) }];
    const [result] = await db
      .insert(conversationSessions)
      .values({
        leadPhone: fromPhone,
        leadName: resolvedName,
        leadEmail: null,
        leadSource: sessionSource,
        messageHistory: JSON.stringify(history),
        stage: "OPEN",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

    const sessionId = (result as any).insertId;
    console.log(`[CS] Created new ${sessionSource} session ${sessionId} for ${fromPhone}${resolvedName ? ` (${resolvedName})` : ""}`);
  }

  // Broadcast SSE so CS inbox updates instantly
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("lead_update");

  // Sync any outbound messages sent from OpenPhone app for this conversation
  // (OpenPhone doesn't fire webhooks for outbound messages, so we poll on each inbound)
  const resolvedSessionId = existingSession?.id ?? (await (async () => {
    const [s] = await db
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.leadPhone, fromPhone),
          eq(conversationSessions.leadSource, sessionSource)
        )
      )
      .orderBy(desc(conversationSessions.updatedAt))
      .limit(1);
    return s?.id;
  })());
  if (resolvedSessionId) {
    syncCsOutboundMessages(fromPhone, resolvedSessionId).catch(err =>
      console.warn("[CS] syncCsOutboundMessages error:", err)
    );
  }
}

/**
 * handleCsOutboundMessage — mirrors messages sent from the OpenPhone app
 * back into the CS chat so agents see a unified thread.
 */
const csOutboundDedup = new Map<string, number>();

async function handleCsOutboundMessage(msg: any) {
  const db = await getDb();
  if (!db) return;

  const messageId: string | undefined = msg.id;
  const now = Date.now();

  // Dedup — OpenPhone at-least-once delivery
  if (messageId) {
    if (csOutboundDedup.has(messageId)) {
      console.log(`[CS Outbound] Duplicate messageId ${messageId} — skipping`);
      return;
    }
    csOutboundDedup.set(messageId, now);
    setTimeout(() => csOutboundDedup.delete(messageId), 60_000);
  }

  // For outgoing messages: from = our CS number, to = lead's phone
  const toPhones: string[] = Array.isArray(msg.to) ? msg.to : [msg.to].filter(Boolean);
  const leadPhone = toPhones[0];
  if (!leadPhone) {
    console.warn("[CS Outbound] No recipient phone found in outgoing message");
    return;
  }

  const outboundText: string = msg.text ?? msg.body ?? "";
  if (!outboundText.trim()) return;

  // Find the most recent CS session for this lead phone
  const [session] = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.leadPhone, leadPhone),
        or(
          eq(conversationSessions.leadSource, "cs-inbound"),
          eq(conversationSessions.leadSource, "cs-inbound-cleaner")
        )
      )
    )
    .orderBy(desc(conversationSessions.updatedAt))
    .limit(1);

  if (!session) {
    // Risk 4: Agent proactively texted from OpenPhone before any inbound — create a session
    console.log(`[CS Outbound] No CS session found for ${leadPhone} — creating proactive outbound session`);
    const history = [{ role: "assistant", content: outboundText, ts: now, senderName: "OpenPhone", opMsgId: messageId }];
    try {
      await db
        .insert(conversationSessions)
        .values({
          leadPhone,
          leadName: null,
          leadEmail: null,
          leadSource: "cs-inbound" as any,
          messageHistory: JSON.stringify(history),
          stage: "OPEN",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
      console.log(`[CS Outbound] Created proactive session for ${leadPhone}`);
      const { broadcastOpsUpdate: bcast } = await import("./sseBroadcast");
      bcast("lead_update");
    } catch (err) {
      console.error(`[CS Outbound] Failed to create proactive session for ${leadPhone}:`, err);
    }
    return;
  }

  let history: Array<{ role: string; content: string; ts?: number; senderName?: string; opMsgId?: string }> = [];
  try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }

  // Dedup by messageId first (most reliable)
  if (messageId && history.some((h: any) => h.opMsgId === messageId)) {
    console.log(`[CS Outbound] messageId dedup: ${messageId} already in history for session ${session.id} — skipping`);
    return;
  }
  // Content dedup fallback: skip if identical assistant message already stored within 15s
  const recent = history.slice(-3);
  const isDup = recent.some(
    m => m.role === "assistant" && m.content === outboundText && now - (m.ts ?? 0) < 15_000
  );
  if (isDup) {
    console.log(`[CS Outbound] Content dedup: message already in history for session ${session.id} — skipping`);
    return;
  }

  // Resolve userId to real name (best-effort)
  let outboundSenderName = "OpenPhone";
  const outboundUserId: string | undefined = msg.userId;
  if (outboundUserId) {
    try {
      const uRes = await fetch(`https://api.openphone.com/v1/users/${encodeURIComponent(outboundUserId)}`, {
        headers: { Authorization: process.env.OPENPHONE_API_KEY ?? "" },
      });
      if (uRes.ok) {
        const uJson = await uRes.json() as any;
        const u = uJson?.data;
        if (u?.firstName) outboundSenderName = `${u.firstName} ${u.lastName ?? ""}`.trim();
      }
    } catch { /* ignore */ }
  }
  history.push({ role: "assistant", content: outboundText, ts: now, senderName: outboundSenderName, opMsgId: messageId });
  if (history.length > 200) history = history.slice(-200);

  await db
    .update(conversationSessions)
    .set({ messageHistory: JSON.stringify(history), updatedAt: new Date() } as any)
    .where(eq(conversationSessions.id, session.id));

  console.log(`[CS Outbound] Mirrored OpenPhone reply to session ${session.id} for ${leadPhone}: "${outboundText.slice(0, 60)}"`);

  // Broadcast SSE so CS inbox updates instantly
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("lead_update");
}

/**
 * syncCsOutboundMessages — fetches recent messages from OpenPhone API for a given
 * CS conversation and mirrors any outbound (agent-sent) messages that aren't already
 * in the session history. Called after each inbound message since OpenPhone doesn't
 * fire webhooks for outbound messages sent from the app.
 */
export async function syncCsOutboundMessages(leadPhone: string, sessionId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const apiKey = process.env.OPENPHONE_API_KEY;
  const csNumberId = process.env.OPENPHONE_CS_PHONE_NUMBER_ID;
  if (!apiKey || !csNumberId) {
    console.warn("[CS Sync] Missing OPENPHONE_API_KEY or OPENPHONE_CS_PHONE_NUMBER_ID");
    return;
  }

  // Fetch last 50 messages for this conversation from OpenPhone, with 1 retry on failure
  let messages: any[] = [];
  const fetchWithRetry = async (attempt: number): Promise<void> => {
    try {
      const url = `https://api.openphone.com/v1/messages?phoneNumberId=${encodeURIComponent(csNumberId)}&participants=${encodeURIComponent(leadPhone)}&maxResults=50`;
      const res = await fetch(url, {
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        if (attempt < 2) {
          console.warn(`[CS Sync] OpenPhone API ${res.status} for ${leadPhone} — retrying in 2s`);
          await new Promise(r => setTimeout(r, 2000));
          return fetchWithRetry(attempt + 1);
        }
        console.warn(`[CS Sync] OpenPhone API ${res.status} for ${leadPhone} after ${attempt} attempts — giving up`);
        return;
      }
      const json = await res.json() as any;
      messages = json?.data ?? [];
    } catch (err) {
      if (attempt < 2) {
        console.warn(`[CS Sync] Fetch error for ${leadPhone} — retrying in 2s:`, err);
        await new Promise(r => setTimeout(r, 2000));
        return fetchWithRetry(attempt + 1);
      }
      console.warn(`[CS Sync] Fetch error for ${leadPhone} after ${attempt} attempts — giving up:`, err);
    }
  };
  await fetchWithRetry(1);

  // Filter to outbound messages only
  const outbound = messages.filter((m: any) => m.direction === "outgoing");
  if (outbound.length === 0) return;

  // Build userId → name map from OpenPhone users API (best-effort, cached per call)
  const opUserMap: Record<string, string> = {};
  try {
    const usersRes = await fetch("https://api.openphone.com/v1/users", {
      headers: { Authorization: apiKey },
    });
    if (usersRes.ok) {
      const usersJson = await usersRes.json() as any;
      for (const u of (usersJson?.data ?? [])) {
        if (u.id) opUserMap[u.id] = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
      }
    }
  } catch { /* ignore — fall back to "OpenPhone" */ }

  // Load current session history
  const [session] = await db
    .select({ messageHistory: conversationSessions.messageHistory })
    .from(conversationSessions)
    .where(eq(conversationSessions.id, sessionId))
    .limit(1);
  if (!session) return;

  let history: Array<{ role: string; content: string; ts?: number; senderName?: string; opMsgId?: string }> = [];
  try { history = JSON.parse(session.messageHistory ?? "[]"); } catch { history = []; }

  // Build set of already-synced OpenPhone message IDs
  const syncedIds = new Set(history.map((h: any) => h.opMsgId).filter(Boolean));

  let added = 0;
  for (const m of outbound) {
    const text: string = m.text ?? m.body ?? "";
    if (!text.trim()) continue;
    const msgId: string = m.id ?? "";
    const msgTs = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    const senderName = (m.userId && opUserMap[m.userId]) ? opUserMap[m.userId] : "OpenPhone";

    // Skip if already synced by ID
    if (msgId && syncedIds.has(msgId)) continue;

    // Skip if identical content within 15s (covers messages sent from CS chat already stored)
    const isDup = history.some(
      (h: any) => h.role === "assistant" && h.content === text && Math.abs((h.ts ?? 0) - msgTs) < 15_000
    );
    if (isDup) continue;

    history.push({ role: "assistant", content: text, ts: msgTs, senderName, opMsgId: msgId });
    added++;
  }

  if (added === 0) return;

  // Sort by ts to maintain chronological order
  history.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
  if (history.length > 200) history = history.slice(-200);

  await db
    .update(conversationSessions)
    .set({ messageHistory: JSON.stringify(history), updatedAt: new Date() } as any)
    .where(eq(conversationSessions.id, sessionId));

  console.log(`[CS Sync] Synced ${added} outbound message(s) from OpenPhone for session ${sessionId} (${leadPhone})`);

  // Broadcast SSE so CS inbox updates instantly
  const { broadcastOpsUpdate: broadcastOpsUpdate2 } = await import("./sseBroadcast");
  broadcastOpsUpdate2("lead_update");
}

// ─────────────────────────────────────────────────────────────────────────────
// handleCallAnswered / handleCallCompleted
// Track which agent is currently on a call using OpenPhone call webhooks.
//
// Payload shape (call.ringing / call.answered / call.completed):
//   event.data.object = {
//     id: string,           // callId
//     userId: string,       // OpenPhone user ID of the agent who answered
//     answeredBy: string,   // same as userId for answered calls
//     status: "ringing" | "in-progress" | "completed",
//     direction: "incoming" | "outgoing",
//     phoneNumberId: string,
//     participants: string[], // E.164 phone numbers involved (external party is here)
//     from: string,          // may be present on some event types
//     to: string[],          // may be present on some event types
//   }
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallAnswered(event: any): Promise<void> {
  const call = event?.data?.object;
  if (!call?.id) return;
  // userId identifies the agent who answered (or initiated for outgoing)
  const opUserId: string | undefined = call.userId ?? call.answeredBy ?? call.initiatedBy;
  if (!opUserId) {
    console.log(`[CallStatus] call.answered: no userId in payload, skipping (type=${event?.type})`);
    return;
  }
  const db = await getDb();
  if (!db) return;
  // Find the agent by openPhoneUserId
  const [agent] = await db
    .select({ id: agents.id, name: agents.name, onCallCallId: agents.onCallCallId })
    .from(agents)
    .where(eq(agents.openPhoneUserId, opUserId))
    .limit(1);
  if (!agent) {
    console.log(`[CallStatus] call.answered: no agent found for openPhoneUserId=${opUserId}`);
    return;
  }
  // Deduplicate: skip only if THIS agent already has this exact call tracked.
  // Do NOT skip if a different agent previously had this call (shared number: ringing fires for
  // the account owner, then call.answered fires for whoever actually picks up).
  if (agent.onCallCallId === call.id) {
    console.log(`[CallStatus] ${agent.name} already on call ${call.id}, skipping duplicate event (${event?.type})`);
    return;
  }
  // If a different agent was previously set as on-call for this call ID, clear them first
  await db
    .update(agents)
    .set({ onCallSince: null, onCallCallId: null } as any)
    .where(and(eq(agents.onCallCallId, call.id), ne(agents.id, agent.id)));
  // Determine direction — outgoing if direction field says so OR if event is call.initiated
  const isOutbound = call.direction === "outgoing" || event?.type === "call.initiated";
  const direction = isOutbound ? "outgoing" : "incoming";
  const callStartedAt = Date.now();
  // On the shared CS number (PN0wVLcpCq) we cannot reliably identify who made the call —
  // OpenPhone always reports the number owner's userId. Skip the on-call badge in that case.
  const isSharedCsNumber = call.phoneNumberId === ENV.openPhoneCsNumberId;
  if (!isSharedCsNumber) {
    await db
      .update(agents)
      .set({ onCallSince: callStartedAt, onCallCallId: call.id } as any)
      .where(eq(agents.id, agent.id));
  }
  console.log(`[CallStatus] ${isSharedCsNumber ? "shared CS number" : agent.name} is now on a ${direction} call (callId=${call.id}, type=${event?.type})`);
  // Post the call_started card:
  //   - call.answered  → inbound call, correct agent confirmed
  //   - call.initiated → outbound call (call.answered may never fire for outbound)
  //   - call.ringing with direction=outgoing → outbound call (OpenPhone fires this for outbound)
  // Skip call.ringing for inbound — on shared numbers it fires for the account owner before anyone answers.
  const shouldPostCard =
    event?.type === "call.answered" ||
    (event?.type === "call.initiated" && isOutbound) ||
    (event?.type === "call.ringing" && isOutbound);
  if (!shouldPostCard) {
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("agent_status");
    return;
  }
  // Look up customer name from quoteLeads for both inbound and outbound.
  // OpenPhone webhook payloads use a `participants` array for the external phone number.
  // call.from / call.to may not be present; fall back through all available fields.
  let callerLabel: string | null = null;
  // Determine the external phone number:
  // - outbound: the destination is in call.to[0] or participants (excluding our own numbers)
  // - inbound: the caller is in call.from or participants (excluding our own numbers)
  const ownNumbers = new Set([
    ENV.openPhoneFromNumber,
    "+12028885362", // CS line
  ].filter(Boolean));
  const participantPhones: string[] = Array.isArray(call.participants) ? call.participants : [];
  const externalParticipant = participantPhones.find((p: string) => !ownNumbers.has(p)) ?? null;
  const callerPhone: string | null = isOutbound
    ? (call.to?.[0] ?? externalParticipant ?? null)
    : (call.from ?? externalParticipant ?? null);
  if (callerPhone) {
    try {
      // Normalize before lookup so format differences don't cause misses
      const normalizedCallerPhone = normalizePhone(callerPhone);
      const [lead] = await db
        .select({ name: quoteLeads.name })
        .from(quoteLeads)
        .where(eq(quoteLeads.phone, normalizedCallerPhone))
        .limit(1);
      callerLabel = lead?.name ?? callerPhone;
    } catch {
      callerLabel = callerPhone;
    }
  }
  const agentLabel = isSharedCsNumber ? "An agent" : agent.name;
  const cardBody = callerLabel
    ? `${agentLabel} ${isOutbound ? "called" : "received a call from"} ${callerLabel}`
    : `${agentLabel} is on a ${direction} call`;
  // Post a call_started card to the command channel
  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "📞 Call Status",
      authorRole: "system",
      body: cardBody,
      quickAction: "call_started",
      metadata: JSON.stringify({
        agentName: agentLabel,
        callId: call.id,
        startedAt: callStartedAt,
        direction,
        callerLabel,
        callerPhone,
      }),
    });
  } catch (e) {
    console.error("[CallStatus] Failed to post call_started card:", e);
  }
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });
  broadcastOpsUpdate("agent_status");
}

async function handleCallCompleted(event: any): Promise<void> {
  const call = event?.data?.object;
  if (!call?.id) return;
  const db = await getDb();
  if (!db) return;
  // Find the agent before clearing so we can name them in the card
  const [agent] = await db
    .select({ id: agents.id, name: agents.name, onCallSince: agents.onCallSince })
    .from(agents)
    .where(eq(agents.onCallCallId, call.id))
    .limit(1);
  // Clear on-call status
  await db
    .update(agents)
    .set({ onCallSince: null, onCallCallId: null } as any)
    .where(eq(agents.onCallCallId, call.id));
  console.log(`[CallStatus] call.completed for callId=${call.id} — cleared on-call status`);
  // Post a call_ended card
  if (agent) {
    const durationMs = agent.onCallSince ? Date.now() - agent.onCallSince : null;
    const durationSec = durationMs ? Math.round(durationMs / 1000) : (call.duration ?? null);
    const durationLabel = durationSec
      ? durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : `${durationSec}s`
      : null;
    const isSharedCsNumber = call.phoneNumberId === ENV.openPhoneCsNumberId;
    const agentLabel = isSharedCsNumber ? "An agent" : agent.name;
    try {
      await db.insert(opsChatMessages).values({
        cleanerJobId: null,
        channel: "command",
        authorName: "📞 Call Status",
        authorRole: "system",
        body: `${agentLabel} ended a call${durationLabel ? ` · ${durationLabel}` : ""}`,
        quickAction: "call_ended",
        metadata: JSON.stringify({
          agentName: agentLabel,
          callId: call.id,
          durationSec,
          durationLabel,
          direction: call.direction ?? "incoming",
        }),
      });
    } catch (e) {
      console.error("[CallStatus] Failed to post call_ended card:", e);
    }
  }
  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("agent_status");
  broadcastOpsUpdate("new_message", { channel: "command" });
}

async function handleCallSummaryCompleted(event: any): Promise<void> {
  // Secondary clear signal — fires after call.completed
  const obj = event?.data?.object;
  const callId: string | undefined = obj?.callId ?? obj?.id;
  if (!callId) return;
  const db = await getDb();
  if (!db) return;
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.onCallCallId, callId))
    .limit(1);
  if (agent) {
    await db
      .update(agents)
      .set({ onCallSince: null, onCallCallId: null } as any)
      .where(eq(agents.id, agent.id));
    console.log(`[CallStatus] call.summary.completed cleared on-call for ${agent.name} (callId=${callId})`);
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("agent_status");
  }
}
