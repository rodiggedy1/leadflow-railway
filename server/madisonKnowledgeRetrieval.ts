/**
 * Madison Knowledge Retrieval
 *
 * The public booking guide must answer only from the approved Maids in Black
 * knowledge base. The full approved source is intentionally passed to the AI
 * rather than a brittle two-passage keyword slice, which can omit the fact a
 * customer asks about when their everyday wording differs from a KB heading.
 */

import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

export async function retrieveKnowledge(_question: string): Promise<string> {
  return MAIDS_IN_BLACK_KNOWLEDGE_BASE;
}
