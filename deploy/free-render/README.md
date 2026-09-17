# ⚠️ RETIRED — Render requires a payment method at signup (2026-09-13)

Live signup attempt on 2026-09-13 showed Render's compute services now
require a credit/debit card even on the free plan — a direct violation of
AKBARAL!'s zero-investment / no-card constraint. This kit is kept only as
a record of that finding (Render's docs themselves mark free instances as
"not for production").

The successor path is **Zeabur Free** — see `deploy/free-zeabur/README.md`
($0, no card, prebuilt GHCR image, WebSocket-capable). The production
image remains continuously published at
`ghcr.io/azadar-templates/akbaral:latest` for any Docker host.
