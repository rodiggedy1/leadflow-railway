/**
 * server/madison/chain/registry.ts
 *
 * Capability Registry — maps capability IDs to their handlers.
 * Every handler wraps an existing service function. No new business logic here.
 *
 * Adding a capability = add one entry here. Planner and executor never change.
 */

import type {
  CapabilityHandler,
  CapabilityId,
  CapabilityContext,
  ValidationResult,
  VerificationResult,
  CardStatusOutput,
  ConfirmationStatusOutput,
  ReadinessOutput,
  SendLinkOutput,
  SendSmsOutput,
  SendBulkSmsOutput,
  Recipient,
} from "./types";
import { getTodayET } from "../../conciergeTime";
import { computeReadinessSummary } from "../readinessService";
import { sendSms } from "../../openphone";
import { appendCsOutboundMessage } from "../../sms/appendCsOutboundMessage";
import { ENV } from "../../_core/env";
import { normalizePhoneLegacy } from "../../utils/phone";
import { randomBytes } from "crypto";

// ── Shared helpers ────────────────────────────────────────────────────────────

function buildPaymentSms(firstName: string, linkUrl: string): string {
  return `Hi ${firstName}! 👋 \n\nWe'd love to save your card on file for a seamless checkout experience. Click the link below to securely add your card:\n\n${linkUrl}\n\nThank you! 🏡✨`;
}

function normalizePhone(phone: string): string {
  return normalizePhoneLegacy(phone) || phone;
}

// ── Capability: readiness.compute ─────────────────────────────────────────────

interface ReadinessComputeArgs {
  date?: string; // YYYY-MM-DD, defaults to today
}

const readinessCompute: CapabilityHandler<ReadinessComputeArgs, ReadinessOutput> = {
  id: "readiness.compute",
  label: "Compute readiness summary",
  isWrite: false,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    const date = args.date ?? getTodayET();
    return { ok: true, resolvedArgs: { date } };
  },

  async execute(args, ctx): Promise<ReadinessOutput> {
    const date = (args.date ?? getTodayET()) as string;
    const summary = await computeReadinessSummary(ctx.db, date);
    return {
      date: summary.date,
      overallPct: summary.overallPct,
      totalIssues: summary.totalIssues,
      summary: `${summary.overallPct}% ready, ${summary.totalIssues} issue${summary.totalIssues !== 1 ? "s" : ""}`,
    };
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    return { ok: true, summary: `Readiness computed: ${result.summary}` };
  },
};

// ── Capability: confirmations.queryStatus ─────────────────────────────────────

interface ConfirmationsQueryArgs {
  date?: string; // YYYY-MM-DD, defaults to today
}

const confirmationsQueryStatus: CapabilityHandler<ConfirmationsQueryArgs, ConfirmationStatusOutput> = {
  id: "confirmations.queryStatus",
  label: "Check confirmation status",
  isWrite: false,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    const date = args.date ?? getTodayET();
    return { ok: true, resolvedArgs: { date } };
  },

  async execute(args, ctx): Promise<ConfirmationStatusOutput> {
    const date = (args.date ?? getTodayET()) as string;
    const { cleanerJobs, confirmationCalls } = await import("../../../drizzle/schema");
    const { eq, ne, and, desc } = await import("drizzle-orm");
    const { matchConfirmationCallsToJobs } = await import("../../confirmationMatchHelper");

    const jobs = await ctx.db
      .select({
        id: cleanerJobs.id,
        customerName: cleanerJobs.customerName,
        customerPhone: cleanerJobs.customerPhone,
        serviceDateTime: cleanerJobs.serviceDateTime,
        teamName: cleanerJobs.teamName,
      })
      .from(cleanerJobs)
      .where(and(
        eq(cleanerJobs.jobDate, date),
        ne(cleanerJobs.bookingStatus, "cancelled"),
        ne(cleanerJobs.bookingStatus, "rescheduled"),
      ))
      .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.customerName);

    const existingCalls = await ctx.db
      .select({
        cleanerJobId: confirmationCalls.cleanerJobId,
        calledPhone: confirmationCalls.calledPhone,
        clientName: confirmationCalls.clientName,
        aiOutcome: confirmationCalls.aiOutcome,
        manualOutcome: confirmationCalls.manualOutcome,
        aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
        manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
        smsConfirmedAt: confirmationCalls.smsConfirmedAt,
        smsFollowupSentRaw: confirmationCalls.smsFollowupSent,
      })
      .from(confirmationCalls)
      .where(eq(confirmationCalls.jobDate, date))
      .orderBy(desc(confirmationCalls.firedAt));

    const confCallByJobId = matchConfirmationCallsToJobs(jobs, existingCalls as any);

    const unconfirmed: Recipient[] = [];
    const alreadySent: Recipient[] = [];
    const confirmed: Recipient[] = [];

    for (const job of jobs) {
      const cc = confCallByJobId.get(job.id) ?? null;
      const r: Recipient = {
        jobId: job.id,
        phone: job.customerPhone ?? null,
        name: job.customerName ?? "Unknown",
      };
      if (cc?.smsConfirmedAt) {
        confirmed.push(r);
      } else if ((cc as any)?.smsFollowupSentRaw === 1) {
        alreadySent.push(r);
      } else {
        unconfirmed.push(r);
      }
    }

    const dateLabel = date === getTodayET() ? "today" : date;
    return { date, dateLabel, unconfirmed, alreadySent, confirmed };
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    const total = result.unconfirmed.length + result.alreadySent.length + result.confirmed.length;
    return {
      ok: true,
      summary: `${total} jobs: ${result.confirmed.length} confirmed, ${result.alreadySent.length} sent, ${result.unconfirmed.length} pending`,
    };
  },
};

// ── Capability: payments.queryCardStatus ──────────────────────────────────────

interface CardStatusArgs {
  date?: string; // YYYY-MM-DD, defaults to today
}

const paymentsQueryCardStatus: CapabilityHandler<CardStatusArgs, CardStatusOutput> = {
  id: "payments.queryCardStatus",
  label: "Check card/payment status",
  isWrite: false,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    const date = args.date ?? getTodayET();
    return { ok: true, resolvedArgs: { date } };
  },

  async execute(args, ctx): Promise<CardStatusOutput> {
    const date = (args.date ?? getTodayET()) as string;
    const { cleanerJobs, stripeCustomers, paymentAuthorizations } = await import("../../../drizzle/schema");
    const { eq, ne, and, isNull } = await import("drizzle-orm");

    const jobs = await (ctx.db as any)
      .select({
        customerName: cleanerJobs.customerName,
        customerPhone: cleanerJobs.customerPhone,
        cardBrand: cleanerJobs.paymentBrand,
        last4: cleanerJobs.paymentLast4,
        hasStripeCard: cleanerJobs.hasStripeCard,
        chargesOnHoldCents: cleanerJobs.chargesOnHoldCents,
      })
      .from(cleanerJobs)
      .where(and(
        eq(cleanerJobs.jobDate, date),
        ne(cleanerJobs.bookingStatus, "rescheduled"),
        ne(cleanerJobs.bookingStatus, "cancelled"),
      ));

    // Deduplicate by customerName
    const seen = new Set<string>();
    const deduped = jobs.filter((j: any) => {
      const key = j.customerName ?? "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const noCard: Recipient[] = [];
    const onHold: Recipient[] = [];
    const hasCard: Recipient[] = [];

    // Check LeadFlow cards for no-card rows
    const [lfCustomers, lfAuths] = await Promise.all([
      (ctx.db as any).select({ phone: stripeCustomers.phone, name: stripeCustomers.name, stripePaymentMethodId: stripeCustomers.stripePaymentMethodId }).from(stripeCustomers),
      (ctx.db as any).select({ customerPhone: paymentAuthorizations.customerPhone, customerName: paymentAuthorizations.customerName, status: paymentAuthorizations.status }).from(paymentAuthorizations).where(and(eq(paymentAuthorizations.status, "authorized"), isNull(paymentAuthorizations.cancelledAt))),

    ]);

    const lfCustByPhone = new Map<string, any>();
    const lfAuthByPhone = new Map<string, any>();
    for (const c of lfCustomers) { const n = normalizePhoneLegacy(c.phone ?? ""); if (n) lfCustByPhone.set(n, c); }
    for (const a of lfAuths) { const n = normalizePhoneLegacy(a.customerPhone ?? ""); if (n) lfAuthByPhone.set(n, a); }

    for (const j of deduped) {
      const r: Recipient = { phone: j.customerPhone ?? null, name: j.customerName ?? "Unknown" };
      const normPhone = j.customerPhone ? normalizePhoneLegacy(j.customerPhone) : null;
      const lfAuth = normPhone ? lfAuthByPhone.get(normPhone) : null;
      const lfCust = normPhone ? lfCustByPhone.get(normPhone) : null;

      if ((j.chargesOnHoldCents ?? 0) > 0 || lfAuth) {
        onHold.push(r);
      } else if (j.hasStripeCard || lfCust?.stripePaymentMethodId) {
        hasCard.push(r);
      } else {
        noCard.push(r);
      }
    }

    return { date, noCard, onHold, hasCard };
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    const total = result.noCard.length + result.onHold.length + result.hasCard.length;
    return {
      ok: true,
      summary: `${total} jobs: ${result.hasCard.length} have card, ${result.onHold.length} on hold, ${result.noCard.length} no card`,
    };
  },
};

// ── Capability: payments.sendLink ─────────────────────────────────────────────

interface SendLinkArgs {
  /** Direct recipient list (from a prior step's output) */
  recipients?: Recipient[];
  /** Single recipient (when used standalone) */
  phone?: string;
  name?: string;
  date?: string;
  address?: string;
}

const paymentsSendLink: CapabilityHandler<SendLinkArgs, SendLinkOutput[]> = {
  id: "payments.sendLink",
  label: "Send payment links",
  isWrite: true,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    const recipients = args.recipients ?? (args.phone ? [{ phone: args.phone, name: args.name ?? args.phone }] : []);
    const valid = recipients.filter(r => r.phone);
    if (valid.length === 0) {
      return { ok: false, reason: "No recipients with phone numbers" };
    }
    return { ok: true, resolvedArgs: { ...args, recipients: valid } };
  },

  async execute(args, ctx): Promise<SendLinkOutput[]> {
    const { cardAuthTokens } = await import("../../../drizzle/schema");
    const recipients = (args.recipients ?? []) as Recipient[];
    const results: SendLinkOutput[] = [];

    for (const recipient of recipients) {
      if (!recipient.phone) continue;
      const normPhone = normalizePhone(recipient.phone);
      const token = randomBytes(32).toString("hex");
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

      // Create token
      const insertResult = await (ctx.db as any).insert(cardAuthTokens).values({
        token,
        customerPhone: normPhone,
        customerName: recipient.name,
        jobDate: args.date ?? null,
        jobAddress: args.address ?? null,
        cleanerJobId: recipient.jobId ?? null,
        used: 0,
        expiresAt,
      });
      const tokenId = (insertResult as any).insertId as number;

      const baseUrl = "https://quote.maidinblack.com";
      const params = new URLSearchParams();
      if (recipient.name) params.set("name", recipient.name);
      if (args.address) params.set("address", args.address);
      const qs = params.toString();
      const url = `${baseUrl}/pay/${token}${qs ? `?${qs}` : ""}`;
      const firstName = recipient.name.split(" ")[0];
      const smsText = buildPaymentSms(firstName, url);

      // Send SMS
      const smsResult = await sendSms({
        to: normPhone,
        content: smsText,
        fromNumberId: ENV.openPhoneCsNumberId,
      });

      if (smsResult.success) {
        appendCsOutboundMessage({
          db: ctx.db as any,
          recipientPhone: normPhone,
          recipientName: recipient.name,
          message: smsText,
          senderName: "Agent",
          openPhoneMessageId: smsResult.messageId,
        }).catch(console.error);
      }

      results.push({
        recipientPhone: normPhone,
        recipientName: recipient.name,
        tokenId,
        url,
        smsSent: smsResult.success,
        openPhoneMessageId: smsResult.messageId ?? null,
      });
    }

    return results;
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    const { cardAuthTokens } = await import("../../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const tokenIds = result.map(r => r.tokenId).filter(Boolean);
    if (tokenIds.length === 0) return { ok: false, summary: "No tokens created" };

      const rows = await (ctx.db as any).select({ id: cardAuthTokens.id }).from(cardAuthTokens).where(inArray(cardAuthTokens.id, tokenIds));
    const ok = rows.length === tokenIds.length;
    const sent = result.filter(r => r.smsSent).length;
    return {
      ok,
      summary: `${sent}/${result.length} payment links sent`,
    };
  },
};

// ── Capability: communications.sendSms ───────────────────────────────────────

interface SendSmsArgs {
  phone: string;
  name: string;
  message: string;
}

const communicationsSendSms: CapabilityHandler<SendSmsArgs, SendSmsOutput> = {
  id: "communications.sendSms",
  label: "Send SMS",
  isWrite: true,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    if (!args.phone) return { ok: false, reason: "Missing phone number" };
    if (!args.message?.trim()) return { ok: false, reason: "Missing message" };
    return { ok: true };
  },

  async execute(args, ctx): Promise<SendSmsOutput> {
    const normPhone = normalizePhone(args.phone);
    const result = await sendSms({
      to: normPhone,
      content: args.message,
      fromNumberId: ENV.openPhoneCsNumberId,
    });
    if (result.success) {
      appendCsOutboundMessage({
        db: ctx.db as any,
        recipientPhone: normPhone,
        recipientName: args.name,
        message: args.message,
        senderName: "Agent",
        openPhoneMessageId: result.messageId,
      }).catch(console.error);
    }
    return {
      phone: normPhone,
      name: args.name,
      success: result.success,
      openPhoneMessageId: result.messageId ?? null,
    };
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    return {
      ok: result.success,
      summary: result.success ? `SMS sent to ${result.name}` : `SMS failed to ${result.name}`,
    };
  },
};

// ── Capability: communications.sendBulkSms ───────────────────────────────────

interface SendBulkSmsArgs {
  recipients: Recipient[];
  message: string;
}

const communicationsSendBulkSms: CapabilityHandler<SendBulkSmsArgs, SendBulkSmsOutput> = {
  id: "communications.sendBulkSms",
  label: "Send bulk SMS",
  isWrite: true,
  defaultOnFailure: "continue",

  async validate(args, ctx): Promise<ValidationResult> {
    const valid = (args.recipients ?? []).filter(r => r.phone);
    if (valid.length === 0) return { ok: false, reason: "No recipients with phone numbers" };
    if (!args.message?.trim()) return { ok: false, reason: "Missing message" };
    return { ok: true, resolvedArgs: { ...args, recipients: valid } };
  },

  async execute(args, ctx): Promise<SendBulkSmsOutput> {
    const results: SendSmsOutput[] = [];
    for (const recipient of args.recipients) {
      if (!recipient.phone) continue;
      const normPhone = normalizePhone(recipient.phone);
      try {
        const result = await sendSms({
          to: normPhone,
          content: args.message,
          fromNumberId: ENV.openPhoneCsNumberId,
        });
        if (result.success) {
          appendCsOutboundMessage({
            db: ctx.db as any,
            recipientPhone: normPhone,
            recipientName: recipient.name,
            message: args.message,
            senderName: "Agent",
            openPhoneMessageId: result.messageId,
          }).catch(console.error);
        }
        results.push({ phone: normPhone, name: recipient.name, success: result.success, openPhoneMessageId: result.messageId ?? null });
      } catch (err) {
        results.push({ phone: normPhone, name: recipient.name, success: false, openPhoneMessageId: null });
      }
    }
    return {
      results,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
    };
  },

  async verify(args, result, ctx): Promise<VerificationResult> {
    return {
      ok: result.failCount === 0,
      summary: `${result.successCount}/${result.results.length} SMS sent`,
    };
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

type AnyHandler = CapabilityHandler<any, any>;

const HANDLERS: AnyHandler[] = [
  readinessCompute,
  confirmationsQueryStatus,
  paymentsQueryCardStatus,
  paymentsSendLink,
  communicationsSendSms,
  communicationsSendBulkSms,
];

const REGISTRY = new Map<CapabilityId, AnyHandler>(
  HANDLERS.map(h => [h.id, h])
);

export function getCapabilityHandler(id: CapabilityId): AnyHandler | undefined {
  return REGISTRY.get(id);
}

export function getAllCapabilities(): AnyHandler[] {
  return HANDLERS;
}

export function getCapabilityIds(): CapabilityId[] {
  return HANDLERS.map(h => h.id);
}
