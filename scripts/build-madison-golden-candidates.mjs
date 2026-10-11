#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const OUTPUT = path.resolve("golden-dataset/candidates.json");
const SAMPLE_SIZE = 50;
const DEV_SIZE = 40;

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function anonymize(text, senderName) {
  let value = String(text ?? "");
  const replacements = [];
  const replace = (pattern, token, label) => {
    const next = value.replace(pattern, token);
    if (next !== value) replacements.push(label);
    value = next;
  };
  replace(/https?:\/\/\S+/gi, "<URL>", "url");
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<EMAIL>", "email");
  replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-])\d{3}[\s.-]\d{4}/g, "<PHONE>", "phone");
  if (senderName && senderName.trim().length >= 2) {
    const escaped = senderName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    replace(new RegExp(escaped, "gi"), "<CUSTOMER_NAME>", "sender-name");
  }
  return { value: value.trim(), replacements };
}

function parseHistory(raw, currentMessageId, currentTimestamp) {
  try {
    const messages = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(messages)) return [];
    const cutoff = Number(currentTimestamp);
    const currentIndex = messages.findIndex(message => message?.opMsgId === currentMessageId);
    const priorMessages = currentIndex >= 0
      ? messages.slice(0, currentIndex)
      : Number.isFinite(cutoff)
        ? messages.filter(message => Number(message?.ts) < cutoff)
        : [];
    return priorMessages
      .map((message) => ({
        role: message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null,
        content: typeof message?.content === "string" ? message.content.trim() : "",
        timestamp: Number(message?.ts),
      }))
      .filter((message) => message.role && message.content && Number.isFinite(message.timestamp))
      .slice(-4)
      .map((message) => ({
        role: message.role,
        content: anonymize(message.content).value,
        actorRole: message.role === "assistant" ? "madison" : "customer",
        sourceMessageId: message.opMsgId ?? null,
      }));
  } catch {
    return [];
  }
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.query(`
    SELECT d.id, d.inboundOpenPhoneId, d.sessionId, d.senderName, d.originalMessage,
           d.createdAt, d.messageType, d.status, s.messageHistory
    FROM madison_sms_drafts d
    LEFT JOIN conversation_sessions s ON s.id = d.sessionId
    WHERE d.originalMessage IS NOT NULL AND TRIM(d.originalMessage) <> ''
    ORDER BY d.createdAt DESC
    LIMIT 1000
  `);

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.messageType ?? "UNKNOWN"}:${row.status ?? "UNKNOWN"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const selected = [];
  while (selected.length < SAMPLE_SIZE && groups.size > 0) {
    for (const [key, group] of groups) {
      const row = group.shift();
      if (row) selected.push(row);
      if (group.length === 0) groups.delete(key);
      if (selected.length === SAMPLE_SIZE) break;
    }
  }

  const scenarios = selected.map((row, index) => {
    const inbound = anonymize(row.originalMessage, row.senderName);
    const context = parseHistory(row.messageHistory, row.inboundOpenPhoneId, row.createdAt);
    return {
      caseId: `MADISON-${String(index + 1).padStart(3, "0")}`,
      split: index < DEV_SIZE ? "development" : "held_out",
      approvalState: "candidate_unreviewed",
      sourceMessageIdHash: hash(row.inboundOpenPhoneId),
      sourceDraftId: Number(row.id),
      sourceCapturedAt: new Date(row.createdAt).toISOString(),
      currentInboundMessage: inbound.value,
      currentActorRole: "customer",
      currentSourceMessageIdHash: hash(row.inboundOpenPhoneId),
      priorConversationContext: context,
      sourceMetadataForLabeler: {
        observedMessageType: row.messageType ?? null,
        observedDraftStatus: row.status ?? null,
        sessionIdHash: hash(row.sessionId),
      },
      expected: {
        intentCategory: null,
        speechAct: null,
        mission: null,
        facts: null,
        extractionCompleteness: null,
        taskCompleteness: null,
        missingInformation: null,
        conflictingInformation: null,
        targetResolutionState: null,
        replyReadiness: null,
        actionReadiness: null,
        forbiddenOperationalActions: null,
        severity: null,
      },
      labeling: {
        labelerId: null,
        labeledAt: null,
        reviewNotes: null,
      },
      anonymization: {
        version: "regex-v1-plus-sender-name",
        replacements: Array.from(new Set([...inbound.replacements, ...context.flatMap(() => [])])),
        piiReviewRequired: true,
      },
    };
  });

  const dataset = {
    datasetVersion: "madison-golden-v1",
    createdAt: new Date().toISOString(),
    approvalPolicy: "human_approval_required",
    provenance: {
      source: "read_only_madison_sms_drafts",
      labels: "unapproved_until_human_review",
      generatedText: "none",
    },
    scenarios,
  };
  await fs.writeFile(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: OUTPUT, scenarioCount: scenarios.length, developmentCount: scenarios.filter((s) => s.split === "development").length, heldOutCount: scenarios.filter((s) => s.split === "held_out").length, labelsApproved: scenarios.filter((s) => s.approvalState === "human_approved").length }, null, 2));
} finally {
  await db.end();
}
