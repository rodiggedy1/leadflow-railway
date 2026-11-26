import { buildSystemPrompt } from "../csReplyStream";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "../knowledgeBase";

// Tone examples kept for Claude replies: the ones that promise or report no action.
const CLAUDE_KEPT_TONE_EXAMPLES = [
  '- "Hey [Name]! Just checking in',
  '- "[Name], thank you for telling us',
  '- "[Name], please do NOT apologize for the mess',
  "- \"[Name], you've been with us",
];

/** The shared CS writing prompt as Claude replies receive it. The source (csReplyStream, also used by the
 * Manus drafting tools) is unchanged; Claude replies leave out only the parts its newer reply rules replace
 * or contradict: the "write until complete" length rule, the "bad" short-reply examples, the old 1-3 emoji
 * limit, tone examples that state actions as already done, and leftover drafting-tool lines. Kept examples
 * use commas instead of dashes (dashes are not allowed in replies). The knowledge base and the tone and
 * writing rules are kept word for word. If the source changes shape, each step leaves it as it is. */
export function claudeWritingPrompt(full: string = buildSystemPrompt()): string {
  let text = full;
  const cut = (start: string, end: string) => {
    const from = text.indexOf(start), to = from < 0 ? -1 : text.indexOf(end, from + start.length);
    if (from >= 0 && to >= 0) text = text.slice(0, from) + text.slice(to);
  };
  text = text.replace(" Your job is to write the exact SMS the agent should send — not advice, the actual text message.", "");
  cut("Length: Write until the message feels COMPLETE", "Examples of the right tone:");
  const examplesStart = text.indexOf("Examples of the right tone:\n"), examplesEnd = text.indexOf("\n\n=== WHAT NOT TO WRITE");
  if (examplesStart >= 0 && examplesEnd > examplesStart) {
    const lines = text.slice(examplesStart, examplesEnd).split("\n");
    const kept = lines.slice(1).filter(line => CLAUDE_KEPT_TONE_EXAMPLES.some(prefix => line.startsWith(prefix))).map(line => line.replaceAll(" — ", ", "));
    text = text.slice(0, examplesStart) + (kept.length ? [lines[0], ...kept].join("\n") : "").trimEnd() + text.slice(examplesEnd);
  }
  cut("=== WHAT NOT TO WRITE (BAD EXAMPLES) ===", "=== WRITING RULES ===");
  const closing = "\n\nWrite the exact SMS the agent should send for the scenario described.";
  if (text.endsWith(closing)) text = text.slice(0, -closing.length);
  return text.includes(MAIDS_IN_BLACK_KNOWLEDGE_BASE) === full.includes(MAIDS_IN_BLACK_KNOWLEDGE_BASE) ? text : full;
}
