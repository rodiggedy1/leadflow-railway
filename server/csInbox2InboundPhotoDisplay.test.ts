import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const componentPath = resolve(process.cwd(), "client/src/components/CsInbox2.tsx");
const source = readFileSync(componentPath, "utf8");

describe("CsInbox2 inbound MMS photo display", () => {
  it("retains persisted media URLs while normalizing detail messages", () => {
    expect(source).toContain("media: (m.media ?? []) as string[]");
  });

  it("renders media thumbnails within the existing message bubble", () => {
    expect(source).toContain("m.media && m.media.length > 0");
    expect(source).toContain('alt="MMS photo"');
    expect(source).toContain("onClick={() => openLightbox(m.media!, mediaIndex)}");
    expect(source).toContain("{m.text && linkify(m.text)}");
  });

  it("uses the established CsInbox lightbox interactions without changing message sends", () => {
    expect(source).toContain("const [lightbox, setLightbox]");
    expect(source).toContain("if (event.key === \"Escape\") closeLightbox()");
    expect(source).toContain('title="Open original"');
    expect(source).not.toContain("sendMessage.mutate({ media");
  });
});
