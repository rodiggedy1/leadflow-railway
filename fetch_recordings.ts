/**
 * Fetches real call recordings from OpenPhone API for the past 3 days.
 * Updates the DB with real recording URLs and generates debriefs for any missing ones.
 */
import mysql from 'mysql2/promise';
import { invokeLLM } from './server/_core/llm';

const OPENPHONE_API_KEY = process.env.OPENPHONE_API_KEY!;
const OPENPHONE_PHONE_NUMBER_ID = process.env.OPENPHONE_PHONE_NUMBER_ID!;
const OPENPHONE_CS_PHONE_NUMBER_ID = process.env.OPENPHONE_CS_PHONE_NUMBER_ID!;

async function opFetch(path: string) {
  const res = await fetch(`https://api.openphone.com/v1${path}`, {
    headers: { Authorization: OPENPHONE_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenPhone ${path} → ${res.status}: ${body.substring(0, 200)}`);
  }
  return res.json() as Promise<any>;
}

async function generateDebrief(
  dialogue: { identifier: string; content: string }[]
): Promise<{ grade: string; wentWell: string; improve: string; nextLine: string; generatedAt: number } | null> {
  const transcriptText = dialogue
    .map((t) => `${t.identifier === 'agent' ? 'Agent' : 'Customer'}: ${t.content}`)
    .join('\n');

  if (transcriptText.length < 80) return null;

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
Be specific and actionable. No fluff.`;

  const response = await invokeLLM({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Call transcript:\n${transcriptText}` },
    ],
  });

  const raw = (response?.choices?.[0]?.message?.content ?? '') as string;
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  const validGrades = ['A', 'B', 'C', 'D', 'F'];
  if (!validGrades.includes(parsed.grade)) parsed.grade = 'C';
  if (parsed.wentWell && parsed.improve && parsed.nextLine) {
    return { ...parsed, generatedAt: Date.now() };
  }
  return null;
}

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL as string);

  // Fetch calls from the past 3 days from both phone numbers
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const phoneNumberIds = [OPENPHONE_PHONE_NUMBER_ID, OPENPHONE_CS_PHONE_NUMBER_ID].filter(Boolean);

  console.log(`Fetching calls since ${threeDaysAgo} for ${phoneNumberIds.length} phone number(s)...`);

  let allCalls: any[] = [];
  for (const phoneNumberId of phoneNumberIds) {
    try {
      const data = await opFetch(
        `/calls?phoneNumberId=${phoneNumberId}&createdAfter=${threeDaysAgo}&maxResults=50`
      );
      const calls = data?.data ?? [];
      console.log(`  Phone ${phoneNumberId}: ${calls.length} calls`);
      allCalls = allCalls.concat(calls);
    } catch (e) {
      console.warn(`  Failed to fetch calls for ${phoneNumberId}:`, e);
    }
  }

  console.log(`Total calls fetched: ${allCalls.length}`);

  let updated = 0;
  let debriefed = 0;

  for (const call of allCalls) {
    const callId = call.id;
    const recordingUrl = call.recording?.url ?? null;
    const duration = call.duration ?? 0;

    console.log(`\nCall ${callId} duration=${duration}s recordingUrl=${recordingUrl ? 'YES' : 'none'}`);

    if (duration < 20) {
      console.log('  Skipping — too short (< 20s)');
      continue;
    }

    // Check if we have this call in DB
    const [existing] = await db.execute(
      'SELECT id, callDebrief, transcript FROM openphone_call_recordings WHERE openphoneCallId = ?',
      [callId]
    ) as any;

    const row = existing[0];

    if (row) {
      // Update recording URL if we now have a real one
      if (recordingUrl && !row.recordingUrl?.includes('synthetic')) {
        await db.execute(
          'UPDATE openphone_call_recordings SET recordingUrl = ? WHERE id = ?',
          [recordingUrl, row.id]
        );
        console.log(`  Updated recording URL for existing row id=${row.id}`);
        updated++;
      }

      // Generate debrief if missing
      if (!row.callDebrief) {
        // Try to fetch transcript
        let dialogue: { identifier: string; content: string }[] | null = null;
        if (row.transcript) {
          try { dialogue = JSON.parse(row.transcript); } catch {}
        }
        if (!dialogue) {
          try {
            const tData = await opFetch(`/call-transcripts/${callId}`);
            dialogue = tData?.data?.dialogue ?? null;
          } catch {}
        }
        if (dialogue && dialogue.length >= 2) {
          console.log(`  Generating debrief (${dialogue.length} turns)...`);
          try {
            const debrief = await generateDebrief(dialogue);
            if (debrief) {
              await db.execute(
                'UPDATE openphone_call_recordings SET callDebrief = ? WHERE id = ?',
                [JSON.stringify(debrief), row.id]
              );
              console.log(`  ✓ Debrief stored — grade=${debrief.grade}`);
              debriefed++;
            }
          } catch (e) {
            console.warn('  Debrief generation failed:', e);
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } else if (recordingUrl) {
      // Insert new row
      console.log(`  Inserting new recording row...`);
      const callerPhone = call.from ?? call.to ?? '';
      await db.execute(
        `INSERT INTO openphone_call_recordings 
         (openphoneCallId, callerPhone, recordingUrl, status, createdAt)
         VALUES (?, ?, ?, 'completed', ?)`,
        [callId, callerPhone, recordingUrl, Date.now()]
      );
      console.log(`  ✓ Inserted new row for callId=${callId}`);
      updated++;
    }
  }

  console.log(`\nDone. Updated URLs: ${updated}, New debriefs: ${debriefed}`);
  await db.end();
}

main().catch(console.error);
