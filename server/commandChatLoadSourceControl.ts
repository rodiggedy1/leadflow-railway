/** Test-only: reverse ONLY the approved Command Chat load-speed hunks (2026-11-26), so the older
 * byte-for-byte source checks still compare every other byte with their baseline. */
const approved: Record<string, Array<[string, string]>> = {
 "server/voiceRouter.ts": [
  [
   "        outcome: z.string().optional(),\n        /** Command Chat: leave out transcripts and structured data (loaded on demand); adds hasTranscript. */\n        omitTranscripts: z.boolean().optional(),\n      })\n",
   "        outcome: z.string().optional(),\n      })\n"
  ],
  [
   "          durationSeconds: voiceCalls.durationSeconds,\n          transcript: input.omitTranscripts ? sql<string | null>`NULL` : voiceCalls.transcript,\n          ...(input.omitTranscripts ? { hasTranscript: sql<number>`(${voiceCalls.transcript} IS NOT NULL AND TRIM(${voiceCalls.transcript}) <> '')` } : {}),\n          summary: voiceCalls.summary,\n",
   "          durationSeconds: voiceCalls.durationSeconds,\n          transcript: voiceCalls.transcript,\n          summary: voiceCalls.summary,\n"
  ],
  [
   "          outcome: voiceCalls.outcome,\n          structuredData: input.omitTranscripts ? sql<string | null>`NULL` : voiceCalls.structuredData,\n          endedReason: voiceCalls.endedReason,\n",
   "          outcome: voiceCalls.outcome,\n          structuredData: voiceCalls.structuredData,\n          endedReason: voiceCalls.endedReason,\n"
  ],
  [
   "\n      const calls = input.omitTranscripts\n        ? rows.map((row: any) => ({ ...row, hasTranscript: Number(row.hasTranscript) === 1 }))\n        : rows;\n      return { calls, total: Number(count) };\n    }),\n\n  /** One call's transcript, loaded on demand (Command Chat call cards). Read-only. */\n  getCallTranscript: agentProcedure\n    .input(z.object({ vapiCallId: z.string().min(1).max(128) }))\n    .query(async ({ input }) => {\n      const db = await getDb();\n      if (!db) return { transcript: null };\n      const [row] = await db.select({ transcript: voiceCalls.transcript }).from(voiceCalls)\n        .where(eq(voiceCalls.vapiCallId, input.vapiCallId)).orderBy(desc(voiceCalls.createdAt)).limit(1);\n      return { transcript: row?.transcript ?? null };\n    }),\n",
   "\n      return { calls: rows, total: Number(count) };\n    }),\n"
  ]
 ],
 "server/opsChatRouter.ts": [
  [
   "import { retrySmsDraft } from \"./madisonSmsAgent\";\nimport { and, desc, eq, getTableColumns, gte, inArray, isNull, isNotNull, like, lte, ne, notInArray, or, sql } from \"drizzle-orm\";\nimport { orderChannelFeed } from \"./opsChannelFeedOrder\";\nimport { transcribeAudio } from \"./_core/voiceTranscription\";\n",
   "import { retrySmsDraft } from \"./madisonSmsAgent\";\nimport { and, desc, eq, gte, inArray, isNull, isNotNull, like, lte, ne, notInArray, or, sql } from \"drizzle-orm\";\nimport { transcribeAudio } from \"./_core/voiceTranscription\";\n"
  ],
  [
   "\n      // Active madison_sms_draft cards sort by lastActivityAt so they resurface\n      // when a customer replies. Everything else keeps its original createdAt order.\n      const sortKey = sql<number>`CASE\n            WHEN ${opsChatMessages.quickAction} = 'madison_sms_draft'\n",
   "\n      const msgs = await db\n        .select()\n        .from(opsChatMessages)\n        .where(eq(opsChatMessages.channel, input.channel))\n        .orderBy(\n          // Active madison_sms_draft cards sort by lastActivityAt so they resurface\n          // when a customer replies. Everything else keeps its original createdAt order.\n          desc(sql`CASE\n            WHEN ${opsChatMessages.quickAction} = 'madison_sms_draft'\n"
  ],
  [
   "            ELSE UNIX_TIMESTAMP(${opsChatMessages.createdAt}) * 1000\n          END`;\n      // Load speed: the same 500 messages in the same order, without sorting the whole channel. Only active\n      // draft cards can rank above their creation time, so the top 500 by sortKey always lies within all active\n      // draft cards plus the newest (500 + their count) messages by createdAt (an indexed read). The order is\n      // then applied with the identical SQL expression.\n      const columns = { ...getTableColumns(opsChatMessages), sortKey };\n      const activeDraftCards = await db.select(columns).from(opsChatMessages).where(and(\n        eq(opsChatMessages.channel, input.channel),\n        eq(opsChatMessages.quickAction, \"madison_sms_draft\"),\n        eq(opsChatMessages.cardStatus, \"active\"),\n      ));\n      const newest = await db.select(columns).from(opsChatMessages)\n        .where(eq(opsChatMessages.channel, input.channel))\n        .orderBy(desc(opsChatMessages.createdAt), desc(opsChatMessages.id))\n        .limit(500 + activeDraftCards.length);\n      const msgs = orderChannelFeed([...activeDraftCards, ...newest], 500);\n\n",
   "            ELSE UNIX_TIMESTAMP(${opsChatMessages.createdAt}) * 1000\n          END`)\n        )\n        .limit(500);\n\n"
  ]
 ]
};

export function withoutApprovedCommandChatLoad(path: string, source: string): string {
  for (const [current, original] of approved[path] ?? []) {
    if (source.split(current).length !== 2) throw new Error(`Unexpected Command Chat load hunk in ${path}`);
    source = source.replace(current, () => original);
  }
  return source;
}
