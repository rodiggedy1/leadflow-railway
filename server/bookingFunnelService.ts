import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BeginBookingFunnelInput } from "../shared/bookingFunnel";
import { normalizePhone } from "./utils/phone";

export class BookingFunnelInputError extends Error {}
export class BookingFunnelIdempotencyConflictError extends Error {}
export class BookingFunnelMutationTokenError extends Error {}

export type PreparedBookingFunnelLead = {
  idempotencyKey: string;
  commandHash: string;
  publicFunnelNumber: string;
  source: BeginBookingFunnelInput["source"];
  stage: "lead";
  customerName: string;
  customerPhone: string;
  version: 1;
};

export function normalizeBookingFunnelLead(input: BeginBookingFunnelInput): Omit<PreparedBookingFunnelLead, "publicFunnelNumber"> {
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  const customerPhone = normalizePhone(input.customerPhone);
  if (!customerPhone) throw new BookingFunnelInputError("Enter a valid U.S. phone number.");
  const material = { source: input.source, customerName, customerPhone };
  return {
    idempotencyKey: input.idempotencyKey,
    commandHash: createHash("sha256").update(JSON.stringify(material)).digest("hex"),
    ...material,
    stage: "lead",
    version: 1,
  };
}

export function createBookingFunnelNumber(): string {
  return `MIB-F${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function createBookingFunnelMutationToken(secret: string, publicFunnelNumber: string, idempotencyKey: string): string {
  if (!secret) throw new Error("Booking funnel token secret is unavailable.");
  return createHmac("sha256", secret).update(`${publicFunnelNumber}:${idempotencyKey}`).digest("hex");
}

export function verifyBookingFunnelMutationToken(secret: string, token: string, publicFunnelNumber: string, idempotencyKey: string): boolean {
  const expected = createBookingFunnelMutationToken(secret, publicFunnelNumber, idempotencyKey);
  const expectedBytes = Buffer.from(expected, "utf8");
  const tokenBytes = Buffer.from(token, "utf8");
  return expectedBytes.length === tokenBytes.length && timingSafeEqual(expectedBytes, tokenBytes);
}

export function isDuplicateBookingFunnelEntry(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; errno?: number; message?: string; cause?: unknown };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.message?.includes("Duplicate entry") === true) return true;
    current = candidate.cause;
  }
  return false;
}
