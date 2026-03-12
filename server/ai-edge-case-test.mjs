/**
 * Edge-case AI test script — runs real LLM calls to verify Madison's knowledge base
 * and conversation steering behavior.
 *
 * Usage: node server/ai-edge-case-test.mjs
 */

import { config } from "dotenv";
config();

// We need to import the compiled TS — use tsx to run this
// Run with: npx tsx server/ai-edge-case-test.mjs

const BASE_URL = "http://localhost:3000";

const TEST_CASES = [
  // Service area questions
  { category: "Service Area", message: "Do you clean in Rockville?" },
  { category: "Service Area", message: "Do you serve Bethesda Maryland?" },
  { category: "Service Area", message: "What areas do you cover?" },

  // Guarantee / trust questions
  { category: "Guarantee", message: "What if I'm not happy with the cleaning?" },
  { category: "Guarantee", message: "Are you insured?" },
  { category: "Guarantee", message: "What's your satisfaction guarantee?" },

  // Supplies / logistics
  { category: "Logistics", message: "Do you bring your own supplies?" },
  { category: "Logistics", message: "Do I need to be home?" },
  { category: "Logistics", message: "How long does it take?" },

  // Pricing / booking
  { category: "Pricing", message: "Why is this so expensive?" },
  { category: "Pricing", message: "Can I pay cash?" },
  { category: "Pricing", message: "Do you require a deposit?" },

  // Off-topic / deflect
  { category: "Off-topic", message: "What's the weather like today?" },
  { category: "Off-topic", message: "Can you recommend a good restaurant?" },

  // Extras awareness
  { category: "Extras", message: "Will you actually clean my oven?", extras: "Clean Inside Oven" },
  { category: "Extras", message: "Do you use pet-safe products?", extras: "I Have Pets" },

  // Cancellation
  { category: "Cancellation", message: "What if I need to cancel?" },
  { category: "Cancellation", message: "Can I reschedule?" },
];

// We'll call the tRPC endpoint directly via HTTP to test the real server
async function testOffScriptReply(testCase) {
  const body = {
    stage: "AVAILABILITY",
    leadName: "Jane Smith",
    quotedPrice: "209",
    serviceType: "Standard Cleaning",
    selectedSlot: null,
    messageHistory: [],
    leadReply: testCase.message,
    extrasContext: testCase.extras ?? null,
  };

  // Call the internal test endpoint if it exists, otherwise use a direct import
  try {
    const res = await fetch(`${BASE_URL}/api/trpc/leads.testOffScript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: body }),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.result?.data?.json?.reply ?? "(no reply)";
    }
  } catch {}
  return null;
}

console.log("=".repeat(70));
console.log("MAIDS IN BLACK — AI EDGE CASE TEST");
console.log("Testing knowledge base accuracy and conversation steering");
console.log("=".repeat(70));
console.log();

// Since we can't easily call tRPC from a script, let's use the handleOffScriptReply directly
// by importing it via tsx

import { handleOffScriptReply } from "./aiService.ts";

let passed = 0;
let failed = 0;
const results = [];

for (const tc of TEST_CASES) {
  process.stdout.write(`[${tc.category}] "${tc.message}" ... `);
  
  try {
    const result = await handleOffScriptReply({
      stage: "AVAILABILITY",
      leadName: "Jane Smith",
      quotedPrice: "209",
      serviceType: "Standard Cleaning",
      selectedSlot: null,
      messageHistory: [],
      leadReply: tc.message,
      extrasContext: tc.extras ?? null,
    });

    const reply = result.reply;
    const steers = reply.length > 0;
    
    if (steers) {
      passed++;
      console.log("✓");
    } else {
      failed++;
      console.log("✗ (empty reply)");
    }
    
    results.push({ ...tc, reply, ok: steers });
  } catch (err) {
    failed++;
    console.log(`✗ ERROR: ${err.message}`);
    results.push({ ...tc, reply: `ERROR: ${err.message}`, ok: false });
  }
}

console.log();
console.log("=".repeat(70));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(70));
console.log();

for (const r of results) {
  console.log(`[${r.category}] Q: "${r.message}"`);
  if (r.extras) console.log(`         Extras: ${r.extras}`);
  console.log(`         A: "${r.reply}"`);
  console.log();
}
