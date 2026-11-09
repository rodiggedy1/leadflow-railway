# Invoice-only configuration correction

The invoice code no longer reads `QUOTE_APP_URL` for its Production origin, uses `JWT_SECRET` for invoice links, or uses `STRIPE_WEBHOOK_SECRET` for its dedicated webhook. Those existing settings and all login and older payment handlers remain unchanged.

Production invoice requests and return links use `https://quote.maidinblack.com`. Preview uses its configured `RAILWAY_PUBLIC_DOMAIN` when `PREVIEW_MODE=true`. An absent Preview domain retains the canonical Production fallback; do not use that fallback to test customer payments from an unrelated Preview domain.

## Required payment settings

Keep the existing `STRIPE_SECRET_KEY` for the intended Stripe account and mode. Add two **invoice-only** Railway service variables:

- `INVOICE_TOKEN_SECRET`: a cryptographically random private key, at least 32 characters. A suitable value is 32 random bytes encoded as 64 hexadecimal characters. Keep it stable across releases; changing it changes the links reconstructed for already issued invoices. Do not reuse or change the login secret.
- `INVOICE_STRIPE_WEBHOOK_SECRET`: the endpoint-specific Stripe signing secret for the invoice webhook below. It is not the Stripe API key, the older webhook's secret, or a local CLI forwarding secret. Stripe assigns distinct signing secrets by endpoint and by test/live mode.[1]

A private key can be generated in the user's own Console with `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'`. Copy it privately into Railway Variables; do not paste it into task chat, commit it, place it in client-side variables, or include it in a URL. This document does not generate or set a real key.

## Dedicated Stripe endpoint

In the same Stripe account and mode used by the existing API key, add a new **Account / snapshot-event** webhook destination. Leave existing destinations and their subscriptions unchanged.[2]

The destination URL is `https://quote.maidinblack.com/api/payable-invoices/stripe-webhook`. The inspected route verifies the raw request body using Stripe's `Stripe-Signature` header. It does not accept a query secret and rejects query parameters; **do not append a cron secret**. Use the endpoint's signing secret as `INVOICE_STRIPE_WEBHOOK_SECRET` in Railway. No live destination has been created as part of this local correction.

Subscribe to the events supported by the existing invoice service: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`, and `charge.refunded`. Use the same compatible snapshot API version as the existing SDK, `2026-05-27.dahlia`, where the account permits selecting it. Do not select connected-account events for this implementation.

The dedicated route rejects unsigned, tampered or incorrectly signed payloads. Verified unrelated events are ignored. Invoice events still require the existing invoice marker and provider-confirmed session, amount, currency, invoice/attempt identity, payment reference and mode before durable settlement. A failed settlement is not acknowledged as success.

## Readiness and release boundaries

Client lookup and explicitly initiated prior-payment recording no longer require invoice signing or Stripe webhook configuration. Creating a payable invoice and creating or resuming customer checkout require all three payment settings server-side; an API caller cannot bypass this by ignoring the button state. Admin readiness names missing settings without returning their values. Merely having settings present does not prove a live key, webhook delivery or account identity is correct.

The code patch can be released only after separate deployment approval. Actual Railway variables and the Stripe destination also require their authorized setup; exporting variables in an interactive Console does not configure the already running server. No configuration changes, provider calls, database queries, invoices or charges are performed by this document.

The observed domain/signing failures prevented the reported lookup from reaching its normal data path. Correcting those gates does not prove the supplied client exists or that July 22–November 7 services and unpaid amounts are available. The existing exact identity and service-payment checks remain in place and return a review error rather than fabricating bookings or balances.

## References

[1]: https://docs.stripe.com/webhooks "Stripe raw-body signature verification and endpoint signing secrets"
[2]: https://docs.stripe.com/development/dashboard/webhooks "Stripe adding a separate Account webhook endpoint"
