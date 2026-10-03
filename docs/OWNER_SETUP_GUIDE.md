# AKBARAL! Owner Setup Guide

**Public identity:** AKBARAL! — One Intelligence. Every Solution.  
**Scope:** customer platform configuration only. The private ZA141251SA mission keeps separate authentication, databases, ledgers, wallets, and money controls.

Never paste credentials into chat, source code, issues, screenshots, or logs. Use the deployment provider's encrypted secret store. Do not rotate a working key merely to follow this guide.

## 1. Google Gemini

1. In the owner's Google AI project, enable the Gemini API and create a server-side API key.
2. Restrict the key to the intended API/project where Google supports that restriction.
3. Set `GOOGLE_API_KEY` in the local `.env` for local testing or in Railway Variables for deployment.
4. Restart the API. Never expose this value through a `NEXT_PUBLIC_*` variable.
5. Verify:
   - authenticated `GET /api/models` reports the selected Gemini model as available;
   - Chat defaults to `gemini-3.8-flash` and streams real tokens;
   - removing the variable in a test environment produces the honest “Chat is not available” response and deducts no task credit.

Provider free-tier and rate quotas are external limits. “No chat credits” does not mean unlimited provider compute.

## 2. Google OAuth

1. Create a Web OAuth client in Google Cloud Console.
2. Add the production origin and the exact callback URL shown by the deployment, normally `https://YOUR_HOST/api/auth/oauth/google/callback`.
3. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in encrypted server variables.
4. Set the application's public/base URL variable to the canonical HTTPS host if the deployment configuration requires it.
5. Verify `GET /api/auth/oauth/providers` reports Google configured, then complete one owner-controlled test sign-in. Confirm state validation, callback host, account creation, logout, and refresh rotation.

Do not use an unverified wildcard redirect and do not place the client secret in browser or mobile bundles.

## 3. Stripe

1. Begin in Stripe test mode. Create products/prices matching the existing AKBARAL! catalog; do not change amounts or quotas.
2. Set `STRIPE_SECRET_KEY` in encrypted server variables.
3. Register the repository's Stripe webhook endpoint on the canonical HTTPS host and set `STRIPE_WEBHOOK_SECRET`.
4. Keep customer payments classified as `akbaral-customer-revenue`. They are not private mission earnings and are not payout-destination balances.
5. Verify with Stripe test events/cards:
   - signature rejection for an invalid webhook;
   - idempotent processing of a repeated event;
   - successful test checkout, invoice, payment, and entitlement update;
   - failed/refunded payment states remain distinct from paid revenue.
6. Move to live mode only after the owner completes Stripe's external KYC/approval and explicitly approves activation.

Never store raw card numbers. Stripe-hosted/tokenized methods remain at Stripe.

## 4. Razorpay

1. Begin with a Razorpay test account and owner-controlled test credentials.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and the webhook secret expected by the deployment configuration in encrypted variables.
3. Configure the canonical HTTPS webhook and enable only required events.
4. Verify test checkout, webhook signature rejection, idempotency, payment capture/failure/refund classification, and entitlement behavior.
5. Activate live mode only after external owner KYC/approval and owner confirmation.

Razorpay customer revenue uses the AKBARAL! customer ledger. It is separate from mission agent earnings and from all five provider-tokenized payout destinations.

## 5. Railway

1. Connect the GitHub repository and deploy the reviewed branch/commit only after CI passes.
2. Configure the start command as documented by the repository (`npm start`) and use the required Node version.
3. Add `SESSION_SECRET`, `DATABASE_URL`, provider credentials, OAuth values, payment values, and canonical public URL through Railway Variables. Never commit them.
4. Attach persistent storage where the selected database/upload mode requires it. Prefer managed PostgreSQL for a production multi-instance deployment.
5. Keep `ZA141251SA_MISSION_SERVER_ENABLED` unset/false on the public customer service. The private mission requires its own explicit deployment, mounted database, owner authentication, and opt-in.
6. Deploy and verify, in order:
   - `/api/health` returns healthy;
   - `/api/ready` returns ready;
   - `/#/` renders all six landing scenes;
   - `/workspace` opens the typed Chat/Work shell;
   - signup/sign-in and refresh work;
   - configured Gemini/OAuth/payment test flows work without exposing secrets.
7. Record the exact deployed commit. A successful build is not a LIVE VERIFIED deployment until these route and provider checks pass.

## Owner-only actions and external approvals

The owner—not an agent—must perform Google/Stripe/Razorpay/Railway account ownership, KYC, tax, payment activation, webhook registration, domain verification, and payout-destination verification. Missing access or approval is **OWNER ACTION REQUIRED** or **EXTERNAL APPROVAL REQUIRED**, never a successful configuration claim.
