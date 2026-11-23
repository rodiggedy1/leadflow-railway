import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { conversationSessions, opsChatMessages } from "../drizzle/schema";
import { projectThumbtackNativeLead } from "../shared/thumbtackNativeLead";
import type { getDb } from "./db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Caller = { id: string; name: string; isOwner: boolean };
const rows = (value: unknown): any[] => (value as any)[0];
const metadata = (value: unknown): Record<string, any> => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
};
function insertedId(value: unknown): number {
  const id = Number((value as any)[0]?.insertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The native lead claim could not be saved." });
  return id;
}

/** Human Claim only: no intake replay, AI generation, SMS, or background work. */
export async function claimNativeThumbtackLead(db: Db, negotiationId: string, caller: Caller) {
  return db.transaction(async tx => {
    // The retained negotiation is the identity; a negative UI ID is never a DB key.
    // Lock its first capture so two human claims cannot create competing cards.
    const [capture] = rows(await tx.execute(sql`SELECT id, raw_payload FROM webhook_events
      WHERE source = 'thumbtack' AND event_type = 'NegotiationCreatedV4'
      AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.data.negotiationID')) = ${negotiationId}
      ORDER BY id ASC LIMIT 1 FOR UPDATE`));
    if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "Thumbtack lead not found" });
    let lead: ReturnType<typeof projectThumbtackNativeLead>;
    try { lead = projectThumbtackNativeLead(JSON.parse(capture.raw_payload)); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "The retained Thumbtack lead could not be read." }); }
    if (!lead || lead.negotiationId !== negotiationId) throw new TRPCError({ code: "BAD_REQUEST", message: "The retained Thumbtack lead identity does not match." });
    const phone10 = lead.phone?.replace(/\D/g, "").slice(-10) ?? "";
    const hasPhone = phone10.length === 10;
    const cardFilter = hasPhone
      ? sql`(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.negotiationId')) = ${negotiationId}
          OR RIGHT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.leadPhone')), '[^0-9]', ''), 10) = ${phone10})`
      : sql`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.negotiationId')) = ${negotiationId}`;
    const [card] = rows(await tx.execute(sql`SELECT id, sessionId, metadata FROM ops_chat_messages
      WHERE channel = 'command' AND quickAction = 'new_lead' AND JSON_VALID(metadata) = 1 AND ${cardFilter}
      ORDER BY (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.negotiationId')) = ${negotiationId}) DESC, id DESC LIMIT 1 FOR UPDATE`));
    const saved = metadata(card?.metadata);
    if (saved.claimedBy) return { success: false as const, alreadyClaimedBy: String(saved.claimedBy) };
    const linkedId = Number(card?.sessionId ?? saved.sessionId);
    const phone = hasPhone ? lead.phone! : `no-phone-tt-${capture.id}`;
    // Match actual phone data, not a supplied sessionId or loose customer name.
    const sessionFilter = hasPhone
      ? sql`RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = ${phone10}`
      : sql`leadPhone = ${phone}`;
    let [session] = rows(await tx.execute(sql`SELECT id, assignedAgentName FROM conversation_sessions
      WHERE ${sessionFilter} ORDER BY (id = ${Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : 0}) DESC, id DESC LIMIT 1 FOR UPDATE`));
    if (session?.assignedAgentName) return { success: false as const, alreadyClaimedBy: String(session.assignedAgentName) };
    if (!session) {
      const sessionId = insertedId(await tx.insert(conversationSessions).values({
        leadPhone: phone, leadName: lead.name, leadSource: "thumbtack", stage: "AVAILABILITY",
        serviceType: lead.serviceType, bedrooms: lead.bedrooms, bathrooms: lead.bathrooms,
        extras: JSON.stringify(lead.extras), address: lead.address ?? lead.location,
        messageHistory: "[]", barkQA: `Thumbtack ID: ${negotiationId}`,
      }));
      session = { id: sessionId };
    }
    const sessionId = Number(session.id);
    const claimedAt = Date.now();
    const claimMetadata = { ...saved, negotiationId, sessionId, leadName: lead.name, leadPhone: lead.phone,
      serviceType: lead.serviceType, location: lead.location, requestedDates: lead.requestedDates,
      bedrooms: lead.bedrooms, bathrooms: lead.bathrooms, extras: lead.extras,
      frequency: lead.frequency, summary: lead.description, utmSource: "thumbtack",
      claimedBy: caller.name, claimedAt };
    let messageId: number;
    if (card) {
      messageId = Number(card.id);
      await tx.update(opsChatMessages).set({ sessionId, metadata: JSON.stringify(claimMetadata) }).where(sql`${opsChatMessages.id} = ${messageId}`);
    } else {
      messageId = insertedId(await tx.insert(opsChatMessages).values({
        channel: "command", authorName: "New Lead", authorRole: "system", quickAction: "new_lead", sessionId,
        body: `Thumbtack Lead · ${lead.name} · ${lead.phone ?? "Phone not provided"}\n${lead.serviceType ?? "Service not provided"}`,
        metadata: JSON.stringify(claimMetadata),
      }));
    }
    let agentId: number | null = null;
    if (caller.isOwner) {
      const [agent] = rows(await tx.execute(sql`SELECT id FROM agents WHERE name = ${caller.name} LIMIT 1`));
      if (agent) agentId = Number(agent.id);
    } else {
      const parsed = parseInt(caller.id, 10);
      if (!Number.isNaN(parsed)) agentId = parsed;
    }
    await tx.update(conversationSessions).set({ assignedAgentName: caller.name,
      ...(agentId !== null ? { assignedAgentId: agentId } : {}) }).where(sql`${conversationSessions.id} = ${sessionId}`);
    return { success: true as const, claimedBy: caller.name, claimedAt, messageId, sessionId };
  });
}
