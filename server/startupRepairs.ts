import { sql } from "drizzle-orm";

type RepairDatabase = {
  execute(query: unknown): Promise<unknown>;
};

/**
 * Retained operational repair. It is intentionally not invoked from normal
 * application startup; a future explicit maintenance trigger will own it.
 */
export async function runConfirmationCallRecoveryRepair(db: RepairDatabase): Promise<number> {
  try {
    const [resetResult] = await db.execute(sql.raw(
      `UPDATE confirmation_calls SET status = 'pending' WHERE status = 'fired'`,
    )) as any;
    const affected = resetResult?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[Repair] Reset ${affected} stuck fired confirmation_calls rows to pending`);
    }
    return affected;
  } catch (error) {
    console.error('[Repair] Failed to reset fired confirmation_calls:', error);
    return 0;
  }
}

/**
 * Retained operational repair for historical Madison SMS-card rows. It is
 * intentionally not invoked from normal application startup.
 */
export async function runOpsSmsCardDedupRepair(db: RepairDatabase): Promise<void> {
  try {
    await db.execute(sql.raw(`START TRANSACTION`));

    const [s0] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages
       SET activeDedupKey = NULL
       WHERE quickAction = 'madison_sms_draft'
         AND cardStatus != 'active'
         AND activeDedupKey IS NOT NULL`,
    )) as any;
    console.log(`[Repair] Stage 0: cleared stale keys from ${s0?.affectedRows ?? 0} non-active rows`);

    const [s1a] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages AS keyed
       JOIN (
         SELECT keyed_row.id AS keyed_id, null_row.body AS null_body,
                null_row.metadata AS null_meta, null_row.lastActivityAt AS null_lat
         FROM ops_chat_messages AS keyed_row
         JOIN ops_chat_messages AS null_row
           ON null_row.quickAction = 'madison_sms_draft'
          AND null_row.cardStatus = 'active'
          AND null_row.activeDedupKey IS NULL
          AND null_row.sessionId = keyed_row.sessionId
          AND null_row.id > keyed_row.id
         WHERE keyed_row.quickAction = 'madison_sms_draft'
           AND keyed_row.cardStatus = 'active'
           AND keyed_row.activeDedupKey IS NOT NULL
       ) AS src ON keyed.id = src.keyed_id
       SET keyed.body = src.null_body,
           keyed.metadata = src.null_meta,
           keyed.lastActivityAt = GREATEST(COALESCE(keyed.lastActivityAt, 0), COALESCE(src.null_lat, 0))`,
    )) as any;
    console.log(`[Repair] Stage 1a: promoted fresher content onto ${s1a?.affectedRows ?? 0} keyed rows`);

    const [s1b] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages AS orphan
       JOIN ops_chat_messages AS keyed
         ON keyed.quickAction = 'madison_sms_draft'
        AND keyed.cardStatus = 'active'
        AND keyed.activeDedupKey IS NOT NULL
        AND keyed.sessionId = orphan.sessionId
       SET orphan.cardStatus = 'dismissed', orphan.activeDedupKey = NULL
       WHERE orphan.quickAction = 'madison_sms_draft'
         AND orphan.cardStatus = 'active'
         AND orphan.activeDedupKey IS NULL`,
    )) as any;
    console.log(`[Repair] Stage 1b: dismissed ${s1b?.affectedRows ?? 0} null-key orphans with keyed siblings`);

    const [s2] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages AS old_card
       JOIN (
         SELECT sessionId, MAX(id) AS keep_id
         FROM ops_chat_messages
         WHERE quickAction = 'madison_sms_draft'
           AND cardStatus = 'active'
           AND activeDedupKey IS NULL
           AND sessionId IS NOT NULL
         GROUP BY sessionId HAVING COUNT(*) > 1
       ) AS newest ON old_card.sessionId = newest.sessionId
       SET old_card.cardStatus = 'dismissed', old_card.activeDedupKey = NULL
       WHERE old_card.quickAction = 'madison_sms_draft'
         AND old_card.cardStatus = 'active'
         AND old_card.activeDedupKey IS NULL
         AND old_card.id != newest.keep_id`,
    )) as any;
    console.log(`[Repair] Stage 2: dismissed ${s2?.affectedRows ?? 0} extra null-key duplicates`);

    const [s2b] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages
       SET cardStatus = 'dismissed', activeDedupKey = NULL
       WHERE quickAction = 'madison_sms_draft'
         AND cardStatus = 'active'
         AND sessionId IS NULL`,
    )) as any;
    console.log(`[Repair] Stage 2b: dismissed ${s2b?.affectedRows ?? 0} active rows with null sessionId`);

    const [s3] = await db.execute(sql.raw(
      `UPDATE ops_chat_messages
       SET activeDedupKey = CONCAT('madison_sms_draft:', sessionId)
       WHERE quickAction = 'madison_sms_draft'
         AND cardStatus = 'active'
         AND activeDedupKey IS NULL
         AND sessionId IS NOT NULL`,
    )) as any;
    console.log(`[Repair] Stage 3: backfilled keys on ${s3?.affectedRows ?? 0} active rows`);

    const [dupRows] = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT sessionId FROM ops_chat_messages
         WHERE quickAction = 'madison_sms_draft' AND cardStatus = 'active'
         GROUP BY sessionId HAVING COUNT(*) > 1
       ) AS dups`,
    )) as any;
    const [nullRows] = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM ops_chat_messages
       WHERE quickAction = 'madison_sms_draft' AND cardStatus = 'active' AND activeDedupKey IS NULL`,
    )) as any;
    const [malformedRows] = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM ops_chat_messages
       WHERE quickAction = 'madison_sms_draft' AND cardStatus = 'active'
         AND activeDedupKey IS NOT NULL
         AND activeDedupKey NOT LIKE 'madison_sms_draft:%'`,
    )) as any;

    const duplicates = Number((dupRows as any[])[0]?.cnt ?? 0);
    const nullKeys = Number((nullRows as any[])[0]?.cnt ?? 0);
    const malformedKeys = Number((malformedRows as any[])[0]?.cnt ?? 0);
    if (duplicates > 0 || nullKeys > 0 || malformedKeys > 0) {
      await db.execute(sql.raw(`ROLLBACK`));
      throw new Error(`[Repair] dedup verification failed: dupSessions=${duplicates}, nullKeys=${nullKeys}, malformedKeys=${malformedKeys}`);
    }

    await db.execute(sql.raw(`COMMIT`));
    console.log('[Repair] ops_chat_messages dedup cleanup: COMMITTED — all invariants satisfied');
  } catch (error) {
    try {
      await db.execute(sql.raw(`ROLLBACK`));
    } catch {
      // A failed or closed transaction has nothing remaining to roll back.
    }
    throw error;
  }
}
