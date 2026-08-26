import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 reply-assist reuse", () => {
  it("mounts the existing CsInbox1 reply-assist components rather than recreating their data paths", () => {
    expect(source).toContain('import FAQPanel from "@/components/FAQPanel"');
    expect(source).toContain('import ObjectionsPanel from "@/components/ObjectionsPanel"');
    expect(source).toContain('import WorldClassReplyPanel from "@/components/WorldClassReplyPanel"');
    expect(source).toContain('import InsertResponseModal from "@/components/InsertResponseModal"');
    expect(source).toContain('<FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="CS Chat" />');
    expect(source).toContain('<ObjectionsPanel open={objectionsOpen} onClose={() => setObjectionsOpen(false)} />');
    expect(source).toContain('<WorldClassReplyPanel');
    expect(source).toContain('<InsertResponseModal');
    expect(source).toContain('data={emojiData}');
  });

  it("keeps reply-assist controls out of internal-note mode", () => {
    const controlsStart = source.indexOf('{composeMode === "reply" && <>');
    const controlsEnd = source.indexOf('<div style={{display:', controlsStart);
    const controls = source.slice(controlsStart, controlsEnd);
    expect(controls).toContain('World-Class');
    expect(controls).toContain('FAQ');
    expect(controls).toContain('Responses');
    expect(controls).toContain('Objections');
    expect(controls).toContain('setShowEmojiPicker');
  });

  it("opens the existing World-Class panel instead of substituting the separate auto-draft flow", () => {
    expect(source).toContain('onClick={() => { setWorldClassOpen(true); setFaqOpen(false); setObjectionsOpen(false); }}><Sparkles size={12} aria-hidden="true" /> World-Class');
    expect(source).toContain('open={worldClassOpen}');
    expect(source).toContain('triggerAutoDraft(selectedConv)');
  });
});
