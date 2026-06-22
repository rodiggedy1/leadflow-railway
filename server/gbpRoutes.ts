/**
 * gbpRoutes.ts — Google Business Profile OAuth + test endpoints
 *
 * Routes:
 *   GET /api/gbp/oauth/start    → redirects to Google consent screen
 *   GET /api/gbp/oauth/callback → exchanges code, stores refresh token
 *   GET /api/gbp/test           → verifies access, lists accounts + locations
 */
import type { Express } from "express";
import {
  getGbpAuthUrl,
  exchangeGbpCodeForTokens,
  clearGbpRefreshTokenCache,
  listGbpAccounts,
  listGbpLocations,
} from "./gbpService";
import { getDb } from "./db";
import { gbpState } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export function registerGbpRoutes(app: Express) {
  // ── OAuth: initiate ──────────────────────────────────────────────────────────
  app.get("/api/gbp/oauth/start", (_req, res) => {
    const url = getGbpAuthUrl();
    res.redirect(url);
  });

  // ── OAuth: callback ──────────────────────────────────────────────────────────
  app.get("/api/gbp/oauth/callback", async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("Missing code");
    try {
      const tokens = await exchangeGbpCodeForTokens(code);
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        return res.status(400).send(
          "No refresh token returned. Make sure you revoked previous GBP access and try again."
        );
      }
      const db = await getDb();
      if (!db) return res.status(500).send("DB not available");
      await db
        .insert(gbpState)
        .values({ id: 1, refreshToken, accountName: "", locationName: "" })
        .onDuplicateKeyUpdate({ set: { refreshToken } });
      clearGbpRefreshTokenCache();
      console.log("[GBP] OAuth complete — refresh token stored");
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px">
          <h2>✅ Google Business Profile connected!</h2>
          <p>Refresh token stored. You can close this tab.</p>
          <p><strong>Next step:</strong> Verify access by visiting 
          <a href="/api/gbp/test">/api/gbp/test</a></p>
        </body></html>
      `);
    } catch (err) {
      console.error("[GBP] OAuth callback error:", err);
      res.status(500).send("OAuth error: " + String(err));
    }
  });

  // ── Test: verify access + list accounts/locations ────────────────────────────
  app.get("/api/gbp/test", async (_req, res) => {
    try {
      const accountsRes = await listGbpAccounts();
      const accounts = accountsRes.accounts ?? [];
      if (accounts.length === 0) {
        return res.json({ ok: false, message: "No GBP accounts found for this Google account." });
      }

      // List locations for each account
      const results = await Promise.all(
        accounts.map(async (acct) => {
          try {
            const locRes = await listGbpLocations(acct.name);
            return { account: acct, locations: locRes.locations ?? [] };
          } catch (e) {
            return { account: acct, locations: [], error: String(e) };
          }
        })
      );

      res.json({ ok: true, accounts: results });
    } catch (err) {
      console.error("[GBP] Test error:", err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ── Save account + location selection ────────────────────────────────────────
  app.post("/api/gbp/setup", async (req, res) => {
    const { accountName, locationName } = req.body as { accountName: string; locationName: string };
    if (!accountName || !locationName) {
      return res.status(400).json({ error: "accountName and locationName required" });
    }
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "DB not available" });
      await db
        .update(gbpState)
        .set({ accountName, locationName })
        .where(eq(gbpState.id, 1));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
