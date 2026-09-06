import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import heicConvert from "heic-convert";
import { z } from "zod";
import { cleanerPortalJobPhotos, cleanerProfiles, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { generateThumbnail, storagePut } from "./storage";

const portalKeySchema = z.string().regex(/^leadflow:\d+$/, "Invalid portal job reference.");

function parseLeadflowJobId(portalJobKey: string) {
  const value = Number.parseInt(portalJobKey.slice("leadflow:".length), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal job reference." });
  }
  return value;
}

async function ownedImportedJob(cleanerId: number, portalJobKey: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Photos are temporarily unavailable." });
  const cleanerRows = await db
    .select({ id: cleanerProfiles.id, teamId: cleanerProfiles.launch27TeamId })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.id, cleanerId))
    .limit(1);
  const cleaner = cleanerRows[0];
  if (!cleaner?.teamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });

  const leadflowJobId = parseLeadflowJobId(portalJobKey);
  const jobRows = await db
    .select({ id: leadflowJobs.id })
    .from(leadflowJobs)
    .where(and(
      eq(leadflowJobs.id, leadflowJobId),
      eq(leadflowJobs.teamId, cleaner.teamId),
      ne(leadflowJobs.bookingStatus, "cancelled"),
      ne(leadflowJobs.bookingStatus, "rescheduled"),
      ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
    ))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "This job is not assigned to your team." });
  return { db, job };
}

export const cleanerPortalPhotoRouter = router({
  getForJob: cleanerProcedure
    .input(z.object({ portalJobKey: portalKeySchema }))
    .query(async ({ ctx, input }) => {
      const { db, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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
      portalJobKey: portalKeySchema,
      filename: z.string().max(255),
      mimeType: z.string().max(50),
      dataBase64: z.string().max(10 * 1024 * 1024),
      photoType: z.enum(["before", "after", "general"]).default("general"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, job } = await ownedImportedJob(ctx.cleaner.cleanerId, input.portalJobKey);
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
