# Google Business Profile Reviews — Project Status

## What's Done
- GBP OAuth flow built and deployed to production (`/api/gbp/oauth/start`, `/api/gbp/oauth/callback`, `/api/gbp/test`)
- `gbp_state` table created in DB to store refresh token, accountName, locationName
- OAuth authorized successfully — refresh token stored in DB
- `business.manage` scope added to OAuth consent screen in maidsinblack inbox project
- My Business Account Management API + My Business Business Information API enabled in Google Cloud

## Blocker
- Google's My Business Account Management API has a **default quota of 0 requests/minute**
- Requires a formal quota increase application (Google API quota request form)
- Even for single-business owners, Google requires this application
- User gave up on this approach for now

## Options When Resuming
1. **Submit Google quota increase request** — go to Cloud Console → APIs → mybusinessaccountmanagement.googleapis.com → Quotas → request increase. Usually approved within hours-days.
2. **Use a third-party scraping API** (no Google approval needed):
   - Outscraper: https://outscraper.com/google-maps-reviews-api/
   - DataForSEO: https://dataforseo.com/apis/google-reviews-api
   - SerpApi: https://serpapi.com/google-maps-reviews
   - Cost: ~$0.001-0.005 per review fetch
3. **Headless browser scraping** — Heartbeat cron visits GBP page, extracts reviews with Puppeteer/Playwright

## Next Steps (when resuming)
- If quota approved: build polling cron in `server/gbpReviewsCron.ts`, `google_reviews` DB table, AI reply draft generation, review panel in CommandChat
- If using third-party API: swap `gbpService.ts` API calls for the chosen provider's endpoint

## Files
- `server/gbpService.ts` — GBP OAuth helpers + API calls
- `server/gbpRoutes.ts` — OAuth routes + test endpoint
- `drizzle/schema.ts` — `gbpState` table (lines at bottom)
