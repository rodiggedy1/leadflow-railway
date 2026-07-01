/**
 * Vapi Webhook Handler
 *
 * Handles two types of Vapi server messages:
 *   1. tool-calls  — mid-call function calls (getQuote, createLead, sendSms)
 *   2. end-of-call-report — post-call summary, transcript, structured data
 *
 * Registered at POST /api/webhooks/vapi
 *
 * Vapi sends toolCallList items in ONE of two formats depending on version:
 *   Format A (Vapi native): { id, name, parameters: { ... } }
 *   Format B (OpenAI-style): { id, function: { name, arguments: "JSON string" } }
 * We handle both.
 */

import type { Express, Request, Response } from "express";
import {
  handleGetQuote,
  handleCreateLead,
  handleSendSms,
  handleScheduleCallback,
  processEndOfCallReport,
  type VapiEndOfCallReport,
} from "./vapiService";
import { notifyOwner } from "./_core/notification";
import { sendSms } from "./openphone";
import { getDb } from "./db";
import { fieldMgmtCalls, callLog } from "../drizzle/schema";
import { eq, or } from "drizzle-orm";

const OWNER_ALERT_NUMBER = "+13029816191";

// Deduplication: track which vapiCallIds have already fired the "call received" notification.
// VAPI can send multiple status-update events with status=in-progress for the same call.
// We only want to notify once per call. The Set is in-memory — fine because calls are
// short-lived (minutes) and the server process is long-lived. Entries are pruned after 1 hour.
const notifiedCallIds = new Set<string>();
const notifiedCallTimestamps = new Map<string, number>();
const NOTIFY_DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour

function pruneNotifiedCalls(): void {
  const now = Date.now();
  for (const [id, ts] of Array.from(notifiedCallTimestamps.entries())) {
    if (now - ts > NOTIFY_DEDUP_TTL_MS) {
      notifiedCallIds.delete(id);
      notifiedCallTimestamps.delete(id);
    }
  }
}

// Vapi native format
interface VapiToolCallNative {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

// OpenAI-style format (some Vapi versions)
interface VapiToolCallOpenAI {
  id: string;
  type?: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

type VapiToolCall = VapiToolCallNative | VapiToolCallOpenAI;

/** Normalize a tool call to { id, name, args } regardless of format */
function parseToolCall(tc: VapiToolCall): { id: string; name: string; args: Record<string, unknown> } {
  // Format A: { id, name, parameters }
  if ("name" in tc && "parameters" in tc) {
    return {
      id: tc.id,
      name: (tc as VapiToolCallNative).name,
      args: (tc as VapiToolCallNative).parameters ?? {},
    };
  }
  // Format B: { id, function: { name, arguments } }
  if ("function" in tc) {
    const fn = (tc as VapiToolCallOpenAI).function;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(fn.arguments);
    } catch {
      args = {};
    }
    return { id: tc.id, name: fn.name, args };
  }
  // Unknown format — return empty
  const anyTc = tc as Record<string, unknown>;
  return { id: (anyTc.id as string) ?? "unknown", name: "", args: {} };
}

export function registerVapiWebhookRoute(app: Express): void {
  app.post("/api/webhooks/vapi", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const message = body?.message as Record<string, unknown> | undefined;
      const msgType = message?.type as string | undefined;

      if (!msgType) {
        return res.status(400).json({ error: "Missing message.type" });
      }

      // ── Tool calls (mid-call) ──────────────────────────────────────────────
      if (msgType === "tool-calls") {
        // Log raw payload for debugging (first 3000 chars)
        console.log("[Vapi] tool-calls raw payload:", JSON.stringify(body).slice(0, 3000));

        // Vapi sends toolCallList OR toolCalls — handle both
        const rawList = (message?.toolCallList ?? message?.toolCalls ?? []) as VapiToolCall[];

        // Extract caller phone from the call object (Vapi puts it at message.call.customer.number)
        const callObj = message?.call as Record<string, unknown> | undefined;
        const callerPhone = (callObj?.customer as Record<string, unknown> | undefined)?.number as string | undefined ?? "";

        const results: Array<{ toolCallId: string; result: string }> = [];
        // Track sessionId created by createLead so sendSms in the same batch can log to the thread
        let batchSessionId: number | undefined;

        for (const rawTc of rawList) {
          const { id, name, args } = parseToolCall(rawTc);

          console.log(`[Vapi] Tool call: ${name}`, JSON.stringify(args));

          let result: unknown;

          switch (name) {
            case "getQuote": {
              result = handleGetQuote(args as {
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
              });
              break;
            }
            case "createLead": {
              const createArgs = args as {
                name: string;
                phone?: string;
                email?: string;
                address?: string;
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
                quotedPrice: number;
                preferredDate?: string;
                selectedExtras?: string[];
              };
              // Use caller's phone from the call object as the authoritative source.
              // The system prompt injects {{customer.number}} which the LLM passes as phone,
              // but we also have it directly from the call object as a safety net.
              if (!createArgs.phone && callerPhone) {
                createArgs.phone = callerPhone;
              }
              // If the LLM passed the business number by mistake, override with real caller phone
              const BUSINESS_PHONE = "+12028885362";
              if (createArgs.phone === BUSINESS_PHONE && callerPhone && callerPhone !== BUSINESS_PHONE) {
                console.warn(`[Vapi] createLead phone was business number — overriding with callerPhone: ${callerPhone}`);
                createArgs.phone = callerPhone;
              }
              const createResult = await handleCreateLead(createArgs as {
                name: string;
                phone: string;
                email?: string;
                address?: string;
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
                quotedPrice: number;
                preferredDate?: string;
                selectedExtras?: string[];
              });
              // Capture sessionId so sendSms in this batch can log to the thread
              if (createResult.success && createResult.sessionId) {
                batchSessionId = createResult.sessionId;
              }
              result = createResult;
              break;
            }
            case "sendSms": {
              result = await handleSendSms({
                ...(args as { to: string; message: string }),
                sessionId: batchSessionId,
              });
              break;
            }
            case "scheduleCallback": {
              const cbArgs = args as {
                callerName?: string;
                phone?: string;
                preferredCallbackTime: string;
                notes?: string;
              };
              // Use caller phone from call object as authoritative source
              const cbPhone = cbArgs.phone ?? callerPhone;
              result = await handleScheduleCallback({
                callerName: cbArgs.callerName,
                phone: cbPhone,
                preferredCallbackTime: cbArgs.preferredCallbackTime,
                notes: cbArgs.notes,
                sessionId: batchSessionId,
              });
              break;
            }
            default: {
              result = { error: `Unknown tool: ${name}` };
            }
          }

          results.push({
            toolCallId: id,
            result: JSON.stringify(result),
          });
        }

        return res.json({ results });
      }

      // ── End-of-call report ─────────────────────────────────────────────────
      if (msgType === "end-of-call-report") {
        // Log for debugging
        console.log("[Vapi] end-of-call-report received:", JSON.stringify(body).slice(0, 1000));
        // Process asynchronously — don't block the 200 response
        processEndOfCallReport(body as unknown as VapiEndOfCallReport).catch((err) => {
          console.error("[Vapi] processEndOfCallReport error:", err);
        });

        // Also update fieldMgmtCalls if this vapiCallId matches a field mgmt call
        const callMsg = (body as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
        const callObj = callMsg?.call as Record<string, unknown> | undefined;
        const vapiCallId = callObj?.id as string | undefined;
        if (vapiCallId) {
          const artifact = callMsg?.artifact as Record<string, unknown> | undefined;
          const analysis = callMsg?.analysis as Record<string, unknown> | undefined;
          const startedAt = callObj?.startedAt ? new Date(callObj.startedAt as string).getTime() : Date.now();
          const endedAt = callObj?.endedAt ? new Date(callObj.endedAt as string).getTime() : Date.now();
          const durationSeconds = Math.round((endedAt - startedAt) / 1000);
          const transcript = (artifact?.transcript as string | undefined) ?? null;
          const summary = (analysis?.summary as string | undefined) ?? null;
          const recordingUrl = (artifact?.recordingUrl as string | undefined) ?? null;
          const endedReason = callMsg?.endedReason as string | undefined;
          // Determine outcome from endedReason
          const outcome =
            endedReason === "customer-ended-call"     ? "answered"  :
            endedReason === "exceeded-max-duration"   ? "answered"  :  // call ran full length = connected
            endedReason === "assistant-ended-call"    ? "answered"  :
            endedReason?.includes("voicemail")        ? "voicemail" :
            endedReason?.includes("no-answer")        ? "no_answer" :
            endedReason === "customer-busy"           ? "no_answer" :
            endedReason === "customer-did-not-answer" ? "no_answer" :
            durationSeconds > 5                       ? "answered"  : "no_answer";

          getDb().then(async (db) => {
            if (!db) return;

            // ── Update callCommandCenter callLog if this vapiCallId matches ──
            const callCenterStatus: string =
              outcome === "answered" ? "completed" :
              outcome === "no_answer" ? "no_answer" : "failed";

            await db.update(callLog)
              .set({
                status: callCenterStatus as any,
                vapiCallId,
                recordingUrl: recordingUrl ?? undefined,
                transcript: transcript ?? undefined,
                durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
                completedAt: endedAt,
              })
              .where(eq(callLog.vapiCallId, vapiCallId))
              .catch((err: unknown) => console.error("[Vapi] callLog update error:", err));

            // ── Fetch full transcript from VAPI API (end-of-call-report transcript can be incomplete) ──
            // Fetch the full call object immediately and update callLog.transcript (source of truth).
            // Then call ensureEnglishTranscript which is idempotent and handles Spanish translation.
            (async () => {
              try {
                const fullCallRes = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
                  headers: { Authorization: `Bearer ${ENV.vapiPrivateKey}` },
                });
                if (!fullCallRes.ok) {
                  console.error(`[Vapi] Full transcript fetch failed: HTTP ${fullCallRes.status} for vapiCallId=${vapiCallId}`);
                  return;
                }
                const fullCall = await fullCallRes.json() as Record<string, unknown>;
                const fullArtifact = fullCall.artifact as Record<string, unknown> | undefined;
                const fullTranscript = (fullArtifact?.transcript as string | undefined) ?? (fullCall.transcript as string | undefined) ?? null;
                if (!fullTranscript) {
                  console.log(`[Vapi] No full transcript available yet for vapiCallId=${vapiCallId}`);
                  return;
                }

                // Look up the callLog id for this vapiCallId
                const [clRow] = await db
                  .select({ id: callLog.id })
                  .from(callLog)
                  .where(eq(callLog.vapiCallId, vapiCallId))
                  .limit(1)
                  .catch(() => []);
                if (!clRow) return;

                // Update callLog.transcript with the full version (source of truth — never overwritten again)
                await db.update(callLog)
                  .set({ transcript: fullTranscript })
                  .where(eq(callLog.id, clRow.id))
                  .catch((err: unknown) => console.error("[Vapi] callLog full transcript update error:", err));
                console.log(`[Vapi] callLog id=${clRow.id} full transcript updated (${fullTranscript.length} chars)`);

                // Translate to English if needed (idempotent — skips if already translated or English)
                const { ensureEnglishTranscript } = await import("./translationHelper");
                await ensureEnglishTranscript(db, clRow.id);
              } catch (fetchErr) {
                console.error("[Vapi] Full transcript fetch/translation failed:", fetchErr);
              }
            })();

            // Update fieldMgmtCalls row with outcome/transcript
            const [updatedCall] = await db.update(fieldMgmtCalls)
              .set({ outcome, durationSeconds, transcript, summary, recordingUrl, endedReason: endedReason ?? null })
              .where(eq(fieldMgmtCalls.vapiCallId, vapiCallId))
              .catch(() => [null]) as any;

            // If this was a client_status_inquiry call, send the ETA reply to the client
            const [callRow] = await db
              .select({
                step: fieldMgmtCalls.step,
                clientStatusInquirySessionId: fieldMgmtCalls.clientStatusInquirySessionId,
                calledPhone: fieldMgmtCalls.calledPhone,
                vapiCallId: fieldMgmtCalls.vapiCallId,
              })
              .from(fieldMgmtCalls)
              .where(eq(fieldMgmtCalls.vapiCallId, vapiCallId))
              .limit(1)
              .catch(() => []);

            if (callRow?.step === "client_status_inquiry" && callRow?.clientStatusInquirySessionId) {
              const { handleStatusInquiryCallEnd } = await import("./clientStatusInquiryEngine");
              // Look up cleaner name from the called phone
              const digits = callRow.calledPhone.replace(/[^\d]/g, "").slice(-10);
              const [cleanerRow] = await db
                .select({ name: (await import("../drizzle/schema")).cleanerProfiles.name })
                .from((await import("../drizzle/schema")).cleanerProfiles)
                .where(eq((await import("../drizzle/schema")).cleanerProfiles.phone, digits))
                .limit(1)
                .catch(() => []);
              await handleStatusInquiryCallEnd({
                db,
                sessionId: callRow.clientStatusInquirySessionId,
                transcript: transcript ?? null,
                outcome,
                cleanerName: cleanerRow?.name ?? null,
              }).catch((err: unknown) => console.error("[Vapi] handleStatusInquiryCallEnd error:", err));
            }

            if (callRow?.step === "schedule_escalation") {
              const { handleEscalationCallEnd } = await import("./escalationEngine");
              const callAssistant = (callObj as Record<string, unknown> | undefined)?.assistant as Record<string, unknown> | undefined;
              const assistantMetadata = (callAssistant?.metadata as Record<string, unknown> | undefined) ?? {};
              await handleEscalationCallEnd({
                vapiCallId: callRow.vapiCallId ?? "",
                transcript: transcript ?? null,
                endedReason: endedReason ?? null,
                metadata: {
                  cleanerProfileId: assistantMetadata.cleanerProfileId as number | undefined,
                  cleanerName: assistantMetadata.cleanerName as string | undefined,
                  cleanerPhone: callRow.calledPhone ?? undefined,
                  targetDate: assistantMetadata.targetDate as string | undefined,
                  jobIds: assistantMetadata.jobIds as number[] | undefined,
                },
              }).catch((err: unknown) => console.error("[Vapi] handleEscalationCallEnd error:", err));
            }
          }).catch(() => {});
        }

        return res.json({ received: true });
      }

      // ── Status update: fire notification bell when call connects ──────────
      if (msgType === "status-update") {
        const status = message?.status as string | undefined;
        if (status === "in-progress") {
          const callObj = message?.call as Record<string, unknown> | undefined;
          const callerPhone = (callObj?.customer as Record<string, unknown> | undefined)?.number as string | undefined ?? "";

          // Guard: skip outbound FieldMgmt/LeadAlert calls placed by the system.
          // These use a dedicated Vapi phone number ID and have customer.number = the
          // CS office line. Without this guard they fire spurious "call received" SMSes
          // even though no call is stored in the calls area.
          // ROLLBACK: old VAPI-bought number: f2f1c044-c70a-4d73-a755-051f8a2a96e4
          const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473"; // Twilio-backed
          const BUSINESS_PHONE = "+12028885362";
          const callPhoneNumberId = callObj?.phoneNumberId as string | undefined;
          const isOutboundAlertCall = callPhoneNumberId === VAPI_OUTBOUND_PHONE_NUMBER_ID;
          const isBusinessNumberCaller = callerPhone === BUSINESS_PHONE;

          if (isOutboundAlertCall || isBusinessNumberCaller) {
            console.log(`[Vapi] status-update in-progress — skipping owner SMS (outbound/internal call, phoneNumberId=${callPhoneNumberId}, caller=${callerPhone})`);
            return res.json({ received: true });
          }

          // Deduplicate: only fire once per vapiCallId
          const vapiCallIdForNotify = callObj?.id as string | undefined;
          if (vapiCallIdForNotify) {
            if (notifiedCallIds.has(vapiCallIdForNotify)) {
              console.log(`[Vapi] status-update in-progress — already notified for callId=${vapiCallIdForNotify}, skipping duplicate`);
              return res.json({ received: true });
            }
            notifiedCallIds.add(vapiCallIdForNotify);
            notifiedCallTimestamps.set(vapiCallIdForNotify, Date.now());
            pruneNotifiedCalls();
          }

          const displayPhone = callerPhone || "unknown number";
          notifyOwner({
            title: `📞 Incoming call from ${displayPhone}`,
            content: `Madison is now speaking with a caller at ${displayPhone}.`,
          }).catch(() => {});
          // Owner SMS notification removed — was firing on every inbound call
        }
        return res.json({ received: true });
      }

      // ── Other message types (hang, speech-update, etc.) ──────────────────────
      return res.json({ received: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Vapi] Webhook error:", msg);
      return res.status(500).json({ error: msg });
    }
  });
}
