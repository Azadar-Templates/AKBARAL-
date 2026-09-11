-- 0013: the complete six-tier public pricing catalog (USD).
--
--   Free Trial $0 · Starter $10 · Professional $50 · Business $90 ·
--   Scale $200 · Enterprise $400
--
-- The 'pro' plan key is kept (existing subscriptions reference it) but its
-- public name becomes "Professional". starter/business/scale are new rows.
-- Custom / manual credit purchase remains a billing-service flow, not a plan.
--
-- plans.key is UNIQUE, so upserts are safe and idempotent.
UPDATE plans SET name = 'Professional', updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE key = 'pro';

INSERT INTO plans (id, key, name, description, price_cents, currency, billing_interval, monthly_credits, max_agents, max_workspaces, max_seats, features, status, sort_order, created_at, updated_at)
VALUES
  ('pln_starter', 'starter', 'Starter', 'For individuals putting their first agents to work.', 1000, 'USD', 'month', 25, 10, 1, 1, '{"agentWorld":true,"customCredits":true}', 'active', 10, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('pln_business', 'business', 'Business', 'For teams running continuous multi-agent operations.', 9000, 'USD', 'month', 250, 150, 15, 10, '{"agentWorld":true,"agentFactory":true,"customCredits":true,"apiAccess":true,"team":true}', 'active', 30, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('pln_scale', 'scale', 'Scale', 'High-volume execution, automation and API throughput.', 20000, 'USD', 'month', 750, 500, 50, 25, '{"agentWorld":true,"agentFactory":true,"customCredits":true,"apiAccess":true,"team":true,"priority":true}', 'active', 40, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT(key) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  monthly_credits = excluded.monthly_credits,
  max_agents = excluded.max_agents,
  max_workspaces = excluded.max_workspaces,
  max_seats = excluded.max_seats,
  features = excluded.features,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = excluded.updated_at;

-- Keep every catalog row honest in USD and priced to the public model.
UPDATE plans SET price_cents = 1000  WHERE key = 'starter'    AND price_cents != 1000;
UPDATE plans SET price_cents = 5000  WHERE key = 'pro'        AND price_cents != 5000;
UPDATE plans SET price_cents = 9000  WHERE key = 'business'   AND price_cents != 9000;
UPDATE plans SET price_cents = 20000 WHERE key = 'scale'      AND price_cents != 20000;
UPDATE plans SET price_cents = 40000 WHERE key = 'enterprise' AND price_cents != 40000;
UPDATE plans SET currency = 'USD' WHERE key IN ('free','starter','pro','business','scale','enterprise') AND currency != 'USD';
