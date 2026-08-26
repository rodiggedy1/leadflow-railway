import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 automatic draft reliability", () => {
  it("makes every selection path reset draft state before loading a new conversation", () => {
    expect(source).toContain('const setSelectedConvWithReset =');
    expect(source).toContain('autoDraftedForId.current = null;');
    expect(source).toContain('setAutoDraftRetryForId(null);');
    expect(source).toContain('setSelectedConvWithReset(conv);');
    expect(source).toContain('setChannel("inbox");');

    const historySearchStart = source.indexOf('{(customerSearch.data ?? []).map(r => {');
    const historySearchEnd = source.indexOf('          ) :', historySearchStart);
    expect(historySearchStart).toBeGreaterThan(-1);
    expect(historySearchEnd).toBeGreaterThan(historySearchStart);
    const historySearchHandler = source.slice(historySearchStart, historySearchEnd);
    expect(historySearchHandler).toContain('setSelectedConvWithReset(conv);');
    expect(historySearchHandler).not.toContain('setSelectedConv(conv);');
  });

  it("starts a draft once the selected conversation detail is ready without suppressing an empty history", () => {
    expect(source).toContain('if (!selectedConv || !detailReady) return;');
    expect(source).not.toContain('if (!selectedConv || !detailReady || detailMessages.length === 0) return;');
    expect(source).toContain('}, [selectedConv?.id, detailReady]);');
  });

  it("treats an empty stream or fallback reply as retryable instead of permanently drafted", () => {
    expect(source).toContain('if (!receivedToken) throw new Error("AI draft stream completed without text");');
    expect(source).toContain('function markAutoDraftRetryable');
    expect(source).toContain('onError: () => { markAutoDraftRetryable(); },');
    expect(source).toContain('if (replyText.trim())');
  });

  it("shows retry only for the selected reply composer after a failed empty draft", () => {
    expect(source).toContain('autoDraftRetryForId === selectedConv.id && !autoDraftLoading && !compose.trim()');
    expect(source).toContain('Retry AI Draft');
    expect(source).toContain('composeMode === "reply" && <>');
  });
});
