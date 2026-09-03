import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.resolve("client/src/App.tsx"), "utf8");
const mockSource = fs.readFileSync(path.resolve("client/src/pages/GuideBookingMock.tsx"), "utf8");

describe("guide-first booking mock route", () => {
  it("keeps the review route isolated and publicly reachable", () => {
    expect(appSource).toContain('const GuideBookingMock = lazy(() => import("./pages/GuideBookingMock"));');
    expect(appSource).toContain('<Route path={"/mock/guide-booking"} component={GuideBookingMock} />');
  });

  it("keeps a persistent booking action and a separate presentation-only panel", () => {
    expect(mockSource).toContain("Book Home Cleaning");
    expect(mockSource).toContain("onClick={() => setPanelOpen(true)}");
    expect(mockSource).toContain("Preview only — no lead or booking is created.");
    expect(mockSource).toContain("This is the existing booking flow, now separate from the guide.");
    expect(mockSource).not.toContain("bookingFunnel.");
    expect(mockSource).not.toContain("useMutation");
  });
});
