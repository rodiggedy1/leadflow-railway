# LeadFlow Quote Form — TODO

- [x] Build quote form UI (warm coral design, Playfair Display + DM Sans)
- [x] Add form fields: Name, Email, Phone, Service Type, Bedrooms, Bathrooms
- [x] Add staggered entrance animations and success state
- [x] Upgrade project to full-stack (tRPC + DB)
- [x] Store OpenPhone API key as secret
- [x] Add quote_leads table to DB schema for storing submissions
- [x] Build tRPC mutation: submitQuote (saves lead + sends OpenPhone SMS)
- [x] Connect QuoteForm frontend to tRPC submitQuote mutation
- [x] Write vitest test for submitQuote procedure
- [x] Test end-to-end: form submit → SMS received on phone (11/11 tests pass)
