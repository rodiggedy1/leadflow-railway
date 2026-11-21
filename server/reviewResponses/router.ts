import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminAgentProcedure, router } from "../_core/trpc";
import { publicReviewSchema, REVIEW_RESPONSE_RELEASE, REVIEW_AGENT_NAME, type PublicReview, type ReviewResponseService } from "../../shared/reviewResponses";
import { REVIEW_AGENT_ID, REVIEW_AGENT_VERSION } from "./managedAgent";
import { ingestCapturedThumbtackReviews, readCapturedThumbtackReviews } from "./captured";

const keyInput = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const revisionInput = keyInput.extend({ expectedRevision: z.number().int().positive() });

async function runtimeService(): Promise<ReviewResponseService> {
  // Lazy dependencies: importing the router creates no DB connection or provider session.
  const [{ getDb }, { createSqlReviewStore }, { createReviewResponseService }, { createManagedReviewGenerator }] = await Promise.all([
    import("../db"), import("./store"), import("./service"), import("./managedAgent"),
  ]);
  const db = await getDb();
  if (!db) throw new Error("Review store unavailable");
  return createReviewResponseService({ store: createSqlReviewStore(db), generator: createManagedReviewGenerator() });
}

async function runtimeCapturedReviews(): Promise<PublicReview[]> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("Captured review store unavailable");
  return readCapturedThumbtackReviews(db);
}

export function createReviewResponsesRouter(getService: () => Promise<ReviewResponseService> = runtimeService,
  getCapturedReviews: () => Promise<PublicReview[]> = runtimeCapturedReviews) {
  async function act<T>(operation: (service: ReviewResponseService) => Promise<T>): Promise<T> {
    try { return await operation(await getService()); }
    catch (error) {
      if (error instanceof TRPCError) throw error;
      // No raw DB/provider bodies, keys, customer context or exception cause exposed.
      throw new TRPCError({ code: "BAD_REQUEST", message: "Review action could not complete. Refresh the review and check its validation or approval state." });
    }
  }
  return router({
    status: adminAgentProcedure.query(() => ({ ...REVIEW_RESPONSE_RELEASE, agentId: REVIEW_AGENT_ID, agentVersion: REVIEW_AGENT_VERSION,
      agentName: REVIEW_AGENT_NAME, mode: "draft_only" as const, providerAccessVerified: false, bookingContextMatchEnabled: false,
      capturedThumbtackImportAvailable: true, currentPublicReplyStatus: "unverified" as const })),
    list: adminAgentProcedure.query(() => act(service => service.list(200))),
    importCaptured: adminAgentProcedure.mutation(({ ctx }) => act(async service =>
      ingestCapturedThumbtackReviews(service, await getCapturedReviews(), ctx.agent.agentEmail))),
    ingest: adminAgentProcedure.input(publicReviewSchema.extend({ source: z.literal("manual").default("manual") }))
      .mutation(({ input, ctx }) => act(service => service.ingest(input, ctx.agent.agentEmail))),
    generate: adminAgentProcedure.input(keyInput)
      .mutation(({ input, ctx }) => act(service => service.generate(input.key, ctx.agent.agentEmail))),
    edit: adminAgentProcedure.input(revisionInput.extend({ text: z.string().trim().min(1).max(20000) }))
      .mutation(({ input, ctx }) => act(service => service.edit(input.key, input.text, input.expectedRevision, ctx.agent.agentEmail))),
    approve: adminAgentProcedure.input(revisionInput)
      .mutation(({ input, ctx }) => act(service => service.approve(input.key, input.expectedRevision, ctx.agent.agentEmail))),
    acknowledge: adminAgentProcedure.input(revisionInput)
      .mutation(({ input, ctx }) => act(service => service.acknowledge(input.key, input.expectedRevision, ctx.agent.agentEmail))),
    // Even an approved draft cannot be published by a direct API call in this build.
    publish: adminAgentProcedure.input(keyInput).mutation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "Public review publication is disabled in this release" });
    }),
  });
}
export const reviewResponsesRouter = createReviewResponsesRouter();
