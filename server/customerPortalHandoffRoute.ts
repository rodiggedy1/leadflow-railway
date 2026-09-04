import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { signCustomerPortalSession } from "./_core/customerPortalAuth";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { redeemCustomerPortalHandoff } from "./customerPortalService";

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

type PortalHandoffDependencies = {
  getDb: typeof getDb;
  redeem: typeof redeemCustomerPortalHandoff;
  sign: typeof signCustomerPortalSession;
};

const defaultDependencies: PortalHandoffDependencies = {
  getDb,
  redeem: redeemCustomerPortalHandoff,
  sign: signCustomerPortalSession,
};

export function createCustomerPortalHandoffHandler(dependencies: PortalHandoffDependencies = defaultDependencies) {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    const code = typeof req.query.access === "string" ? req.query.access : "";
    if (!HANDOFF_CODE_PATTERN.test(code)) return res.redirect(303, "/my-home");

    try {
      const db = await dependencies.getDb();
      if (!db) return res.redirect(303, "/my-home");
      const account = await dependencies.redeem(db, code);
      if (!account) return res.redirect(303, "/my-home");

      const token = await dependencies.sign({
        accountId: account.id,
        customerName: account.customerName,
        customerPhone: account.customerPhone,
      });
      res.cookie(CUSTOMER_PORTAL_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_MS,
      });
      return res.redirect(303, "/my-home");
    } catch (error) {
      console.error("[CustomerPortalHandoff] Redemption failed:", error);
      return res.redirect(303, "/my-home");
    }
  };
}

export function registerCustomerPortalHandoffRoute(app: Express) {
  app.get("/customer-portal/handoff", createCustomerPortalHandoffHandler());
}
