import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const widgetSource = fs.readFileSync(path.resolve("client/src/components/BookingWidgetConfigPanel.tsx"), "utf8");
const bookingPageSource = fs.readFileSync(path.resolve("client/src/pages/BookNow.tsx"), "utf8");
const bookingPageStyles = fs.readFileSync(path.resolve("client/src/pages/book-now.css"), "utf8");
const appSource = fs.readFileSync(path.resolve("client/src/App.tsx"), "utf8");
const embedSource = fs.readFileSync(path.resolve("server/widgetEmbed.ts"), "utf8");

describe("installed Maids in Black guide-first widget contract", () => {
  it("keeps the installed external launcher and its existing /book/widget iframe target", () => {
    expect(embedSource).toContain("app.get(\"/api/widget.js\"");
    expect(embedSource).toContain("src: API_BASE + '/book/widget'");
    expect(embedSource).toContain("btn.style.display = val ? 'none' : '-webkit-flex'");
    expect(embedSource).toContain("width: isCompact ? 'calc(100vw - 24px)' : 'min(470px, calc(100vw - 32px))'");
  });

  it("renders a guide first and keeps the Book Home Cleaning action visible independently of Q&A", () => {
    const guideStart = widgetSource.indexOf('if (mode === "live" && surface === "popup")');
    const guideSource = widgetSource.slice(guideStart);

    expect(guideStart).toBeGreaterThan(-1);
    expect(guideSource).toContain("data-widget-guide-shell");
    expect(guideSource).toContain("GUIDE_SHORTCUTS.map");
    expect(guideSource).toContain('aria-label="Ask Madison a question"');
    expect(widgetSource).toContain("bookingFaqMutation.mutateAsync({ question })");
    expect(guideSource).toContain("data-guide-history");
    expect(guideSource).toContain("data-book-home-cleaning");
    expect(guideSource).toContain("Book Home Cleaning");
    expect(guideSource).toContain("onClick={() => setBookingPanelOpen(true)}");
    expect(guideSource).toContain("sticky bottom-0");
    expect(guideSource.indexOf("data-book-home-cleaning")).toBeLessThan(guideSource.indexOf('aria-label="Ask Madison a question"'));
    expect(widgetSource).toContain("const guideConversationRef = useRef<HTMLDivElement>(null)");
    expect(widgetSource).toContain("const guideLatestMessageRef = useRef<HTMLDivElement>(null)");
    expect(widgetSource).toContain("const guideBookingBarRef = useRef<HTMLDivElement>(null)");
    expect(widgetSource).toContain("const visibleBottom = Math.min(containerRect.bottom, bookingBarRect.top) - 12");
    expect(widgetSource).toContain("container.scrollTo({ top: container.scrollTop + delta, behavior: \"smooth\" })");
    expect(guideSource).toContain("pb-24");
  });

  it("opens the existing real booking-page flow inside the live widget panel and returns to the guide", () => {
    expect(widgetSource).toContain('import BookNow from "@/pages/BookNow"');
    expect(widgetSource).toContain("return <BookNow embedded onClose={closeBookingPanel} />");
    expect(widgetSource).toContain("const closeBookingPanel = () => setBookingPanelOpen(false)");
    expect(bookingPageSource).toContain("export default function BookNow({ embedded = false, onClose }: BookNowProps)");
    expect(bookingPageSource).toContain('source: embedded ? "widget-popup" : "book-page"');
    expect(bookingPageSource).toContain("trpc.bookingFunnel.begin.useMutation()");
    expect(bookingPageSource).toContain("trpc.bookingFunnel.update.useMutation()");
    expect(bookingPageSource).toContain("trpc.bookingFunnel.reserve.useMutation()");
    expect(bookingPageSource).toContain("BookingPaymentCheckout");
    expect(bookingPageSource).toContain('const pageClassName = embedded ? "mib-booking-panel" : "book-now-page"');
    expect(bookingPageSource).toContain('className="mib-booking-panel__header"');
    expect(bookingPageSource).toContain('aria-label="Close booking panel"');
    expect(bookingPageSource).toContain('aria-label="Return to Madison"');
    expect(bookingPageSource).toContain("const embeddedPanelRef = useRef<HTMLElement | null>(null)");
    expect(bookingPageSource).toContain("embeddedPanelRef.current?.scrollTo({ top: 0, behavior: \"smooth\" })");
    expect(bookingPageSource).toContain("}, [embedded, step, done])");
    expect(bookingPageSource).toContain("if (!embedded || funnelRecordRef.current || leadCapturePromiseRef.current) return");
    expect(bookingPageSource).toContain('validateBookingWidgetIntakeField("fullName", fullName) || validateBookingWidgetIntakeField("phone", phone)');
    expect(bookingPageSource).toContain("void captureLeadIfReady()");
    expect(bookingPageStyles).toContain("overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none");
    expect(bookingPageStyles).toContain(".mib-booking-panel::-webkit-scrollbar{display:none;width:0;height:0}");
  });

  it("removes the mistaken standalone mock route instead of exposing a second widget surface", () => {
    expect(appSource).not.toContain("GuideBookingMock");
    expect(appSource).not.toContain('/mock/guide-booking');
  });

  it("keeps the desktop popup at its original size and lowers only its bottom anchor", () => {
    expect(embedSource).toContain("bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'");
    expect(embedSource).toContain("height: 'min(860px, calc(100vh - 120px))'");
    expect(embedSource).toContain("height: isBooking ? 'min(860px, calc(100vh - 120px))' : 'auto'");
  });
});
