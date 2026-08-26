import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/components/CsInbox2.tsx"),
  "utf8",
);
const modalStart = componentSource.indexOf("function NewMessageModal");
const modalEnd = componentSource.indexOf("\nexport default function CsInbox2", modalStart);
const modalSource = componentSource.slice(modalStart, modalEnd);

describe("CsInbox2 New Message modal dismissal", () => {
  it("does not use the full-screen backdrop as a dismissal target", () => {
    expect(modalSource).toContain('zIndex:9999}}>');
    expect(modalSource).not.toContain('zIndex:9999}} onClick={onClose}>');
  });

  it("keeps only explicit close controls and successful sends as dismissal paths", () => {
    expect((modalSource.match(/onClick=\{onClose\}/g) ?? [])).toHaveLength(3);
    expect(modalSource).toContain('onSuccess: () => { onConvOpened(phone); onClose(); },');
  });
});
