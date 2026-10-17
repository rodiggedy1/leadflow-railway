import { opsChatProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

type NativeDetail = { question?: string; answer?: string };
type NativePayload = {
  data?: {
    negotiationID?: string;
    createdAt?: string;
    status?: string;
    leadPrice?: string;
    leadPriceBreakdown?: unknown;
    estimate?: unknown;
    requestReviewLink?: string;
    refundRequestLink?: string;
    customer?: { customerID?: string; firstName?: string; lastName?: string; displayName?: string; phone?: string };
    request?: {
      requestID?: string;
      description?: string;
      category?: { categoryID?: string; name?: string };
      location?: { address1?: string; address2?: string; city?: string; state?: string; zipCode?: string };
      proposedTimes?: Array<{ start?: string; end?: string }>;
      travelPreferences?: string[];
      details?: NativeDetail[];
      attachments?: unknown[];
    };
  };
};

function answer(details: NativeDetail[], pattern: RegExp): string | null {
  return details.find((detail) => pattern.test(detail.question ?? ""))?.answer?.trim() || null;
}

function numberFromHomeSize(value: string | null, unit: "bedrooms" | "bathrooms"): string | null {
  if (!value) return null;
  const match = value.match(new RegExp(`(\\d+)\\s*${unit === "bedrooms" ? "bed" : "bath"}`, "i"));
  return match?.[1] ?? null;
}

export const thumbtackLeadRouter = router({
  listNative: opsChatProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = (await db.execute(sql`
      SELECT raw_payload
      FROM webhook_events
      WHERE source = ${"thumbtack"} AND event_type = ${"NegotiationCreatedV4"}
      ORDER BY id DESC
      LIMIT 100
    `) as any)[0] as Array<{ raw_payload: string }>;
    const seen = new Set<string>();
    const leads: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      let payload: NativePayload;
      try { payload = JSON.parse(row.raw_payload) as NativePayload; } catch { continue; }
      const data = payload.data;
      const negotiationId = data?.negotiationID?.trim();
      if (!negotiationId || seen.has(negotiationId)) continue;
      seen.add(negotiationId);
      const customer = data?.customer ?? {};
      const request = data?.request ?? {};
      const details = request.details ?? [];
      const location = request.location;
      const homeSize = answer(details, /home size|number of bedrooms|number of bathrooms/i);
      const phone = customer.phone?.trim() || null;
      const sessionRows = phone
        ? (await db.execute(sql`
            SELECT id FROM conversation_sessions
            WHERE leadPhone LIKE ${`%${phone.replace(/[^0-9]/g, "").slice(-10)}`}
              AND leadSource IN (${"thumbtack"}, ${"thumbtack-sms"})
            ORDER BY id DESC LIMIT 1
          `) as any)[0] as Array<{ id: number }>
        : [];
      leads.push({
        negotiationId,
        requestId: request.requestID ?? null,
        customerId: customer.customerID ?? null,
        name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.displayName || "Thumbtack lead",
        phone,
        location: [location?.city, location?.state, location?.zipCode].filter(Boolean).join(", ") || null,
        address: [location?.address1, location?.address2].filter(Boolean).join(", ") || null,
        category: request.category?.name ?? null,
        categoryId: request.category?.categoryID ?? null,
        serviceType: answer(details, /service type|cleaning type/i) ?? request.category?.name ?? null,
        requestedDates: answer(details, /schedul/i),
        description: request.description ?? answer(details, /anything else|description|special/i),
        homeSize,
        bedrooms: numberFromHomeSize(homeSize, "bedrooms") ?? answer(details, /bedroom/i),
        bathrooms: numberFromHomeSize(homeSize, "bathrooms") ?? answer(details, /bathroom/i),
        frequency: answer(details, /frequency/i),
        pets: answer(details, /pet/i),
        extras: [answer(details, /extra request/i), answer(details, /anything else/i)].filter(Boolean),
        travelPreferences: request.travelPreferences ?? [],
        nativeDetails: details,
        proposedTimes: request.proposedTimes ?? [],
        status: data?.status ?? null,
        leadPrice: data?.leadPrice ?? null,
        leadPriceBreakdown: data?.leadPriceBreakdown ?? null,
        estimate: data?.estimate ?? null,
        createdAt: data?.createdAt ?? null,
        requestReviewLink: data?.requestReviewLink ?? null,
        refundRequestLink: data?.refundRequestLink ?? null,
        attachments: request.attachments ?? [],
        sessionId: sessionRows[0]?.id ?? null,
      });
    }
    return leads;
  }),
});
