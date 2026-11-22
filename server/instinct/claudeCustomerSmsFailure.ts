import { z } from "zod";

const phases = ["generation", "preparation", "fallback_preparation", "pre_send"] as const;
const knownCodes = new Set(["KNOWLEDGE_UNAVAILABLE", "TASK_EVIDENCE_NOT_CURRENT_INBOUND", "ACKNOWLEDGMENT_REQUIRES_TASK",
  "NOT_FOUND", "FORBIDDEN", "CONFLICT", "PRECONDITION_FAILED", "UNCLASSIFIED_ERROR"]);
const safeCode = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)
  && (knownCodes.has(value) || /^(?:SMS_QUOTE_|CUSTOMER_REPLY_|CUSTOMER_TASK_|UNSAFE_REPLY_|ER_)/.test(value));
const safeFields = new Set([
  "replyText", "task", "title", "items", "evidenceQuote", "bookingQuote", "action", "intentEvidenceQuote",
  "fields", "evidence", "turnIndex", "quote", "customerName", "customerPhone", "customerEmail", "address",
  "requestedLocalDate", "requestedLocalTime", "pricing", "pricingMode", "serviceId", "bedrooms", "bathrooms",
  "homeType", "condition", "maidCount", "hourCount", "extras", "id", "quantity", "recurrence", "extrasConfirmed",
  "notes", "quoteTextTemplate", "quotePresentationLanguage", "customerNameConfirmed", "city", "addressConfirmed",
  "smsNumberConfirmed", "state", "revision", "link", "input", "previous", "originalConversation",
]);
const diagnosticSchema = z.object({
  phase: z.enum(phases),
  code: z.string().refine(safeCode),
  name: z.enum(["Error", "SyntaxError", "ZodError", "CustomerTaskStoreError", "UnknownError"]),
  issues: z.array(z.object({
    code: z.string().regex(/^[a-z_]{1,40}$/),
    path: z.array(z.union([z.number().int().nonnegative(), z.string().refine(value => safeFields.has(value) || value === "[field]")])).max(8),
  }).strict()).max(8),
}).strict();
export const customerSmsFailureDetailsSchema = z.object({ failures: z.array(diagnosticSchema).min(1).max(2) }).strict();
export type CustomerSmsFailureDetails = z.infer<typeof customerSmsFailureDetailsSchema>;
export type CustomerSmsFailure = CustomerSmsFailureDetails["failures"][number];

/** Never persist raw exception messages: SDK/SQL errors can contain private text or credentials. */
export function describeCustomerSmsFailure(error: unknown, phase: CustomerSmsFailure["phase"]): CustomerSmsFailure {
  const value = error && typeof error === "object" ? error as { message?: unknown; code?: unknown; name?: unknown } : {};
  const code = [value.message, value.code].find(safeCode)
    ?? "UNCLASSIFIED_ERROR";
  const name = error instanceof z.ZodError ? "ZodError" : error instanceof SyntaxError ? "SyntaxError"
    : value.name === "CustomerTaskStoreError" ? "CustomerTaskStoreError" : error instanceof Error ? "Error" : "UnknownError";
  const issues = error instanceof z.ZodError ? error.issues.slice(0, 8).map(issue => ({
    code: issue.code,
    path: issue.path.slice(0, 8).map(part => typeof part === "number" && Number.isSafeInteger(part) && part >= 0 ? part
      : typeof part === "string" && safeFields.has(part) ? part : "[field]"),
  })) : [];
  return diagnosticSchema.parse({ phase, code, name, issues });
}
