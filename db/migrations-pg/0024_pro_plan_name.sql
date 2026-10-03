-- Rename only the $50 plan's public label. Pricing and quotas are unchanged.
UPDATE plans
SET name = 'Pro', updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE key = 'pro' AND price_cents = 5000;
