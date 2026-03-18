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
        return res.json({ received: true });
      }

      // ── Other message types (status-update, hang, speech-update, etc.) ─────
      return res.json({ received: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Vapi] Webhook error:", msg);
      return res.status(500).json({ error: msg });
    }
  });
}
