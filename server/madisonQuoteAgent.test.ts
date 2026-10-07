import { describe, expect, it } from "vitest";
import {
  evaluateMadisonQuote,
  MADISON_QUOTE_AGENT_ENABLED,
} from "./madisonQuoteAgent";

describe("Madison Quote Agent boundary", () => {
  it("is explicitly disabled while the quote flow is rebuilt", () => {
    expect(MADISON_QUOTE_AGENT_ENABLED).toBe(false);
    expect(evaluateMadisonQuote()).toEqual({ status: "disabled" });
  });
});
