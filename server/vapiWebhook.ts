/**
 * Vapi Webhook Handler
 *
 * Handles two types of Vapi server messages:
 *   1. tool-calls  — mid-call function calls (getQuote, createLead, sendSms)
 *   2. end-of-call-report — post-call summary, transcript, structured data
 *
 * Registered at POST /api/webhooks/vapi
 */

import type { Express, Request, Response } from "express";
import {
  handleGetQuote,
  handleCreateLead,
  handleSendSms,
  processEndOfCallReport,
  type VapiEndOfCallReport,
} from "./vapiService";

interface VapiToolCallMessage {
  message: {
    type: "tool-calls";
    toolCallList: Array<{
      id: string;
      function: {
        name: string;
        arguments: string; // JSON string
      };
    }>;
    call?: {
      customer?: { number?: string };
    };
  };
}

export function registerVapiWebhookRoute(app: Express): void {
  app.post("/api/webhooks/vapi", async (req: Request, res: Response) => {
    try {
      const body = req.body as { message?: { type?: string } };
      const msgType = body?.message?.type;

      if (!msgType) {
        return res.status(400).json({ error: "Missing message.type" });
      }

      // ── Tool calls (mid-call) ──────────────────────────────────────────────
      if (msgType === "tool-calls") {
        const payload = body as VapiToolCallMessage;
        const toolCallList = payload.message.toolCallList ?? [];

        const results: Array<{ toolCallId: string; result: string }> = [];

        for (const toolCall of toolCallList) {
          const { id, function: fn } = toolCall;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(fn.arguments);
          } catch {
            args = {};
          }

          let result: unknown;

          switch (fn.name) {
            case "getQuote": {
              result = handleGetQuote(args as {
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
              });
              break;
            }
            case "createLead": {
              // Use caller's phone from the call object as fallback if LLM doesn't pass it
              const callerPhone = payload.message.call?.customer?.number ?? "";
              const createArgs = args as {
                name: string;
                phone?: string;
                address?: string;
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
                quotedPrice: number;
                preferredDate?: string;
              };
              if (!createArgs.phone && callerPhone) {
                createArgs.phone = callerPhone;
              }
              result = await handleCreateLead(createArgs as {
                name: string;
                phone: string;
                address?: string;
                bedrooms: string;
                bathrooms: string;
                serviceType: string;
                quotedPrice: number;
                preferredDate?: string;
              });
              break;
            }
            case "sendSms": {
              result = await handleSendSms(args as { to: string; message: string });
              break;
            }
            default: {
              result = { error: `Unknown tool: ${fn.name}` };
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
        // Process asynchronously — don't block the 200 response
        processEndOfCallReport(body as VapiEndOfCallReport).catch((err) => {
          console.error("[Vapi] processEndOfCallReport error:", err);
        });
        return res.json({ received: true });
      }

      // ── Other message types (status-update, hang, speech-update, etc.) ─────
      // Acknowledge but take no action
      return res.json({ received: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Vapi] Webhook error:", msg);
      return res.status(500).json({ error: msg });
    }
  });
}
