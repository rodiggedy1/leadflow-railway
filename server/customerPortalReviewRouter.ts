import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { cleanerPortalJobProgress, customerPortalAccounts, leadflowJobs, opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { getCustomerPortalSessionFromRequest } from "./_core/customerPortalAuth";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { broadcastOpsUpdate } from "./sseBroadcast";
import { extractUSDigits } from "./utils/phone";

export const THUMBTACK_REVIEW_URL = "https://www.thumbtack.com/reviews/services/382987965776199683/write-customer-review";

const REVIEW_CHIPS = [
  "On time",
  "Super thorough",
  "Friendly team",
  "Great attention to detail",
  "Spotless results",
  "Went above & beyond",
  "Easy to communicate with",
  "Would book again",
] as const;

const reviewChipsSchema = z.array(z.enum(REVIEW_CHIPS)).max(REVIEW_CHIPS.length);

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function parseDrafts(value: string | null): string[] {
  if (!value) return [];
  try {
    const drafts = JSON.parse(value) as unknown;
    return Array.isArray(drafts) && drafts.every(draft => typeof draft === "string") ? drafts : [];
  } catch {
    return [];
  }
}

async function getCustomerReviewJob(ctx: { req: Parameters<typeof getCustomerPortalSessionFromRequest>[0] }, leadflowJobId?: number) {
  const session = await getCustomerPortalSessionFromRequest(ctx.req);
  if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "CUSTOMER_PORTAL_UNAUTHENTICATED" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Customer reviews are temporarily unavailable." });
  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, session.accountId)).limit(1);
  const account = accounts[0];
  if (!account || account.customerPhone !== session.customerPhone) throw new TRPCError({ code: "UNAUTHORIZED", message: "CUSTOMER_PORTAL_UNAUTHENTICATED" });
  const phoneDigits = extractUSDigits(account.customerPhone);
  if (!phoneDigits) throw new TRPCError({ code: "UNAUTHORIZED", message: "CUSTOMER_PORTAL_UNAUTHENTICATED" });

  const jobRows = await db.select({
    id: leadflowJobs.id,
    jobDate: leadflowJobs.jobDate,
    serviceDateTime: leadflowJobs.serviceDateTime,
    customerName: leadflowJobs.customerName,
    jobAddress: leadflowJobs.jobAddress,
    serviceName: leadflowJobs.serviceName,
    bedrooms: leadflowJobs.bedrooms,
    bathrooms: leadflowJobs.bathrooms,
    frequency: leadflowJobs.frequency,
    teamName: leadflowJobs.teamName,
    customerRating: leadflowJobs.customerRating,
    reviewChipsSelected: leadflowJobs.reviewChipsSelected,
    reviewFreeText: leadflowJobs.reviewFreeText,
    reviewDrafts: leadflowJobs.reviewDrafts,
    reviewDraftPicked: leadflowJobs.reviewDraftPicked,
    reviewDraftText: leadflowJobs.reviewDraftText,
    reviewCopied: leadflowJobs.reviewCopied,
    reviewThumbtackOpenedAt: leadflowJobs.reviewThumbtackOpenedAt,
  }).from(leadflowJobs).innerJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id)).where(and(
    eq(cleanerPortalJobProgress.jobStatus, "completed"),
    ne(leadflowJobs.bookingStatus, "cancelled"),
    ne(leadflowJobs.bookingStatus, "rescheduled"),
    ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
    sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`,
    ...(leadflowJobId ? [eq(leadflowJobs.id, leadflowJobId)] : []),
  )).orderBy(desc(cleanerPortalJobProgress.updatedAt), desc(leadflowJobs.id)).limit(1);

  const job = jobRows[0];
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "No completed cleaning is available for review." });
  return { db, account, job };
}

export const customerPortalReviewRouter = router({
  getLatest: publicProcedure.query(async ({ ctx }) => {
    try {
      const { job } = await getCustomerReviewJob(ctx);
      return { job: { ...job, drafts: parseDrafts(job.reviewDrafts) } };
    } catch (error) {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return { job: null };
      throw error;
    }
  }),

  submitRating: publicProcedure.input(z.object({ leadflowJobId: z.number().int().positive(), rating: z.number().int().min(1).max(5) })).mutation(async ({ ctx, input }) => {
    const { db, job } = await getCustomerReviewJob(ctx, input.leadflowJobId);
    await db.update(leadflowJobs).set({ customerRating: input.rating }).where(eq(leadflowJobs.id, job.id));

    if (input.rating <= 3) {
      try {
        const stars = "★".repeat(input.rating) + "☆".repeat(5 - input.rating);
        const body = [
          `⚠️ **${input.rating}-star rating ${stars}**`,
          `👤 Customer: ${firstName(job.customerName)}`,
          `🧹 Team: ${job.teamName ?? "Unassigned"}`,
          `📍 Job: ${job.jobDate} — ${job.jobAddress ?? "Address unavailable"}`,
          "Follow up with this customer personally.",
        ].join("\n");
        await db.insert(opsChatMessages).values({
          cleanerJobId: null,
          channel: "command",
          authorName: "⭐ Rating Alert",
          authorRole: "system",
          body,
          mediaUrl: null,
          quickAction: "low_rating",
          metadata: JSON.stringify({ rating: input.rating, leadflowJobId: job.id, source: "customer_portal_review" }),
        });
        broadcastOpsUpdate("new_message", { channel: "command" });
      } catch (error) {
        console.error("[CustomerPortalReview] Failed to post low rating to Command Chat:", error);
      }
    }

    return { rating: input.rating };
  }),

  generateDrafts: publicProcedure.input(z.object({
    leadflowJobId: z.number().int().positive(),
    chips: reviewChipsSchema,
    freeText: z.string().trim().max(500).optional(),
  }).refine(input => input.chips.length > 0 || Boolean(input.freeText), { message: "Choose at least one detail or add a note." })).mutation(async ({ ctx, input }) => {
    const { db, job } = await getCustomerReviewJob(ctx, input.leadflowJobId);
    if (job.customerRating !== 5) throw new TRPCError({ code: "FORBIDDEN", message: "Review drafts are available after a five-star rating." });

    // Preserve the prior review-draft prompt and treatment exactly. The only
    // source adaptation is LeadFlow job data; the final review destination is
    // handled separately by recordThumbtackAction.
    const teamName = job.teamName ?? "the team";
    const bedroomStr = job.bedrooms ? `${job.bedrooms} bedroom${job.bedrooms > 1 ? "s" : ""}` : null;
    const bathroomStr = job.bathrooms ? `${job.bathrooms} bathroom${job.bathrooms > 1 ? "s" : ""}` : null;
    const sizeStr = [bedroomStr, bathroomStr].filter(Boolean).join(", ");
    const serviceStr = job.serviceName ?? "cleaning service";
    const chipsStr = input.chips.length > 0 ? input.chips.join(", ") : "great service";
    const extraContext = input.freeText ? `\nCustomer's own words: "${input.freeText}"` : "";

    const systemPrompt = `You are a review-writing assistant for Maids in Black, a premium home cleaning company in Washington DC.
Your job is to write authentic, heartfelt Google reviews on behalf of satisfied customers.
Each review should:
- Sound natural and human, not like marketing copy
- Be 2-4 sentences (50-100 words)
- Mention specific details about the job when available
- Vary in tone and structure (one enthusiastic, one matter-of-fact, one warm/personal)
- NOT use the word "impeccable", "pristine", "meticulous", or other overused cleaning clichés
- NOT start with "I" — vary the opening
- End on a positive note that encourages others to book`;

    const userPrompt = `Write 3 different Google review drafts for this cleaning job:
- Team: ${teamName}
- Service: ${serviceStr}${sizeStr ? ` (${sizeStr})` : ""}
- What the customer highlighted: ${chipsStr}${extraContext}

Return a JSON object with this exact structure:
{
  "drafts": ["draft1 text here", "draft2 text here", "draft3 text here"]
}`;

    let response;
    try {
      response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_drafts",
          strict: true,
          schema: {
            type: "object",
            properties: {
              drafts: {
                type: "array",
                items: { type: "string" },
                description: "Array of exactly 3 review draft strings",
              },
            },
            required: ["drafts"],
            additionalProperties: false,
          },
        },
      },
      });
    } catch (error) {
      console.error("[CustomerPortalReview] generateDrafts failed:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not prepare three review options. Please try again." });
    }
    const raw = response.choices?.[0]?.message?.content;
    const parsed = typeof raw === "string" ? JSON.parse(raw) as { drafts?: unknown } : null;
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts.filter((draft): draft is string => typeof draft === "string" && draft.trim().length > 0).slice(0, 3) : [];
    if (drafts.length !== 3) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not prepare three review options. Please try again." });

    await db.update(leadflowJobs).set({
      reviewChipsSelected: input.chips.join(","),
      reviewFreeText: input.freeText || null,
      reviewDrafts: JSON.stringify(drafts),
      reviewDraftPicked: null,
      reviewDraftText: null,
      reviewCopied: 0,
      reviewThumbtackOpenedAt: null,
    }).where(eq(leadflowJobs.id, job.id));
    return { drafts, thumbtackReviewUrl: THUMBTACK_REVIEW_URL };
  }),

  chooseDraft: publicProcedure.input(z.object({ leadflowJobId: z.number().int().positive(), draftIndex: z.number().int().min(1).max(3) })).mutation(async ({ ctx, input }) => {
    const { db, job } = await getCustomerReviewJob(ctx, input.leadflowJobId);
    if (job.customerRating !== 5) throw new TRPCError({ code: "FORBIDDEN", message: "Review drafts are available after a five-star rating." });
    const draft = parseDrafts(job.reviewDrafts)[input.draftIndex - 1];
    if (!draft) throw new TRPCError({ code: "BAD_REQUEST", message: "That review option is no longer available." });
    await db.update(leadflowJobs).set({ reviewDraftPicked: input.draftIndex, reviewDraftText: draft }).where(eq(leadflowJobs.id, job.id));
    return { draft };
  }),

  recordThumbtackAction: publicProcedure.input(z.object({ leadflowJobId: z.number().int().positive(), draftText: z.string().trim().min(1).max(2_000) })).mutation(async ({ ctx, input }) => {
    const { db, job } = await getCustomerReviewJob(ctx, input.leadflowJobId);
    if (job.customerRating !== 5) throw new TRPCError({ code: "FORBIDDEN", message: "Thumbtack review handoff is available after a five-star rating." });
    await db.update(leadflowJobs).set({ reviewDraftText: input.draftText, reviewCopied: 1, reviewThumbtackOpenedAt: new Date() }).where(eq(leadflowJobs.id, job.id));
    return { thumbtackReviewUrl: THUMBTACK_REVIEW_URL };
  }),
});
