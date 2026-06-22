/**
 * gbpService.ts — Google Business Profile OAuth + Reviews API
 *
 * Uses the same GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET credentials.
 * The GBP OAuth token is stored separately in gbp_state (id=1).
 * Scope: https://www.googleapis.com/auth/business.manage
 */
import { google } from "googleapis";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { gbpState } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ── Redirect URI for GBP OAuth (separate from Gmail) ─────────────────────────
const GBP_REDIRECT_URI = "https://quote.maidinblack.com/api/gbp/oauth/callback";

// ── In-memory refresh token cache ────────────────────────────────────────────
let _cachedRefreshToken: string | null = null;

export function clearGbpRefreshTokenCache() {
  _cachedRefreshToken = null;
}

async function getRefreshToken(): Promise<string | null> {
  if (_cachedRefreshToken) return _cachedRefreshToken;
  const db = await getDb();
  if (!db) return null;
  const [state] = await db.select().from(gbpState).where(eq(gbpState.id, 1));
  if (state?.refreshToken) {
    _cachedRefreshToken = state.refreshToken;
    return _cachedRefreshToken;
  }
  return null;
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    ENV.gmailClientId,
    ENV.gmailClientSecret,
    GBP_REDIRECT_URI
  );
}

export async function getAuthedOAuth2Client() {
  const client = getOAuth2Client();
  const token = await getRefreshToken();
  if (!token) throw new Error("GBP not connected. Run OAuth first: /api/gbp/oauth/start");
  client.setCredentials({ refresh_token: token });
  return client;
}

export function getGbpAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/business.manage"],
  });
}

export async function exchangeGbpCodeForTokens(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  clearGbpRefreshTokenCache();
  return tokens;
}

// ── GBP API helpers ───────────────────────────────────────────────────────────

/** List all GBP accounts for the authenticated user */
export async function listGbpAccounts() {
  const auth = await getAuthedOAuth2Client();
  const res = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${await getAccessToken(auth)}` } }
  );
  if (!res.ok) throw new Error(`GBP accounts error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ accounts?: Array<{ name: string; accountName: string; type: string }> }>;
}

/** List all locations for an account */
export async function listGbpLocations(accountName: string) {
  const auth = await getAuthedOAuth2Client();
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`,
    { headers: { Authorization: `Bearer ${await getAccessToken(auth)}` } }
  );
  if (!res.ok) throw new Error(`GBP locations error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ locations?: Array<{ name: string; title: string }> }>;
}

/** List reviews for a location */
export async function listGbpReviews(locationName: string, pageToken?: string) {
  const auth = await getAuthedOAuth2Client();
  let url = `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=50`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getAccessToken(auth)}` }
  });
  if (!res.ok) throw new Error(`GBP reviews error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{
    reviews?: GbpReview[];
    nextPageToken?: string;
    totalReviewCount?: number;
    averageRating?: number;
  }>;
}

/** Post a reply to a review */
export async function replyToGbpReview(reviewName: string, comment: string) {
  const auth = await getAuthedOAuth2Client();
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await getAccessToken(auth)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    }
  );
  if (!res.ok) throw new Error(`GBP reply error: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Helper: get a fresh access token from the OAuth2 client */
async function getAccessToken(auth: ReturnType<typeof getOAuth2Client>): Promise<string> {
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("Failed to get GBP access token");
  return token;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GbpReview {
  name: string; // e.g. "accounts/123/locations/456/reviews/abc"
  reviewId: string;
  reviewer: {
    profilePhotoUrl?: string;
    displayName: string;
    isAnonymous?: boolean;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string; // ISO 8601
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}
