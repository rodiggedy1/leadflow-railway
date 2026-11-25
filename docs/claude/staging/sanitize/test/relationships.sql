-- TEST ONLY: how many records still link up across tables (by phone, email, person or team), plus row counts.
-- Run before and after sanitizing; the numbers must be identical.
SELECT 'lead phone -> job phone' AS link, COUNT(*) AS n FROM conversation_sessions a JOIN leadflow_jobs b ON RIGHT(REGEXP_REPLACE(a.leadPhone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(b.customerPhone,'[^0-9]',''),10)
UNION ALL SELECT 'stripe customer phone -> payment authorization phone', COUNT(*) FROM stripe_customers a JOIN payment_authorizations b ON RIGHT(REGEXP_REPLACE(a.phone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(b.customerPhone,'[^0-9]',''),10)
UNION ALL SELECT 'cleaner job customer phone -> lead phone', COUNT(*) FROM cleaner_jobs a JOIN conversation_sessions b ON RIGHT(REGEXP_REPLACE(a.customerPhone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(b.leadPhone,'[^0-9]',''),10)
UNION ALL SELECT 'booking email -> portal account email', COUNT(*) FROM bookings a JOIN customer_portal_accounts b ON LOWER(a.customerEmail) = LOWER(b.customerEmail)
UNION ALL SELECT 'cleaner job cleaner name -> cleaner profile name', COUNT(*) FROM cleaner_jobs a JOIN cleaner_profiles b ON LOWER(a.cleanerName) = LOWER(b.name)
UNION ALL SELECT 'job team name -> scheduling team name', COUNT(*) FROM leadflow_jobs a JOIN scheduling_teams b ON LOWER(a.teamName) = LOWER(b.name)
UNION ALL SELECT 'lead name -> job customer name', COUNT(*) FROM conversation_sessions a JOIN leadflow_jobs b ON LOWER(a.leadName) = LOWER(b.customerName)
UNION ALL SELECT 'rows: conversation_sessions', COUNT(*) FROM conversation_sessions
UNION ALL SELECT 'rows: leadflow_jobs', COUNT(*) FROM leadflow_jobs
UNION ALL SELECT 'rows: bookings', COUNT(*) FROM bookings
UNION ALL SELECT 'rows: payable_invoices', COUNT(*) FROM payable_invoices
UNION ALL SELECT 'sum: leadflow_jobs.jobTotalCents', COALESCE(SUM(jobTotalCents), 0) FROM leadflow_jobs
UNION ALL SELECT 'sum: payable_invoice_lines.amountCents', COALESCE(SUM(amountCents), 0) FROM payable_invoice_lines;
