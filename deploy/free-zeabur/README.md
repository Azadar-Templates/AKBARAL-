# ⚠️ RETIRED — Zeabur Free no longer includes hosted compute (2026-09-13)

Live dashboard check on 2026-09-13: the only options offered are
**"Buy New Server"** and **"Bind External Server"** — there is no $0
server/project creation flow for this account. Zeabur's Free plan is now a
management layer for servers you already own, not free hosting (consistent
with their pricing page listing "Manageable own servers" as the Free-tier
compute feature).

The successor path is **SnapDeploy Free** — see
`deploy/free-snapdeploy/README.md` ($0, no card, 2×512 MB containers,
builds our Dockerfile from GitHub, free SSL subdomain; WebSockets are paid
but our app's SSE fallback covers realtime). The production image remains
continuously published at `ghcr.io/azadar-templates/akbaral:latest` for
any Docker host.
