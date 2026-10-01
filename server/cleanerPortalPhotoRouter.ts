import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import heicConvert from "heic-convert";
import { z } from "zod";
import { cleanerPortalJobPhotos, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { portalJobKeySchema, resolveOwnedLeadflowJob } from "./cleanerPortalJobResolver";
import { generateThumbnail, storagePut } from "./storage";



export const cleanerPortalPhotoRouter = router({
  getForJob: cleanerProcedure
    .input(z.object({ portalJobKey: portalJobKeySchema }))
    .query(async ({ ctx, input }) => {
      const { db, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Photos are temporarily unavailable.");
      return db
        .select({
          id: cleanerPortalJobPhotos.id,
          photoUrl: cleanerPortalJobPhotos.photoUrl,
          thumbnailUrl: cleanerPortalJobPhotos.thumbnailUrl,
          photoType: cleanerPortalJobPhotos.photoType,
          filename: cleanerPortalJobPhotos.filename,
          createdAt: cleanerPortalJobPhotos.createdAt,
        })
        .from(cleanerPortalJobPhotos)
        .where(eq(cleanerPortalJobPhotos.leadflowJobId, job.id))
        .orderBy(asc(cleanerPortalJobPhotos.createdAt));
    }),

  uploadPhoto: cleanerProcedure
    .input(z.object({
      portalJobKey: portalJobKeySchema,
      filename: z.string().max(255),
      mimeType: z.string().max(50),
      dataBase64: z.string().max(10 * 1024 * 1024),
      photoType: z.enum(["before", "after", "general"]).default("general"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, job } = await resolveOwnedLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey, "Photos are temporarily unavailable.");
      const rawBuffer = Buffer.from(input.dataBase64, "base64");
      const rawMimeType = input.mimeType.toLowerCase();
      const isHeic = rawMimeType === "image/heic" || rawMimeType === "image/heif";

      let buffer: Buffer;
      let mimeType: string;
      let ext: string;
      if (isHeic) {
        try {
          const jpegArrayBuffer = await heicConvert({ buffer: rawBuffer, format: "JPEG", quality: 0.9 });
          buffer = Buffer.from(jpegArrayBuffer);
          mimeType = "image/jpeg";
          ext = "jpg";
        } catch (error) {
          console.error("[cleanerPortalPhoto] HEIC conversion failed:", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Photo format conversion failed. Please try again." });
        }
      } else {
        buffer = rawBuffer;
        mimeType = input.mimeType;
        ext = input.filename.split(".").pop() ?? "jpg";
      }

      const randomSuffix = Math.random().toString(36).slice(2, 10);
      const fileKey = `cleaner-photos/${ctx.cleaner.cleanerId}/leadflow-${job.id}-${randomSuffix}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, mimeType);

      let thumbnailUrl: string | null = null;
      let thumbnailKey: string | null = null;
      const thumbnail = await generateThumbnail(buffer, mimeType);
      if (thumbnail) {
        const thumbKey = `cleaner-photos/${ctx.cleaner.cleanerId}/leadflow-${job.id}-${randomSuffix}-thumb.jpg`;
        const uploadedThumbnail = await storagePut(thumbKey, thumbnail.buffer, thumbnail.contentType);
        thumbnailUrl = uploadedThumbnail.url;
        thumbnailKey = uploadedThumbnail.key;
      }

      const createdAt = new Date();
      await db.insert(cleanerPortalJobPhotos).values({
        leadflowJobId: job.id,
        cleanerProfileId: ctx.cleaner.cleanerId,
        photoUrl: url,
        photoKey: fileKey,
        thumbnailUrl,
        thumbnailKey,
        filename: input.filename,
        photoType: input.photoType,
        createdAt,
      });
      return { photoUrl: url, thumbnailUrl, photoType: input.photoType, filename: input.filename, createdAt };
    }),
});
