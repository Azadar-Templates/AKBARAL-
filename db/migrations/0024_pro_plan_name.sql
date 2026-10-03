-- Rename only the $50 plan's public label. Pricing and quotas are unchanged.
UPDATE plans
SET name = 'Pro', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE key = 'pro' AND price_cents = 5000;
