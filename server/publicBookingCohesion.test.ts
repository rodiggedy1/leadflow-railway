import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (name: string) => readFileSync(resolve(root, name), "utf8");

describe("approved /book visual cohesion", () => {
  const app = read("client/src/App.tsx");
  const css = read("client/src/components/public-booking-cohesion.css")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/\s+!important/g, "!important")
    .replace(/0\.56/g, ".56");
  const header = read("client/src/components/PublicBookingHeader.tsx");
  const book = read("client/src/pages/Book.tsx");

  it("confines the wrapper to the existing standalone public booking route", () => {
    expect(app.match(/className="public-booking-cohesion approved-book-surface"/g)).toHaveLength(1);
    expect(app).toContain(
      '<Route path={"/book"} component={PublicBookingRoute} />'
    );
    expect(app).toContain(
      '<Route path={"/book/:token"} component={CustomerBookingLinkLive} />'
    );
    expect(app).toContain("<PublicBookingHeader /><Book />");
    const selectors = [
      ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g),
    ];
    for (const [, selector] of selectors) {
      expect(selector.trim()).toMatch(
        /^(?:\.public-booking-cohesion|@font-face|@media)/
      );
    }
    expect(css).not.toMatch(
      /(?:^|})\s*(?:html|body|#root|button|input|textarea)\s*[{,]/
    );
    expect(css).toContain('font-family:"MIB Book Poppins"');
  });

  it("uses only the approved background and CSS brand display without changing the booking canvas width", () => {
    expect(css).toContain("modern-home-dark-stone.webp");
    expect(css).toContain("rgba(15,16,14,.56)");
    expect(css).toContain('content:"ONLINE BOOKING"');
    expect(css).toContain("maids-in-black-logo.svg");
    const shell = css.match(/\.literal-book-shell\{([^}]+)\}/)?.[1] ?? "";
    expect(shell).toContain("border-color:transparent!important");
    expect(shell).toContain("background-clip:padding-box");
    expect(shell).not.toMatch(/(?:^|;)(?:width|height|padding|margin|grid|display):/);
    expect(css).not.toContain("review-tools");
    expect(css).not.toContain("review-payment-block");
  });

  it("keeps the header stateless with only approved static links", () => {
    expect(header).toContain('href="https://maidsinblack.com/"');
    expect(header).toContain('href="tel:+12028885362"');
    expect(header).toContain('className="br-site-header"');
    expect(header).toContain("Back to website");
    expect(header).not.toMatch(/useState|useEffect|trpc|onClick|fetch\(/);
  });

  it("retains direct card entry and the established card, wallet, Cash App and finalization controls", () => {
    for (const marker of [
      "<PublicBookingCardSetupBeforeReservation",
      "<BookingWalletCardOnFileCheckout",
      "<BookingCashAppCheckout",
      "const finalizeConfirmedCard = async () =>",
      "void finalizeConfirmedCard();",
      "trpc.bookingFunnel.reserve.useMutation",
      "trpc.bookingPayments.finalize.useMutation",
    ])
      expect(book).toContain(marker);
    expect(book).not.toContain("public-booking-cohesion");
    expect(book).not.toContain(["review", "Jump"].join(""));
    expect(book).not.toContain(["Live requests", " disabled"].join(""));
    expect(css).not.toMatch(/pointer-events\s*:\s*none|opacity\s*:\s*0/);
  });
});
