---
title: AKBARAL!
emoji: 🟢
colorFrom: green
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
short_description: One Intelligence. Every Solution.
---

# AKBARAL!

**One Intelligence. Every Solution.**

This Space runs the AKBARAL! public web + API tier from the repository
`Dockerfile` (`scripts/start-prod.mjs`: migrations → build preflight → web tier
on `PORT` + internal API tier).

Configuration is supplied through Space **secrets**, never through this file:

| Secret | What it is |
|---|---|
| `DATABASE_URL` | free Neon Postgres project (AKBARAL! plane) |
| `SESSION_SECRET` | 32+ random characters |
| `GOOGLE_API_KEY` | free Google AI Studio key — the brain for 3,801 of the 4,001 agents |

Variables: `NODE_ENV=production`, `AKBARAL_LAUNCH_MODE=free`, and
`SEED_DATABASE=true` for the first boot only.

`AKBARAL_SITE_URL` is not required: the application detects the Space's own
`SPACE_HOST` and uses the free `*.hf.space` hostname as its production URL.

The private ZA141251SA mission tier is **not** deployed in this Space. It runs
as its own service (`AKBARAL_ROLES=mission`) against its own separate database,
with its own authentication and single-identity lock.
