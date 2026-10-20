import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { normalizePhone as normalizePhoneStrict } from "./utils/phone";

const BRIDGE_PATH = "/api/twilio/lead-bridge";
const CONFIRMATION_TIMEOUT_SECONDS = 12;
const RECONCILIATION_WINDOW_MINUTES = 5;
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

type BridgeRow = {
  id: number;
  bridgeId: string;
  sessionId: number | null;
  leadPhone: string;
  leadName: string;
  state: string;
  officeCallSid: string | null;
  customerCallSid: string | null;
  conferenceSid: string | null;
  customerCallStartedAt: Date | string | null;
  createdAt: Date | string;
};

function twilioClient() {
  if (!ENV.twilioAccountSid || !ENV.twilioAuthToken) {
    throw new Error("Twilio bridge credentials are not configured");
  }
  return twilio(ENV.twilioAccountSid, ENV.twilioAuthToken);
}

function callbackBaseUrl(): string {
  const base = ENV.twilioBridgeCallbackBaseUrl.trim().replace(/\/$/, "");
  if (!base) throw new Error("TWILIO_BRIDGE_CALLBACK_BASE_URL is not configured");
  return base;
}

function callbackUrl(path: string, bridgeId: string): string {
  return `${callbackBaseUrl()}${BRIDGE_PATH}/${path}?bridgeId=${encodeURIComponent(bridgeId)}`;
}

function requestCallbackUrl(req: Request, path: string, bridgeId: string): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}${BRIDGE_PATH}/${path}?bridgeId=${encodeURIComponent(bridgeId)}`;
}

function verifyTwilioSignature(req: Request, res: Response): boolean {
  const signature = req.header("x-twilio-signature");
  if (!signature || !ENV.twilioAuthToken) {
    res.status(403).send("Invalid callback signature");
    return false;
  }
  const configuredUrl = callbackBaseUrl();
  const path = req.path.replace(/^\/api\/twilio\/lead-bridge/, "");
  const bridgeId = typeof req.query.bridgeId === "string" ? req.query.bridgeId : "";
  const url = `${configuredUrl}${BRIDGE_PATH}${path}?bridgeId=${encodeURIComponent(bridgeId)}`;
  const valid = twilio.validateRequest(ENV.twilioAuthToken, signature, url, req.body as Record<string, string>);
  if (!valid) {
    res.status(403).send("Invalid callback signature");
    return false;
  }
  return true;
}

function twimlResponse(res: Response, voice: twilio.twiml.VoiceResponse): void {
  res.type("text/xml").status(200).send(voice.toString());
}

function safeProviderMessage(error: unknown): string {
  if (!(error instanceof Error)) return "provider request failed";
  const code = typeof (error as { code?: unknown }).code === "string" || typeof (error as { code?: unknown }).code === "number"
    ? `Twilio ${(error as { code: string | number }).code}: `
    : "";
  return `${code}${error.message}`.slice(0, 500);
}

export async function startTwilioLeadBridge(input: { leadPhone: string; leadName: string; sessionId?: number | null }) {
  const leadPhone = normalizePhoneStrict(input.leadPhone);
  const leadName = input.leadName.trim() || "Lead";
  const sessionId = input.sessionId ?? null;
  if (!leadPhone) throw new Error("A valid lead phone number is required");
  if (!ENV.twilioBridgeFromNumber) throw new Error("Twilio bridge caller ID is not configured");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const bridgeId = randomUUID();
  const idempotencyKey = randomUUID();
  await db.execute(sql`INSERT INTO twilio_lead_bridges (bridgeId, idempotencyKey, sessionId, leadPhone, leadName, state, createdAt, updatedAt) VALUES (${bridgeId}, ${idempotencyKey}, ${sessionId}, ${leadPhone}, ${leadName}, 'office_call_starting', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`);
  try {
    const call = await twilioClient().calls.create({
      to: ENV.twilioBridgeOfficeNumber,
      from: ENV.twilioBridgeFromNumber,
      url: callbackUrl("office-answer", bridgeId),
      statusCallback: callbackUrl("status", bridgeId),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeout: 25,
    });
    await updateBridge(bridgeId, { state: "office_ringing", officeCallSid: call.sid }, ["office_call_starting"]);
    return { success: true, bridgeId, officeCallSid: call.sid, state: "office_ringing" as const };
  } catch (error) {
    const providerMessage = safeProviderMessage(error);
    await updateBridge(bridgeId, { state: "failed", failureCode: "office_call_create_failed", failureMessage: providerMessage }, ["office_call_starting"]);
    throw new Error(providerMessage);
  }
}

async function getBridge(bridgeId: string): Promise<BridgeRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.execute(sql`SELECT id, bridgeId, sessionId, leadPhone, leadName, state, officeCallSid, customerCallSid, conferenceSid, customerCallStartedAt, createdAt FROM twilio_lead_bridges WHERE bridgeId = ${bridgeId} LIMIT 1`) as unknown as [BridgeRow[], unknown];
  return rows[0]?.[0] ?? null;
}

async function updateBridge(bridgeId: string, fields: Record<string, unknown>, fromStates?: string[]): Promise<boolean> {
  const db = await getDb();
  if (!db || Object.keys(fields).length === 0) return false;
  const assignments = Object.keys(fields).map((key) => `\`${key}\` = ?`).join(", ");
  const values = Object.values(fields);
  const assignmentSql = Object.keys(fields).map((key, index) => sql`${sql.raw(`\`${key}\``)} = ${values[index]}`);
  const stateClause = fromStates?.length ? sql` AND state IN (${sql.join(fromStates.map((state) => sql`${state}`), sql`, `)})` : sql``;
  const result = await db.execute(sql`UPDATE twilio_lead_bridges SET ${sql.join(assignmentSql, sql`, `)}, updatedAt = CURRENT_TIMESTAMP(3) WHERE bridgeId = ${bridgeId}${stateClause}`) as any;
  return Number(result?.[0]?.affectedRows ?? 0) === 1;
}

async function startCustomerLeg(req: Request, bridgeId: string): Promise<void> {
  const bridge = await getBridge(bridgeId);
  if (!bridge || bridge.state !== "office_confirmed") return;
  const claimed = await updateBridge(bridgeId, {
    state: "customer_call_starting",
    customerCallStartedAt: new Date(),
  }, ["office_confirmed"]);
  if (!claimed) return;

  try {
    const call = await twilioClient().calls.create({
      to: bridge.leadPhone,
      from: ENV.twilioBridgeFromNumber,
      url: requestCallbackUrl(req, "customer-answer", bridgeId),
      statusCallback: requestCallbackUrl(req, "status", bridgeId),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeout: 30,
    });
    await updateBridge(bridgeId, { customerCallSid: call.sid }, ["customer_call_starting"]);
  } catch (error) {
    await updateBridge(bridgeId, { state: "failed", failureCode: "customer_call_create_failed", failureMessage: safeProviderMessage(error) }, ["customer_call_starting"]);
    throw error;
  }
}

async function cancelCustomerLegIfOfficeEnded(bridgeId: string): Promise<void> {
  const bridge = await getBridge(bridgeId);
  if (!bridge?.customerCallSid || !["awaiting_confirmation", "customer_call_starting", "customer_ringing", "failed"].includes(bridge.state)) return;
  const claimed = await updateBridge(bridgeId, { state: "cancelled", failureCode: "office_hung_up_before_connection" }, ["awaiting_confirmation", "customer_call_starting", "customer_ringing", "failed"]);
  if (!claimed) return;
  try {
    await twilioClient().calls(bridge.customerCallSid).update({ status: "completed" });
  } catch (error) {
    console.error("[TwilioLeadBridge] customer-leg cleanup failed", { bridgeId, message: safeProviderMessage(error) });
  }
}

function requireTestSecret(req: Request, res: Response): boolean {
  if (!ENV.twilioBridgeTestSecret || req.header("x-leadflow-bridge-secret") !== ENV.twilioBridgeTestSecret) {
    res.status(403).json({ error: "Bridge test authorization required" });
    return false;
  }
  return true;
}

export function registerTwilioLeadBridgeRoutes(app: Express): void {
  app.post(`${BRIDGE_PATH}/start`, async (req, res) => {
    if (!requireTestSecret(req, res)) return;
    const leadPhone = normalizePhoneStrict(String(req.body?.leadPhone ?? ""));
    const leadName = String(req.body?.leadName ?? "Lead").trim() || "Lead";
    const sessionId = Number.isInteger(req.body?.sessionId) ? Number(req.body.sessionId) : null;
    if (!leadPhone) return res.status(400).json({ error: "A valid leadPhone is required" });
    if (!ENV.twilioBridgeFromNumber) return res.status(500).json({ error: "Twilio bridge caller ID is not configured" });
    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    const bridgeId = randomUUID();
    const idempotencyKey = randomUUID();
    await db.execute(sql`INSERT INTO twilio_lead_bridges (bridgeId, idempotencyKey, sessionId, leadPhone, leadName, state, createdAt, updatedAt) VALUES (${bridgeId}, ${idempotencyKey}, ${sessionId}, ${leadPhone}, ${leadName}, 'office_call_starting', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`);
    try {
      const call = await twilioClient().calls.create({
        to: ENV.twilioBridgeOfficeNumber,
        from: ENV.twilioBridgeFromNumber,
        url: requestCallbackUrl(req, "office-answer", bridgeId),
        statusCallback: requestCallbackUrl(req, "status", bridgeId),
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
        timeout: 25,
      });
      await updateBridge(bridgeId, { state: "office_ringing", officeCallSid: call.sid }, ["office_call_starting"]);
      return res.json({ success: true, bridgeId, officeCallSid: call.sid, state: "office_ringing" });
    } catch (error) {
      await updateBridge(bridgeId, { state: "failed", failureCode: "office_call_create_failed", failureMessage: safeProviderMessage(error) }, ["office_call_starting"]);
      return res.status(502).json({ error: "The office call could not be started", bridgeId });
    }
  });

  app.post(`${BRIDGE_PATH}/office-answer`, async (req, res) => {
    if (!verifyTwilioSignature(req, res)) return;
    const bridgeId = String(req.query.bridgeId ?? "");
    const bridge = await getBridge(bridgeId);
    if (!bridge || TERMINAL_STATES.has(bridge.state)) return res.status(404).send("Unknown bridge");
    await updateBridge(bridgeId, { state: "awaiting_confirmation", officeCallSid: req.body.CallSid ?? bridge.officeCallSid }, ["office_ringing", "office_answered", "awaiting_confirmation"]);
    const voice = new twilio.twiml.VoiceResponse();
    const gather = voice.gather({ numDigits: 1, timeout: CONFIRMATION_TIMEOUT_SECONDS, action: callbackUrl("confirm-office", bridgeId), method: "POST" });
    gather.say("Press 1 to connect to this lead. Press any other key or wait to cancel.");
    voice.say("No confirmation received. The call will now end.");
    voice.hangup();
    return twimlResponse(res, voice);
  });

  app.post(`${BRIDGE_PATH}/confirm-office`, async (req, res) => {
    if (!verifyTwilioSignature(req, res)) return;
    const bridgeId = String(req.query.bridgeId ?? "");
    if (String(req.body?.Digits ?? "") !== "1") {
      await updateBridge(bridgeId, { state: "cancelled", failureCode: "office_confirmation_invalid_or_timeout" }, ["awaiting_confirmation"]);
      const voice = new twilio.twiml.VoiceResponse();
      voice.say("No valid confirmation was received. Goodbye.");
      voice.hangup();
      return twimlResponse(res, voice);
    }
    const confirmed = await updateBridge(bridgeId, { state: "office_confirmed", confirmedAt: new Date() }, ["awaiting_confirmation"]);
    if (!confirmed) {
      const voice = new twilio.twiml.VoiceResponse();
      voice.say("This call is no longer available. Goodbye.");
      voice.hangup();
      return twimlResponse(res, voice);
    }
    try {
      await startCustomerLeg(req, bridgeId);
    } catch {
      const voice = new twilio.twiml.VoiceResponse();
      voice.say("We could not connect the lead. Goodbye.");
      voice.hangup();
      return twimlResponse(res, voice);
    }
    const voice = new twilio.twiml.VoiceResponse();
    voice.say("Connecting you to the lead now.");
    const dial = voice.dial();
    dial.conference({ statusCallback: requestCallbackUrl(req, "conference-status", bridgeId), statusCallbackMethod: "POST" }, bridgeId);
    return twimlResponse(res, voice);
  });

  app.post(`${BRIDGE_PATH}/customer-answer`, async (req, res) => {
    if (!verifyTwilioSignature(req, res)) return;
    const bridgeId = String(req.query.bridgeId ?? "");
    const bridge = await getBridge(bridgeId);
    if (!bridge || ["failed", "cancelled", "completed"].includes(bridge.state)) return res.status(404).send("Unknown bridge");
    await updateBridge(bridgeId, { state: "connected", customerCallSid: req.body.CallSid ?? bridge.customerCallSid }, ["customer_call_starting", "customer_ringing", "connected"]);
    const voice = new twilio.twiml.VoiceResponse();
    const dial = voice.dial();
    dial.conference({ statusCallback: requestCallbackUrl(req, "conference-status", bridgeId), statusCallbackMethod: "POST" }, bridgeId);
    return twimlResponse(res, voice);
  });

  app.post(`${BRIDGE_PATH}/status`, async (req, res) => {
    if (!verifyTwilioSignature(req, res)) return;
    const bridgeId = String(req.query.bridgeId ?? "");
    const callSid = String(req.body?.CallSid ?? "");
    const callStatus = String(req.body?.CallStatus ?? "");
    const bridge = await getBridge(bridgeId);
    if (!bridge) return res.status(404).send("Unknown bridge");
    const isOffice = callSid && callSid === bridge.officeCallSid;
    const isCustomer = callSid && (callSid === bridge.customerCallSid || (
      !bridge.customerCallSid &&
      ["customer_call_starting", "customer_ringing"].includes(bridge.state) &&
      String(req.body?.To ?? "") === bridge.leadPhone
    ));
    if (isCustomer && !bridge.customerCallSid) {
      await updateBridge(bridgeId, { customerCallSid: callSid }, ["customer_call_starting", "customer_ringing"]);
    }
    if (isOffice && ["no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
      await updateBridge(bridgeId, { state: "failed", failureCode: `office_${callStatus}` }, ["office_call_starting", "office_ringing", "office_answered", "awaiting_confirmation"]);
      await cancelCustomerLegIfOfficeEnded(bridgeId);
    } else if (isOffice && callStatus === "completed") {
      await cancelCustomerLegIfOfficeEnded(bridgeId);
    } else if (isCustomer && ["no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
      await updateBridge(bridgeId, { state: "failed", failureCode: `customer_${callStatus}` }, ["customer_call_starting", "customer_ringing", "connected"]);
    } else if (isCustomer && callStatus === "ringing") {
      await updateBridge(bridgeId, { state: "customer_ringing" }, ["customer_call_starting"]);
    } else if (isCustomer && callStatus === "completed") {
      await updateBridge(bridgeId, { state: "completed", completedAt: new Date() }, ["customer_ringing", "connected", "customer_call_starting"]);
    }
    return res.status(204).send();
  });

  app.post(`${BRIDGE_PATH}/conference-status`, async (req, res) => {
    if (!verifyTwilioSignature(req, res)) return;
    const bridgeId = String(req.query.bridgeId ?? "");
    const status = String(req.body?.ConferenceStatus ?? "");
    const conferenceSid = String(req.body?.ConferenceSid ?? "");
    const fields: Record<string, unknown> = { conferenceSid };
    if (["completed", "failed"].includes(status)) {
      fields.state = status === "completed" ? "completed" : "failed";
      fields.completedAt = new Date();
    }
    await updateBridge(bridgeId, fields, ["connected", "customer_ringing", "completed", "failed"]);
    return res.status(204).send();
  });

  app.get(`${BRIDGE_PATH}/status/:bridgeId`, async (req, res) => {
    if (!requireTestSecret(req, res)) return;
    const bridge = await getBridge(req.params.bridgeId);
    if (!bridge) return res.status(404).json({ error: "Bridge not found" });
    return res.json(bridge);
  });

  app.post(`${BRIDGE_PATH}/reconcile/:bridgeId`, async (req, res) => {
    if (!requireTestSecret(req, res)) return;
    const bridge = await getBridge(req.params.bridgeId);
    if (!bridge) return res.status(404).json({ error: "Bridge not found" });
    if (bridge.customerCallSid || !["customer_call_starting", "customer_ringing"].includes(bridge.state)) return res.json({ bridge, reconciled: false });
    const createdAt = new Date(bridge.customerCallStartedAt ?? bridge.createdAt);
    const calls = await twilioClient().calls.list({ to: bridge.leadPhone, from: ENV.twilioBridgeFromNumber, startTimeAfter: new Date(createdAt.getTime() - 30_000), startTimeBefore: new Date(createdAt.getTime() + RECONCILIATION_WINDOW_MINUTES * 60_000), limit: 10 });
    if (calls.length === 1) {
      await updateBridge(bridge.bridgeId, { customerCallSid: calls[0].sid }, ["customer_call_starting", "customer_ringing"]);
      return res.json({ reconciled: true, customerCallSid: calls[0].sid, bridge: await getBridge(bridge.bridgeId) });
    }
    return res.json({ reconciled: false, candidates: calls.length, bridge });
  });
}
