import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/components/CsInbox2.tsx", import.meta.url), "utf8");

describe("CsInbox2 production Reply Assist toolbar", () => {
  it("mounts the existing reusable Reply Assist components", () => {
    expect(source).toContain('import FAQPanel from "@/components/FAQPanel"');
    expect(source).toContain('import ObjectionsPanel from "@/components/ObjectionsPanel"');
    expect(source).toContain('import WorldClassReplyPanel from "@/components/WorldClassReplyPanel"');
    expect(source).toContain('import InsertResponseModal from "@/components/InsertResponseModal"');
    expect(source).toContain('<WorldClassReplyPanel');
    expect(source).toContain('World-Class</button>');
    expect(source).toContain('FAQ</button>');
    expect(source).toContain('Responses</button>');
    expect(source).toContain('Objections</button>');
    expect(source).toContain('data={emojiData}');
  });

  it("opens the reusable World-Class panel without labeling manual compose text as an AI draft", () => {
    expect(source).toContain('setWorldClassOpen(true); setFaqOpen(false); setObjectionsOpen(false);');
    expect(source).not.toContain('World-Class Draft · Review before sending');
  });
});
