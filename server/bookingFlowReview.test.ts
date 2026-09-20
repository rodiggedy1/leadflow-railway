import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "client/src/pages/BookingFlowReview.tsx"), "utf8");
const styles = readFileSync(resolve(root, "client/src/pages/booking-flow-review.css"), "utf8");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");

describe("Booking Flow review route", () => {
  it("keeps the visual review isolated from the live booking route and payment behavior", () => {
    expect(app).toContain('const BookingFlowReview = lazy(() => import("./pages/BookingFlowReview"));');
    expect(app).toContain('<Route path={"/review/book-now"} component={BookingFlowReviewRoute} />');
    expect(page).toContain("VISUAL REVIEW ONLY");
    expect(page).not.toContain("trpc.");
    expect(page).not.toContain("BookingPaymentCheckout");
    expect(page).not.toContain("bookingFunnel");
  });

  it("contains the supplied eight-step visual booking journey and review-only confirmation state", () => {
    for (const label of ["Cleaning Type", "Home Details", "Home Condition", "Extras", "Date & Time", "Your Info", "Payment", "Review & Book"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("What can we help you with?");
    expect(page).toContain("Tell us about your home");
    expect(page).toContain("How much love does your home need?");
    expect(page).toContain("Add any extras?");
    expect(page).toContain("When works for you?");
    expect(page).toContain("Your information");
    expect(page).toContain("Thanks for booking!");
    expect(page).toContain("You’re booked!");
    expect(page).toContain("Everything looks good");
  });

  it("uses the supplied bedroom, kitchen, and boxes images in first-step service order", () => {
    expect(page).toContain('import standardBedroom from "@/assets/book-now-review/standard-bedroom.png"');
    expect(page).toContain('import deepKitchen from "@/assets/book-now-review/deep-kitchen.png"');
    expect(page).toContain('import moveoutBoxes from "@/assets/book-now-review/moveout-boxes.png"');
    expect(page).toContain('id: "standard", title: "Standard Cleaning"');
    expect(page).toContain('image: standardBedroom');
    expect(page).toContain('image: deepKitchen');
    expect(page).toContain('image: moveoutBoxes');
  });

  it("uses the supplied living-room image only for the Step 2 reassurance rail", () => {
    expect(page).toContain('import homeDetailsRail from "@/assets/book-now-review/home-details-rail.png"');
    expect(page).toContain("step === 2 ? homeDetailsRail");
  });

  it("uses the supplied bathroom image for the Step 4 top-right reassurance rail", () => {
    expect(page).toContain('import extrasBathroomRail from "@/assets/book-now-review/extras-bathroom-rail.png"');
    expect(page).toContain("step === 4 ? extrasBathroomRail");
  });

  it("maps the supplied Page 4 extras images to their named tiles", () => {
    expect(page).toContain('["cabinets", "Interior Cabinets", "Wipe down inside cabinets.", 30, extrasCabinets]');
    expect(page).toContain('["inside-fridge", "Inside Fridge", "We’ll clean the inside and outside.", 25, extrasFridge]');
    expect(page).toContain('["baseboards", "Baseboards", "Dust and wipe all baseboards.", 20, extrasBaseboards]');
    expect(page).toContain('["laundry", "Laundry", "Wash, dry and fold one load.", 20, extrasLaundry]');
    expect(page).toContain('["inside-oven", "Inside Oven", "Remove grease and residue.", 25, extrasOven]');
    expect(page).toContain('["windows", "Windows (Interior)", "Clean interior windows and sills.", 20, extrasWindows]');
    expect(page).toContain('["fans", "Ceiling Fans", "Dust and wipe ceiling fans.", 15, extrasCeilingFans]');
    expect(page).toContain('import extrasDoors from "@/assets/book-now-review/extras-doors.png"');
    expect(page).toContain('["doors", "Interior Doors", "Wipe down doors and frames.", 15, extrasDoors]');
  });

  it("uses a full-width Step 3 condition canvas without a reassurance rail", () => {
    expect(page).toContain('step === 3 ? " booking-review-card--condition" : ""');
    expect(page).toContain("step !== 1 && step !== 3 && <aside className=\"booking-review-rail\">");
    expect(page).toContain("const CONDITION_IMAGES");
    expect(page).toContain('className="booking-condition-choices"');
    expect(page).toContain('className="booking-condition-track"');
    expect(page).toContain('className="booking-condition-value" aria-hidden="true" style={{ left: `${percent}%` }}>{value}</output>');
    expect(page).toContain('className="booking-condition-slider"');
    expect(page).toContain('className="booking-condition-feedback"');
    expect(page).toContain("Next: Extras");
    expect(styles).toContain(".booking-review-card--condition{grid-template-columns:minmax(0,1fr);max-width:1440px}");
    expect(styles).toContain(".booking-condition-choices{display:grid;grid-template-columns:repeat(10,minmax(0,1fr))");
  });

  it("uses the supplied images for all ten Step 3 conditions", () => {
    expect(page).toContain('import spotlessHouse from "@/assets/book-now-review/condition-01-spotless-house-ui.png"');
    expect(page).toContain('import refreshedHouse from "@/assets/book-now-review/condition-02-refresh-house-ui.png"');
    expect(page).toContain('import normalSofa from "@/assets/book-now-review/condition-03-sofa-ui.png"');
    expect(page).toContain('import livedInHouse from "@/assets/book-now-review/condition-04-lived-in-house-ui.png"');
    expect(page).toContain('import prettyLivedInSofa from "@/assets/book-now-review/condition-05-pretty-lived-in-sofa-ui.png"');
    expect(page).toContain('import laundryBasket from "@/assets/book-now-review/condition-06-laundry-basket-ui.png"');
    expect(page).toContain('import goodGlovesHouse from "@/assets/book-now-review/condition-07-good-gloves-ui.png"');
    expect(page).toContain('import aTeamCleaningKit from "@/assets/book-now-review/condition-08-a-team-cleaning-kit-ui.png"');
    expect(page).toContain('import reinforcementsBoxes from "@/assets/book-now-review/condition-09-reinforcements-boxes-ui.png"');
    expect(page).toContain('import trashBags from "@/assets/book-now-review/condition-10-trash-bags-ui.png"');
    expect(page).toContain("const CONDITION_IMAGES = [spotlessHouse, refreshedHouse, normalSofa, livedInHouse, prettyLivedInSofa, laundryBasket, goodGlovesHouse, aTeamCleaningKit, reinforcementsBoxes, trashBags]");
    expect(page).toContain('<img src={CONDITION_IMAGES[index]} alt="" />');
    expect(styles).toContain(".booking-condition-choices button{display:grid;grid-template-rows:65px minmax(52px,auto) 28px;justify-items:center;align-items:center;gap:20px");
    expect(styles).toContain(".booking-condition-choices button>span:nth-child(2){align-self:start;max-width:136px;min-height:52px;margin-top:14px;text-align:center}");
    expect(styles).toContain(".booking-condition-emoji>img{width:100%;height:65px;object-fit:contain}");
    expect(styles).toContain(".booking-condition-slider{padding:70px 46px 0}");
    expect(styles).toContain(".booking-condition-value{position:absolute;top:50%;display:grid;place-items:center;width:86px;height:86px");
  });

  it("locks the warm editorial shell and responsive review layout", () => {
    expect(styles).toContain("--cream:#fbf8f3");
    expect(styles).toContain("grid-template-columns:250px minmax(0,1fr)");
    expect(styles).toContain("font-family:\"Playfair Display\"");
    expect(styles).toContain("grid-template-columns:minmax(0,1fr) 365px");
    expect(page).toContain('step === 1 ? " booking-review-card--service" : step === 3 ? " booking-review-card--condition" : ""');
    expect(page).toContain("step !== 1 && step !== 3 && <aside className=\"booking-review-rail\">");
    expect(styles).toContain(".booking-review-card--service{grid-template-columns:minmax(0,1fr);max-width:1440px}");
    expect(styles).toContain("@media(max-width:1500px)");
  });

  it("does not introduce the prohibited legacy booking path", () => {
    for (const prohibited of ["cleaner" + "Jobs", "cleaner" + "_jobs"]) {
      expect(page).not.toContain(prohibited);
      expect(styles).not.toContain(prohibited);
    }
  });
});
