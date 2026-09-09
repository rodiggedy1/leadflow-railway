import { and, asc, eq, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { cleanerProfiles, leadflowBookingMessages, leadflowJobs } from "../drizzle/schema";
import { cleanerProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { getOrCreateCustomerPortalMagicLink } from "./customerPortalService";
import { sendSms } from "./openphone";

const portalKeySchema = z.string().regex(/^leadflow:\d+$/, "Invalid portal job reference.");
const messageInput = z.object({ portalJobKey: portalKeySchema, body: z.string().trim().min(1).max(1_000) });

function parseLeadflowJobId(portalJobKey: string) {
  const value = Number.parseInt(portalJobKey.slice("leadflow:".length), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid portal job reference." });
  return value;
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function portalTime(value: string | null) {
  if (!value) return "Time pending";
  if (value.includes("T")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
  }
  const time = value.split(" ")[1] ?? "";
  const [hourValue, minuteValue] = time.split(":");
  const hour = Number.parseInt(hourValue, 10);
  return Number.isInteger(hour) ? `${hour % 12 || 12}:${String(Number.parseInt(minuteValue ?? "0", 10)).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}` : (time || value);
}

function portalExtras(value: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
}

function messagePortalUrl(portalUrl: string) {
  return `${portalUrl}${portalUrl.includes("?") ? "&" : "?"}view=messages`;
}

async function ownedActiveLeadflowJob(cleanerId: number, portalJobKey: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Messages are temporarily unavailable." });
  const cleaners = await db.select({ id: cleanerProfiles.id, teamId: cleanerProfiles.launch27TeamId }).from(cleanerProfiles).where(eq(cleanerProfiles.id, cleanerId)).limit(1);
  const cleaner = cleaners[0];
  if (!cleaner?.teamId) throw new TRPCError({ code: "FORBIDDEN", message: "Your cleaner account has no assigned team." });
  const jobId = parseLeadflowJobId(portalJobKey);
  const jobs = await db.select({ id: leadflowJobs.id, customerName: leadflowJobs.customerName, customerPhone: leadflowJobs.customerPhone, customerEmail: leadflowJobs.customerEmail, jobAddress: leadflowJobs.jobAddress, serviceDateTime: leadflowJobs.serviceDateTime, extras: leadflowJobs.extras }).from(leadflowJobs).where(and(
    eq(leadflowJobs.id, jobId), eq(leadflowJobs.teamId, cleaner.teamId),
    ne(leadflowJobs.bookingStatus, "cancelled"), ne(leadflowJobs.bookingStatus, "rescheduled"), ne(leadflowJobs.bookingStatus, "missing_from_launch27"),
  )).limit(1);
  const job = jobs[0];
  if (!job) throw new TRPCError({ code: "FORBIDDEN", message: "This job is not assigned to your team." });
  return { db, cleaner, job };
}

export const cleanerPortalMessagesRouter = router({
  getForJob: cleanerProcedure.input(z.object({ portalJobKey: portalKeySchema })).query(async ({ ctx, input }) => {
    const { db, job } = await ownedActiveLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey);
    const messages = await db.select({ id: leadflowBookingMessages.id, senderRole: leadflowBookingMessages.senderRole, body: leadflowBookingMessages.body, notificationStatus: leadflowBookingMessages.notificationStatus, createdAt: leadflowBookingMessages.createdAt }).from(leadflowBookingMessages).where(eq(leadflowBookingMessages.leadflowJobId, job.id)).orderBy(asc(leadflowBookingMessages.createdAt), asc(leadflowBookingMessages.id));
    return {
      job: { portalJobKey: input.portalJobKey, customerName: job.customerName, address: job.jobAddress ?? "", time: portalTime(job.serviceDateTime), extras: portalExtras(job.extras) },
      messages,
    };
  }),
  send: cleanerProcedure.input(messageInput).mutation(async ({ ctx, input }) => {
    const { db, cleaner, job } = await ownedActiveLeadflowJob(ctx.cleaner.cleanerId, input.portalJobKey);
    if (!job.customerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "This booking has no customer phone number." });
    const now = new Date();
    const inserted = await db.insert(leadflowBookingMessages).values({ leadflowJobId: job.id, senderRole: "cleaner", body: input.body, cleanerProfileId: cleaner.id, notificationStatus: "pending", createdAt: now });
    const messageId = Number(inserted[0].insertId);
    let portalLink: string | null = null;
    try {
      portalLink = messagePortalUrl(await getOrCreateCustomerPortalMagicLink(db, { customerName: job.customerName, customerPhone: job.customerPhone, customerEmail: job.customerEmail }));
    } catch (error) {
      console.error("[CleanerPortalMessages] Customer portal link generation failed; sending the message without a link.", error);
    }
    const smsContent = portalLink
      ? `Your Maids in Black cleaning team sent you a direct message: ${input.body}\n\nReply in your portal: ${portalLink}`
      : `Your Maids in Black cleaning team sent you a direct message: ${input.body}`;
    const sms = await sendSms({ to: job.customerPhone, content: smsContent });
    await db.update(leadflowBookingMessages).set(sms.success
      ? { notificationStatus: "sent", notificationMessageId: sms.messageId ?? null, notificationError: null, notificationSentAt: new Date() }
      : { notificationStatus: "failed", notificationError: sms.error ?? "The customer notification could not be sent." },
    ).where(eq(leadflowBookingMessages.id, messageId));
    return { id: messageId, notificationSent: sms.success, notificationError: sms.success ? null : (sms.error ?? "The customer notification could not be sent."), portalLinkIncluded: Boolean(portalLink) };
  }),
});
