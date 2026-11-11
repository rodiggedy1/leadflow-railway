import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";

export type HandoffKind = "card" | "cashapp";
export type HandoffScope = { bookingId: number; profileId: number; version: number; date: string };
export const handoffPrefix = (kind: HandoffKind) => kind === "card" ? "hc1_" : "hp1_";
// Case-insensitive routing is intentional: a collation alias must never fall through
// to a legacy handler. Authorization below still requires canonical exact bytes.
export function isInternalHandoffToken(token: string): boolean { return /^(hc1_|hp1_)/i.test(token); }
export function handoffConflict(message = "This booking or payment link needs review before continuing."): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
export function handoffDateNumber(date: string): number {
  const value = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) handoffConflict();
  return Number(date.replaceAll("-", ""));
}
function scopeBytes(scope: HandoffScope): Buffer {
  const values = [scope.bookingId, scope.profileId, scope.version, handoffDateNumber(scope.date)];
  const bytes = Buffer.alloc(16);
  values.forEach((value, index) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffffffff) handoffConflict();
    bytes.writeUInt32BE(value, index * 4);
  });
  return bytes;
}
// Reuse the native Stripe credential, never an invoice setting or new secret.
// Domain separation keeps these unreleased capabilities independent of others.
function handoffSigningSecret(): string {
  return ENV.stripeSecretKey ? createHmac("sha256", ENV.stripeSecretKey).update("leadflow:internal-booking-handoff:token-key:v1").digest("hex") : "";
}
export function issueHandoffToken(kind: HandoffKind, scope: HandoffScope, requestId: string, secret = handoffSigningSecret()): string {
  if (secret.length < 32) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Secure payment-link signing is not configured." });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) handoffConflict();
  const fields = scopeBytes(scope);
  const nonce = createHmac("sha256", secret).update("leadflow:internal-booking-handoff:issuance:v1\0").update(handoffPrefix(kind)).update(fields).update(requestId.toLowerCase()).digest().subarray(0, 16);
  return handoffPrefix(kind) + Buffer.concat([fields, nonce]).toString("base64url");
}
/** Call ONLY after exact persisted-row lookup and a byte-equal token comparison. */
export function decodePersistedHandoffToken(token: string, persistedToken: string, kind: HandoffKind): HandoffScope {
  if (persistedToken !== token || !token.startsWith(handoffPrefix(kind)) || !/^(hc1_|hp1_)[A-Za-z0-9_-]{43}$/.test(token)) handoffConflict("Invalid payment link.");
  const bytes = Buffer.from(token.slice(4), "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== token.slice(4)) handoffConflict("Invalid payment link.");
  const [bookingId, profileId, version, dateNumber] = [0, 4, 8, 12].map(offset => bytes.readUInt32BE(offset));
  const raw = String(dateNumber);
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const scope = { bookingId, profileId, version, date };
  scopeBytes(scope);
  return scope;
}
/** A stored review-version candidate, not the current version, proves UUID replay. */
export function matchesHandoffRequest(token: string, kind: HandoffKind, scope: HandoffScope, requestId: string): boolean {
  const expected = issueHandoffToken(kind, scope, requestId);
  return token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
