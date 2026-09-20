# Private mission browser checks

`npm run mission:browser-check` launches real headless Chromium against a real private mission HTTP server with a newly isolated **synthetic SQLite fixture**. It overrides database, owner and vault settings in its own process, never reuses a production database, and never starts a provider worker. No external browser request is permitted.

## Run

With a locally installed Playwright browser:

```sh
npm ci
npx playwright install chromium
npm run mission:browser-check
```

In Linux x64 environments where browser CDNs or OS package mirrors are inaccessible, the pinned development-only npm runtime includes Chromium and NSS libraries:

```sh
MISSION_BROWSER_NPM_RUNTIME=true npm run mission:browser-check
```

This fallback was exercised on Node 22.22.3 with Chromium **153.0.8010.0**. Its dependency requires Node 22.17+ (or Node 24+). It does not disable browser web security or turn off application authentication. A system executable can instead be selected with `MISSION_BROWSER_EXECUTABLE`.

## Evidence and resumability

- Default evidence directory: `logs/browser/<timestamp>/`; override with `MISSION_BROWSER_EVIDENCE_DIR`.
- `result.json` records source SHA, runtime/harness fingerprint, dirty-tree flag, browser version and each completed check immediately.
- `desktop-resource-calls.png`, `desktop-chat-controls.png` and corresponding mobile screenshots capture the actual rendered UI. A failure screenshot is saved when possible.
- `MISSION_BROWSER_VIEWPORT=desktop` or `mobile` resumes only the needed viewport. Preserve old evidence directories and compare fingerprints before combining results.
- CI executes both viewports and preserves screenshots/JSON even on failure. It does not upload the temporary test database, raw credentials or browser traces containing session headers.

Each viewport covers owner login, explicit locally scoped credential creation/binding, secret clearing, native receipt form validation, safely rendered evidence, actual-usage reconciliation, separate financial accounting, unstarted hold cancellation, an evidenced renewal with archived prior usage, explicit chat opt-in, durable queued-message display, no document-wide horizontal overflow, no JavaScript page errors, and read-only/anonymous restrictions. No response is faked when the worker is not running.

**Limits:** 390×844 is Chromium mobile/touch emulation, not a physical Android/iOS device, Safari/WebKit test, mobile release build or hosted deployment check. All money, credentials and resource evidence are labelled synthetic. Browser results do not prove model access, revenue, a purchase or a real payment.
