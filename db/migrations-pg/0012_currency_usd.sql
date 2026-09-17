-- 0012: public pricing presentation moves from PKR to USD ($).
--
-- The platform's public pricing is now denominated in USD cents
-- ($50.00 = 5000). The plan catalog is re-priced in USD; marketplace
-- listings are re-labelled USD. All write paths already insert the
-- currency column explicitly, so the legacy DDL defaults (DEFAULT
-- 'PKR') are unreachable for new rows and left as-is — SQLite cannot
-- ALTER a column default without a table rebuild.
--
-- Historical invoices/payments keep their original 'PKR' label: they
-- were recorded as PKR orders and re-labelling them would misstate
-- what was actually charged. Only the catalog and listings move.
UPDATE plans SET currency = 'USD' WHERE currency = 'PKR';
UPDATE plans SET price_cents = 5000  WHERE key = 'pro'        AND price_cents = 499900;  -- $50.00 / month
UPDATE plans SET price_cents = 40000 WHERE key = 'enterprise' AND price_cents = 4999900; -- $400.00 / month
UPDATE agent_marketplace SET currency = 'USD' WHERE currency = 'PKR';
