import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("../client/src/pages/InternalBooking", () => ({
  InternalBooking: () => React.createElement("div", { "data-testid": "exact-internal-booking" }, "Exact internal booking"),
}));
import InternalBookingReview from "../client/src/pages/InternalBookingReview";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Booking CRM New booking actual entry", () => {
  it("keeps the existing CRM destination and registered internal route", () => {
    const crm = read("client/src/pages/BookingsCRMExactLive.tsx");
    const app = read("client/src/App.tsx");
    expect(crm).toContain('window.location.assign("/review/internal-booking")');
    expect(app).toContain('const InternalBookingReview = lazy(() => import("./pages/InternalBookingReview"))');
    expect(app).toContain('<Route path={"/review/internal-booking"} component={InternalBookingReview} />');
    expect(app).toContain('<Route path={"/book"}');
  });
  it("renders the exact replacement internal component from the registered destination", () => {
    expect(renderToStaticMarkup(React.createElement(InternalBookingReview))).toContain('data-testid="exact-internal-booking"');
    const entry = read("client/src/pages/InternalBooking.tsx");
    expect(entry).toContain("<InternalBookingWrapper onClose={onClose} />");
    const wrapper = read("client/src/components/internal-booking/InternalBookingWrapper.tsx");
    expect(wrapper).toContain("<InternalPublicBook");
  });
  it("retains the existing internal route close/back behavior", () => {
    const back = vi.fn();
    vi.stubGlobal("window", { history: { back } });
    const element = InternalBookingReview();
    element.props.onClose();
    expect(back).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.stubGlobal("React", React);
  });
  it("does not leave a separate older native booking controller at the CRM destination", () => {
    const entry = read("client/src/pages/InternalBookingReview.tsx");
    expect(entry).toContain('import { InternalBooking } from "./InternalBooking"');
    expect(entry).not.toContain("createInternal.useMutation");
    expect(entry).not.toContain("startInternalCardSetup.useMutation");
    expect(entry).not.toContain("useCanonicalBookingFlow");
  });
});
