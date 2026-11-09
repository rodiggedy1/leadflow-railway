# Invoice payments using the existing Stripe integration

Invoice card payments reuse `getStripeClient()` and the same server-only `STRIPE_SECRET_KEY` used by existing booking payment flows. No additional payment credential, new Stripe destination, table migration, or login-secret change is required for invoice creation and card checkout.

## Private invoice links

If a dedicated `INVOICE_TOKEN_SECRET` is already configured, it remains authoritative and must be at least 32 characters. When absent or empty, a server-only invoice-specific HMAC key is derived from the existing Stripe API secret using the fixed context `leadflow:invoice-token-key:v1`. That derived key creates the existing opaque invoice links; neither it nor the Stripe credential is returned to the browser or logged. The legacy JWT is never used.

The Stripe API secret must remain stable for reconstructing previously issued links when using the derived key. Rotating it changes subsequently reconstructed links; previously distributed tokens are still checked against their stored hashes. Do not add or change a dedicated override casually: that also changes reconstructed links. The existing explicit dedicated-key behavior is unchanged.

Production uses `https://quote.maidinblack.com`, not the old global quote-site URL. Explicit Preview mode uses its configured Railway domain. No environment variable is changed by this correction.

## Amount and confirmed payment

The admin records prior payments against the selected dates. After a confirmed save, all eligible dates in the returned billing period are selected so the summary shows gross service value, already-paid value, and the unpaid remainder. Staff can still explicitly narrow the selection before issuing the invoice. Paid dates remain visible and cannot be charged again through the invoice checkout.

The customer chooses unpaid service dates or selects all and pays their server-calculated outstanding balance in the existing Stripe-hosted card Checkout. Creating or sending an invoice does not charge a card. This feature does not initiate off-session saved-card charges or automatically send email/SMS.

Payment is confirmed through the existing authenticated server-to-Stripe Checkout retrieval in invoice refresh/resume. Invoice, attempt, provider session, payment mode, amount, currency, marker, reference, and payment ID must match before durable allocation. The browser's return URL and claimed success are not payment evidence. Failed provider retrieval does not mark an invoice paid. Allocation remains transactionally idempotent.

## Optional signed webhook

The existing invoice webhook remains optional for checkout readiness. If `INVOICE_STRIPE_WEBHOOK_SECRET` is configured, the raw-body route still verifies Stripe's signature before accepting an event. Missing secrets, unsigned/tampered bodies, wrong secrets, and unrelated identity do not bypass verification. No new webhook is provisioned by this correction, and older Stripe handlers are unchanged.

Without webhook delivery, LeadFlow confirms payment when the invoice is reopened or the customer uses Check payment status/Resume. A customer who pays but never returns can leave the local payment status pending until that explicit check occurs. There is no new polling or background synchronizer. Automatic refund notification also requires a configured signed webhook; Stripe-side refunds without delivered events require staff review rather than assuming the local ledger has updated.

## Validation and release

All validation uses synthetic clients, mock storage/payment processors, and network-isolated tests. This document does not create an invoice, payment, email, webhook, schema, or configuration value. Local checks do not prove the running deployment or a real transaction; Production release requires separate approval.
