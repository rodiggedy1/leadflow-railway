/**
 * csElevateStream.ts — Streaming SSE endpoint for the CS Inbox world-class elevate rewrite.
 *
 * POST /api/cs-elevate-stream
 *   Body: { draft, clientName?, messageHistory?, jobContext? }
 *   Auth: agent session cookie OR Manus OAuth owner session (same as opsStream)
 *
 * Streams the Forge API (Gemini 2.5 Flash) response token-by-token as SSE events:
 *   data: {"token":"Hello"}
 *   data: {"token":" Kate"}
 *   ...
 *   data: [DONE]
 *
 * The client reads the stream and appends tokens to the suggestion UI in real-time.
 * On error, sends: data: {"error":"..."}
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { getAgentFromRequest } from "./_core/agentAuth";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import { COOKIE_NAME } from "@shared/const";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

async function isAuthorizedOpsUser(req: Request): Promise<boolean> {
  // 1. Agent session — pure local JWT verify
  const agent = await getAgentFromRequest(req);
  if (agent) return true;

  // 2. Manus OAuth owner session — local JWT verify only
  try {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const sessionCookie = cookies[COOKIE_NAME];
    const session = await sdk.verifySession(sessionCookie);
    return Boolean(session);
  } catch {
    return false;
  }
}

function buildElevatePrompt(params: {
  draft: string;
  clientName?: string;
  messageHistory?: string;
  jobContext?: string;
}): { systemPrompt: string; userMessage: string; conversationSnippet: string } {
  const firstName = params.clientName?.split(" ")[0] ?? "the client";
  const messages: Array<{ role: string; content: string }> = (() => {
    try { return JSON.parse(params.messageHistory ?? "[]"); } catch { return []; }
  })();
  const conversationSnippet = messages.slice(-6)
    .map((m) => `${m.role === "user" ? "Client" : "Agent"}: ${m.content}`)
    .join("\n");
  const jobContextSection = params.jobContext
    ? `\n=== CLIENT'S UPCOMING JOB ===\n${params.jobContext}\nUse these details naturally in the rewrite when relevant — reference the specific service, date, or team name to show you know exactly who this client is and what's coming up for them. Never invent details not listed here.\n`
    : "";

  const systemPrompt = `You are a world-class customer service coach for Maids in Black, a premium residential cleaning service in Washington DC.
Your job: take the agent's SMS draft and rewrite it using the Zappos WOW service philosophy — proactive ownership, genuine warmth, and a concrete next step that makes the client feel like the only person in the world.${jobContextSection}

The Zappos model in practice:
- Don't just confirm — OWN it. "We'll get you scheduled" → "I'm on it — let me find you the perfect slot."
- Be specific, not vague. "Whenever you're ready" is passive. Give them something to act on.
- Show you actually care about THIS person, not just the task. One specific, genuine detail beats three generic warm phrases.
- Proactive > reactive. If there's a natural next step, take it for them instead of putting it back on them.

RULES:
1. Return ONLY the rewritten message — no explanation, no preamble, no labels.
2. Keep roughly the same length as the draft — do NOT pad it out.
3. Keep the same intent and facts — do not invent new information or prices.
4. Use the client's first name (${firstName}) once, naturally.
5. Replace vague phrases ("whenever you're ready", "let me know", "feel free to reach out") with specific, action-oriented language.
6. Sound like a real person who genuinely wants to help, not a script. Direct, warm, confident.
7. NEVER use hollow filler: no "Absolutely!", "Of course!", "Happy to help!", "You're in great hands!", "Wonderful!", "Just checking in!", "Hope everything's going well!".
8. NEVER invent prices — keep any [placeholder] from the draft as-is.
9. If the draft is already excellent, return it unchanged.

EXAMPLES of the transformation:
Before: "Hey hope everything is going well we'll be able to get you scheduled"
After: "Hey ${firstName}, we have openings this week — want me to lock one in for you?"

Before: "Just wanted to follow up and see if you had any questions"
After: "${firstName}, I wanted to make sure you have everything you need — what's the one thing I can clear up for you right now?"

Before: "Let me know if you'd like to reschedule"
After: "${firstName}, I can move your appointment — does [day] or [day] work better for you?"

=== MAIDS IN BLACK KNOWLEDGE BASE ===
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}`;

  const userMessage = `Agent's draft: "${params.draft}"\n\nRewrite to world-class SMS level. Return only the rewritten message.`;

  return { systemPrompt, userMessage, conversationSnippet };
}

export function registerCsElevateStreamRoute(app: Express) {
  app.post("/api/cs-elevate-stream", async (req: Request, res: Response) => {
    // Auth check
    const authorized = await isAuthorizedOpsUser(req);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { draft, clientName, messageHistory, jobContext } = req.body ?? {};
    if (!draft || typeof draft !== "string" || draft.trim().length < 1) {
      res.status(400).json({ error: "draft is required" });
      return;
    }

    // SSE headers — must be set before any data is written
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const { systemPrompt, userMessage, conversationSnippet } = buildElevatePrompt({
      draft: draft.trim(),
      clientName,
      messageHistory,
      jobContext,
    });

    const forgeApiUrl = ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
      ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
      : "https://forge.manus.im/v1/chat/completions";

    const payload = {
      model: "gemini-2.5-flash",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...(conversationSnippet ? [{ role: "user", content: `Recent conversation:\n${conversationSnippet}` }] : []),
        { role: "user", content: userMessage },
      ],
      // No thinking budget for streaming — faster first token
      max_tokens: 1024,
    };

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(forgeApiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ENV.forgeApiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
      return;
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => "unknown error");
      res.write(`data: ${JSON.stringify({ error: `LLM error ${upstreamRes.status}: ${errText}` })}\n\n`);
      res.end();
      return;
    }

    if (!upstreamRes.body) {
      res.write(`data: ${JSON.stringify({ error: "No response body from LLM" })}\n\n`);
      res.end();
      return;
    }

    // Stream SSE chunks from the Forge API to the client
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Clean up if the client disconnects
    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ":") continue; // keepalive or empty
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue; // skip malformed chunks
          }

          // Extract the delta token from the OpenAI-compatible SSE format
          const choices = chunk.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined;
          if (!choices?.length) continue;

          const delta = choices[0]?.delta?.content;
          if (delta) {
            // Forward the token to the client
            res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
          }

          // If the model signals done, forward the DONE sentinel
          if (choices[0]?.finish_reason === "stop") {
            res.write("data: [DONE]\n\n");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stream error";
      // Only write error if headers haven't been fully sent yet (best effort)
      try {
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      } catch { /* ignore */ }
    } finally {
      res.end();
    }
  });
}
