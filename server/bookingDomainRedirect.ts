import type { Express, NextFunction, Request, Response } from "express";

export const BOOKING_HOST = "book.maidsinblack.com";
export const OLD_BOOKING_HOST = "quote.maidinblack.com";

type Options = { redirectOldDomain?: boolean };

/**
 * Reads the Host header directly instead of req.hostname so this does not depend on
 * `trust proxy`, which is intentionally unset (enabling it would change req.ip and
 * req.protocol for the rest of the app). Railway forwards the public Host header.
 */
function requestHost(req: Request): string {
  return (req.headers.host ?? "").split(":")[0].toLowerCase();
}

/**
 * Serves the public booking form at the root of book.maidsinblack.com.
 * Only GET/HEAD requests for exactly "/", "/book" or "/book/" are considered, so
 * /admin, /api/*, Stripe webhooks, static assets, /book/widget, /book/:token and
 * /book-now always fall through untouched. The query string is preserved.
 */
export function bookingDomainRedirect(options: Options = {}) {
  const redirectOldDomain = options.redirectOldDomain ?? process.env.REDIRECT_OLD_BOOKING_DOMAIN === "true";
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const isBookPath = req.path === "/book" || req.path === "/book/";
    const isRootPath = req.path === "/";
    if (!isBookPath && !isRootPath) return next();

    const host = requestHost(req);
    const queryIndex = req.originalUrl.indexOf("?");
    const search = queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex);

    if (host === BOOKING_HOST && isBookPath) return res.redirect(301, `/${search}`);
    // Off by default; enable with REDIRECT_OLD_BOOKING_DOMAIN=true once the new domain is verified.
    if (redirectOldDomain && host === OLD_BOOKING_HOST) return res.redirect(301, `https://${BOOKING_HOST}/${search}`);
    next();
  };
}

export function registerBookingDomainRedirect(app: Express, options: Options = {}): void {
  app.use(bookingDomainRedirect(options));
}
