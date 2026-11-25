/** What Claude is sent from long conversations. Pure helpers; the stored history is never changed. */

/** Most recent messages sent to Claude per SMS conversation or email thread. */
export const CLAUDE_HISTORY_WINDOW = 30;

/** Index of the first message to send: the last CLAUDE_HISTORY_WINDOW messages, widened if needed so the
 * message being answered (mustInclude) is always shown. */
export function historyWindowStart(length: number, mustInclude = length - 1): number {
  const start = Math.max(0, length - CLAUDE_HISTORY_WINDOW);
  return mustInclude >= 0 && mustInclude < start ? mustInclude : start;
}

// Standard reply separators, after which the older thread is repeated: Gmail/Apple ("On <date>, <name> wrote:"),
// Outlook ("-----Original Message-----", or a "From:" line directly followed by "Sent:").
const QUOTE_MARKERS = [
  /^[ \t]*On [^\n]{1,300}wrote:[ \t]*$/m,
  /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}[ \t]*$/im,
  /^[ \t]*From:[^\n]*\r?\n[ \t]*Sent:[^\n]*$/m,
];

/** An earlier email's own text, without the copy of older messages quoted in it: text after a standard reply
 * separator and any ">"-quoted lines are left out. Returns the text unchanged if nothing of its own would remain. */
export function withoutQuotedEmailHistory(text: string): string {
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  const lines = text.slice(0, cut).split("\n"), kept = lines.filter(line => !/^[ \t]*>/.test(line));
  if (cut === text.length && kept.length === lines.length) return text; // nothing quoted: unchanged, byte for byte
  const own = kept.join("\n").trimEnd();
  return own.trim() ? own : text;
}
