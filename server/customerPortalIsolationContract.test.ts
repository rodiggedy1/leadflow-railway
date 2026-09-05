import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_PORTAL_SERVICES } from "../shared/customerPortalServices";

const root = process.cwd();

describe("customer portal isolation", () => {
  it("contains the complete twelve-service catalog with service-specific form fields", () => {
    expect(CUSTOMER_PORTAL_SERVICES).toHaveLength(12);
    expect(CUSTOMER_PORTAL_SERVICES.map(service => service.id)).toEqual(["tv-mounting", "furniture-assembly", "picture-hanging", "minor-home-repairs", "handyman", "plumbing", "electrical-lighting", "interior-painting", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"]);
    expect(CUSTOMER_PORTAL_SERVICES.every(service => service.fields.length > 0)).toBe(true);
  });

  it("shows the approved six-service portal preview with the remaining catalog behind View all services", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    const expectedFeaturedIds = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"];
    expect(CUSTOMER_PORTAL_SERVICES.filter(service => expectedFeaturedIds.includes(service.id)).map(service => service.id)).toEqual(expectedFeaturedIds);
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "moving-help")?.detail).toBe("One helper for two hours · no truck");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "lawn-yard-care")?.detail).toBe("Small maintained lawn · mow, edge, and blow");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "junk-removal")?.detail).toBe("Small curbside or one-eighth truckload pickup");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "pressure-washing")?.detail).toBe("Small ground-level patio or walkway");
    expect(CUSTOMER_PORTAL_SERVICES.find(service => service.id === "furniture-assembly")?.detail).toBe("Small or standard item · two-hour minimum");
    expect(source).toContain('const FEATURED_SERVICE_IDS = ["furniture-assembly", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"] as const;');
    expect(source).toContain('const [activePage, setActivePage] = useState<PortalPage>("home");');
    expect(source).toContain('activePage === "services"');
    expect(source).toContain("CUSTOMER_PORTAL_SERVICES.map(service =>");
    expect(source).toContain('<h3>Home cleaning</h3>');
    expect(source).toContain('>View all services <ArrowRight /></button>');
    expect(source).toContain('const SERVICE_CTAS: Record<string, string>');
    expect(source).toContain('"furniture-assembly": "Get it assembled"');
    expect(source).toContain('"moving-help": "Get moving"');
    expect(source).toContain('"lawn-yard-care": "Take care of my yard"');
    expect(source).toContain('"junk-removal": "Remove my junk"');
    expect(source).toContain('"pressure-washing": "Get it cleaned"');
    expect(source).toContain('<em>{SERVICE_CTAS[service.id] ?? "Start request"} <ArrowRight /></em>');
    expect(source).toContain("Starting at {formatCurrency(service.startingPrice * 100)}");
    expect(source).toContain('className="mib-direct-services"');
    expect(source).toContain('className="mib-direct-services-top"');
    expect(source).toContain('className="mib-direct-services-bottom"');
    expect(source).toContain('"furniture-assembly": "Small or standard item"');
    expect(source).toContain("FEATURED_CARD_DETAILS[service.id] ?? service.detail");
    expect(source).toContain("calculateCustomerPortalEstimate(service.id, selections)");
  });

  it("uses a neutral Maids in Black portal surface with coral reserved for precise accents", async () => {
    const css = await readFile(path.resolve(root, "client/src/pages/customer-portal.css"), "utf8");
    expect(css).toContain("--mib-coral:#e8603c");
    expect(css).toContain("--mib-coral-dark:#c94a28");
    expect(css).toContain("--mib-warm-bg:#faf9f6");
    expect(css).toContain("--mib-border:#e9e6e0");
    expect(css).toContain(".mib-portal-stats article{display:flex");
    expect(css).toContain("background:#fff;box-shadow");
    expect(css).not.toContain("#173829");
    expect(css).not.toContain("#41654c");
  });

  it("uses prepared editorial imagery only for the Home-page hero and six featured service tiles", async () => {
    const [portal, css] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-home-images.css"), "utf8"),
    ]);
    expect(portal).toContain('import "./customer-portal-home-images.css";');
    expect(portal).toContain('aria-label="A calm, tidy bedroom"');
    expect(css).toContain('mib-direct-hero-art{background:#f4eee7 url("https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/eEjrlBbNDTdDTFIp.jpg")');
    expect(css).toContain("CeurSjYieOVYNFdH.jpg");
    expect(css).toContain("hiFnKvnLmkAvHHSU.jpg");
    expect(css).toContain("erclJpDjctKWACGq.jpg");
    expect(css).toContain("FWpVcxbFXceBwwph.jpg");
    expect(css).toContain("QPfMHaCigljjuJlQ.jpg");
  });

  it("keeps staff portal-request failure outside the existing Bookings and Leads load/error gate", async () => {
    const source = await readFile(path.resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
    expect(source).toContain("trpc.customerPortal.staffRequests.useQuery");
    expect(source).toContain("(listQuery.isLoading || funnelListQuery.isLoading)");
    expect(source).toContain("(listQuery.error || funnelListQuery.error)");
    expect(source).not.toContain("portalRequestsQuery.isLoading ||");
    expect(source).not.toContain("portalRequestsQuery.error ||");
  });

  it("uses Joe-style same-response portal sessions only for direct book-now completions while preserving widget handoff", async () => {
    const [payment, checkout, bookingPage, widget, portalPage] = await Promise.all([
      readFile(path.resolve(root, "server/bookingPaymentRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/components/BookingPaymentCheckout.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "server/widgetEmbed.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
    ]);
    expect(payment).toContain('if (record.source !== "book-page") return false;');
    expect(payment).toContain("ensureCustomerPortalAccount(db");
    expect(payment).toContain("signCustomerPortalSession({");
    expect(payment).toContain("ctx.res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, sessionToken");
    expect(payment).toContain("...getSessionCookieOptions(ctx.req)");
    expect(payment).toContain("Direct customer portal session creation failed");
    const startSetup = payment.slice(payment.indexOf("startSetup:"), payment.indexOf("confirmSetup:"));
    const confirmSetup = payment.slice(payment.indexOf("confirmSetup:"));
    expect(startSetup.indexOf("const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);")).toBeGreaterThan(startSetup.indexOf('if (target.profile.paymentStatus === "card_on_file")'));
    expect(confirmSetup.indexOf("const directPortalSessionReady = await establishDirectPortalSession(ctx, db, record);")).toBeGreaterThan(confirmSetup.indexOf("await db.transaction"));
    expect(payment).toContain("portalAccessCode");
    expect(payment).toContain('if (target.profile.paymentStatus === "card_on_file")');
    expect(payment).toContain('if (record.source !== "book-page") try {');
    expect(payment).toContain('return { alreadyComplete: true, bookingId: target.bookingId, paymentStatus: "card_on_file" as const, portalAccessCode, directPortalSessionReady }');
    expect(checkout).toContain('portalAccessCode: result.portalAccessCode');
    expect(checkout).toContain("directPortalSessionReady: result.directPortalSessionReady");
    expect(checkout).toContain("onComplete(result)");
    expect(bookingPage).toContain('if (result.directPortalSessionReady) { window.location.assign("/my-home"); }');
    expect(bookingPage).toContain('"https://maidsinblack.com"');
    expect(bookingPage).toContain('if (embedded && window.parent !== window) { if (!result.portalAccessCode) return;');
    expect(bookingPage).not.toContain("/customer-portal/handoff?access=");
    expect(widget).toContain("event.data.type === 'mib-booking-widget-portal'");
    expect(widget).toContain("event.source === bookingFrame.contentWindow");
    expect(widget).toContain("/customer-portal/handoff?access=");
    expect(widget).toContain("event.data.type !== 'mib-booking-widget-close'");
    expect(portalPage).not.toContain("redeemHandoff.useMutation");
    expect(portalPage).not.toContain('get("access")');
  });

  it("keeps customer portal procedures limited to the dedicated router and route", async () => {
    const [app, router] = await Promise.all([readFile(path.resolve(root, "client/src/App.tsx"), "utf8"), readFile(path.resolve(root, "server/routers.ts"), "utf8")]);
    expect(app).toContain('const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));');
    expect(app).toContain('<Route path={"/my-home"} component={CustomerPortal} />');
    expect(router).toContain("customerPortal: customerPortalRouter");
  });

  it("keeps the Payments page visual treatment on the existing saved-card and secure new-card setup controls", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain('activePage === "payments"');
    expect(source).toContain("mib-direct-payment-layout");
    expect(source).toContain("{savedCardLabel}");
    expect(source).toContain("startNewCardSetup.mutateAsync().then(setNewCardSetup)");
    expect(source).toContain("<PortalNewCardForm");
  });

  it("keeps the Account page visual treatment on the existing customer, home, and secure-access fields", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain('activePage === "account"');
    expect(source).toContain("mib-direct-account-overview");
    expect(source).toContain("{portal.data.account.name}");
    expect(source).toContain("{portal.data.account.phone}");
    expect(source).toContain('{portal.data.account.email ?? "Email not saved"}');
    expect(source).toContain('{homeAddress || "Address saved with booking"}');
    expect(source).toContain("Secure portal access");
  });

  it("keeps the Home-footer portrait treatment on its existing services and quick-service actions", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain("mib-direct-ask-photo");
    expect(source).toContain("AELCGmPvHfefwVla.webp");
    expect(source).toContain('onClick={() => goToPage("services")}');
    expect(source).toContain('onClick={() => openService("home-cleaning")}');
    expect(source).toContain('onClick={() => openService("furniture-assembly")}');
    expect(source).toContain('onClick={() => openService("lawn-yard-care")}');
    expect(source).toContain('onClick={() => openService("moving-help")}');
  });

  it("keeps the full footer portrait free of browse and support overlays", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    const footer = source.slice(source.indexOf('<footer className="mib-direct-ask"'), source.indexOf("</footer>") + "</footer>".length);
    expect(footer).toContain('className="mib-direct-ask-photo"');
    expect(footer).toContain('className="mib-direct-footer-links"');
    expect(footer).not.toContain("mib-direct-ask-launcher");
    expect(footer).not.toContain("mib-direct-footer-help");
    expect(footer).not.toContain("Customer portal");
  });

  it("keeps the review presentation responsive without replacing desktop composition or portal actions", async () => {
    const [homeCss, pageCss] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/customer-portal-home-reference-refinement.css"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-sidebar-pages.css"), "utf8"),
    ]);
    expect(homeCss).toContain("@media(max-width:650px)");
    expect(homeCss).toContain(".mib-direct-services-top,.mib-direct-services-bottom{grid-template-columns:1fr");
    expect(homeCss).toContain(".mib-direct-footer-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(homeCss).toContain(".mib-direct-hero-art{order:2");
    expect(homeCss).toContain("@media(min-width:981px){.mib-direct-hero{position:relative;display:block");
    expect(pageCss).toContain(".mib-direct-page-title .mib-direct-button{width:100%");
    expect(pageCss).toContain(".mib-direct-bookings-review,.mib-direct-payment-layout{gap:12px}");
    expect(pageCss).toContain(".mib-direct-service-catalog{gap:12px}");
  });

  it("uses an accessible tap-to-open mobile menu without replacing the desktop sidebar", async () => {
    const [source, css] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-home-reference-refinement.css"), "utf8"),
    ]);
    expect(source).toContain("const [mobileNavOpen, setMobileNavOpen] = useState(false);");
    expect(source).toContain('className="mib-direct-mobile-menu"');
    expect(source).toContain('aria-controls="mib-direct-mobile-navigation"');
    expect(source).toContain("aria-expanded={mobileNavOpen}");
    expect(source).toContain("setMobileNavOpen(open => !open)");
    expect(source).toContain("setMobileNavOpen(false); window.scrollTo");
    expect(source).toContain('id="mib-direct-mobile-navigation"');
    expect(css).toContain("@media(min-width:651px){.mib-direct-mobile-menu{display:none}");
    expect(css).toContain(".mib-direct-sidebar.mobile-open{display:block}");
  });

  it("connects the Home summary to the existing live Bookings page without an undefined scroll helper", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain('onClick={() => goToPage("bookings")}>View and manage <ArrowRight /></button>');
    expect(source).not.toContain('scrollToSection("mib-bookings")');
  });
});
