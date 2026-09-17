# ⚠️ RETIRED — ClawCloud Run shut down (do not use)

**2026-04-23:** new registrations closed. **2026-05-11:** ClawCloud Run
container product and all free tiers terminated. **2026-06-30:** the
whole ClawCloud VPS business shut down and remaining data was destroyed.

Sources: securityonline.info/clawcloud-run-service-termination-migration-guide-2026/
· claw.cloud/announcements/38 · lowendtalk.com/discussion/217828/

This kit is kept only as a record. The production image it referenced is
still valid and continuously published at
`ghcr.io/azadar-templates/akbaral:latest` — deployable on any Docker host.

## Verified free-hosting market status (checked 2026-09-11)

| Platform | Verdict for AKBARAL! (single container + live SQLite) |
| --- | --- |
| ClawCloud Run | **Dead** (terminated May 2026) |
| Zeabur Free | No persistent storage on Free (their docs); auto-sleep; 2 services |
| Modal Starter ($30/mo credits, no card) | Volumes are eventually-consistent — unsafe for a live SQLite file; requires BYO Postgres (app migration) |
| Render / Koyeb / Back4App / SnapDeploy free | No persistent disk on free tiers |
| Fly.io / Railway | No free tier for new accounts / one-time trial only |
| Northflank free | Requires a credit card |
| Oracle Cloud Always Free | Fits perfectly, never charges — but requires a card for identity verification at signup |
| Hugging Face Spaces | Persistent storage is a paid add-on |
| Vercel / Netlify / Cloudflare / Deno | Serverless-only — requires application rewrite |
| Serv00 & free shared hosts | No Docker, non-commercial ToS, not production-grade |

**Conclusion:** as of September 2026 there is no reputable host that is
simultaneously free, cardless, persistent-disk, and production-grade for
this architecture. The two real zero-dollar paths are documented in
`docs/ZERO_COST_LAUNCH.md` (Oracle with one-time card verification, or
Modal + free Postgres after a backend migration).
