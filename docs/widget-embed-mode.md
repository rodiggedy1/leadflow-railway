# Maids in Black Widget Embed Mode

The Maids in Black WordPress site keeps the same installed code:

```html
<script src="https://quote.maidinblack.com/api/widget.js" async></script>
```

The opened content is controlled inside `server/widgetEmbed.ts` by one typed constant:

```ts
const WIDGET_CONTENT_MODE: "booking" | "sms" = "booking";
```

| Value | Opened content |
|---|---|
| `booking` | The existing Book with AI experience rendered by `/book/widget` with `surface="popup"` |
| `sms` | The preserved legacy name-and-phone SMS form and its existing submission endpoint |

The launcher and triggers are shared by both modes: the same coral button, pulse, lower-right placement, manual toggle, 15-second auto-open, top-edge exit intent, and page-session dismissal behavior.

## Reverting to the previous SMS popup

1. Change only `WIDGET_CONTENT_MODE` from `"booking"` to `"sms"`.
2. Increment `WIDGET_VERSION` so the served script can be identified.
3. Run `server/widgetEmbedBookingMode.test.ts`, `server/widgetLead.test.ts`, and the full build.
4. Deploy the normal LeadFlow application. No WordPress or Maids in Black website edit is required.

The exact preview baseline before the booking-renderer change is commit `add3e2fc`.
