import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cssPath = "client/src/pages/schedule-crm-exact-live.css";
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const baselineCommit = "166ab595dfd7730dad3da1b6ba5ab03fc767c918";
const baselineCss = execFileSync("git", ["show", `${baselineCommit}:${cssPath}`], { cwd: root, encoding: "utf8" });

const newColorBlock = `/* All customer cards share the same brown surface, independent of job or interaction state. */
.schedule-crm-exact-live .scr-job-card,
.schedule-crm-exact-live .scr-job-card:hover,
.schedule-crm-exact-live .scr-job-card.is-selected,
.schedule-crm-exact-live .scr-job-card.is-conflict { background: #2b201e; }

`;

const protectedBaselineHashes: Record<string, string> = {
  "client/src/pages/LeadflowScheduleCRMExactLive.tsx": "2b0c38bd4bc1f8b729928d2d9fe6a31a8ec1ec1acfa8a87a82cbc643908bb6c3",
  "client/src/components/LeadflowScheduleMap.tsx": "40fc78dd10c7de5f7d37d3248493d2e2ec449d9495bf56562ceb510c5f9a6886",
  "server/leadflowScheduleRouter.ts": "04dee4e6e8a5716afaa1e762e0f54ba5aeddd7078c5748255aa1fc997a22a605",
  "server/leadflowScheduleAssignmentDefaults.ts": "e1e77768e24889430e528f2dc5ec21329694d45f81edd431be5e0ccdcbec585a",
  "server/leadflowScheduleCallsRouter.ts": "216340489c7e6eec9afacfb94ff006e212e4abab9ef17e5e4c45117af713be61",
  "client/src/pages/schedule-crm-review.css": "59f71a787bf16a65613ed34510191c02c88fef0a870313a7a9061995f6a84ce4",
  "client/src/pages/schedule-card-density.css": "4f8c41a718be0c1bdb2913082e099cfcaca161d3c47a81f3be472e818b2a644f",
  "client/src/pages/schedule-palette-balance.css": "5bd60ecd8d1ac06e17fe229a3467e98ba39622675f630ce29fa50a7657f5c154",
  "client/src/pages/schedule-identity-portraits.css": "b9007109671acdd6ee1742f1c5945c3c526019c9aea26c00889d54a673b096c3",
  "client/src/pages/schedule-leads-cohesion.css": "d11781b01c593d501bcf680ee5821ece83c54c8637e92f57c041a873abfbf255",
};

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

describe("Schedule customer-card color-only override", () => {
  it("covers normal, hover, selected, and conflict card states with the same scoped brown", () => {
    const css = read(cssPath);
    expect(css.match(new RegExp(newColorBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);

    const rule = newColorBlock.slice(newColorBlock.indexOf(".schedule-crm-exact-live"));
    const [selectorText, declarationText] = rule.slice(0, -1).split(" {");
    expect(selectorText.split(",\n")).toEqual([
      ".schedule-crm-exact-live .scr-job-card",
      ".schedule-crm-exact-live .scr-job-card:hover",
      ".schedule-crm-exact-live .scr-job-card.is-selected",
      ".schedule-crm-exact-live .scr-job-card.is-conflict",
    ]);
    expect(declarationText.trim()).toBe("background: #2b201e; }");
  });

  it("has no color override properties beyond the one background declaration", () => {
    const rule = newColorBlock.slice(newColorBlock.indexOf(".schedule-crm-exact-live"));
    const declaration = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"));
    expect(declaration.match(/[\w-]+\s*:/g)).toEqual(["background:"]);
    expect(declaration.trim()).toBe("background: #2b201e;");
  });

  it("removes exactly the new block back to the pinned CSS baseline and preserves protected sources", () => {
    const css = read(cssPath);
    expect(css.replace(newColorBlock, "")).toBe(baselineCss);

    for (const [relativePath, expectedHash] of Object.entries(protectedBaselineHashes)) {
      expect(sha256(read(relativePath)), relativePath).toBe(expectedHash);
    }
  });
});
