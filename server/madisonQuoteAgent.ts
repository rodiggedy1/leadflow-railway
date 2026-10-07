import type { QuoteInputs, VerifiedQuote } from "./madisonMissionStore";

/**
 * Quote Agent boundary.
 *
 * The quote workflow is intentionally disabled while it is being rebuilt as an
 * isolated component. Generic Madison SMS handling must treat quote messages as
 * ordinary drafts until this flag is explicitly enabled and the end-to-end
 * quote lifecycle is verified.
 */
export const MADISON_QUOTE_AGENT_ENABLED = false;

export type MadisonQuoteAgentResult =
  | { status: "disabled" }
  | {
      status: "incomplete";
      missing: string[];
      prompt: string;
      inputs: QuoteInputs;
    }
  | {
      status: "verified";
      quote: VerifiedQuote;
      inputs: QuoteInputs;
    };

export function evaluateMadisonQuote(): MadisonQuoteAgentResult {
  return { status: "disabled" };
}
