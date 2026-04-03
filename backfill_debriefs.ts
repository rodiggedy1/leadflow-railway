/**
 * Backfill post-call AI debriefs for all recordings that have transcripts but no debrief yet.
 * Uses the OpenPhone API to fetch transcripts for calls from the past 3 days.
 */
import mysql from 'mysql2/promise';
import { invokeLLM } from './server/_core/llm';

async function generateDebrief(
  transcriptText: string
): Promise<{ grade: string; wentWell: string; improve: string; nextLine: string; generatedAt: number } | null> {
  const systemPrompt = `You are an expert home services sales coach. Analyze this call transcript and produce a concise debrief for the agent.
Return ONLY a JSON object with exactly these keys:
{
  "grade": "A single letter grade: A, B, C, D, or F",
  "wentWell": "One sentence — what the agent did well on this call",
  "improve": "One sentence — the single most important thing to improve",
  "nextLine": "The exact word-for-word line the agent should use next time to handle the key moment better"
}
Grade criteria:
- A: Excellent — closed or made a strong attempt, great rapport, handled objections well
- B: Good — solid process, minor missed opportunities
- C: Average — adequate but missed key objection handling or follow-through
- D: Poor — poor engagement, lost the lead unnecessarily
- F: Failed — unprofessional or completely failed to follow process
Be specific and actionable. Reference actual moments from the transcript. No fluff.`;

  const response = await invokeLLM({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Call transcript:\n${transcriptText}` },
    ],
  });

  const rawContent = response?.choices?.[0]?.message?.content ?? '';
  const raw = typeof rawContent === 'string' ? rawContent : '';
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  const validGrades = ['A', 'B', 'C', 'D', 'F'];
  if (!validGrades.includes(parsed.grade)) parsed.grade = 'C';
  if (parsed.wentWell && parsed.improve && parsed.nextLine) {
    return { ...parsed, generatedAt: Date.now() };
  }
  return null;
}

async function fetchOpenPhoneTranscript(callId: string): Promise<{ identifier: string; content: string }[] | null> {
  const apiKey = process.env.OPENPHONE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.openphone.com/v1/call-transcripts/${callId}`, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      console.warn(`  [OpenPhone] Transcript fetch failed for ${callId}: ${res.status}`);
      return null;
    }
    const data = await res.json() as any;
    return data?.data?.dialogue ?? null;
  } catch (e) {
    console.warn(`  [OpenPhone] Transcript fetch error for ${callId}:`, e);
    return null;
  }
}

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL as string);
  
  // Find all recordings without a debrief that have a transcript OR a real callId we can fetch from
  const [rows] = await db.execute(
    `SELECT id, openphoneCallId, sessionId, transcript, recordingUrl
     FROM openphone_call_recordings 
     WHERE callDebrief IS NULL
     ORDER BY createdAt DESC
     LIMIT 50`
  ) as any;

  console.log(`Found ${rows.length} recordings without debriefs`);

  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    const callId = row.openphoneCallId;
    let dialogue: { identifier: string; content: string }[] | null = null;

    // Try existing transcript in DB first
    if (row.transcript && row.transcript !== 'null') {
      try {
        const parsed = JSON.parse(row.transcript);
        if (Array.isArray(parsed) && parsed.length > 0) {
          dialogue = parsed;
          console.log(`  Using stored transcript for callId=${callId} (${parsed.length} turns)`);
        }
      } catch {}
    }

    // If no stored transcript, fetch from OpenPhone API
    if (!dialogue && callId && !callId.startsWith('synthetic')) {
      console.log(`  Fetching transcript from OpenPhone for callId=${callId}...`);
      dialogue = await fetchOpenPhoneTranscript(callId);
      if (dialogue) {
        // Save it to DB for future use
        await db.execute(
          'UPDATE openphone_call_recordings SET transcript = ? WHERE id = ?',
          [JSON.stringify(dialogue), row.id]
        );
      }
    }

    if (!dialogue || dialogue.length < 2) {
      console.log(`  Skipping id=${row.id} callId=${callId} — no transcript available`);
      skipped++;
      continue;
    }

    // Format transcript
    const transcriptText = dialogue
      .map((turn: any) => `${turn.identifier === 'agent' ? 'Agent' : 'Customer'}: ${turn.content}`)
      .join('\n');

    if (transcriptText.length < 100) {
      console.log(`  Skipping id=${row.id} — transcript too short`);
      skipped++;
      continue;
    }

    console.log(`  Generating debrief for id=${row.id} callId=${callId} session=${row.sessionId}...`);
    try {
      const debrief = await generateDebrief(transcriptText);
      if (debrief) {
        await db.execute(
          'UPDATE openphone_call_recordings SET callDebrief = ? WHERE id = ?',
          [JSON.stringify(debrief), row.id]
        );
        console.log(`  ✓ Debrief stored — grade=${debrief.grade} session=${row.sessionId}`);
        processed++;
      } else {
        console.warn(`  ✗ No valid debrief produced for id=${row.id}`);
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ Error generating debrief for id=${row.id}:`, err);
      skipped++;
    }

    // Rate limit: wait 1s between LLM calls
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone. Processed: ${processed}, Skipped: ${skipped}`);
  await db.end();
}

main().catch(console.error);
