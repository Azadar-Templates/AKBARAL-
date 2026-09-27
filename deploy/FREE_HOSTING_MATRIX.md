# Free hosting matrix — verified 2026-09-27

Hard rule for this project: **$0 upfront, no credit card, no balance top-up, no
paid upgrade before verified mission revenue exists.** A provider that asks for
a card is rejected, however good it looks.

## Container hosts

| Host | Card at signup | Free compute | Sleeps | Docker | Secrets | Verdict |
|---|---|---|---|---|---|---|
| **Hugging Face Spaces (Docker SDK, CPU Basic)** | **No** | 2 vCPU / **16 GB RAM**, unmetered CPU, ~50 GB ephemeral disk | only after **48 h idle** (cold start 30–90 s) | Yes (must listen on the port in the Space config) | Yes (repo secrets/variables) | **CHOSEN** — `deploy/free-hf-spaces` |
| Render Free | Docs say no; this project's own live signup attempt on 2026-09-13 was asked for a card | 750 h/month, 512 MB | after **15 min** idle (30–50 s wake) | Yes | Yes | Fallback only — **stop if a card is requested**; free Postgres expires (30–90 days) and free services cannot send outbound SMTP |
| SnapDeploy | Marketed "no card"; the owner's live account hit a **$1 verification** | 100 h/month, 512 MB | 15 min idle | Yes | Yes | **Rejected** (2026-09-22, owner-verified) |
| Caasify | Requires funds/top-up before provisioning | — | — | Yes | Yes | **Rejected** (2026-09-22, owner-verified) |
| Koyeb | **Yes since Feb 2026 ($29 hold)** | 1 service, 512 MB | 1 h idle | Yes | Yes | **Rejected** — was recommended on 2026-09-27 before this was verified; that recommendation is withdrawn |
| Back4App Containers | No | 256 MB | 60 min | Yes | Yes | Too small (this image needs 300–450 MB) |
| Railway / Fly / Cloud Run / Azure CA / Oracle / Northflank | Yes (card or trial-then-card) | — | — | Yes | Yes | **Rejected** — card |
| Zeabur | No | no hosted compute on Free | — | — | — | **Rejected** — nothing to run on |

## Databases (persistence lives here, so the container can stay ephemeral)

| Provider | Card | Free tier | Catch | Verdict |
|---|---|---|---|---|
| **Neon** | No | 0.5 GB/project, 100 CU-h/project/month, up to 10 projects, commercial use allowed | scale-to-zero cold start | **CHOSEN** — one project for AKBARAL!, a **separate** project for ZA141251SA |
| Aiven | No | 1 GB, dedicated 1 CPU / 1 GB node | no pooling on free | Good fallback |
| Supabase | No | 500 MB + auth/storage | **project pauses after ~7 days idle** | Not for the mission plane |
| Prisma Postgres | No | 500 MB, 100k ops | newer | Fallback |
| Render Postgres | No | 1 GB | **expires after 30–90 days** | Demo only |

## What is genuinely free in the rest of the stack

| Need | Free, no-card option | Status in code |
|---|---|---|
| AI brain (all 4001 agents) | **Google AI Studio / Gemini free tier** (permanent, no card, rate-limited) | primary provider; model resolved from `src/config/google-model-lifecycle.ts` |
| Web research | **Wikipedia API** — keyless, free, permitted with a User-Agent | default provider (`src/agents/search-providers.ts`); keyed providers optional |
| Public HTTPS URL | the host's own free hostname (`*.hf.space`, `*.onrender.com`) | auto-detected by `src/config/platform-url.ts`; **no domain purchase** |
| TLS | host-managed certificate | free |
| Object storage | container filesystem (ephemeral) | uploads are best-effort; everything durable is in Postgres |
| Email | Gmail SMTP app password (free) or any free relay | optional; unconfigured = honest 503, never a fake send |
| Payments | Stripe account costs nothing to open | `AKBARAL_LAUNCH_MODE=free` defers it entirely |
| Image generation (200 agents) | **none exists for free** | stays fail-closed on `OPENAI_API_KEY` |

## Honest limitations of the free path

1. **Sleep.** Free containers sleep (HF: 48 h idle). The first visitor after that
   waits 30–90 s. There is no free always-on container anywhere that does not
   ask for a card.
2. **Ephemeral disk.** Uploaded files are lost on restart/rebuild. Users, agents,
   tasks, ledger and audit chain live in Postgres, so nothing that matters is
   lost. Object storage is a later, revenue-funded upgrade.
3. **Free Spaces are public.** The private ZA141251SA tier therefore should not
   run on a free Space. Run it locally (`npm run mission:serve`) or as a second
   private service once revenue funds one.
4. **Quotas.** Gemini free tier is rate-limited (~500 requests/day on Flash-Lite);
   Wikipedia is encyclopaedic only. Both are honest capability limits, not
   failures — the agent records a blocked requirement instead of spending
   (`src/mission/operating-funds.ts`).
