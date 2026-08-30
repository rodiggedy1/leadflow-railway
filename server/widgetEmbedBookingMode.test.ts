import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const embedSource = readFileSync(new URL("./widgetEmbed.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const popupPageSource = readFileSync(new URL("../client/src/pages/BookWidget.tsx", import.meta.url), "utf8");
const bookingRendererSource = readFileSync(new URL("../client/src/components/BookingWidgetConfigPanel.tsx", import.meta.url), "utf8");

describe("reversible Maids in Black booking embed", () => {
  it("keeps the installed website script URL and serves uncached cross-origin JavaScript", () => {
    expect(embedSource).toContain('<script src="https://quote.maidinblack.com/api/widget.js" async></script>');
    expect(embedSource).toContain('app.get("/api/widget.js"');
    expect(embedSource).toContain('res.setHeader("Access-Control-Allow-Origin", "*")');
    expect(embedSource).toContain('res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate")');
  });

  it("uses one explicit booking-or-SMS switch with booking as the reversible default", () => {
    expect(embedSource).toContain('const WIDGET_CONTENT_MODE: "booking" | "sms" = "booking"');
    expect(embedSource).toContain('var CONTENT_MODE = \'${contentMode}\'');
    expect(embedSource).toContain("var isBooking = CONTENT_MODE === 'booking'");
    expect(embedSource).toContain("if (isBooking) {");
    expect(embedSource).toContain("} else {");
  });

  it("preserves the exact existing launcher geometry, pulse, toggle, and dismissal behavior", () => {
    for (const marker of [
      "bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'",
      "right: '16px'",
      "width: '60px'",
      "height: '60px'",
      "animation: 'mib-ping 1.8s ease-out infinite'",
      "icon.textContent = '\\uD83D\\uDCAC'",
      "setOpen(!state.open)",
      "state.dismissed = true; setOpen(false)",
    ]) expect(embedSource).toContain(marker);
  });

  it("preserves the 15-second auto-open and one-shot top-edge exit intent rules", () => {
    expect(embedSource).toContain("}, 15000)");
    expect(embedSource).toContain("if (!state.open && !state.dismissed)");
    expect(embedSource).toContain("document.addEventListener('mouseleave'");
    expect(embedSource).toContain("if (exitTriggered) return");
    expect(embedSource).toContain("if (state.dismissed) return");
    expect(embedSource).toContain("if (e.clientY > 5) return");
    expect(embedSource).not.toContain("localStorage");
    expect(embedSource).not.toContain("sessionStorage");
  });

  it("loads the new popup from the same host that served the unchanged embed", () => {
    expect(embedSource).toContain("var scriptElement = document.currentScript");
    expect(embedSource).toContain("new URL(scriptElement.src).origin");
    expect(embedSource).toContain("src: API_BASE + '/book/widget'");
    expect(embedSource).toContain("id: 'mib-booking-frame'");
    expect(embedSource).toContain("title: 'Book with Maids in Black'");
    expect(embedSource).toContain("function applyPanelLayout() {");
    expect(embedSource).toContain("var isCompact = window.innerWidth < 592");
    expect(embedSource).toContain("right: isCompact ? '12px' : '24px'");
    expect(embedSource).toContain("width: isCompact ? 'calc(100vw - 24px)' : 'min(500px, calc(100vw - 32px))'");
    expect(embedSource).toContain("window.addEventListener('resize', applyPanelLayout)");
  });

  it("uses the narrower 500px desktop width and full-screen mobile geometry without changing legacy SMS dimensions", () => {
    expect(embedSource).toContain("width: isBooking ? 'min(500px, calc(100vw - 32px))' : '340px'");
    for (const marker of [
      "bottom: '0'",
      "right: '0'",
      "left: '0'",
      "width: '100vw'",
      "height: '100dvh'",
      "maxHeight: '100dvh'",
      "borderRadius: '0'",
    ]) expect(embedSource).toContain(marker);
    expect(embedSource).toContain("right: '16px'");
    expect(embedSource).toContain("width: isMobile ? 'auto' : '340px'");
    expect(embedSource).toContain("borderRadius: '16px'");
  });

  it("uses a thin public popup route and does not duplicate booking or pricing logic", () => {
    expect(appSource).toContain('const BookWidget = lazy(() => import("./pages/BookWidget"))');
    expect(appSource).toContain('<Route path={"/book/widget"} component={BookWidget} />');
    expect(popupPageSource).toContain('import BookingExperience from "@/components/BookingExperience"');
    expect(popupPageSource).toContain('<BookingExperience surface="popup" />');
    for (const prohibited of ["trpc.", "bookingFunnel", "calculate", "pricing", "fetch(", "useMutation"]) {
      expect(popupPageSource).not.toContain(prohibited);
    }
  });

  it("renders the live popup edge-to-edge without changing full-page or editor shells", () => {
    expect(bookingRendererSource).toContain('surface === "popup" ? "h-dvh bg-[#f5f5f3] p-0"');
    expect(bookingRendererSource).toContain('surface === "popup" ? "h-dvh w-full max-w-none"');
    expect(bookingRendererSource).toContain('surface === "popup" ? "h-dvh"');
    expect(bookingRendererSource).toContain('surface === "popup" ? "flex h-dvh flex-col rounded-none border-0 shadow-none"');
    expect(bookingRendererSource).toContain('mode === "live" && surface === "popup" ? "flex min-h-0 flex-1 flex-col overflow-hidden p-0"');
    expect(bookingRendererSource).toContain('mode === "live" && surface === "popup" ? "min-h-0 flex-1 max-w-none rounded-none border-0 shadow-none"');
    expect(bookingRendererSource).toContain('mode === "live" && surface === "popup" ? "min-h-0 flex-1" : "h-[680px] xl:h-auto xl:min-h-0 xl:flex-1"');
    expect(bookingRendererSource).toContain('<form onSubmit={(event) => { event.preventDefault(); submitComposer(); }} className="shrink-0');
    expect(bookingRendererSource).toContain('"max-w-[720px] rounded-[28px] border border-[#dfe0e2] shadow-[0_28px_80px_rgba(17,17,17,0.16)] xl:min-h-0 xl:flex-1"');
    expect(bookingRendererSource).toContain('"mx-auto w-full max-w-[760px]"');
    expect(embedSource).toContain("panel.appendChild(header)");
    expect(embedSource).toContain("panel.appendChild(body)");
    expect(embedSource).toContain("panel.appendChild(footer)");
  });

  it("retains the complete legacy SMS renderer and endpoint for one-setting rollback", () => {
    for (const marker of [
      "Text Me Now \\u2192",
      "/api/trpc/quotes.submitWidgetLead?batch=1",
      "form.addEventListener('submit', handleSubmit)",
      "panel.appendChild(header)",
      "panel.appendChild(body)",
      "panel.appendChild(footer)",
    ]) expect(embedSource).toContain(marker);
  });
});
