/**
 * hiringRouter.ts — Hiring pipeline backend procedures.
 * Extracted to a separate file to keep TypeScript inference tractable.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { conversationSessions } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { publicProcedure, agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sendSms } from "./openphone";

export const hiringRouter = router({
    /**
     * Public — submit a job application from /apply
     */
    submitApplication: publicProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().optional(),
        phone: z.string().min(7),
        streetAddress: z.string().optional(),
        apt: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        hasCleaning: z.boolean().nullable(),
        hasBankAccount: z.boolean().nullable(),
        isAuthorized: z.boolean().nullable(),
        consentBackground: z.boolean().nullable(),
        experience: z.string().optional(),
        specialties: z.array(z.string()),
        videoUrl: z.string().url().optional(),
        bioPhotoUrl: z.string().url().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        const [result] = await db.insert(candidates).values({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email || null,
          phone: input.phone,
          streetAddress: input.streetAddress || null,
          apt: input.apt || null,
          city: input.city || null,
          state: input.state || null,
          zip: input.zip || null,
          hasCleaning: input.hasCleaning === null ? null : input.hasCleaning ? 1 : 0,
          hasBankAccount: input.hasBankAccount === null ? null : input.hasBankAccount ? 1 : 0,
          isAuthorized: input.isAuthorized === null ? null : input.isAuthorized ? 1 : 0,
          consentBackground: input.consentBackground === null ? null : input.consentBackground ? 1 : 0,
          experience: input.experience || null,
          specialties: input.specialties.length > 0 ? JSON.stringify(input.specialties) : null,
          videoUrl: input.videoUrl || null,
          bioPhotoUrl: input.bioPhotoUrl || null,
          stage: "Application Submitted",
        });
        const candidateId = (result as any).insertId;

        // ── Generate status page token and save it ────────────────────────────
        const { randomBytes } = await import("crypto");
        const statusToken = randomBytes(24).toString("base64url");
        await db.update(candidates).set({ statusToken }).where(eq(candidates.id, candidateId));
        const statusLink = `https://quote.maidinblack.com/hiring-status/${statusToken}`;

        // ── AI scoring (non-blocking — runs after response is sent) ──────────
        setImmediate(async () => {
          try {
            const yesNo = (v: boolean | null) => v === null ? "Not answered" : v ? "Yes" : "No";
            const prompt = [
              `Evaluate this cleaning job applicant and return a JSON object with two fields:`,
              `- "score": integer 0-100 representing overall hiring fit`,
              `- "summary": 2-3 sentence plain-text summary of their strengths and any concerns`,
              ``,
              `Applicant: ${input.firstName} ${input.lastName}`,
              `Location: ${[input.city, input.state].filter(Boolean).join(", ") || "Not provided"}`,
              `Specialties: ${input.specialties.length ? input.specialties.join(", ") : "None selected"}`,
              `Has cleaning experience: ${yesNo(input.hasCleaning)}`,
              `Has bank account: ${yesNo(input.hasBankAccount)}`,
              `Authorized to work in US: ${yesNo(input.isAuthorized)}`,
              `Consents to background check: ${yesNo(input.consentBackground)}`,
              `Experience / bio: ${input.experience || "Not provided"}`,
              `Submitted video interview: ${input.videoUrl ? "Yes" : "No"}`,
              ``,
              `Scoring guidelines:`,
              `- Start at 50. Add points for: cleaning experience (+15), bank account (+10), work authorization (+15), background check consent (+10), detailed experience bio (+10), video submitted (+5), relevant specialties (+5).`,
              `- Subtract points for: no cleaning experience (-10), no work authorization (-20), no background check consent (-10), no bank account (-5).`,
              `- Cap at 100, floor at 0.`,
            ].join("\n");

            const llmResp = await invokeLLM({
              messages: [
                { role: "system", content: "You are a hiring assistant for a professional cleaning company. Always respond with valid JSON only, no markdown." },
                { role: "user", content: prompt },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "applicant_evaluation",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      score: { type: "integer", description: "0-100 hiring fit score" },
                      summary: { type: "string", description: "2-3 sentence plain-text summary" },
                    },
                    required: ["score", "summary"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = llmResp?.choices?.[0]?.message?.content;
            if (content && typeof content === "string") {
              const parsed = JSON.parse(content) as { score: number; summary: string };
              const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
              await db.update(candidates)
                .set({ aiScore: score, aiSummary: parsed.summary })
                .where(eq(candidates.id, candidateId));
            }
          } catch (err: any) {
            console.error("[AI Scoring] Failed for candidate", candidateId, err.message);
          }
        });

        // ── Interview link SMS (non-blocking) ──────────────────────────────
        setImmediate(async () => {
          try {
            const { conversationSessions } = await import("../drizzle/schema");
            const rawPhone = input.phone.replace(/[^\d]/g, "");
            const e164Phone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
            const firstName = input.firstName || "there";
            const interviewLink = `https://quote.maidinblack.com/interview/${candidateId}`;
            const smsText = `Hey ${firstName} — got your application 👋\n\nNext step is a quick 5-min interview:\n${interviewLink}`;

            // Create session BEFORE sending SMS so replies are routable
            const [sessionInsert] = await db.insert(conversationSessions).values({
              leadPhone: e164Phone,
              leadName: `${input.firstName} ${input.lastName}`.trim(),
              stage: "INTERVIEW_LINK_SENT" as any,
              leadSource: "hiring_interview",
              aiMode: 1,
              messageHistory: JSON.stringify([{ role: "assistant", content: smsText, ts: Date.now() }]),
            });
            const sessionId = (sessionInsert as any).insertId as number;

            const smsResult = await sendSms({ to: e164Phone, content: smsText });
            if (!smsResult.success) {
              console.error(`[Hiring SMS] Failed to send interview link to ${e164Phone}:`, smsResult.error);
            } else {
              console.log(`[Hiring SMS] Interview link sent to ${e164Phone}, candidate ${candidateId}, session ${sessionId}`);
            }

            // Send status page link as second SMS
            const statusSmsText = `Hey ${firstName} — you can track your application progress anytime here:\n${statusLink}`;
            await sendSms({ to: e164Phone, content: statusSmsText });
            console.log(`[Hiring SMS] Status page link sent to ${e164Phone}, candidate ${candidateId}`);

            // Schedule 2-hour nudge
            const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
            setTimeout(async () => {
              try {
                // Only send if candidate hasn't completed interview
                const { candidates: cTable } = await import("../drizzle/schema");
                const [candidate] = await db.select({ stage: cTable.stage }).from(cTable).where(eq(cTable.id, candidateId)).limit(1);
                if (!candidate || candidate.stage === "AI Interview") return;
                const nudge1 = `Hey ${firstName} — Jade from Maids in Black here! Your interview link is still waiting 👇\n${interviewLink}\nTakes 5 min and helps us move you forward faster.`;
                await sendSms({ to: e164Phone, content: nudge1 });
                await db.update(conversationSessions)
                  .set({ stage: "INTERVIEW_NUDGE_1" as any, messageHistory: JSON.stringify([{ role: "assistant", content: nudge1, ts: Date.now() }]) })
                  .where(eq(conversationSessions.id, sessionId));
                console.log(`[Hiring SMS] 2-hour nudge sent to ${e164Phone}, candidate ${candidateId}`);
              } catch (err: any) {
                console.error(`[Hiring SMS] 2-hour nudge failed for candidate ${candidateId}:`, err.message);
              }
            }, TWO_HOURS_MS);

            // Schedule next-morning nudge (18 hours after submission)
            const NEXT_MORNING_MS = 18 * 60 * 60 * 1000;
            setTimeout(async () => {
              try {
                const { candidates: cTable } = await import("../drizzle/schema");
                const [candidate] = await db.select({ stage: cTable.stage }).from(cTable).where(eq(cTable.id, candidateId)).limit(1);
                if (!candidate || candidate.stage === "AI Interview") return;
                const nudge2 = `Good morning ${firstName} — Jade from Maids in Black here 👋 We're still reviewing applications today — your interview spot is open:\n${interviewLink}\nThis is the last reminder — complete it to stay in the running!`;
                await sendSms({ to: e164Phone, content: nudge2 });
                await db.update(conversationSessions)
                  .set({ stage: "INTERVIEW_NUDGE_2" as any, messageHistory: JSON.stringify([{ role: "assistant", content: nudge2, ts: Date.now() }]) })
                  .where(eq(conversationSessions.id, sessionId));
                console.log(`[Hiring SMS] Next-morning nudge sent to ${e164Phone}, candidate ${candidateId}`);
              } catch (err: any) {
                console.error(`[Hiring SMS] Next-morning nudge failed for candidate ${candidateId}:`, err.message);
              }
            }, NEXT_MORNING_MS);

          } catch (err: any) {
            console.error(`[Hiring SMS] Failed to send interview link for candidate ${candidateId}:`, err.message);
          }
        });

        // ── Post new_application card to Command Chat (non-blocking) ──────────
        setImmediate(async () => {
          try {
            const { opsChatMessages } = await import("../drizzle/schema");
            const applicantName = `${input.firstName} ${input.lastName}`.trim();
            const rawPhone = input.phone.replace(/[^\d]/g, "");
            const e164Phone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
            const cardMeta = JSON.stringify({
              applicantName,
              applicantPhone: e164Phone,
              position: "House Cleaner",
              photoUrl: input.bioPhotoUrl ?? null,
              candidateId,
            });
            await db.insert(opsChatMessages).values({
              authorName: "System",
              authorRole: "system",
              channel: "command",  // CommandChat listens to the "command" channel
              body: `New application from ${applicantName}`,
              quickAction: "new_application",
              metadata: cardMeta,
            });
            // Broadcast so the card appears instantly without a page refresh
            const { broadcastOpsUpdate } = await import("./sseBroadcast");
            broadcastOpsUpdate("new_message");
          } catch (err: any) {
            console.error("[Hiring Card] Failed to post to Command Chat:", err.message);
          }
        });

        return { success: true, id: candidateId };
      }),

    /**
     * Protected — list candidates for the hiring pipeline board
     */
    getCandidates: agentProcedure
      .input(z.object({
        stage: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const { candidates } = await import("../drizzle/schema");
        const rows = await db
          .select()
          .from(candidates)
          .where(and(eq(candidates.archived, 0), ne(candidates.stage, "Rejected")))
          .orderBy(desc(candidates.createdAt));
        return rows.map(r => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email ?? null,
          phone: r.phone,
          streetAddress: r.streetAddress ?? null,
          apt: r.apt ?? null,
          city: r.city ?? null,
          state: r.state ?? null,
          zip: r.zip ?? null,
          stage: r.stage,
          experience: r.experience ?? null,
          bioPhotoUrl: r.bioPhotoUrl ?? null,
          videoUrl: r.videoUrl ?? null,
          interviewVideoUrl: r.interviewVideoUrl ?? null,
          specialties: r.specialties ? JSON.parse(r.specialties) as string[] : [],
          hasCleaning: r.hasCleaning === 1,
          hasBankAccount: r.hasBankAccount === 1,
          isAuthorized: r.isAuthorized === 1,
          consentBackground: r.consentBackground === 1,
          aiScore: r.aiScore ?? null,
          aiSummary: r.aiSummary ?? null,
          interviewCallId: r.interviewCallId ?? null,
          createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
        }));
      }),

    /**
     * Protected — find the most recent conversation_sessions row for a candidate's phone.
     * Returns the session ID so the UI can call leads.sendMessage with it.
     * Uses the same phone number (PN0wVLcpCq) as the leads drawer.
     */
    getSessionByPhone: agentProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { sessionId: null, messages: [] };
        const rawPhone = input.phone.replace(/[^\d]/g, "");
        const e164Phone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
        const sessions = await db
          .select({ id: conversationSessions.id, messageHistory: conversationSessions.messageHistory })
          .from(conversationSessions)
          .where(eq(conversationSessions.leadPhone, e164Phone))
          .orderBy(desc(conversationSessions.createdAt))
          .limit(1);
        const session = sessions[0];
        if (!session) return { sessionId: null, messages: [] };
        let messages: { role: string; content: string; ts: number; senderName?: string }[] = [];
        try { messages = JSON.parse(session.messageHistory ?? "[]"); } catch { messages = []; }
        messages.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
        return { sessionId: session.id, messages };
      }),
    /**
     * Protected — re-run AI scoring for a specific candidate
     */
    rescoreCandidate: agentProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        const rows = await db.select().from(candidates).where(eq(candidates.id, input.id)).limit(1);
        if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
        const r = rows[0];
        const yesNo = (v: number | null) => v === null ? "Not answered" : v === 1 ? "Yes" : "No";
        const specialties = r.specialties ? JSON.parse(r.specialties) as string[] : [];
        const prompt = [
          `Evaluate this cleaning job applicant and return a JSON object with two fields:`,
          `- "score": integer 0-100 representing overall hiring fit`,
          `- "summary": 2-3 sentence plain-text summary of their strengths and any concerns`,
          ``,
          `Applicant: ${r.firstName} ${r.lastName}`,
          `Location: ${[r.city, r.state].filter(Boolean).join(", ") || "Not provided"}`,
          `Specialties: ${specialties.length ? specialties.join(", ") : "None selected"}`,
          `Has cleaning experience: ${yesNo(r.hasCleaning)}`,
          `Has bank account: ${yesNo(r.hasBankAccount)}`,
          `Authorized to work in US: ${yesNo(r.isAuthorized)}`,
          `Consents to background check: ${yesNo(r.consentBackground)}`,
          `Experience / bio: ${r.experience || "Not provided"}`,
          `Submitted video interview: ${r.videoUrl ? "Yes" : "No"}`,
          ``,
          `Scoring guidelines:`,
          `- Start at 50. Add points for: cleaning experience (+15), bank account (+10), work authorization (+15), background check consent (+10), detailed experience bio (+10), video submitted (+5), relevant specialties (+5).`,
          `- Subtract points for: no cleaning experience (-10), no work authorization (-20), no background check consent (-10), no bank account (-5).`,
          `- Cap at 100, floor at 0.`,
        ].join("\n");
        const llmResp = await invokeLLM({
          messages: [
            { role: "system", content: "You are a hiring assistant for a professional cleaning company. Always respond with valid JSON only, no markdown." },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "applicant_evaluation",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  score: { type: "integer", description: "0-100 hiring fit score" },
                  summary: { type: "string", description: "2-3 sentence plain-text summary" },
                },
                required: ["score", "summary"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = llmResp?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "LLM returned no content" });
        const parsed = JSON.parse(content) as { score: number; summary: string };
        const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
        await db.update(candidates)
          .set({ aiScore: score, aiSummary: parsed.summary })
          .where(eq(candidates.id, input.id));
        return { success: true, score, summary: parsed.summary };
      }),

    /**
     * Protected — advance a candidate to a new stage
     */
    updateStage: agentProcedure
      .input(z.object({
        id: z.number(),
        stage: z.string(),
        sendSmsNotification: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");

        // Fetch candidate phone + name before updating
        const rows = await db
          .select({ firstName: candidates.firstName, phone: candidates.phone, statusToken: candidates.statusToken })
          .from(candidates)
          .where(eq(candidates.id, input.id))
          .limit(1);
        const candidate = rows[0];

        await db.update(candidates).set({ stage: input.stage }).where(eq(candidates.id, input.id));

        // Optionally send stage-change SMS
        if (input.sendSmsNotification && candidate?.phone) {
          const rawPhone = candidate.phone.replace(/[^\d]/g, "");
          const e164Phone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
          const firstName = candidate.firstName || "there";

          const stageMessages: Record<string, string> = {
            // Display-name keys (what the pipeline sends)
            "Real Interview": `Hey ${firstName} — great news from Maids in Black! 🎉 You've passed the AI interview and we'd love to schedule a real video interview with you. We'll be in touch shortly to confirm the time. — Jade`,
            "Background Check": `Hey ${firstName} — Jade from Maids in Black here! You're moving forward to the background check stage. We'll send you a link shortly to complete it. Hang tight! 🙌`,
            "Paid Test Clean": `Hey ${firstName} — exciting news! You've been selected for a paid test clean with Maids in Black. We'll reach out with scheduling details soon. — Jade 🧹`,
            "Onboarding": `Hey ${firstName} — welcome to the Maids in Black family! 🎊 You've been hired! Our team will reach out with onboarding details and your first assignment. So excited to have you! — Jade`,
            "Rejected": `Hey ${firstName} — Jade from Maids in Black here. Thank you so much for taking the time to apply and complete the interview. After careful review, we've decided to move forward with other candidates at this time. We truly appreciate your interest and wish you all the best in your job search! 💙`,
          };

          const smsText = stageMessages[input.stage];
          if (smsText) {
            setImmediate(async () => {
              try {
                await sendSms({ to: e164Phone, content: smsText });
                console.log(`[Hiring SMS] Stage-change SMS sent to ${e164Phone} for stage ${input.stage}`);
              } catch (err: any) {
                console.error(`[Hiring SMS] Stage-change SMS failed for candidate ${input.id}:`, err.message);
              }
            });
          }
        }

        return { success: true };
      }),

    /**
     * Public — returns VAPI public key + interview assistant config for a candidate.
     * The interview assistant is created on-the-fly with the candidate's name.
     */
    getInterviewConfig: publicProcedure
      .input(z.object({ candidateId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        const rows = await db.select().from(candidates).where(eq(candidates.id, input.candidateId)).limit(1);
        if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found" });
        const c = rows[0];
        const { ENV } = await import("./_core/env");
        return {
          vapiPublicKey: ENV.vapiPublicKey,
          // Pre-created VAPI assistant — uses {{candidateName}} variable substitution
          hiringAssistantId: "de069cb2-ca13-47d2-9464-c4e58b5bd686",
          candidateName: `${c.firstName} ${c.lastName}`,
          candidateId: c.id,
          alreadyInterviewed: !!c.interviewCallId,
        };
      }),

    /**
     * Public — saves the VAPI call ID after interview ends so we can fetch transcript later.
     */
    saveInterviewCallId: publicProcedure
      .input(z.object({
        candidateId: z.number(),
        callId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        await db.update(candidates)
          .set({ interviewCallId: input.callId, stage: "AI Interview" })
          .where(eq(candidates.id, input.candidateId));
        return { success: true };
      }),

    /**
     * Public — saves the recorded camera video URL after interview ends.
     */
    saveInterviewVideo: publicProcedure
      .input(z.object({
        candidateId: z.number(),
        interviewVideoUrl: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        await db.update(candidates)
          .set({ interviewVideoUrl: input.interviewVideoUrl })
          .where(eq(candidates.id, input.candidateId));
         return { success: true };
      }),
    /**
     * Public — fetches the VAPI call recording URL for a candidate's AI interview.
     * Queries the VAPI API using the stored interviewCallId.
     */
    deleteCandidate: agentProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const { candidates } = await import("../drizzle/schema");
        await db.delete(candidates).where(eq(candidates.id, input.id));
        return { success: true };
      }),

    archiveCandidate: agentProcedure
      .input(z.object({ id: z.number(), archived: z.boolean() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const { candidates } = await import("../drizzle/schema");
        await db.update(candidates)
          .set({ archived: input.archived ? 1 : 0 })
          .where(eq(candidates.id, input.id));
        return { success: true };
      }),

    /**
     * Send a message to a candidate — finds or creates a conversation session.
     * Uses the CS phone number (PN0wVLcpCq), same as the lead drawer.
     */
    sendCandidateMessage: agentProcedure
      .input(z.object({
        phone: z.string(),
        candidateName: z.string(),
        message: z.string().min(1).max(1600),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const rawPhone = input.phone.replace(/[^\d]/g, "");
        const e164Phone = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
        // Find existing session or create one
        const existing = await db
          .select({ id: conversationSessions.id, messageHistory: conversationSessions.messageHistory })
          .from(conversationSessions)
          .where(eq(conversationSessions.leadPhone, e164Phone))
          .orderBy(desc(conversationSessions.createdAt))
          .limit(1);
        let sessionId: number;
        let history: Array<{ role: string; content: string; ts?: number; senderName?: string }> = [];
        if (existing[0]) {
          sessionId = existing[0].id;
          try { history = JSON.parse(existing[0].messageHistory ?? "[]"); } catch { history = []; }
        } else {
          // No session yet — create one (aiMode=0 so AI doesn't auto-reply)
          const [ins] = await db.insert(conversationSessions).values({
            leadPhone: e164Phone,
            leadName: input.candidateName,
            messageHistory: "[]",
            leadSource: "hiring" as any,
            aiMode: 0,
          });
          sessionId = (ins as any).insertId as number;
        }
        // Append outbound message
        const now = Date.now();
        const agentName = (ctx as any).agent?.agentName ?? "Agent";
        history.push({ role: "assistant", content: input.message, ts: now, senderName: agentName });
        await db
          .update(conversationSessions)
          .set({ messageHistory: JSON.stringify(history) })
          .where(eq(conversationSessions.id, sessionId));
        // Send via OpenPhone CS line
        const smsResult = await sendSms({ to: e164Phone, content: input.message, fromNumberId: "PN0wVLcpCq" });
        if (!smsResult.success) {
          console.error(`[sendCandidateMessage] SMS failed to ${e164Phone}:`, smsResult.error);
        }
        return { success: true, sessionId, smsSent: smsResult.success };
      }),

    getInterviewRecordingUrl: publicProcedure
      .input(z.object({ candidateId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { recordingUrl: null, isStereo: false };
        const { candidates } = await import("../drizzle/schema");
        const rows = await db
          .select({ interviewCallId: candidates.interviewCallId })
          .from(candidates)
          .where(eq(candidates.id, input.candidateId))
          .limit(1);
        const callId = rows[0]?.interviewCallId;
        if (!callId) return { recordingUrl: null, isStereo: false };
        try {
          const envModule = await import("./_core/env");
          const vapiKey = envModule.ENV.vapiPrivateKey;
          const resp = await fetch(`https://api.vapi.ai/call/${callId}`, {
            headers: { Authorization: `Bearer ${vapiKey}` },
          });
          if (!resp.ok) return { recordingUrl: null, isStereo: false };
          const data = await resp.json() as {
            artifact?: {
              recordingUrl?: string;
              stereoRecordingUrl?: string;
              recording?: {
                stereoUrl?: string;
                mono?: { combinedUrl?: string; assistantUrl?: string; customerUrl?: string };
              };
            };
          };
          const isSentinel = (u?: string | null) => !u || u === "rawRecordingUploadDisabled";
          // Priority: assistantUrl (AI-only, no candidate voice doubling) → stereo → mono combined
          const assistantUrl = data?.artifact?.recording?.mono?.assistantUrl ?? null;
          const stereoUrl = data?.artifact?.stereoRecordingUrl ?? data?.artifact?.recording?.stereoUrl ?? null;
          const monoUrl = data?.artifact?.recordingUrl ?? null;
          const recordingUrl = !isSentinel(assistantUrl) ? assistantUrl
            : !isSentinel(stereoUrl) ? stereoUrl
            : !isSentinel(monoUrl) ? monoUrl
            : null;
          const isStereo = isSentinel(assistantUrl) && !isSentinel(stereoUrl);
          return { recordingUrl, isStereo };
        } catch {
          return { recordingUrl: null, isStereo: false };
        }
      }),

    /**
     * Public — get applicant status page data from a status token
     */
    getApplicantStatus: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { candidates } = await import("../drizzle/schema");
        const rows = await db
          .select({
            id: candidates.id,
            firstName: candidates.firstName,
            lastName: candidates.lastName,
            city: candidates.city,
            state: candidates.state,
            stage: candidates.stage,
            createdAt: candidates.createdAt,
            interviewCallId: candidates.interviewCallId,
          })
          .from(candidates)
          .where(eq(candidates.statusToken, input.token))
          .limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired link" });
        const c = rows[0];
        const interviewLink = `https://quote.maidinblack.com/interview/${c.id}`;
        return {
          firstName: c.firstName,
          lastName: c.lastName,
          city: c.city ?? null,
          state: c.state ?? null,
          stage: c.stage,
          appliedAt: c.createdAt,
          interviewLink,
          hasCompletedInterview: !!c.interviewCallId,
        };
      }),
});
