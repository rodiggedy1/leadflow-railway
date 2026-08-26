import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 composer expansion", () => {
  it("auto-grows from a compact baseline, caps the textarea, and supports explicit expand-collapse", () => {
    expect(source).toContain('const [composerExpanded, setComposerExpanded] = useState(false);');
    expect(source).toContain('const composeTextareaRef = useRef<HTMLTextAreaElement>(null);');
    expect(source).toContain('const minimumHeight = composerExpanded ? 220 : 72;');
    expect(source).toContain('const maximumHeight = composerExpanded ? Math.min(Math.floor(window.innerHeight * 0.42), 420) : 220;');
    expect(source).toContain('textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";');
    expect(source).toContain('onInput={adjustComposerHeight}');
    expect(source).toContain('aria-label={composerExpanded ? "Collapse reply composer" : "Expand reply composer"}');
    expect(source).toContain('if (e.key === "Escape" && composerExpanded)');
  });

  it("preserves existing keyboard send behavior and does not alter the scoped AI draft label", () => {
    expect(source).toContain('if (e.key === "Enter" && (e.metaKey || e.ctrlKey))');
    expect(source).toContain('else doSend();');
    expect(source).toContain('World-Class Draft · Review before sending');
  });
});
