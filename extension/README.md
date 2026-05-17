# LeadFlow × Thumbtack Chrome Extension

Generates Madison's first message for accepted Thumbtack leads and sends it via both Thumbtack and SMS.

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer Mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `thumbtack-extension` folder
5. The "M" icon will appear in your Chrome toolbar

## First-time Setup

Click the ⚙ gear icon in the extension popup and set your LeadFlow URL:
- `https://quote.maidinblack.com`

Make sure you're logged into LeadFlow in Chrome before using the extension.

## How to Use

1. Go to Thumbtack and accept a lead
2. The extension icon will show a badge (orange dot)
3. Click the extension icon — it shows the lead info and generates Madison's message
4. Review/edit the message
5. Click **Send via SMS + Thumbtack** — it sends on Thumbtack AND via SMS, and updates the lead drawer

## Manual Mode

If the extension doesn't auto-detect the lead (selectors may need updating), click "or enter lead info manually" and fill in the details.

## Updating Thumbtack Selectors

When a new lead comes in, open Chrome DevTools (F12) on the Thumbtack lead page and find the correct CSS selectors for:
- Customer name
- Phone number
- Service type
- Description/Q&A

Then update `content.js` — the selector variables are clearly labeled at the top of `extractLeadData()`.

## Files

- `manifest.json` — Extension config
- `content.js` — Runs on Thumbtack pages, detects leads, injects messages
- `background.js` — Service worker, routes messages between content script and popup
- `popup.html` / `popup.js` — The popup UI and API logic
