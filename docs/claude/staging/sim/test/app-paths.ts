// TEST ONLY — runs the app's OWN sending code (not test copies) with the staging simulator preloaded.
// Local throwaway database only. Run from the repository root, inside a no-internet sandbox:
//   node --require ./docs/claude/staging/sim/outbound-sim.cjs --import tsx docs/claude/staging/sim/test/app-paths.ts
import { sendSms } from "../../../../../server/openphone";
import { notifyOwner } from "../../../../../server/_core/notification";
import { sendNewGmailEmail } from "../../../../../server/gmailService";
import { bootstrapVapiAssistant } from "../../../../../server/vapiService";
import { startTwilioLeadBridge } from "../../../../../server/twilioLeadBridge";

const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<unknown>, ok: (r: any) => boolean) {
  try { const r = await fn(); results.push([name, ok(r), JSON.stringify(r)?.slice(0, 200) ?? ""]); }
  catch (e: any) { results.push([name, false, String(e?.message ?? e)]); }
}

(async () => {
  await (globalThis as any).__stagingSimReady;
  await check("App text message (server/openphone.ts sendSms)", () => sendSms({ to: "+19992000123", content: "Hi Alex, your clean is confirmed for Tuesday 10-12." }), r => r?.smsSent === true || r?.success === true || !!r?.messageId);
  await check("App owner notification (notifyOwner)", () => notifyOwner({ title: "New lead", content: "Alex Example asked for a quote" } as any), r => r === true);
  await check("App email (gmailService sendNewGmailEmail)", () => sendNewGmailEmail({ to: "u000001@example.invalid", subject: "Your quote from Maids in Black", bodyHtml: "<p>Hello Alex</p>" }), r => !!r?.messageId);
  await check("App AI-call assistant setup (bootstrapVapiAssistant)", () => bootstrapVapiAssistant("https://staging.example.invalid/api/webhooks/vapi"), r => typeof r === "string" && r.length > 0);
  await check("App office call bridge (Twilio startTwilioLeadBridge)", () => startTwilioLeadBridge({ leadPhone: "+19992000123", leadName: "Alex Example", sessionId: null }), r => !!r);
  for (const [n, ok, d] of results) console.log(`RESULT ${ok ? "PASS" : "FAIL"} | ${n} | ${d}`);
  process.exit(results.every(r => r[1]) ? 0 : 1);
})();
