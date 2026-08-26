import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 production composer expansion", () => {
  it("auto-grows, caps long replies with internal scrolling, and supports explicit expand-collapse", () => {
    expect(source).toContain('const [composerExpanded, setComposerExpanded] = useState(false);');
    expect(source).toContain('const composeTextareaRef = useRef<HTMLTextAreaElement>(null);');
    expect(source).toContain('const minimumHeight = composerExpanded ? 220 : 72;');
    expect(source).toContain('const maximumHeight = composerExpanded ? Math.min(Math.floor(window.innerHeight * 0.42), 420) : 220;');
    expect(source).toContain('textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";');
    expect(source).toContain('aria-label={composerExpanded ? "Collapse reply composer" : "Expand reply composer"}');
    expect(source).toContain('if (e.key === "Escape" && composerExpanded)');
  });

  it("preserves Reply Assist and the existing send shortcut", () => {
    expect(source).toContain('World-Class</button>');
    expect(source).toContain('FAQ</button>');
    expect(source).toContain('if (e.key === "Enter" && (e.metaKey || e.ctrlKey))');
    expect(source).toContain('doSend();');
  });
});
