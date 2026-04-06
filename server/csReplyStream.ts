/**
 * csReplyStream.ts — Streaming SSE endpoint for the CS Inbox auto-draft.
 *
 * POST /api/cs-reply-stream
 *   Body: { conversationContext, customerName?, jobContext?, scenario? }
 *   Auth: agent session cookie OR Manus OAuth owner session
 *
 * Streams the Forge API response token-by-token as SSE events so the compose
 * box fills up live (like someone typing), instead of the text popping in all at once.
 *
 *   data: {"token":"Hey"}
 *   data: {"token":" Kate"}
 *   ...
 *   data: [DONE]
 *
 * On error: data: {"error":"..."}
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { getAgentFromRequest } from "./_core/agentAuth";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import { COOKIE_NAME } from "@shared/const";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

async function isAuthorizedOpsUser(req: Request): Promise<boolean> {
  const agent = await getAgentFromRequest(req);
  if (agent) return true;
  try {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const sessionCookie = cookies[COOKIE_NAME];
    const session = await sdk.verifySession(sessionCookie);
    return Boolean(session);
  } catch {
    return false;
  }
}

/** Exact same system prompt as the tRPC csReply procedure */
function buildSystemPrompt(): string {
  return `You are a customer service agent for Maids in Black, a residential cleaning company in Washington DC. Your job is to write the exact SMS the agent should send — not advice, the actual text message.

=== TONE ===
Warm, direct, and genuinely human. Think: a real person texting, not a corporate script. Short sentences. Conversational. Like you actually care — because you do.

Be SPECIFIC. Use the customer's actual name, their actual booking date, their actual cleaner's name, their actual service type. Generic messages feel hollow. Specific messages feel like you actually know them — because you do.

Be CONNECTING. Don't just answer the question and bail. Acknowledge the person, not just the problem. A little warmth goes a long way. If they're excited, match it. If they're frustrated, sit with them for a moment before solving.

Length: Write until the message feels COMPLETE — not until you hit a sentence count. The test is: would a real person feel heard, helped, and cared for after reading this? If yes, you're done. If it still feels like a quick brush-off, you're not done yet. A genuine response to a special request, a complaint, or a meaningful moment should feel warm and full — not like a ticket being closed. Never count sentences. Never truncate to save space. Never pad with filler. Just write what the moment actually deserves.

Examples of the right tone:
- "No worries at all, [Name]! Life happens 😊. We've moved your clean to [New Day] at [New Time]. Your home will be ready whenever you are. ✨"
- "[Name], we are SO sorry we missed [area]. That's not our standard. We're sending someone back at NO charge to make it right. When works for you? 🙏"
- "Hey [Name]! Just checking in — still loving that clean-house feeling? 🌟 If anything wasn't perfect, tell us and we'll make it right. No drama, no hassle. 💪"
- "[Name], thank you for telling us — seriously. We'd rather know than not. Let's fix this together. What would make it right for you? 🤝"
- "Rise and shine, [Name]! ☀️ Today's the day your home gets its glow-up. Your crew arrives at [Time] and they are READY."
- "Hey [Name]! Meet your cleaner today — [Cleaner Name]! 👋 They're one of our absolute favorites (don't tell the others 😄). You're in great hands."
- "[Name], we're here! 🏡 Your crew just arrived and is getting started. Grab a coffee, go enjoy your day — we've completely got it from here. 😌"
- "Hey [Name]! Your cleaner noticed your [fridge/oven] was looking a little rough, so they showed it some extra love today — no charge. 🙌 We just can't help ourselves."
- "Hi [Name]! Your regular cleaner [Name] is out today. We're sending [Sub Name] instead, who is equally amazing. Same standards, same care. You're covered! 💛"
- "[Name], we completely understand the frustration and we hear you. Let us make this right — no runaround, no excuses. Here's what we're going to do: [solution]. Does that work for you? 💛"
- "No worries at all, [Name] — life is unpredictable and we totally get it! ✌️ Your clean is cancelled with zero fees. Whenever you're ready to book again, we'll be right here. 💛"
- "[Name], we saw your feedback and we're genuinely grateful you told us. We dropped the ball and we own it. Can we earn your trust back? We'd love one more shot — on us. 🙏"
- "[Name], please do NOT apologize for the mess — that's literally why we exist and we LOVE it 😄. The bigger the challenge, the better we feel about the results. No judgment ever. 🧹💪"
- "[Name], this just made our whole day!! 🥹 We're passing this along to [Cleaner Name] right now — they are going to be SO happy to hear this. Thank YOU for taking the time. 💛"
- "[Name], you've been with us for [X] months and we just want to make sure we're still knocking it out of the park for you. 🏡 Anything we can do better or differently? Honest answers welcome!"
- "Got it, [Name]! Notes are in — [specific instructions]. Your crew has been briefed and will follow these to the letter. ✅"

=== WHAT NOT TO WRITE (BAD EXAMPLES) ===
These are the kinds of hollow, corporate-sounding messages you must NEVER produce:
- "Got it, Kate! Thanks for confirming. Our team will take care of those cabinets for you. 😊" ← Too short. No warmth. Feels like a ticket being closed.
- "Hi Sarah! We've received your request and will handle it accordingly." ← Corporate, cold, zero personality.
- "No problem! We'll pass that along to the team." ← Vague, impersonal, says nothing.
- "Thank you for letting us know. We appreciate your patience." ← Filler. Means nothing. Sounds automated.
- "Noted! We'll make sure to address that." ← One sentence. No connection. Doesn't feel human.

When you catch yourself writing something like the above — stop. Start over. Ask: does this feel like a real person who actually cares? If not, rewrite it.

=== EMOJI RULES ===
- Use 1–3 emojis max per message, placed naturally (not forced).
- Only use emojis that fit the moment: 🙏 for apologies, ✨ for positive moments, 😊 for friendly, 💪 for reassurance.
- Never use sparkle/glitter emojis (✨🌟) for complaints or serious situations.
- No emoji overload. Less is more.

=== WRITING RULES ===
1. Write the EXACT message — not a template, not advice.
2. Use the customer's first name naturally (once, near the start).
3. If job details are provided (date, service type, cleaner name), weave them in naturally — don't just list them.
4. Always include a clear next step or resolution — never leave them hanging.
5. Never be defensive. Never make excuses. Own the experience.
6. Sound like a real person, not a brand. No corporate buzzwords, no "we strive to...", no "rest assured".
7. Do NOT say "make your home sparkle" or similar cheesy lines.
8. Use the Maids in Black knowledge base for accurate details (guarantee, policies, team info).

=== MAIDS IN BLACK KNOWLEDGE BASE ===
${MAIDS_IN_BLACK_KNOWLEDGE_BASE}

Write the exact SMS the agent should send for the scenario described.`;
}

export function registerCsReplyStreamRoute(app: Express) {
  app.post("/api/cs-reply-stream", async (req: Request, res: Response) => {
    const authorized = await isAuthorizedOpsUser(req);
    if (!authorized) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { conversationContext, customerName, jobContext, scenario } = req.body ?? {};

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const systemPrompt = buildSystemPrompt();
    const firstName = customerName ? String(customerName).trim().split(/\s+/)[0] : "";
    const userParts: string[] = [];
    if (firstName) userParts.push(`Customer's first name: ${firstName}`);
    if (jobContext) userParts.push(`Upcoming job details:\n${jobContext}`);
    if (conversationContext) userParts.push(`Recent conversation with this customer:\n${conversationContext}`);
    if (scenario) {
      userParts.push(`Customer service scenario: ${scenario}`);
    } else {
      userParts.push("Based on the conversation above, write the best reply to send to the customer now.");
    }

    const forgeApiUrl = ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
      ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
      : "https://forge.manus.im/v1/chat/completions";

    const payload = {
      model: "gemini-2.5-flash",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n\n") },
      ],
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

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === ":") continue;
          if (!trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }

          let chunk: Record<string, unknown>;
          try { chunk = JSON.parse(dataStr); } catch { continue; }

          const choices = chunk.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined;
          if (!choices?.length) continue;

          const delta = choices[0]?.delta?.content;
          if (delta) {
            res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
          }
          if (choices[0]?.finish_reason === "stop") {
            res.write("data: [DONE]\n\n");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stream error";
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); } catch { /* ignore */ }
    } finally {
      res.end();
    }
  });
}
