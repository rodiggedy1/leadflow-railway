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
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions, alwaysOnEnrollments, smsOptOuts, jobSmsReplies, cleanerJobs, cleanerProfiles, cleanerRatingSmsLog, openphoneCallRecordings, opsChatMessages, completedJobs, quoteLeads, agents, candidates, nurtureEnrollments, missedCalls } from "../drizzle/schema";
import { sendSms, fetchCallRecordings } from "./openphone";
import { createQuoteLink, updateQuoteAddress } from "./quoteLink";
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
import { registerTwilioProxyWebhookRoute } from "./twilioProxyWebhook";
import { registerEmailLeadWebhookRoute } from "./emailLeadWebhook";
import { registerThumbTackWebhookRoute } from "./thumbtackWebhook";
import { getSetting } from "./settingsRouter";
import { pauseEnrollment, endEnrollment } from "./nurtureSequence";
import { ENV } from "./_core/env";
import { scoreAndCacheStatusById } from "./csStatusScorer";

export function registerWebhookRoutes(app: Express) {
  // Bark.com lead integration (Zapier webhook)
  registerBarkWebhookRoute(app);

  // Twilio Proxy call recording callback
  registerTwilioProxyWebhookRoute(app);

  // Thumbtack lead integration (Zapier webhook)
  registerThumbTackWebhookRoute(app);

  // Email lead integration (Mailgun inbound)
  registerEmailLeadWebhookRoute(app);

  app.post("/api/webhooks/openphone", async (req, res) => {
    // Acknowledge immediately — OpenPhone expects a 200 within 5 seconds
    res.status(200).json({ received: true });

    try {
      const event = req.body;

      // ── Webhook Event Log ────────────────────────────────────────────────────
      // Write every raw event to webhook_events BEFORE any processing.
      // This ensures no event is ever silently lost, even if processing fails.
      // Events can be replayed from the Sync Health page.
      // Fire-and-forget: don't await, don't block processing
      getDb().then(db0 => {
        if (!db0) return;
        const msgObj0 = event?.data?.object;
        const fromPhone0: string | null = msgObj0?.from ?? null;
        const toPhone0: string | null = Array.isArray(msgObj0?.to) ? msgObj0.to[0] : (msgObj0?.to ?? null);
        const eventId0: string | null = msgObj0?.id ?? null;
        const evType = event?.type ?? 'unknown';
        const evPayload = JSON.stringify(event);
        return db0.execute(
          sql`INSERT INTO webhook_events (source, event_type, event_id, from_phone, to_phone, raw_payload, processed, created_at) VALUES (${'openphone'}, ${evType}, ${eventId0}, ${fromPhone0}, ${toPhone0}, ${evPayload}, 0, NOW())`
        );
      }).catch((err: unknown) => console.error('[WebhookLog] Failed to log event:', err));

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

      // Handle delivery status updates for outbound SMS.
      // OpenPhone fires "message.delivered" for both delivered and undelivered outcomes.
      // The status field on the object is: "delivered" | "undelivered" | "failed" | "queued" | "sent"
      if (event?.type === "message.delivered" || event?.type === "message.updated" || event?.type === "message.delivery.updated") {
        const msgObj = event?.data?.object;
        const messageId: string | undefined = msgObj?.id;
        const status: string | undefined = msgObj?.status;
        console.log(`[Webhook] Delivery event: type=${event?.type} messageId=${messageId} status=${status}`);
        if (messageId && status) {
          handleSmsDeliveryUpdate(messageId, status).catch((e: unknown) =>
            console.error("[Webhook] handleSmsDeliveryUpdate error:", e)
          );
        }
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
        // Exception: allow messages arriving on the Bark number (PNO7yagqfm / +19497634135)
        // so they reach the Bark SMS handler below.
        const barkNumberId = ENV.openPhoneBarkNumberId;
        if (!barkNumberId || msg.phoneNumberId !== barkNumberId) {
          console.log(`[Webhook] Skipping: phoneNumberId ${msg.phoneNumberId} does not match configured ${configuredNumberId}`);
          return;
        }
        console.log(`[Webhook] Bark number (${msg.phoneNumberId}) — allowing through to Bark handler`);
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

          // ── Silenced services — controlled via Settings page ──────────────────────
          const silencedRaw = await getSetting("silenced_services", "");
          const silencedList = silencedRaw.split(",").map(s => s.trim()).filter(Boolean);
          if (silencedList.some(s => ttService.toLowerCase().includes(s.toLowerCase()))) {
            console.log(`[Webhook] Thumbtack SMS silenced service "${ttService}" — dropping lead silently`);
            return;
          }

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

      // ── Bark SMS lead alert ──────────────────────────────────────────────────
      // Bark sends lead alerts from +16506469270.
      // Format: "House Cleaning\nYvonne" (service on line 1, name on line 2)
      const BARK_ALERT_NUMBER = "+16506469270";
      if (fromPhone === BARK_ALERT_NUMBER) {
        console.log(`[Webhook] Bark SMS lead detected: "${inboundText}"`);
        const dbBark = await getDb();
        if (dbBark) {
          // Parse best-effort — always create a lead regardless of format.
          // Store the raw text so nothing is lost. Name/service are cosmetic.
          const lines = inboundText.trim().split(/\n/).map(l => l.trim()).filter(Boolean);
          const barkService = lines[0] || "Bark Lead";
          const barkName    = lines[1] || "Bark Lead";

          // Duplicate detection: same raw message text within 10 minutes
          // (guards against OpenPhone at-least-once retries only — not across different leads)
          const DEDUP_WINDOW_MS = 10 * 60 * 1000;
          const barkCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
          const rawTextMarker = `Bark SMS lead: ${inboundText}`;
          const barkDupes = await dbBark
            .select({ id: conversationSessions.id })
            .from(conversationSessions)
            .where(
              and(
                eq(conversationSessions.leadSource, "bark-sms"),
                gte(conversationSessions.createdAt, barkCutoff),
                sql`JSON_CONTAINS(${conversationSessions.messageHistory}, ${JSON.stringify([{ content: rawTextMarker }])}, '$')`
              )
            )
            .limit(1);
          if (barkDupes.length > 0) {
            console.log(`[Webhook] Bark SMS duplicate detected — skipping, existing sessionId=${barkDupes[0].id}`);
            return;
          }

          const barkPlaceholderPhone = `bark-sms-${Date.now()}`;
          const barkNow = Date.now();
          const barkHistory = JSON.stringify([
            { role: "system", content: `Bark SMS lead: ${inboundText}`, ts: barkNow },
          ]);
          let barkSessionId: number | null = null;
          try {
            const [barkIns] = await dbBark.insert(conversationSessions).values({
              leadPhone: barkPlaceholderPhone,
              leadName: barkName,
              stage: "QUOTE_SENT" as any,
              serviceType: barkService,
              messageHistory: barkHistory,
              leadSource: "bark-sms",
              aiMode: 0, // no AI — no real customer phone yet
            } as any);
            barkSessionId = (barkIns as any).insertId ?? null;
            console.log(`[Webhook] Bark SMS lead created — sessionId=${barkSessionId}, name=${barkName}, service=${barkService}`);
          } catch (err) {
            console.error("[Webhook] Failed to create Bark SMS session:", err);
            notifyOwner({
              title: "⚠️ Bark SMS Lead Lost — Session Creation Failed",
              content: `Lead: ${barkName}\nService: ${barkService}\nError: ${err instanceof Error ? err.message : String(err)}\n\nThis Bark lead appeared in Command Chat but was NOT saved to the Leads list.`,
            }).catch(() => {});
          }

          // Post new_lead card to Command Chat
          const barkCardBody = [
            `🐶 **Bark Lead** · ${barkName}`,
            `🏠 **${barkService}**`,
            `⚠️ No phone yet — add customer number in lead to start SMS`,
          ].join("\n");
          const barkCardMeta = JSON.stringify({
            leadName: barkName,
            leadPhone: null,
            serviceType: barkService,
            utmSource: "bark-sms",
            sessionId: barkSessionId,
            arrivedAt: barkNow,
          });
          try {
            await dbBark.insert(opsChatMessages).values({
              cleanerJobId: null,
              channel: "command",
              authorName: "🐶 Bark Lead",
              authorRole: "system",
              body: barkCardBody,
              mediaUrl: null,
              quickAction: "new_lead",
              metadata: barkCardMeta,
            });
          } catch (err) {
            console.error("[Webhook] Failed to post Bark SMS card:", err);
          }

          logActivity({
            eventType: "new_lead",
            title: `New Bark lead: ${barkName}`,
            body: barkService,
            meta: { leadName: barkName, serviceType: barkService, source: "bark-sms", sessionId: barkSessionId },
          }).catch(() => {});

          void sendPushToAll({
            title: `🐶 New Bark Lead`,
            body: `${barkName} · ${barkService}`,
            tag: `new-lead-bark-${barkSessionId}`,
            url: "/ops-chat",
            playSound: true,
          });
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
      //
      // IMPORTANT: Sessions may be stored with non-normalized phone formats (e.g. "703-727-5500"
      // or "(703) 727-5500") because they were created before strict E.164 normalization was
      // enforced. The webhook always receives E.164 from OpenPhone (+17037275500).
      // We must match on the last 10 digits (digit-only) to handle all stored formats.
      // fromPhone is always E.164 here (+1XXXXXXXXXX), so last 10 digits = the US local number.
      const fromPhoneDigits = fromPhone.replace(/[^\d]/g, "").slice(-10);
      const sessions = await db
        .select()
        .from(conversationSessions)
        .where(
          or(
            eq(conversationSessions.leadPhone, fromPhone),
            sql`REGEXP_REPLACE(${conversationSessions.leadPhone}, '[^0-9]', '') LIKE ${`%${fromPhoneDigits}`}`
          )
        )
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
          || s.stage === "SCHEDULE_CONFIRM_SENT"
      );
      // INTERVIEW_LINK_SENT / NUDGE sessions are for hiring candidates, not customers.
      // REACTIVATION sessions are for past customers being re-engaged.
      // In BOTH cases: if a NEWER active lead session exists (created after the special session),
      // the newer lead session takes priority — so a fresh widget/quote submission is never
      // hijacked by an older reactivation or interview session.
      const isSpecialSession = reviewSession &&
        (reviewSession.stage === "INTERVIEW_LINK_SENT" ||
         reviewSession.stage === "INTERVIEW_NUDGE_1" ||
         reviewSession.stage === "INTERVIEW_NUDGE_2" ||
         reviewSession.stage === "REACTIVATION" ||
         reviewSession.stage === "REACTIVATION_TIME");
      const newerLeadSession = isSpecialSession
        ? reversedSessions.find(
            s => s.stage !== "DONE" &&
              s.id !== reviewSession!.id &&
              new Date(s.createdAt) > new Date(reviewSession!.createdAt)
          )
        : undefined;
      const activeSession = (newerLeadSession ?? reviewSession) ??
        reversedSessions.find(s => s.stage !== "DONE");

      const session = activeSession ?? sessions[sessions.length - 1]; // fallback to most recent

      if (!session) {
        // ── Active Recurring Customer Guard ────────────────────────────────────────────────────────────────────
        // Before creating a new quote session, check if this phone belongs to an active recurring customer.
        // If so, do NOT start the AI quote flow — send a friendly reply and alert the team instead.
        try {
          const { getFrequencyWindowDays, isRecurringFrequency } = await import("./alwaysOnEngine");
          const recentJobs = await db
            .select({ frequency: completedJobs.frequency, jobDate: completedJobs.jobDate })
            .from(completedJobs)
            .where(eq(completedJobs.phone, fromPhone))
            .orderBy(desc(completedJobs.jobDate))
            .limit(1);
          if (recentJobs.length > 0) {
            const { frequency, jobDate } = recentJobs[0]!;
            if (isRecurringFrequency(frequency) && jobDate) {
              const windowDays = getFrequencyWindowDays(frequency)!;
              const bufferDays = 7;
              const jobMs = new Date(jobDate + "T00:00:00Z").getTime();
              const daysSince = Math.floor((Date.now() - jobMs) / (1000 * 60 * 60 * 24));
              if (daysSince < windowDays + bufferDays) {
                // Active recurring customer — do not start quote flow
                console.log(`[Webhook] Active recurring customer ${fromPhone} (${frequency}, ${daysSince}d since last job) — skipping quote session creation.`);
                await sendSms({
                  to: fromPhone,
                  content: `Hi there! It looks like you're already one of our recurring customers — thanks for reaching out! 😊 We'll have someone from our team follow up with you shortly. You can also call us at 202-888-5362.`,
                });
                await db.insert(opsChatMessages).values({
                  cleanerJobId: null,
                  channel: 'command',
                  authorName: '📲 Recurring Customer Inbound',
                  authorRole: 'system',
                  body: `📲 **Recurring customer texted in** — ${fromPhone} (${frequency}, last job ${jobDate})\n\n"${inboundText}"\n\nAuto-replied with hold message. Please follow up.`,
                  mediaUrl: null,
                  quickAction: null,
                  metadata: JSON.stringify({ leadPhone: fromPhone, frequency, jobDate, arrivedAt: Date.now() }),
                });
                return;
              }
            }
          }
        } catch (recurringCheckErr) {
          console.error('[Webhook] Failed to check recurring customer status:', recurringCheckErr);
          // Fall through — create session as normal if check fails
        }

        // ── New Inbound Lead ────────────────────────────────────────────────────────────────────────────────────
        // Unknown number texted in — create a normal new lead session so it appears
        // in the Leads list and the AI can engage it like any other inbound lead.
        console.log(`[Webhook] No session found for ${fromPhone} — creating new inbound-sms lead session.`);
        try {
          const newHistory = JSON.stringify([
            { role: 'user', content: inboundText, ts: Date.now(), mediaUrls: mediaUrls.length ? mediaUrls : undefined },
          ]);
          const [newIns] = await db.insert(conversationSessions).values({
            leadPhone: fromPhone,
            leadName: null,
            stage: 'QUOTE_SENT' as any,
            messageHistory: newHistory,
            leadSource: 'inbound-sms',
            aiMode: 1, // allow AI to engage
          } as any);
          const newSessionId = (newIns as any).insertId ?? null;
          console.log(`[Webhook] New inbound-sms session created — sessionId=${newSessionId}, phone=${fromPhone}`);

          // Create a quote_leads entry so this lead appears in the Lead Drawer immediately
          try {
            const [qlIns] = await db.insert(quoteLeads).values({
              name: fromPhone, // no name yet — phone as placeholder
              phone: fromPhone,
              email: null,
              serviceType: null,
              bedrooms: null,
              bathrooms: null,
              smsSent: 0,
            } as any);
            const newLeadId = (qlIns as any).insertId ?? null;
            if (newLeadId && newSessionId) {
              await db.update(conversationSessions)
                .set({ quoteLeadId: newLeadId })
                .where(eq(conversationSessions.id, newSessionId));
            }
            console.log(`[Webhook] Created quoteLeads row ${newLeadId} for inbound-sms ${fromPhone}`);
          } catch (qlErr) {
            console.error('[Webhook] Failed to create quoteLeads row for inbound-sms:', qlErr);
          }

          // Notify the team so they know a new cold inbound arrived
          try {
            await db.insert(opsChatMessages).values({
              cleanerJobId: null,
              channel: 'command',
              authorName: '📲 New Inbound SMS',
              authorRole: 'system',
              body: `📲 **New inbound SMS** from ${fromPhone}\n\n"${inboundText}"\n\nAI is engaging — check the Leads page.`,
              mediaUrl: null,
              quickAction: 'new_lead',
              metadata: JSON.stringify({ leadPhone: fromPhone, sessionId: newSessionId, arrivedAt: Date.now() }),
            });
          } catch (chatErr) {
            console.error('[Webhook] Failed to post inbound-sms card to command chat:', chatErr);
          }
          void sendPushToAll({
            title: '📲 New Inbound SMS',
            body: `${fromPhone}: "${inboundText.slice(0, 80)}"`,
            tag: `new-lead-inbound-${newSessionId}`,
            url: '/leads',
            playSound: true,
          });
          logActivity({
            eventType: 'new_lead',
            title: `New inbound SMS from ${fromPhone}`,
            body: inboundText.length > 120 ? inboundText.slice(0, 120) + '…' : inboundText,
            meta: { leadPhone: fromPhone, sessionId: newSessionId, source: 'inbound-sms' },
          }).catch(() => {});
        } catch (createErr) {
          console.error('[Webhook] Failed to create inbound-sms session:', createErr);
        }
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

      // ── CRITICAL: Persist the user message to DB IMMEDIATELY ──────────────────
      // This MUST happen before ANY LLM/AI call. If the AI engine crashes, times out,
      // or throws, the customer's message is guaranteed to be in the DB already.
      // Also stamp lastCustomerReplyAt so the CommandChat lead-replies notification
      // fires immediately — regardless of whether the AI replies afterward.
      // The history will be updated again later with the assistant reply appended.
      await db
        .update(conversationSessions)
        .set({ messageHistory: JSON.stringify(history), lastCustomerReplyAt: now } as any)
        .where(eq(conversationSessions.id, session.id));

      // Log the inbound reply as an activity event
      logActivity({
        eventType: "lead_reply",
        title: `New reply from ${session.leadName ?? fromPhone}`,
        body: inboundText.length > 120 ? inboundText.slice(0, 120) + "…" : inboundText,
        meta: { sessionId: session.id, leadPhone: fromPhone, leadName: session.leadName, stage: session.stage },
      }).catch(() => {});

      // NOTE: We do NOT auto-pause nurture on inbound reply.
      // The recency gate in nurtureCron (20-min window) already skips sending
      // during active conversations. Pausing here caused new leads to always
      // show as "paused" in the UI even while mid-conversation with Jade.

      // If agent has taken over (aiMode = 0), just store the inbound message and stop.
      // The agent will reply manually from the app.
      // NOTE: messageHistory + lastCustomerReplyAt were already saved above — no second update needed.
      if (session.aiMode === 0) {
        console.log(`[Webhook] Manual mode for session ${session.id} — storing inbound, skipping AI reply.`);
        return;
      }

      // If the lead was booked within the last 30 days, do NOT send an AI auto-reply.
      // A booking older than 30 days is considered lapsed — the lead is fair game for re-engagement.
      // NOTE: messageHistory + lastCustomerReplyAt were already saved above — no second update needed.
      const BOOKED_SILENCE_DAYS = 30;
      const bookedAt = session.bookedAt ? new Date(session.bookedAt).getTime() : null;
      const bookedRecently = session.isBooked === 1 && bookedAt !== null &&
        (Date.now() - bookedAt) < BOOKED_SILENCE_DAYS * 24 * 60 * 60 * 1000;
      if (bookedRecently) {
        console.log(`[Webhook] Lead ${fromPhone} (session ${session.id}) was booked ${Math.floor((Date.now() - bookedAt!) / 86400000)}d ago — storing inbound, skipping AI reply.`);
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
        // Flow C: enriched data collected across the 5-step flow
        preferredDates: (session as any).preferredDates ?? undefined,
        specialNotes: (session as any).specialNotes ?? undefined,
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

           // ── SCHEDULE_CONFIRM: Daily schedule confirmation reply from cleaner ───────────
      if (session.stage === "SCHEDULE_CONFIRM_SENT") {
        const { handleScheduleConfirmReply } = await import("./scheduleConfirmEngine");
        // Parse the target date from the session's message history (the outbound SMS was sent for a specific date)
        // The session was created with leadSource = "schedule_confirm" and the date is encoded in the outbound text
        // We look it up from the most recent SCHEDULE_CONFIRM_SENT session's createdAt to derive the target date
        const sessionCreated = new Date(session.createdAt);
        // The cron fires at 5 PM ET for tomorrow's jobs — derive target date from session creation time
        const etCreated = new Date(sessionCreated.toLocaleString("en-US", { timeZone: "America/New_York" }));
        etCreated.setDate(etCreated.getDate() + 1);
        const targetDate = `${etCreated.getFullYear()}-${String(etCreated.getMonth() + 1).padStart(2, "0")}-${String(etCreated.getDate()).padStart(2, "0")}`;

        const confirmResult = await handleScheduleConfirmReply(
          session.id,
          fromPhone,
          inboundText,
          session.leadName ?? null,
          targetDate
        );
        console.log(`[Webhook] ScheduleConfirm: ${session.stage} → ${confirmResult.newStage}. Confirmed: ${confirmResult.confirmed}. Reply: "${confirmResult.responseText}"`);

        // Send SMS FIRST — before DB update (per skill rules)
        const csNumberId = ENV.openPhoneCsNumberId;
        const confirmSmsResult = await sendSms({
          to: fromPhone,
          content: confirmResult.responseText,
          ...(csNumberId ? { fromNumberId: csNumberId } : {}),
        });
        if (!confirmSmsResult.success) {
          console.error(`[Webhook] Failed to send schedule confirm reply to ${fromPhone}:`, confirmSmsResult.error);
        }

        history.push({ role: "assistant", content: confirmResult.responseText, ts: Date.now() });
        if (history.length > 20) history = history.slice(-20);
        await db
          .update(conversationSessions)
          .set({
            stage: confirmResult.newStage as any,
            messageHistory: JSON.stringify(history),
          })
          .where(eq(conversationSessions.id, session.id));
        return;
      }

      // ── QUALITY_RATING: Post-job 1-5 star rating flow ─────────────────────
      if (session.stage === "QUALITY_RATING_REQUESTED" || session.stage === "QUALITY_MISSED_FOLLOWUP") {
        const ratingResult = await handleRatingReply(session.id, fromPhone, inboundText, session.stage);
        console.log(`[Webhook] Quality rating stage: ${session.stage} → ${ratingResult.newStage}. Reply: "${ratingResult.responseText}"`);
        // Send SMS FIRST — before DB update — so a DB error never blocks the thank-you message
        const ratingSmsResult = await sendSms({ to: fromPhone, content: ratingResult.responseText });
        if (!ratingSmsResult.success) {
          console.error(`[Webhook] Failed to send rating reply to ${fromPhone}:`, ratingSmsResult.error);
        }
        history.push({ role: "assistant", content: ratingResult.responseText, ts: Date.now() });

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
        // LLM-based intent detection — catches natural phrasing regex misses
        // yes → CONFIRMATION, no → UNHANDLED, other → UNHANDLED
        let rebookingIntent: "yes" | "no" | "other" = "other";
        try {
          const rebookIntentResp = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `You are determining if a customer SMS reply is a "yes" (wants to rebook / interested), "no" (not interested / declining), or "other" (unclear / question / off-topic).
Respond ONLY with JSON: { "intent": "yes" | "no" | "other" }`,
              },
              { role: "user", content: `Customer reply: "${inboundText.trim()}"` },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "rebooking_intent",
                strict: true,
                schema: {
                  type: "object",
                  properties: { intent: { type: "string" } },
                  required: ["intent"],
                  additionalProperties: false,
                },
              },
            },
          });
          const rebookParsed = JSON.parse(rebookIntentResp.choices[0].message.content as string);
          if (rebookParsed.intent === "yes" || rebookParsed.intent === "no") {
            rebookingIntent = rebookParsed.intent;
          }
        } catch {
          // LLM failed — fall back to broad regex
          if (/\b(yes|yeah|yep|sure|ok|okay|sounds good|please|definitely|absolutely|let's do it|lets do it|yes please|i'd like that|id like that)\b/i.test(lc)) {
            rebookingIntent = "yes";
          } else if (/\b(no|nope|not now|maybe later|not interested|no thanks|no thank you|nah|pass)\b/i.test(lc)) {
            rebookingIntent = "no";
          }
        }
        let replyMsg: string;
        // ALL replies surface in the pipeline so agents can see and act on them.
        // yes   → CONFIRMATION ("New Leads" column — ready to book)
        // no    → UNHANDLED   ("Follow Up" column — agent can decide)
        // other → UNHANDLED   ("Follow Up" column — agent can decide)
        let newStage: ConversationStage;
        if (rebookingIntent === "yes") {
          replyMsg = `Amazing, ${firstName}! 🎉 I'll have someone reach out shortly to lock in your spot. Talk soon!`;
          newStage = "CONFIRMATION";
        } else if (rebookingIntent === "no") {
          replyMsg = `No worries at all, ${firstName}! If you ever need us again, just text back. 😊`;
          newStage = "UNHANDLED";
        } else {
          replyMsg = `Thanks for the reply, ${firstName}! I'll have someone from the team follow up with you. 😊`;
          newStage = "UNHANDLED";
        }
        history.push({ role: "user", content: inboundText, ts: Date.now() });
        history.push({ role: "assistant", content: replyMsg, ts: Date.now() });

        await db
          .update(conversationSessions)
          .set({ stage: newStage, messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        const replyResult = await sendSms({ to: fromPhone, content: replyMsg });
        if (!replyResult.success) {
          console.error(`[Webhook] Failed to send rebooking reply to ${fromPhone}:`, replyResult.error);
        }
        console.log(`[Webhook] Review rebooking reply: ${session.stage} → ${newStage}. intent=${rebookingIntent}`);
        return;
      }

      // -- INTERVIEW_LINK_SENT / NUDGE: record the reply, no auto-reply SMS --
      if (
        session.stage === "INTERVIEW_LINK_SENT" ||
        session.stage === "INTERVIEW_NUDGE_1" ||
        session.stage === "INTERVIEW_NUDGE_2"
      ) {
        history.push({ role: "user", content: inboundText, ts: Date.now() });
        // Keep session open so messages keep appearing in the SMS drawer.
        // Do NOT send any auto-reply.
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, session.id));
        console.log("[Webhook] Interview reply recorded (no auto-reply) for " + fromPhone);
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
      // Wrapped in its own try/catch so an AI crash never silently drops the message.
      // The user's message is already saved to DB above — this only handles the reply.
      let result: Awaited<ReturnType<typeof processLeadReplyV2>>;
      try {
        result = await processLeadReplyV2(inboundText, context);
      } catch (aiErr) {
        console.error(`[Webhook] AI engine threw for session ${session.id} (stage=${session.stage}):`, aiErr);
        // Message is already saved. Send a human-fallback SMS so the lead isn't left hanging.
        await sendSms({
          to: fromPhone,
          content: "Hey! We got your message and a team member will follow up with you shortly. 😊",
        }).catch((smsErr: unknown) => console.error("[Webhook] Failed to send AI fallback SMS:", smsErr));
        return;
      }

      // DONE / CALL_SCHEDULED — no AI reply, human handles post-booking messages
      if (result === null) {
        console.log(`[Webhook] Skipping AI reply for post-booking stage=${session.stage} from ${fromPhone}`);
        // History is already saved above — nothing more to do.
        return;
      }

      console.log(`[Webhook] Stage: ${session.stage} → ${result.nextStage}. Reply: "${result.reply}"`);

      // NOTE: history push is deferred until after finalReplyContent is resolved
      // so the stored message contains the real quote URL, not the raw {quoteLink} placeholder.

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
          // messageHistory updated below after finalReplyContent is resolved
          lastAiMessageAt: new Date(),
          autoFollowUpSent: isTerminalStage ? session.autoFollowUpSent : 0,
          // Sync isBooked flag whenever stage transitions to/from BOOKED
          ...(result.nextStage === "BOOKED" && session.stage !== "BOOKED"
            ? { isBooked: 1, bookedAt: new Date() }
            : {}),
          // Persist engine-extracted data (bedrooms, bathrooms, price, service type)
          // Flow C bypass returns data in result.extractedData (no _engineData); fall back to it
          ...((engineData?.bedrooms    ?? (result.extractedData as any)?.bedrooms)    ? { bedrooms:    engineData?.bedrooms    ?? (result.extractedData as any)?.bedrooms }    : {}),
          ...((engineData?.bathrooms   ?? (result.extractedData as any)?.bathrooms)   ? { bathrooms:   engineData?.bathrooms   ?? (result.extractedData as any)?.bathrooms }   : {}),
          ...((engineData?.quotedPrice ?? (result.extractedData as any)?.quotedPrice) ? { quotedPrice: engineData?.quotedPrice ?? (result.extractedData as any)?.quotedPrice } : {}),
          ...((engineData?.serviceType ?? (result.extractedData as any)?.serviceType) ? { serviceType: engineData?.serviceType ?? (result.extractedData as any)?.serviceType } : {}),
          ...(langUpdates.language !== undefined ? { language: langUpdates.language } : {}),
          // preLangStage: null clears it after confirmation; undefined means no change
          ...(langUpdates.preLangStage !== undefined ? { preLangStage: langUpdates.preLangStage } : {}),
          // Idempotency: record the message ID we just processed so duplicate events are dropped
          ...(inboundMessageId ? { lastProcessedMessageId: inboundMessageId } : {}),
          // Flow C: persist extras, preferredDates, specialNotes when collected
          ...(result.extractedData?.extras !== undefined ? { extras: JSON.stringify(result.extractedData.extras) } : {}),
          ...(result.extractedData?.preferredDates ? { preferredDates: result.extractedData.preferredDates } : {}),
          ...(result.extractedData?.specialNotes ? { specialNotes: result.extractedData.specialNotes } : {}),
        })
         .where(eq(conversationSessions.id, session.id));
      // Flow C: when address is collected, update the quote app with the address so checkout can pre-fill it
      const newAddress = result.extractedData?.address;
      if (newAddress && session.smsFlow === "C" && (session as any).quoteSlug) {
        updateQuoteAddress((session as any).quoteSlug, newAddress).catch(err =>
          console.error("[QuoteLink] updateQuoteAddress failed:", err)
        );
      }
      // Generate a custom quote page when transitioning to SLOT_CHOICE (Flow B) or FLOWC_QUOTE_SENT (Flow C)
      let finalReplyContent = result.reply;
      // Only Flow C generates a quote link — Flow B sends exactly what's in the speed-to-lead templates
      const needsQuoteLink =
        (result.nextStage === "FLOWC_QUOTE_SENT" && session.stage !== "FLOWC_QUOTE_SENT");
      if (needsQuoteLink) {
        try {
          const resolvedBedrooms  = engineData?.bedrooms  ?? session.bedrooms  ?? "1";
          const resolvedBathrooms = engineData?.bathrooms ?? session.bathrooms ?? "1";
          const resolvedPrice     = engineData?.quotedPrice ?? session.quotedPrice ?? "0";
          const resolvedService   = engineData?.serviceType ?? session.serviceType ?? "Standard Cleaning";
          const resolvedSlots     = dynamicSlots.map(s => s.label);
          // For Flow C, use the enriched data collected across the 5-step flow
          const isFlowC = result.nextStage === "FLOWC_QUOTE_SENT";
          const resolvedPreferredDates = result.extractedData?.preferredDates ?? (session as any).preferredDates ?? undefined;
          const resolvedSpecialNotes   = result.extractedData?.specialNotes   ?? (session as any).specialNotes   ?? undefined;
          const resolvedExtras         = result.extractedData?.extras         ?? (session.extras ? JSON.parse(session.extras) : undefined);
          // Build a structured conversation summary — use explicit fields only, never raw user messages
          // (raw messages like "yes", "All good", "April 25" confuse the quote app's AI summary generator)
          const userMessages = history.filter(m => m.role === "user").map(m => m.content);
          const conversationSummary = isFlowC
            ? [
                `Service: ${resolvedService}`,
                `Home: ${resolvedBedrooms} / ${resolvedBathrooms}`,
                resolvedPreferredDates ? `Preferred date: ${resolvedPreferredDates}` : null,
                resolvedExtras && resolvedExtras.length > 0 ? `Add-ons: ${resolvedExtras.join(", ")}` : null,
                resolvedSpecialNotes && resolvedSpecialNotes.toLowerCase() !== "all good" && resolvedSpecialNotes.trim().length > 0
                  ? `Special notes: ${resolvedSpecialNotes}` : null,
              ].filter(Boolean).join(". ")
            : userMessages.slice(-3).join(" ");
          const quoteResult = await createQuoteLink({
            customerName:        session.leadName ?? "Customer",
            customerPhone:       fromPhone,
            bedrooms:            resolvedBedrooms,
            bathrooms:           resolvedBathrooms,
            serviceType:         resolvedService,
            frequency:           (session as any).frequency ?? "One-time",
            price:               resolvedPrice,
            slots:               isFlowC && resolvedPreferredDates ? [resolvedPreferredDates] : resolvedSlots,
            source:              session.leadSource ?? "LeadFlow SMS",
            conversationSummary,
          });
          if (quoteResult?.url) {
            if (finalReplyContent.includes("{quoteLink}")) {
              // Template has {quoteLink} placeholder — substitute it in place
              finalReplyContent = finalReplyContent.replace(/\{quoteLink\}/g, quoteResult.url);
            } else {
              // No placeholder — append as postscript (legacy fallback)
              finalReplyContent = `${result.reply}\n\nView your custom quote here: ${quoteResult.url}`;
            }
            console.log(`[QuoteLink] Injected quote URL for ${fromPhone}: ${quoteResult.url}`);
            // Store the quote slug on the session so we can update it later (e.g. with address)
            if (quoteResult.slug) {
              await db.update(conversationSessions).set({ quoteSlug: quoteResult.slug }).where(eq(conversationSessions.id, session.id));
            }
            // Gap 4: Insert quoteLeads row for widget Flow C leads when quote link fires.
            // Widget leads don't insert at submission time (bedrooms/bathrooms/extras unknown then),
            // so we create the row here when all data is available.
            if (isFlowC && session.leadSource === "widget") {
              try {
                await db.insert(quoteLeads).values({
                  name: session.leadName ?? "Unknown",
                  email: null,
                  phone: fromPhone,
                  serviceType: resolvedService,
                  bedrooms: resolvedBedrooms,
                  bathrooms: resolvedBathrooms,
                  extras: resolvedExtras && resolvedExtras.length > 0 ? JSON.stringify(resolvedExtras) : null,
                  smsSent: 1,
                  smsMessageId: null,
                });
                console.log(`[QuoteLink] Inserted quoteLeads row for widget lead ${fromPhone}`);
              } catch (qlErr) {
                console.error("[QuoteLink] Failed to insert quoteLeads row for widget lead:", qlErr);
              }
            }
          } else {
            // No quote URL — strip any leftover {quoteLink} placeholder so it doesn't appear in the SMS
            finalReplyContent = finalReplyContent.replace(/\{quoteLink\}/g, "").trim();
          }
        } catch (err) {
          console.error("[QuoteLink] Failed to generate quote link — sending plain price SMS:", err);
          // Always strip {quoteLink} placeholder so it never appears literally in the SMS
          finalReplyContent = finalReplyContent.replace(/\{quoteLink\}/g, "").trim();
        }
      }

      // Append the assistant's reply to history NOW — after finalReplyContent is fully resolved
      // so the stored message contains the real quote URL, not the raw {quoteLink} placeholder.
      history.push({ role: "assistant", content: finalReplyContent, ts: Date.now() });
      await db
        .update(conversationSessions)
        .set({ messageHistory: JSON.stringify(history) })
        .where(eq(conversationSessions.id, session.id));

      // Send the reply via OpenPhone
      const smsResult = await sendSms({
        to: fromPhone,
        content: finalReplyContent,
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
          // End any active/paused nurture enrollment immediately — do not wait for the next send tick
          getDb().then(async (db) => {
            if (!db) return;
            try {
              const { inArray, eq, and, isNull } = await import("drizzle-orm");
              const { nurtureEnrollments } = await import("../drizzle/schema");
              const [enrollment] = await db
                .select({ id: nurtureEnrollments.id })
                .from(nurtureEnrollments)
                .where(and(
                  eq(nurtureEnrollments.sessionId, session.id),
                  inArray(nurtureEnrollments.status, ["active", "paused"]),
                  isNull(nurtureEnrollments.deletedAt)
                ))
                .limit(1);
              if (enrollment) await endEnrollment(db, enrollment.id, "booked");
            } catch (err) {
              console.error("[Webhook] Failed to end nurture enrollment on BOOKED transition:", err);
            }
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
              // Normalize both sides: strip non-digits and compare last 10 digits
              // This handles stored formats like "2405438028", "(240) 543-8028", "+12405438028"
              sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') LIKE CONCAT('%', RIGHT(REGEXP_REPLACE(${fromPhone}, '[^0-9]', ''), 10))`,
              sql`REGEXP_REPLACE(${cleanerProfiles.phone}, '[^0-9]', '') LIKE CONCAT('%', RIGHT(REGEXP_REPLACE(${fromPhone}, '[^0-9]', ''), 10))`
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

    // Extract the external (lead) phone number.
    // OpenPhone v3 call.recording.completed may send participants as empty array;
    // fall back to call.from / call.to based on direction.
    const participants: string[] = call.participants ?? [];
    const internalNumbers = [
      normalizePhone(ENV.openPhoneFromNumber ?? ""),
      normalizePhone("+12028885362"), // CS line
    ].filter(Boolean);
    let rawPhone = participants.find(p => !internalNumbers.includes(normalizePhone(p)));
    if (!rawPhone) {
      // Fallback: derive from from/to fields
      const fromPhone = call.from ?? "";
      const toPhone = call.to ?? "";
      if (direction === "outgoing") {
        rawPhone = toPhone || undefined;
      } else {
        rawPhone = fromPhone || undefined;
      }
    }
    if (!rawPhone) {
      console.warn(`[CallRecording] No external participant phone for callId=${callId}, participants=${JSON.stringify(participants)}, from=${call.from}, to=${call.to}`);
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
      console.warn(`[CallRecording] No session found for leadPhone=${leadPhone} — storing with sessionId=0`);
    }

    // Insert with ON DUPLICATE KEY UPDATE for idempotency
    // (openphoneCallId has a UNIQUE constraint — duplicate webhooks are silently ignored)
    await db
      .insert(openphoneCallRecordings)
      .values({
        sessionId: session?.id ?? 0,
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

    console.log(`[CallRecording] Stored recording for callId=${callId} sessionId=${session?.id ?? 0}`);

    // Fire Whisper transcription + debrief in the background (non-blocking).
    if (recording.url) {
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

  // ── Running-late SMS detection (cleaner bypassed the app) ─────────────────
  // If a known cleaner texts the ops line with an ETA / running-late message,
  // post the same Command Chat card that the app would have posted so staff
  // can click "📞 Call Client" without the cleaner needing to tap the button.
  if (isCleaner && inboundText.trim()) {
    tryDetectCleanerRunningLate({
      db,
      fromPhoneDigits,
      cleanerName: resolvedName ?? "Cleaner",
      inboundText,
    }).catch(err => console.error("[CS] tryDetectCleanerRunningLate error:", err));
  }

  // ── Client status inquiry auto-handler ───────────────────────────────────
  // When a non-cleaner client texts asking about their job status ("Is the team
  // on the way?", "What time will they arrive?"), automatically:
  //   1. Send an ack SMS: "Checking with your team, will text you back shortly."
  //   2. Place a VAPI call to the assigned cleaner asking for their ETA.
  //   3. When the call ends, reply to the client with the ETA.
  // This runs async — does NOT block the rest of handleCsInboundMessage.
  if (!isCleaner && inboundText.trim()) {
    import("./clientStatusInquiryEngine").then(({ tryHandleClientStatusInquiry }) => {
      tryHandleClientStatusInquiry({
        db,
        fromPhone,
        fromPhoneDigits,
        clientName: resolvedName,
        inboundText,
      }).then(result => {
        if (result.triggered) {
          console.log(`[CS] Client status inquiry triggered for ${fromPhone}. Session: ${result.sessionId}, VAPI call: ${result.vapiCallId ?? "none"}`);
        }
      }).catch(err => console.error("[CS] tryHandleClientStatusInquiry error:", err));
    }).catch(err => console.error("[CS] import clientStatusInquiryEngine error:", err));
  }

  const sessionSource = isCleaner ? "cs-inbound-cleaner" : "cs-inbound";

  // Find the most recent matching session for this phone.
  // For cleaners, match ALL session types for their phone — cs-inbound-cleaner, cs_initiated,
  // AND cs-inbound. A cleaner's identity is authoritative: once isCleaner=true, any existing
  // session for their phone should be upgraded to cs-inbound-cleaner rather than creating a
  // duplicate. This prevents the two-session bug where a cleaner who previously texted in as
  // a client ends up with two separate threads.
  const sourceMatch = isCleaner
    ? or(
        eq(conversationSessions.leadSource, "cs-inbound-cleaner"),
        eq(conversationSessions.leadSource, "cs_initiated"),
        eq(conversationSessions.leadSource, "cs-inbound")
      )
    : eq(conversationSessions.leadSource, sessionSource);
  const [existingSession] = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.leadPhone, fromPhone),
        sourceMatch
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


    // Also backfill leadName if it was previously null and we now resolved one.
    // If this is a cleaner texting into a cs_initiated session, permanently upgrade
    // the leadSource to cs-inbound-cleaner so it always appears in the Teams column.
    const updatePayload: Record<string, unknown> = { messageHistory: JSON.stringify(history), updatedAt: new Date() };
    if (resolvedName && !existingSession.leadName) {
      updatePayload.leadName = resolvedName;
    }
    if (isCleaner && existingSession.leadSource !== "cs-inbound-cleaner") {
      updatePayload.leadSource = "cs-inbound-cleaner";
      console.log(`[CS] Upgraded session ${existingSession.id} leadSource from ${existingSession.leadSource} → cs-inbound-cleaner (cleaner texted in)`);
    }
    // Always lock cleaner sessions to Teams queue — regardless of previous csQueue value
    if (isCleaner && (existingSession as any).csQueue !== "Teams") {
      updatePayload.csQueue = "Teams";
      console.log(`[CS] Locked session ${existingSession.id} csQueue → Teams (cleaner identified)`);
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
    // Before creating a new cs-inbound session, check if there's an active hiring_interview
    // or hiring session for this phone. If so, append the inbound message there — this prevents
    // applicant replies (to the CS number) from being split into a separate cs-inbound thread.
    const [hiringSession] = await db
      .select()
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.leadPhone, fromPhone),
          inArray(conversationSessions.leadSource as any, ["hiring_interview", "hiring"] as any[])
        )
      )
      .orderBy(desc(conversationSessions.updatedAt))
      .limit(1);
    if (hiringSession) {
      // Append to the hiring session so the full conversation stays in one place
      const [freshHiring] = await db
        .select({ messageHistory: conversationSessions.messageHistory })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, hiringSession.id))
        .limit(1);
      let hiringHistory: Array<{ role: string; content: string; ts?: number; opMsgId?: string }> = [];
      try { hiringHistory = JSON.parse(freshHiring?.messageHistory ?? "[]"); } catch { hiringHistory = []; }
      // Dedup by messageId
      if (messageId && hiringHistory.some((h: any) => h.opMsgId === messageId)) {
        console.log(`[CS→Hiring] messageId dedup: ${messageId} already in hiring session ${hiringSession.id}. Skipping.`);
        return;
      }
      // Content dedup
      const recentH = hiringHistory.slice(-3);
      const isDupH = inboundText.trim() !== "" && recentH.some(m => m.role === "user" && m.content === inboundText && now - (m.ts ?? 0) < 10_000);
      if (isDupH) {
        console.log(`[CS→Hiring] Content dedup: identical message already in hiring session ${hiringSession.id}. Skipping.`);
        return;
      }
      hiringHistory.push({ role: "user", content: inboundText, ts: now, opMsgId: messageId, ...(mediaUrls.length > 0 ? { media: mediaUrls } : {}) } as any);
      await db
        .update(conversationSessions)
        .set({ messageHistory: JSON.stringify(hiringHistory), updatedAt: new Date() } as any)
        .where(eq(conversationSessions.id, hiringSession.id));
      console.log(`[CS→Hiring] Routed inbound from ${fromPhone} to hiring session ${hiringSession.id} instead of creating new cs-inbound`);
    } else {
      // No hiring session — create new cs-inbound session as before
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
    // Fire LLM status scoring async (non-blocking) — updates csStatusTier in real-time on new message
    scoreAndCacheStatusById(resolvedSessionId, isCleaner).catch(err =>
      console.warn("[CS] scoreAndCacheStatusById error:", err)
    );
    syncCsOutboundMessages(fromPhone, resolvedSessionId).catch(err =>
      console.warn("[CS] syncCsOutboundMessages error:", err)
    );
  }
}

// ── Running-late SMS detection helper ────────────────────────────────────────

/**
 * Patterns that indicate a cleaner is running late or giving an ETA.
 * Covers the real messages found in 90-day data analysis:
 *   "Yes l be there 4:45"
 *   "Hello we there around 12:30"
 *   "I be there 9;00"
 *   "Running a little late, be there by 2pm"
 *   "On my way, will arrive around 3:30"
 */
const RUNNING_LATE_PATTERNS: RegExp[] = [
  /running\s+(?:a\s+(?:little|bit)\s+)?late/i,
  /(?:be|get)\s+there\s+(?:at|around|by|@)?\s*\d/i,
  /(?:arrive|arriving|arrival)\s+(?:at|around|by|@)?\s*\d/i,
  /(?:there|arrive)\s+(?:at|around|by|@)?\s*\d{1,2}[:\s;]\d{2}/i,
  /(?:on\s+my\s+way|omw).*\d{1,2}[:\s;]\d{2}/i,
  /(?:will\s+be|i'?ll\s+be)\s+(?:there|at)\s+(?:at|around|by|@)?\s*\d/i,
  /(?:delayed|delay|stuck|traffic|running\s+behind)/i,
  /\b(?:be\s+there|there)\s+(?:at|by|around|@)?\s*\d{1,2}\s*(?:am|pm)/i,
];

/**
 * Parse a rough ETA time from a free-text message.
 * Returns Unix ms timestamp (today's date + parsed time) or null.
 */
function parseEtaFromText(text: string): { etaMs: number | null; etaLabel: string | null } {
  // Match patterns like 4:45, 4;45, 4 45, 4pm, 4:45pm, 12:30
  const timeMatch = text.match(
    /\b(\d{1,2})[:\s;](\d{2})\s*([ap]m)?\b|\b(\d{1,2})\s*([ap]m)\b/i
  );
  if (!timeMatch) return { etaMs: null, etaLabel: null };

  let hours: number;
  let minutes: number;
  let ampm: string | undefined;

  if (timeMatch[1] !== undefined) {
    // HH:MM format
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    ampm = timeMatch[3]?.toLowerCase();
  } else {
    // HH am/pm format
    hours = parseInt(timeMatch[4], 10);
    minutes = 0;
    ampm = timeMatch[5]?.toLowerCase();
  }

  if (isNaN(hours) || isNaN(minutes)) return { etaMs: null, etaLabel: null };

  // Normalize to 24h
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  // Heuristic: if no am/pm and hour is 1–6, assume pm (cleaners work afternoons)
  if (!ampm && hours >= 1 && hours <= 6) hours += 12;

  const now = new Date();
  const eta = new Date(now);
  eta.setHours(hours, minutes, 0, 0);

  // If the parsed time is more than 1 hour in the past, skip (likely a mistake)
  if (eta.getTime() < now.getTime() - 60 * 60 * 1000) return { etaMs: null, etaLabel: null };

  const etaLabel = eta.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });

  return { etaMs: eta.getTime(), etaLabel };
}

/**
 * Checks if an inbound CS message from a known cleaner looks like a running-late
 * or ETA message. If so, finds their active job for today and posts the same
 * Command Chat card the app would have posted — so staff can click "📞 Call Client".
 *
 * Idempotent: skips if the job already has a running_late card posted today.
 */
async function tryDetectCleanerRunningLate({
  db,
  fromPhoneDigits,
  cleanerName,
  inboundText,
}: {
  db: Awaited<ReturnType<typeof import("./db").getDb>>;
  fromPhoneDigits: string;
  cleanerName: string;
  inboundText: string;
}): Promise<void> {
  if (!db) return;

  // 1. Check if the text matches any running-late pattern
  const isRunningLate = RUNNING_LATE_PATTERNS.some(re => re.test(inboundText));
  if (!isRunningLate) return;

  // 2. Find the cleaner's profile
  const [profile] = await db
    .select({ id: cleanerProfiles.id })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.phone, fromPhoneDigits))
    .limit(1);
  if (!profile) return;

  // 3. Find today's active job for this cleaner
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
  const [job] = await db
    .select({
      id: cleanerJobs.id,
      cleanerName: cleanerJobs.cleanerName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      jobStatus: cleanerJobs.jobStatus,
    })
    .from(cleanerJobs)
    .where(
      and(
        eq(cleanerJobs.cleanerProfileId, profile.id),
        eq(cleanerJobs.jobDate, todayET),
      )
    )
    .orderBy(desc(cleanerJobs.id))
    .limit(1);

  if (!job) {
    console.log(`[CS RunningLate] No today's job found for cleaner ${cleanerName} (${fromPhoneDigits})`);
    return;
  }

  // 4. Idempotency: skip if we already posted a running_late card for this job today
  const [existingCard] = await db
    .select({ id: opsChatMessages.id })
    .from(opsChatMessages)
    .where(
      and(
        eq(opsChatMessages.cleanerJobId, job.id),
        eq(opsChatMessages.quickAction, "cleaner_status"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${opsChatMessages.metadata}, '$.status')) = 'running_late'`,
        gte(opsChatMessages.createdAt, new Date(new Date().setHours(0, 0, 0, 0)))
      )
    )
    .limit(1);

  if (existingCard) {
    console.log(`[CS RunningLate] Card already posted for job ${job.id} — skipping duplicate`);
    return;
  }

  // 5. Parse ETA from the message text
  const { etaMs, etaLabel } = parseEtaFromText(inboundText);

  // 6. Update the job status to running_late
  await db
    .update(cleanerJobs)
    .set({
      jobStatus: "running_late",
      ...(etaMs ? { etaTimestamp: etaMs } : {}),
    })
    .where(eq(cleanerJobs.id, job.id))
    .catch(err => console.error("[CS RunningLate] Failed to update jobStatus:", err));

  // 7. Post the Command Chat card (same shape as cleanerRouter.updateJobStatus)
  const etaPart = etaLabel ? ` · ETA ${etaLabel}` : "";
  const customerPart = job.customerName ? ` — ${job.customerName}` : "";
  const addressPart = job.jobAddress ? ` (${job.jobAddress})` : "";
  const body = `⏰ ${cleanerName} — Running late${customerPart}${addressPart}${etaPart} · via SMS`;

  await db.insert(opsChatMessages).values({
    channel: "command",
    cleanerJobId: job.id,
    authorName: cleanerName,
    authorRole: "cleaner",
    body,
    quickAction: "cleaner_status",
    metadata: JSON.stringify({
      cleanerName,
      status: "running_late",
      label: "Running late",
      emoji: "⏰",
      cleanerJobId: job.id,
      customerName: job.customerName ?? null,
      jobAddress: job.jobAddress ?? null,
      etaLabel: etaLabel ?? null,
      issueNote: null,
      detectedFromSms: true,
      smsText: inboundText.slice(0, 200),
    }),
  });

  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("new_message", { channel: "command" });
  broadcastOpsUpdate("job_update", { jobId: job.id });

  console.log(`[CS RunningLate] ✅ Card posted for ${cleanerName} job ${job.id}${etaLabel ? ` (ETA ${etaLabel})` : ""} — detected from SMS: "${inboundText.slice(0, 80)}"`);
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

  if (messages.length === 0) return;

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
  for (const m of messages) {
    const text: string = m.text ?? m.body ?? "";
    // Allow empty text for media-only messages (photos)
    const msgId: string = m.id ?? "";
    const msgTs = m.createdAt ? new Date(m.createdAt).getTime() : 0;
    const isInbound = m.direction === "incoming";
    const role = isInbound ? "user" : "assistant";
    const senderName = isInbound ? undefined : ((m.userId && opUserMap[m.userId]) ? opUserMap[m.userId] : "OpenPhone");

    // Skip if already synced by ID
    if (msgId && syncedIds.has(msgId)) continue;

    // Skip if identical non-empty content within 15s (dedup for messages already stored via webhook)
    if (text.trim()) {
      const isDup = history.some(
        (h: any) => h.role === role && h.content === text && Math.abs((h.ts ?? 0) - msgTs) < 15_000
      );
      if (isDup) continue;
    }

    const entry: any = { role, content: text, ts: msgTs, opMsgId: msgId };
    if (senderName) entry.senderName = senderName;
    history.push(entry);
    added++;
  }

  if (added === 0) return;

  // Sort by ts to maintain chronological order
  history.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));


  await db
    .update(conversationSessions)
    .set({ messageHistory: JSON.stringify(history), updatedAt: new Date() } as any)
    .where(eq(conversationSessions.id, sessionId));

  console.log(`[CS Sync] Synced ${added} message(s) from OpenPhone for session ${sessionId} (${leadPhone})`);

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
  // ── Cross-reference: update lastCalledAt on the matching conversationSession ──
  // Strategy: match session by leadPhone, then use assignedAgentId (the claiming agent)
  // rather than trying to resolve the OpenPhone userId (unreliable on shared numbers).
  if (callerPhone) {
    try {
      const normalizedCaller = normalizePhone(callerPhone);
      const [matchedSession] = await db
        .select({
          id: conversationSessions.id,
          assignedAgentId: conversationSessions.assignedAgentId,
          assignedAgentName: conversationSessions.assignedAgentName,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.leadPhone, normalizedCaller))
        .orderBy(desc(conversationSessions.createdAt))
        .limit(1);
      if (matchedSession) {
        // Prefer the claiming agent; fall back to the call's resolved agent
        const callingAgentId = matchedSession.assignedAgentId ?? agent.id;
        const callingAgentName = matchedSession.assignedAgentName ?? agent.name;
        await db
          .update(conversationSessions)
          .set({
            lastCalledAt: new Date(callStartedAt),
            lastCalledByAgentId: callingAgentId,
            lastCalledByAgentName: callingAgentName,
          } as any)
          .where(eq(conversationSessions.id, matchedSession.id));
        console.log(`[CallStatus] Updated lastCalledAt for session ${matchedSession.id} (lead: ${callerLabel}, agent: ${callingAgentName})`);
        // Broadcast so Lead Ops refreshes the card immediately
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("lead_update");
      }
    } catch (e) {
      console.error("[CallStatus] Failed to update lastCalledAt on conversationSession:", e);
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

  const callId: string = call.id;
  const direction: string = call.direction ?? "incoming";
  const durationSec: number | null = call.duration ?? null;
  const durationLabel = durationSec
    ? durationSec >= 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`
    : null;
  const dirLabel = direction === "outgoing" ? "Outbound" : "Inbound";
  const otherParty = direction === "outgoing" ? (call.to ?? "") : (call.from ?? "");

  // Clear on-call status (best-effort)
  await db
    .update(agents)
    .set({ onCallSince: null, onCallCallId: null } as any)
    .where(eq(agents.onCallCallId, callId));
  console.log(`[CallStatus] call.completed for callId=${callId}`);

  // ── Missed call detection ──────────────────────────────────────────────────
  // A missed inbound call has direction=incoming and answeredAt=null.
  // OpenPhone also sets status to "missed", "no-answer", or "abandoned".
  const isMissed =
    direction === "incoming" &&
    !call.answeredAt &&
    (!call.status || ["missed", "no-answer", "abandoned", "completed"].includes(call.status));

  if (isMissed) {
    await handleMissedCall({ call, callId, db });
  }

  // ── Post call_ended card to CommandChat ────────────────────────────────────
  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "📞 Call",
      authorRole: "system",
      body: `${dirLabel} call · ${otherParty}${durationLabel ? ` · ${durationLabel}` : ""}`,
      quickAction: "call_ended",
      metadata: JSON.stringify({
        callId,
        direction,
        otherParty,
        durationSec,
        durationLabel,
      }),
    });
  } catch (e) {
    console.error("[CallStatus] Failed to post call_ended card:", e);
  }

  const { broadcastOpsUpdate } = await import("./sseBroadcast");
  broadcastOpsUpdate("agent_status");
  broadcastOpsUpdate("new_message", { channel: "command" });
}

/**
 * handleMissedCall
 * Called from handleCallCompleted when an inbound call was not answered.
 *
 * Steps:
 *   1. Inserts a row into missed_calls (deduped by openphoneCallId)
 *   2. Sends an auto-SMS to the caller (with 24h dedup + opt-out check)
 *   3. Posts a missed_call card to CommandChat
 *   4. Broadcasts missed_call SSE event so the header badge updates in real time
 */
async function handleMissedCall({ call, callId, db }: { call: any; callId: string; db: any }): Promise<void> {
  const callerPhone: string = call.from ?? "";
  if (!callerPhone) {
    console.warn("[MissedCall] No caller phone — skipping");
    return;
  }

  const phoneNumberId: string = call.phoneNumberId ?? "";
  // Map phone number ID → human label
  const phoneNumberLabel =
    phoneNumberId === ENV.openPhoneNumberId ? "Main" :
    phoneNumberId === ENV.openPhoneCsNumberId ? "CS" :
    phoneNumberId === ENV.openPhoneBarkNumberId ? "Bark" :
    "Unknown";

  const calledAt = call.createdAt ? new Date(call.createdAt) : new Date();

  // ── 1. Insert into missed_calls (UNIQUE on openphoneCallId — safe to retry) ──
  let missedCallId: number | null = null;
  try {
    // Check for existing row first (dedup)
    const [existing] = await db
      .select({ id: missedCalls.id })
      .from(missedCalls)
      .where(eq(missedCalls.openphoneCallId, callId))
      .limit(1);

    if (existing) {
      console.log(`[MissedCall] Already recorded callId=${callId} — skipping insert`);
      missedCallId = existing.id;
    } else {
      const [inserted] = await db
        .insert(missedCalls)
        .values({
          openphoneCallId: callId,
          callerPhone,
          phoneNumberId,
          phoneNumberLabel,
          calledAt,
          smsSent: 0,
          calledBack: 0,
        })
        .$returningId();
      missedCallId = inserted?.id ?? null;
      console.log(`[MissedCall] Inserted missed_calls row id=${missedCallId}`);
    }
  } catch (e) {
    console.error(`[MissedCall] Failed to insert missed_calls row:`, e);
  }

  // ── 2. Auto-SMS (with opt-out + 24h dedup) ────────────────────────────────
  const AUTO_SMS_MSG =
    "Hi this is Ava from Maids in Black, sorry we missed your call. We'll give you a call back in a few moments. Feel free to shoot us a quick text as well!";

  try {
    // Check opt-out
    const [optOut] = await db
      .select({ id: smsOptOuts.id })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, callerPhone))
      .limit(1);

    if (optOut) {
      console.log(`[MissedCall] ${callerPhone} opted out — skipping auto-SMS`);
    } else {
      // 24h dedup — don't spam the same caller
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentSms] = await db
        .select({ id: missedCalls.id })
        .from(missedCalls)
        .where(
          and(
            eq(missedCalls.callerPhone, callerPhone),
            eq(missedCalls.smsSent, 1),
            gte(missedCalls.smsSentAt, cutoff24h)
          )
        )
        .limit(1);

      if (recentSms) {
        console.log(`[MissedCall] Auto-SMS already sent to ${callerPhone} in last 24h — skipping`);
      } else {
        // Send from the same number they called
        const smsResult = await sendSms({
          to: callerPhone,
          content: AUTO_SMS_MSG,
          fromNumberId: phoneNumberId || undefined,
        });

        if (smsResult.success && missedCallId) {
          await db
            .update(missedCalls)
            .set({ smsSent: 1, smsSentAt: new Date() })
            .where(eq(missedCalls.id, missedCallId));
          console.log(`[MissedCall] Auto-SMS sent to ${callerPhone}`);
        } else {
          console.error(`[MissedCall] Auto-SMS failed for ${callerPhone}:`, smsResult.error);
        }
      }
    }
  } catch (e) {
    console.error(`[MissedCall] Auto-SMS error for ${callerPhone}:`, e);
  }

  // ── 3. Post missed_call card to CommandChat ────────────────────────────────
  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: null,
      channel: "command",
      authorName: "☎️ Missed Call",
      authorRole: "system",
      body: `Missed inbound call · ${callerPhone} · ${phoneNumberLabel} line`,
      quickAction: "missed_call",
      metadata: JSON.stringify({
        missedCallId,
        callId,
        callerPhone,
        phoneNumberLabel,
        calledAt: calledAt.toISOString(),
      }),
    });
  } catch (e) {
    console.error("[MissedCall] Failed to post missed_call card:", e);
  }

  // ── 4. SSE broadcast — updates header badge in real time ──────────────────
  try {
    const { broadcastOpsUpdate } = await import("./sseBroadcast");
    broadcastOpsUpdate("missed_call", { callerPhone, phoneNumberLabel });
    broadcastOpsUpdate("new_message", { channel: "command" });
  } catch (e) {
    console.error("[MissedCall] SSE broadcast error:", e);
  }
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

// Client-facing steps — these are the ones we alert on if undelivered
const CLIENT_SMS_STEPS = new Set(["client_pre_job", "client_on_the_way", "client_running_late"]);

/**
 * Handle SMS delivery status updates from OpenPhone.
 * Matches by openPhoneMessageId in both jobSmsReplies and fieldMgmtLog,
 * then updates deliveryStatus to "delivered", "undelivered", or "failed".
 * If a CLIENT-facing step is undelivered, posts an alert to the command channel.
 */
async function handleSmsDeliveryUpdate(messageId: string, status: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Preserve the exact OpenPhone status — "delivered", "undelivered", "failed", "sent", "queued"
  // We keep "undelivered" distinct from "failed" so the UI can show the right label.
  const deliveryStatus = ["delivered", "undelivered", "failed", "sent", "queued"].includes(status) ? status : status;
  try {
    const { jobSmsReplies: jsr, fieldMgmtLog: fml, cleanerJobs: cj } = await import("../drizzle/schema");
    const { eq: eqFn } = await import("drizzle-orm");

    // Update jobSmsReplies (manual outbound SMS from sendJobSms)
    await db.update(jsr)
      .set({ deliveryStatus } as any)
      .where(eqFn(jsr.openPhoneMessageId, messageId));

    // Update fieldMgmtLog (automated client SMS) and check if it's a client step
    const [updatedRow] = await db.select({
      id: fml.id,
      cleanerJobId: fml.cleanerJobId,
      step: fml.step,
      recipientPhone: fml.recipientPhone,
      smsSent: fml.smsSent,
    }).from(fml).where(eqFn(fml.openPhoneMessageId, messageId)).limit(1);

    await db.update(fml)
      .set({ deliveryStatus } as any)
      .where(eqFn(fml.openPhoneMessageId, messageId));

    console.log(`[Webhook] SMS delivery update: messageId=${messageId} status=${deliveryStatus} step=${updatedRow?.step ?? 'unknown'}`);

    // ── Alert on undelivered client SMS ────────────────────────────────────────
    // Only alert for client-facing steps (not cleaner SMS) and only for failures.
    if (
      updatedRow &&
      (deliveryStatus === "undelivered" || deliveryStatus === "failed") &&
      CLIENT_SMS_STEPS.has(updatedRow.step)
    ) {
      try {
        // Look up customer name for the alert
        const [jobRow] = await db.select({
          customerName: cj.customerName,
          jobAddress: cj.jobAddress,
        }).from(cj).where(eqFn(cj.id, updatedRow.cleanerJobId)).limit(1);

        const stepLabel = updatedRow.step === "client_pre_job" ? "Pre-arrival SMS"
          : updatedRow.step === "client_on_the_way" ? "On-the-way SMS"
          : "Running-late SMS";
        const clientName = jobRow?.customerName ?? "Client";
        const phone = updatedRow.recipientPhone ?? "unknown";
        const address = jobRow?.jobAddress ?? "";

        await db.insert(opsChatMessages).values({
          cleanerJobId: updatedRow.cleanerJobId,
          channel: "command",
          authorName: "📵 SMS Failure",
          authorRole: "system",
          quickAction: "sms_undelivered",
          body: `${stepLabel} to ${clientName} was **undelivered**.\nPhone: ${phone}${address ? `\nAddress: ${address}` : ""}\n\nThis number may be a landline or VoIP. Get an alternate mobile number.`,
          metadata: JSON.stringify({
            messageId,
            step: updatedRow.step,
            cleanerJobId: updatedRow.cleanerJobId,
            phone,
            customerName: clientName,
          }),
        });

        // Broadcast so Command Chat refreshes immediately
        const { broadcastOpsUpdate } = await import("./sseBroadcast");
        broadcastOpsUpdate("new_message", { channel: "command" });

        console.log(`[Webhook] Undelivered alert posted for job ${updatedRow.cleanerJobId} step=${updatedRow.step} phone=${phone}`);
      } catch (alertErr) {
        console.error("[Webhook] Failed to post undelivered alert:", alertErr);
      }
    }
  } catch (err) {
    console.error("[Webhook] handleSmsDeliveryUpdate DB error:", err);
  }
}
