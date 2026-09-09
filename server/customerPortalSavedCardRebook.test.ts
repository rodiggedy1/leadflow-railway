import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal saved-card rebook", () => {
  it("automatically completes the existing authorized saved-card association before showing portal rebook confirmation", async () => {
    const [checkout, bookingPage, paymentRouter] = await Promise.all([
      readFile(path.resolve(root, "client/src/components/BookingPaymentCheckout.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "server/bookingPaymentRouter.ts"), "utf8"),
    ]);

    expect(checkout).toContain("autoUseSavedCard?: boolean");
    expect(checkout).toContain("const savedCardAutoReservationStarted = useRef(false);");
    expect(checkout).toContain("if (!autoUseSavedCard || !savedCard || paymentChoice !== \"saved\" || savedCardAutoReservationStarted.current) return;");
    expect(checkout).toContain("void reserveWithSavedCard();");
    expect(checkout).toContain("Finalizing your appointment…");
    expect(checkout).toContain('autoUseSavedCard ? "Saved payment method" : "Secure card on file"');
    expect(checkout).toContain("Your saved card is securely on file and will reserve this appointment.");
    expect(checkout).toContain('checkoutError && <button type="button" onClick={() => void reserveWithSavedCard()}');
    expect(bookingPage).toContain("autoUseSavedCard={Boolean(portalRebook?.savedCard)}");
    expect(bookingPage).toContain("if (portalRebook) { setDone(true); return; }");
    expect(bookingPage).toContain("Finalizing your appointment.");
    expect(paymentRouter).toContain("function affectedRows(result: unknown): number {");
    expect(paymentRouter.indexOf("function affectedRows(result: unknown): number {")).toBeLessThan(paymentRouter.indexOf("reuseSavedCard: publicProcedure"));
    expect(paymentRouter).toContain('if (affectedRows(result) !== 1) throw new TRPCError({ code: "CONFLICT", message: "The payment method changed. Please try again." });');
    expect(paymentRouter).toContain("void sendBookingCompletionNotifications(target.bookingId).catch");
  });

  it("creates a Command Chat card only for a freshly created, signed portal booking lead while retaining the existing widget lead path", async () => {
    const [sharedInput, bookingPage, funnelRouter, notifications] = await Promise.all([
      readFile(path.resolve(root, "shared/bookingFunnel.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "server/bookingFunnelRouter.ts"), "utf8"),
      readFile(path.resolve(root, "server/bookingLeadCreatedNotifications.ts"), "utf8"),
    ]);

    expect(sharedInput).toContain("portalLeadCard: z.literal(true).optional()");
    expect(bookingPage).toContain("portalLeadCard: portalRebook ? true : undefined");
    expect(bookingPage).toContain("const captureLeadOnOpen = embedded || Boolean(portalRebook);");
    expect(funnelRouter).toContain("if (input.portalLeadCard) {");
    expect(funnelRouter).toContain("portalSession.customerPhone !== normalized.customerPhone");
    expect(funnelRouter).toContain("if (created && input.portalLeadCard)");
    expect(funnelRouter).toContain("sendCustomerPortalLeadCreatedCommandChatCard(row.publicFunnelNumber)");
    expect(funnelRouter).toContain('if (created && normalized.source === "widget-popup")');
    const portalNotice = notifications.slice(notifications.indexOf("export async function sendCustomerPortalLeadCreatedCommandChatCard"));
    expect(portalNotice).toContain('channel: "command"');
    expect(portalNotice).toContain('quickAction: "new_lead"');
    expect(portalNotice).toContain('source: "customer_portal"');
    expect(portalNotice).toContain('broadcastOpsUpdate("new_message", { channel: "command" })');
    expect(portalNotice).not.toContain("sendSms(");
  });
});
