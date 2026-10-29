# Apple Pay official implementation sources

This file preserves the externally verified source requirements used for the Apple Pay-only `/book` implementation. Cash App is intentionally out of scope.

## Stripe Apple Pay for web

URL: https://docs.stripe.com/apple-pay.md?platform=web

- Elements integrations must register every test and production domain that displays Apple Pay.
- Stripe handles Apple merchant validation; no separate Apple Merchant ID/certificate flow is needed for this web Elements use case.
- Apple Pay payments are customer-initiated.
- The native sheet must be triggered by a user gesture.
- Merchant tokens are Stripe's recommended solution only for merchant-initiated recurring/deferred/automatic-reload charges. This implementation charges the first cleaning immediately and creates no recurring/deferred wallet arrangement.
- Test Apple Pay using test API keys and a real card in an Apple Wallet; Stripe does not show Apple Pay where device/integration requirements are unmet.

## Stripe Express Checkout Element

URL: https://docs.stripe.com/elements/express-checkout-element

- The Express Checkout Element renders active, supported, configured one-click methods.
- Apple Pay can be ordered/configured and its native button type can be `book`.
- The Element can detect availability through `availablepaymentmethodschange`.
- Apple Pay on non-Safari desktop browsers needs `paymentMethods.applePay: "always"`; this can surface Apple’s sign-in/cross-device experience only on otherwise supported platforms.
- The Element supports method-level controls; non-Apple methods must be set to `never` for this Apple-only surface.

## Stripe ECE JavaScript reference

URL: https://docs.stripe.com/js/elements_object/create_express_checkout_element

- ECE `paymentMethods` defaults to every Dashboard-enabled method.
- `amazonPay`, `applePay`, `googlePay`, `link`, `paypal`, and `klarna` can be set to `never`.
- Apple Pay may be set to `always` on supported platforms, but cannot be forced on an unsupported platform/currency.

## Stripe availability event

URL: https://docs.stripe.com/js/elements_object/express_checkout_element_availablepaymentmethodschange_event

- Fires at initial ECE render and whenever available buttons change.
- `paymentMethods.applePay.available` indicates whether native Apple Pay will render.
- If no buttons render, the event has `paymentMethods: undefined`.

## Stripe PaymentIntent ECE flow

URL: https://docs.stripe.com/elements/express-checkout-element/accept-a-payment.md?payment-ui=elements

- The server creates the PaymentIntent for a server-decided amount and currency.
- The Elements instance amount/currency must match the PaymentIntent.
- On wallet confirmation, client calls `elements.submit()`, then server creates/retrieves the intent, then `stripe.confirmPayment` using that Elements instance and client secret.
- Use `redirect: "if_required"` to avoid an unnecessary redirect for an Apple Pay-only branch.

## Apple Human Interface Guidelines

URL: https://developer.apple.com/design/human-interface-guidelines/apple-pay

- Offer Apple Pay on all supported devices/browsers, but do not present it as a payment option if the device does not support it.
- When a wallet is available, Apple Pay may be primary but need not be the sole choice.
- Use Apple-provided/API-generated payment controls; do not recreate a custom Apple Pay payment button.
- Apple Pay supports nearby iPhone/Apple Watch and QR-code continuation on compatible browsers.
- Clearly show the amount charged at authorization.
