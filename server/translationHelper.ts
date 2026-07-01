/**
 * translationHelper.ts
 *
 * Idempotent helper to translate a non-English callLog transcript to English.
 *
 * Rules:
 * - If transcriptLanguage is "en" or null → skip (no-op)
 * - If transcript is null/empty → skip
 * - If transcriptEnglish already exists → skip (idempotent)
 * - On translation failure → log error, leave transcriptEnglish null (retryable)
 * - NEVER modifies the original transcript column
 */

import { eq, and, isNull, isNotNull, ne } from "drizzle-orm";
import { callLog } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";

type Db = Awaited<ReturnType<typeof import("./db").getDb>>;

/**
 * Translate a single callLog row's transcript to English.
 * Safe to call multiple times — skips if already translated.
 */
export async function ensureEnglishTranscript(db: NonNullable<Db>, callLogId: number): Promise<string | null> {
  // Fetch the row
  const [row] = await db
    .select({
      id: callLog.id,
      transcript: callLog.transcript,
      transcriptLanguage: callLog.transcriptLanguage,
      transcriptEnglish: callLog.transcriptEnglish,
    })
    .from(callLog)
    .where(eq(callLog.id, callLogId))
    .limit(1)
    .catch(() => []);

  if (!row) {
    console.log(`[Translation] callLog id=${callLogId} not found — skipping`);
    return null;
  }

  // Skip if English or unknown language
  if (!row.transcriptLanguage || row.transcriptLanguage === "en") {
    console.log(`[Translation] callLog id=${callLogId} language=${row.transcriptLanguage ?? "null"} — skipping`);
    return null;
  }

  // Skip if no transcript
  if (!row.transcript || row.transcript.trim().length === 0) {
    console.log(`[Translation] callLog id=${callLogId} — transcript empty, skipping`);
    return null;
  }

  // Skip if already translated (idempotent) — return existing translation
  if (row.transcriptEnglish && row.transcriptEnglish.trim().length > 0) {
    console.log(`[Translation] callLog id=${callLogId} — transcriptEnglish already exists, skipping`);
    return row.transcriptEnglish;
  }

  console.log(`[Translation] Translating callLog id=${callLogId} (language=${row.transcriptLanguage}, ${row.transcript.length} chars)...`);

  try {
    const llmRes = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a professional translator. Translate the following call transcript to English. " +
            "Preserve speaker labels (AI: / User:) exactly as they appear. " +
            "Output only the translated transcript, nothing else.",
        },
        { role: "user", content: row.transcript },
      ],
    });

    const translatedText = (llmRes as any)?.choices?.[0]?.message?.content as string | undefined;

    if (!translatedText || translatedText.trim().length === 0) {
      console.error(`[Translation] LLM returned empty translation for callLog id=${callLogId}`);
      return null;
    }

    await db
      .update(callLog)
      .set({ transcriptEnglish: translatedText })
      .where(eq(callLog.id, callLogId));

    console.log(`[Translation] callLog id=${callLogId} — transcriptEnglish saved (${translatedText.length} chars)`);
    return translatedText;
  } catch (err) {
    console.error(`[Translation] Failed to translate callLog id=${callLogId}:`, err);
    // Leave transcriptEnglish null — retryable
    return null;
  }
}

/**
 * Backfill: translate all non-English callLog rows that have a transcript but no English translation.
 * Returns the number of rows processed.
 */
export async function backfillEnglishTranscripts(db: NonNullable<Db>): Promise<number> {
  const rows = await db
    .select({ id: callLog.id })
    .from(callLog)
    .where(
      and(
        isNotNull(callLog.transcriptLanguage),
        ne(callLog.transcriptLanguage, "en"),
        isNotNull(callLog.transcript),
        isNull(callLog.transcriptEnglish),
      )
    )
    .catch(() => []);

  console.log(`[Translation Backfill] Found ${rows.length} rows to translate`);

  for (const row of rows) {
    await ensureEnglishTranscript(db, row.id);
  }

  return rows.length;
}
