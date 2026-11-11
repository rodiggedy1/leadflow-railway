import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const head = "ad59ceeb3feae17548e4b345ec781f1f5ddef131";

const hiddenSelectors = [
  ".br-first-page .br-editorial",
  ".br-first-page .br-trust",
  ".br-first-page .br-card-heading p",
  ".br-second-page .br2-hero h1",
  ".br-second-page .br2-hero-subtitle",
  ".br-second-page .br2-hero-proof",
  ".br-second-page .br2-benefit-card",
  ".br-second-page .br2-review-quote",
  ".br-second-page .br2-extra > img",
  ".br-second-page .br2-extra > .br2-extra-icon",
  ".br-third-page .br2-hero h1",
  ".br-third-page .br2-hero-subtitle",
  ".br-third-page .br2-hero-proof",
  ".br-third-page .br3-testimonial",
  ".br-third-page .br3-guarantee",
] as const;

const publicFiles = [
  "client/src/components/approved-book/FirstPage.tsx",
  "client/src/components/approved-book/SecondPage.tsx",
  "client/src/components/approved-book/TrustSections.tsx",
  "client/src/pages/Book.tsx",
] as const;

describe("staff exact-public presentation boundary", () => {
  it("hides only approved editorial and trust selectors under the staff surface", () => {
    const css = read(
      "client/src/components/internal-booking/internal-booking-shell.css"
    );
    const scope = ".internal-exact-booking-shell.approved-book-surface";
    const hideBlock = css.slice(
      css.indexOf(`${scope} .br-first-page .br-editorial`),
      css.indexOf(
        "\n}\n",
        css.indexOf(`${scope} .br-first-page .br-editorial`)
      ) + 2
    );

    expect(hideBlock).toContain("display: none;");
    for (const selector of hiddenSelectors) {
      expect(hideBlock).toContain(`${scope} ${selector}`);
    }
    expect(hideBlock).not.toContain(".literal-book-");
    expect(hideBlock).not.toContain(".internal-booking-");
    expect(css).toContain(`${scope} .br-first-page .br-hero`);
    expect(css).toContain(`${scope} .br-first-page .br-hero-inner`);
  });

  it("keeps the approved public screens byte-identical to the authorized HEAD", () => {
    for (const file of publicFiles) {
      expect(read(file)).toBe(
        execFileSync("git", ["show", `${head}:${file}`], {
          cwd: root,
          encoding: "utf8",
          env: { PATH: process.env.PATH },
        })
      );
    }
  });

  it("keeps real staff form controls, payment paths, and controller wiring present", () => {
    const internal = read(
      "client/src/components/internal-booking/InternalPublicBook.tsx"
    );
    const controls = read(
      "client/src/components/approved-book/InternalBookingControls.tsx"
    );
    const payment = read(
      "client/src/components/internal-booking/InternalApprovedBookPayment.tsx"
    );
    const api = read(
      "client/src/components/internal-booking/InternalExactBookingApi.ts"
    );
    const session = read(
      "client/src/components/internal-booking/InternalExactBookingSession.ts"
    );

    for (const marker of [
      "<ApprovedBookFirstPage",
      "<ApprovedBookSecondPage",
      "<ApprovedBookPayment",
      "discountPercent",
      "onNext",
      "onBack",
      "notes",
      "dateValue",
      "onDateChange",
    ]) {
      expect(internal).toContain(marker);
    }
    for (const marker of [
      "internal-booking-amount-control",
      "internal-booking-no-payment-control",
      "Final booking amount ($)",
      "Book without payment",
    ]) {
      expect(controls).toContain(marker);
    }
    for (const marker of ["Card", "Cash App", "Payment", "onBack"]) {
      expect(payment).toContain(marker);
    }
    for (const marker of [
      "prepare",
      "startSetup",
      "confirmSetup",
      "finalize",
      "prepareCashApp",
      "settleCashApp",
      "abandonCashApp",
    ]) {
      expect(api).toContain(marker);
    }
    expect(session).toContain("prepare");
    expect(session).toContain("requireTarget");
  });
});
