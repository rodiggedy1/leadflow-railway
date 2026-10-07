#!/usr/bin/env node
/**
 * Read-only Madison/Shadow trace for Railway MySQL.
 *
 * This script never INSERTs, UPDATEs, DELETEs, or touches cleaner_jobs.
 * It traces:
 *   ops_chat_messages card -> madison_sms_drafts -> madison_message_understanding
 *
 * Usage:
 *   DATABASE_URL='mysql://...' node scripts/query-madison-shadow.mjs --draft-id 3060891
 *   DATABASE_URL='mysql://...' node scripts/query-madison-shadow.mjs --text 'cancel my booking'
 *   railway run node scripts/query-madison-shadow.mjs --text 'cancel my booking'
 */

import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const draftIdArg = getArg("--draft-id");
const textArg = getArg("--text") ?? "cancel my booking";
const limit = Math.min(Math.max(Number(getArg("--limit") ?? 25), 1), 100);
const jsonOutput = args.includes("--json");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Use Railway's environment, for example: railway run node scripts/query-madison-shadow.mjs --text 'cancel my booking'");
  process.exit(2);
}

// One connection is enough for this read-only trace; no mutation statements exist in this file.
const pool = mysql.createPool(process.env.DATABASE_URL);

const cleanError = (error) => ({
  code: error?.code ?? null,
  errno: error?.errno ?? null,
  sqlState: error?.sqlState ?? null,
  message: error?.message ?? String(error),
});

const parseMetadata = (metadata) => {
  if (!metadata) return { value: null, error: null };
  try {
    return { value: JSON.parse(metadata), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
};

const asNumber = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const print = (label, value) => {
  if (jsonOutput) return;
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

try {
  const connection = await pool.getConnection();
  try {
    const [databaseRows] = await connection.query("SELECT DATABASE() AS databaseName");
    const [versionRows] = await connection.query("SELECT @@hostname AS host, VERSION() AS version");

    let cards;
    if (draftIdArg) {
      const [rows] = await connection.query(
        `SELECT id, authorName, authorRole, body, metadata, sessionId, lastActivityAt, cardStatus, createdAt
           FROM ops_chat_messages
          WHERE authorRole = 'agent'
            AND metadata LIKE ?
          ORDER BY createdAt DESC
          LIMIT ?`,
        [`%${draftIdArg}%`, limit]
      );
      cards = rows;
    } else {
      const [rows] = await connection.query(
        `SELECT id, authorName, authorRole, body, metadata, sessionId, lastActivityAt, cardStatus, createdAt
           FROM ops_chat_messages
          WHERE authorRole = 'agent'
            AND body LIKE ?
          ORDER BY createdAt DESC
          LIMIT ?`,
        [`%${textArg}%`, limit]
      );
      cards = rows;
    }

    const parsedCards = cards.map((card) => {
      const metadata = parseMetadata(card.metadata);
      return {
        ...card,
        parsedMetadata: metadata.value,
        metadataParseError: metadata.error,
        metadataDraftId: asNumber(metadata.value?.draftId),
      };
    });

    const selectedDraftIds = new Set();
    if (draftIdArg && asNumber(draftIdArg)) selectedDraftIds.add(asNumber(draftIdArg));
    for (const card of parsedCards) {
      if (card.metadataDraftId) selectedDraftIds.add(card.metadataDraftId);
    }

    let drafts = [];
    if (selectedDraftIds.size > 0) {
      const ids = [...selectedDraftIds];
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await connection.query(
        `SELECT id, inboundOpenPhoneId, sessionId, fromPhone, senderName, senderType,
                status, messageType, intent, capability, originalMessage, intentSummary,
                generatedDraft, approvedText, errorStage, errorCode, errorMessage,
                createdAt, updatedAt
           FROM madison_sms_drafts
          WHERE id IN (${placeholders})
          ORDER BY createdAt DESC`,
        ids
      );
      drafts = rows;
    } else {
      const [rows] = await connection.query(
        `SELECT id, inboundOpenPhoneId, sessionId, fromPhone, senderName, senderType,
                status, messageType, intent, capability, originalMessage, intentSummary,
                generatedDraft, approvedText, errorStage, errorCode, errorMessage,
                createdAt, updatedAt
           FROM madison_sms_drafts
          WHERE originalMessage LIKE ?
          ORDER BY createdAt DESC
          LIMIT ?`,
        [`%${textArg}%`, limit]
      );
      drafts = rows;
    }

    const draftIds = drafts.map((draft) => draft.id).filter(Boolean);
    let shadowsByDraft = [];
    let shadowsBySource = [];
    if (draftIds.length > 0) {
      const placeholders = draftIds.map(() => "?").join(",");
      const [rows] = await connection.query(
        `SELECT id, sourceMessageId, draftId, sessionId, inboundText,
                primaryCategory, categories, mission, missionState, nextBestAction,
                confidence, knownFacts, missingFacts, resolvedCustomerId,
                resolvedBookingId, model, classifierVersion, createdAt, updatedAt
           FROM madison_message_understanding
          WHERE draftId IN (${placeholders})
          ORDER BY createdAt DESC`,
        draftIds
      );
      shadowsByDraft = rows;

      const sourceIds = drafts.map((draft) => draft.inboundOpenPhoneId).filter(Boolean);
      if (sourceIds.length > 0) {
        const sourcePlaceholders = sourceIds.map(() => "?").join(",");
        const [sourceRows] = await connection.query(
          `SELECT id, sourceMessageId, draftId, sessionId, inboundText,
                  primaryCategory, categories, mission, missionState, nextBestAction,
                  confidence, knownFacts, missingFacts, resolvedCustomerId,
                  resolvedBookingId, model, classifierVersion, createdAt, updatedAt
             FROM madison_message_understanding
            WHERE sourceMessageId IN (${sourcePlaceholders})
            ORDER BY createdAt DESC`,
          sourceIds
        );
        shadowsBySource = sourceRows;
      }
    }

    const result = {
      readOnly: true,
      queriedAt: new Date().toISOString(),
      database: databaseRows[0] ?? null,
      server: versionRows[0] ?? null,
      search: { draftId: draftIdArg ? Number(draftIdArg) : null, text: textArg, limit },
      cards: parsedCards,
      drafts,
      shadowsByDraft,
      shadowsBySource,
      interpretation: {
        cardCount: parsedCards.length,
        draftCount: drafts.length,
        shadowCountByDraft: shadowsByDraft.length,
        shadowCountBySource: shadowsBySource.length,
        nextCheck:
          drafts.length === 0
            ? "No Madison draft matched the search. Verify the message text, environment, or deployment route."
            : shadowsByDraft.length > 0 || shadowsBySource.length > 0
              ? "A Shadow row exists. Compare draftId/sourceMessageId and the UI query input."
              : "No Shadow row exists by either draftId or sourceMessageId. Use draft.errorStage/errorCode/errorMessage and the running server commit to locate the runtime boundary.",
      },
    };

    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else {
      print("DATABASE", result.database);
      print("SERVER", result.server);
      print("CARDS", result.cards);
      print("MADISON DRAFTS", result.drafts);
      print("SHADOW ROWS BY draftId", result.shadowsByDraft);
      print("SHADOW ROWS BY sourceMessageId", result.shadowsBySource);
      print("INTERPRETATION", result.interpretation);
    }
  } finally {
    connection.release();
  }
} catch (error) {
  console.error("Read-only Railway query failed:", cleanError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
