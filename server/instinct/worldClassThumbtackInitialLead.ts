import { invokeLLM } from "../_core/llm";
import { prepareWorldClassCsReplyMessages } from "../worldClassCsReply";
import { initialLeadDraftRequestSchema } from "../../shared/claudeInitialLead";
import { normalizeThumbtackSmsPhone } from "../../shared/thumbtackSmsPhone";
import { CHATGPT_WORLDCLASS_GENERATOR_ID } from "../../shared/smsSenderProvenance";
import { ClaudeInitialLeadError, generateThumbtackInitialLeadContent, type InitialLeadRunner, type ClaudeInitialLeadContentOptions } from "./claudeInitialLead";

/** Same direct OpenAI GPT-4o call as WorldClass csReply. Content only: no tools,
 * SMS submission, retries, staff identity or fabricated managed-agent session. */
const runWorldClassDraft: InitialLeadRunner = async options => {
  if (options.signal?.aborted) throw new ClaudeInitialLeadError("CANCELLED");
  const completion = await invokeLLM({ messages: [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: options.userPrompt },
  ] });
  // invokeLLM has no signal seam. The unchanged caller deadline also rejects
  // non-cooperative work; this guard prevents a late result from progressing.
  if (options.signal?.aborted) throw new ClaudeInitialLeadError("CANCELLED");
  const choice = completion.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim() || choice?.finish_reason === "length") {
    throw new ClaudeInitialLeadError("INVALID_RESPONSE");
  }
  return { finalSmsText: content, agentId: CHATGPT_WORLDCLASS_GENERATOR_ID,
    ...(typeof completion.id === "string" && completion.id.trim() ? { sessionId: completion.id } : {}) };
};
const prepareMessages: NonNullable<ClaudeInitialLeadContentOptions["prepareMessages"]> = async request =>
  prepareWorldClassCsReplyMessages({ ...initialLeadDraftRequestSchema.parse(request), history: [] }) as Awaited<ReturnType<NonNullable<ClaudeInitialLeadContentOptions["prepareMessages"]>>>;

/** Used only by the existing native Thumbtack dispatcher. Manual Claude drafts
 * and all ongoing customer replies retain their original generator/defaults. */
export async function generateWorldClassThumbtackInitialLeadContent(raw: unknown) {
  return generateThumbtackInitialLeadContent(raw, { prepareMessages, runner: runWorldClassDraft,
    normalizeCustomerPhone: normalizeThumbtackSmsPhone, validateReply: text => text });
}
