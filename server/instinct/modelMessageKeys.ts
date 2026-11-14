import { createHash } from "node:crypto";
import { z } from "zod";
import { modelActionSchema, modelCitationSchema, type AnalysisRequest, type AuthorizedScope, type ModelAction } from "../../shared/instinct";

/** Model-facing SMS protocol; internal Instinct citations remain unchanged. */
export const MODEL_MESSAGE_KEYS_VERSION = "instinct-sms-message-keys-v1";
export const keyedActionSchema = modelActionSchema.omit({ anchorEvidenceIndex: true, citations: true, supersededByEvidenceIndex: true }).extend({
  threadKey: z.string().min(1), anchorMessageKey: z.string().min(1), evidenceKeys: z.array(z.string().min(1)).min(1),
  supersededByMessageKey: z.string().min(1).nullable(),
}).strict();
export const keyedFactSchema = z.object({ text: z.string().min(1), evidenceKeys: z.array(z.string().min(1)).min(1) }).strict();
export const keyedOutputSchema = z.object({ actions: z.array(keyedActionSchema) }).strict();
export const keyedSegmentOutputSchema = keyedOutputSchema.extend({ contextFacts: z.array(keyedFactSchema) }).strict();
export const keyedReductionOutputSchema = keyedSegmentOutputSchema.extend({ accountedSegments: z.array(z.string().min(1)) }).strict();
export type KeyedAction = z.infer<typeof keyedActionSchema>;
type Quote = z.infer<typeof modelCitationSchema>;
type Fact = { text: string; citations: Quote[] };
export interface OriginalRange { evidenceIndex: number; start: number; end: number }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function rangeKey(range: OriginalRange): string { return `${range.evidenceIndex}:${range.start}:${range.end}`; }

/** Partition the complete supplied ranges, never expand a segment back to a body.
 * Turn, line and sentence boundaries give independent requests independent proof.
 * JS string indices supply UTF-16 offsets; the model never calculates them.
 */
export function originalProofUnits(request: AnalysisRequest, ranges: readonly OriginalRange[]): OriginalRange[] {
  return ranges.flatMap(range => {
    const item = request.context.evidence[range.evidenceIndex];
    if (!item || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start
      || range.end > (item.originalText?.length ?? 0)) throw new Error("INVALID_CITATION");
    if (item.originalText === null || ["snippet", "summary", "translation_only", "missing"].includes(item.contentBasis)) return [];
    const boundaries = new Set([range.start, range.end]);
    const add = (offset: number) => {
      if (offset > range.start && offset < range.end
        && !(/[\uD800-\uDBFF]/.test(item.originalText![offset - 1]) && /[\uDC00-\uDFFF]/.test(item.originalText![offset]))) boundaries.add(offset);
    };
    item.originalTurns.forEach(turn => { add(turn.start); add(turn.end); });
    const supplied = item.originalText.slice(range.start, range.end);
    for (const match of Array.from(supplied.matchAll(/\r?\n|[.!?;](?:[ \t]+|(?=\r?\n|$))/g))) add(range.start + match.index! + match[0].length);
    const ordered = Array.from(boundaries).sort((a, b) => a - b);
    return ordered.slice(1).map((end, index) => ({ evidenceIndex: range.evidenceIndex, start: ordered[index], end })).filter(unit => unit.end > unit.start);
  });
}

/** Each invocation owns a separate context/range (or exact child-proof) namespace.
 * Reducers receive ONLY child citations, including legacy fixture subranges. They
 * cannot recover other units merely because the full original exists on server.
 */
export function createModelMessageKeys(request: AnalysisRequest, scope: AuthorizedScope, ranges: readonly OriginalRange[], proof?: readonly Quote[]) {
  const units = proof ? proof.map(value => modelCitationSchema.parse(value)) : originalProofUnits(request, ranges).map(range => ({ ...range,
    exactQuote: request.context.evidence[range.evidenceIndex].originalText!.slice(range.start, range.end) }));
  const unique = Array.from(new Map(units.map(unit => [rangeKey(unit), unit])).values());
  for (const unit of units) {
    const item = request.context.evidence[unit.evidenceIndex];
    if (!item || item.ref.sourceAccountKey !== scope.sourceAccountKey) throw new Error("INVALID_SOURCE_REFERENCE");
    if (item.originalText === null || ["snippet", "summary", "translation_only", "missing"].includes(item.contentBasis)
      || item.originalText.slice(unit.start, unit.end) !== unit.exactQuote || unit.end > item.originalText.length
      || !ranges.some(range => range.evidenceIndex === unit.evidenceIndex && range.start <= unit.start && range.end >= unit.end)) throw new Error("INVALID_CITATION");
  }
  const { capturedAtUtc: _observed, entries: _entries, ...manifest } = request.context.manifest;
  const originals = request.context.evidence.map(item => {
    const { observedAtUtc: _capture, ...ref } = item.ref;
    return { ...item, ref };
  });
  const threadKey = `thread:${hash({ version: MODEL_MESSAGE_KEYS_VERSION, scope, manifest, originals,
    timeZone: request.timeZone, localDate: request.localDate, ranges, proof: proof ? unique : null })}`;
  const messages = unique.map(unit => ({ key: `message:${hash([threadKey, unit])}`, text: unit.exactQuote, originalRange: {
    evidenceIndex: unit.evidenceIndex, start: unit.start, end: unit.end,
  } }));
  const byKey = new Map(messages.map((message, index) => [message.key, unique[index]]));
  const byRange = new Map(messages.map(message => [rangeKey(message.originalRange), message.key]));
  const quote = (key: string): Quote => {
    const value = byKey.get(key);
    if (!value) throw new Error("INVALID_SOURCE_REFERENCE");
    return { ...value };
  };
  const keyFor = (value: Quote): string => {
    const key = byRange.get(rangeKey(value));
    if (!key || quote(key).exactQuote !== value.exactQuote) throw new Error("INVALID_CITATION");
    return key;
  };
  return {
    threadKey, messages,
    decodeAction(value: KeyedAction): ModelAction {
      const parsed = keyedActionSchema.parse(value);
      if (parsed.threadKey !== threadKey || !parsed.evidenceKeys.includes(parsed.anchorMessageKey)
        || (parsed.supersededByMessageKey !== null && !parsed.evidenceKeys.includes(parsed.supersededByMessageKey))) throw new Error("INVALID_SOURCE_REFERENCE");
      const { threadKey: _thread, anchorMessageKey, evidenceKeys, supersededByMessageKey, ...action } = parsed;
      return modelActionSchema.parse({ ...action, anchorEvidenceIndex: quote(anchorMessageKey).evidenceIndex,
        citations: evidenceKeys.map(quote), supersededByEvidenceIndex: supersededByMessageKey === null ? null : quote(supersededByMessageKey).evidenceIndex });
    },
    encodeAction(value: ModelAction): KeyedAction {
      const { anchorEvidenceIndex, citations, supersededByEvidenceIndex, ...action } = value;
      const anchor = citations.find(citation => citation.evidenceIndex === anchorEvidenceIndex);
      const correction = citations.find(citation => citation.evidenceIndex === supersededByEvidenceIndex);
      if (!anchor || (supersededByEvidenceIndex !== null && !correction)) throw new Error("INVALID_SOURCE_REFERENCE");
      return keyedActionSchema.parse({ ...action, threadKey, anchorMessageKey: keyFor(anchor), evidenceKeys: citations.map(keyFor),
        supersededByMessageKey: supersededByEvidenceIndex === null ? null : keyFor(correction!) });
    },
    decodeFact(value: z.infer<typeof keyedFactSchema>): Fact {
      const parsed = keyedFactSchema.parse(value);
      return { text: parsed.text, citations: parsed.evidenceKeys.map(quote) };
    },
    encodeFact(value: Fact): z.infer<typeof keyedFactSchema> { return { text: value.text, evidenceKeys: value.citations.map(keyFor) }; },
  };
}
export type ModelMessageKeys = ReturnType<typeof createModelMessageKeys>;
