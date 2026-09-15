/* ============================================================
 * AKBARAL! — Cinematic Intelligence homepage (Next.js App Router).
 *
 * Active page for `/`. Rendered as a real React component with native JSX
 * elements. The SPA behaviour is provided by public/app.js.
 *
 * Visual system: the unified AKBARAL! Design System (design-system/
 * tokens.json — shared with the Android app and the future iOS app):
 * deep obsidian foundation, subtle indigo/violet atmosphere, premium
 * glass surfaces, cinematic lighting, editorial/technical typography,
 * hairline borders, fine grids. One identity, every surface.
 * Fully original design (no third-party assets).
 *
 * Hero background architecture: full-bleed <video> slot
 * (/media/hero-loop.mp4 — drop the production loop there) with an
 * original canvas intelligence-network animation as the live fallback
 * and an original still poster for reduced-motion / no-JS / mobile
 * fallbacks. See docs/DESIGN.md.
 * ============================================================ */

/** The real orchestration stages, in the order MASTER runs them. */
const PIPELINE_STAGES = [
  ['01', 'Goal', 'Any goal in plain language — research, engineering, operations, revenue.'],
  ['02', 'Understanding', 'Intent detection decomposes it into structured, ordered work.'],
  ['03', 'Planning', 'A persisted workflow with steps, dependencies and execution order.'],
  ['04', 'Routing', 'Each step is matched to a specialist through the agent registry.'],
  ['05', 'Execution', 'Tools run for real; every state change streams into the workspace.'],
  ['06', 'Verification', 'Evidence and execution checks gate completion. Failures are refunded.'],
] as const;

/** Capability families the registry actually covers. */
const CAPABILITIES = [
  ['◈', 'Research & intelligence', 'Market, competitor and technical research with source tracking.'],
  ['⌘', 'Software & web', 'Specifications, implementation, review and release paths.'],
  ['▤', 'Documents & data', 'Reports, spreadsheets, analysis and structured deliverables.'],
  ['◫', 'Design & media', 'Interfaces, brand language, image and media direction.'],
  ['◎', 'Business & operations', 'Planning, go-to-market, forecasting and process design.'],
  ['⟳', 'Automation', 'Scheduled workflows and repeatable operations on a real queue.'],
] as const;

/** Disciplines represented in the 4,001-contract registry. */
const DISCIPLINES = [
  'Research', 'Software engineering', 'Web development', 'UI / UX', 'Data science',
  'Documents', 'Spreadsheets', 'Marketing', 'SEO', 'Finance', 'Legal information',
  'Operations', 'CRM', 'Automation', 'Security', 'DevOps', 'Cloud', 'Content',
  'Translation', 'Education',
] as const;

/** Honest, implemented guarantees — each one is covered by the test suite. */
const TRUST_POINTS = [
  ['Rotated sessions', 'Short-lived access tokens and refresh tokens that rotate on every use; a reused token is rejected.'],
  ['Owner RBAC', 'Owner-only surfaces are enforced server-side on every request — never by hiding a button.'],
  ['No invented integrations', 'An unconfigured provider refuses and names the exact credential an operator must set.'],
  ['Refunds on failure', 'A task consumes a credit only when the work succeeds; failures are refunded automatically.'],
] as const;

export default function Home() {
  return (
    <>
<noscript><style>{`#boot-veil{display:none !important}#screen-landing{display:block !important}`}</style></noscript><div id="boot-veil" aria-hidden="true"><div className="boot-core"><span className="boot-ring"></span><span className="boot-ring r2"></span><span className="boot-mark">A!</span></div><div className="boot-word">AKBARAL!</div><div className="boot-tagline">ONE INTELLIGENCE · EVERY SOLUTION</div><div className="boot-line"><i></i></div></div><div id="toast-root" aria-live="polite" aria-atomic="false"></div><a className="skip-link" href="#app-root">
  Skip to content</a><header className="site-header" id="site-header"><div className="header-bar"><a className="brand" href="#/" aria-label="AKBARAL home"><span className="brand-mark" aria-hidden="true"><span className="brand-mark-glow"></span>
      A!</span><span className="brand-text">
      AKBARAL!</span></a><nav className="main-nav" id="main-nav" aria-label="Primary navigation"><div className="nav-set nav-public">
        <button type="button" data-scroll-to="platform">Platform</button>
        <button type="button" data-scroll-to="agents">Agents</button>
        <button type="button" data-scroll-to="security">Security</button>
        <button type="button" data-scroll-to="pricing">Pricing</button><a className="nav-mobile-only" href="#/login">Log In</a><a className="nav-mobile-only" href="#/register">Sign Up</a></div><div className="nav-set nav-app">
        <a href="#/dashboard">Dashboard</a>
        <a href="#/master">MASTER</a>
        <a href="#/agents">Agents</a>
        <a href="#/workspace">Workspace</a>
        <a href="#/automations">Automations</a>
        <a href="#/billing">Billing</a>
        <a href="#/factory">Factory</a>
        <a href="#/marketplace" className="nav-mobile-only">Marketplace</a>
        <a href="#/crm" className="nav-mobile-only">CRM &amp; AI Employees</a>
        <a href="#/settings">Settings</a>
        <a href="#/admin" className="admin-only" hidden>Admin</a></div></nav><div className="header-actions"><span className="credit-pill" id="credit-pill" title="Free task credits">
      …</span><span className="menu-toggle" id="menu-toggle" role="button" tabIndex={ 0 } aria-label="Toggle navigation menu" aria-expanded="false">
        ☰</span><button className="btn btn-ghost btn-sm" id="logout-btn" hidden>
      Log out</button><button className="btn btn-ghost btn-sm" id="login-btn" data-route="login">
      Log In</button><button className="btn btn-primary btn-sm" id="start-free-nav" data-route="register">Start Building</button></div></div></header><main id="app-root">

      {/* ================= LANDING — compact front door ================= */}
      {/* The marketing page is NOT the default paint: `/` and `/workspace` are
          application entries, and public/app.js reveals the screen the visitor
          actually asked for. Without JS the <noscript> rule below restores the
          full page (SEO + no-JS visitors). */}
      <section className="screen landing-screen" id="screen-landing" hidden>

        {/* ---------- Hero: the product, immediately ---------- */}
        <section className="akx-hero" id="hero">
          <div className="akx-hero-media" aria-hidden="true">
            <video id="hero-video" muted loop playsInline preload="none" poster="/media/hero-poster.jpg" disablePictureInPicture tabIndex={-1}>
              <source src="/media/hero-loop.mp4" type="video/mp4" />
            </video>
            <canvas id="hero-canvas"></canvas>
            <div className="hero-poster" style={{ backgroundImage: 'url(/media/hero-poster.jpg)' }}></div>
            <div className="akx-hero-veil"></div>
          </div>

          <div className="aw-container akx-hero-inner">
            <div className="akx-hero-grid">
              <div className="akx-hero-copy">
                <p className="akx-kicker">
                  MASTER intelligence system
                  <i className="sys-sep" aria-hidden="true"> / </i>
                  <span id="sys-status" className="sys-ok">READY</span>
                </p>
                <h1 className="akx-title">
                  One intelligence.<br /><em>Every solution.</em>
                </h1>
                <p className="akx-lede">
                  State a goal and AKBARAL! plans it, routes each step to the right specialist from a
                  4,001-agent registry, runs the tools for real, verifies the result — and shows you
                  every state change as it happens.
                </p>
                <div className="akx-actions">
                  <button className="btn btn-primary btn-lg" data-route="register">
                    Start building <span aria-hidden="true">→</span>
                  </button>
                  <button className="btn btn-outline btn-lg" data-scroll-to="platform">
                    See how it works
                  </button>
                </div>
                <div className="akx-statusline">
                  <span><b>4,001</b> agent contracts</span>
                  <span>Real tool execution</span>
                  <span>Verified completions</span>
                  <span><b>Credits</b> only on success</span>
                </div>
              </div>

              {/* A truthful picture of the pipeline every run goes through. */}
              <div className="akx-frame" role="img" aria-label="The MASTER pipeline: goal, understanding, planning, routing, execution, verification, result">
                <div className="akx-frame-bar">
                  <i></i><i></i><i></i>
                  <span>MASTER · pipeline</span>
                </div>
                <div className="akx-frame-body">
                  <div className="akx-turn user">
                    <span className="akx-turn-h">You</span>
                    <p>“Build a one-page calculator site with a clean modern layout.”</p>
                  </div>
                  <div className="akx-turn">
                    <span className="akx-turn-h"><b>MASTER</b> · orchestrating</span>
                    <ul className="akx-steps">
                      <li className="done">Goal understood · intent + deliverables</li>
                      <li className="done">Workflow planned · 3 ordered steps</li>
                      <li className="live">Execution · agents run real tools</li>
                      <li>Verification · evidence checks before success</li>
                      <li>Result + artifacts land in your workspace</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Platform: the pipeline, on one screen ---------- */}
        <section className="akx-band" id="platform">
          <div className="aw-container">
            <div className="akx-band-head">
              <div>
                <p className="eyebrow" data-kicker="Platform"></p>
                <h2>Every request runs through one orchestration core.</h2>
              </div>
              <p>
                No black box: the workflow, the agents chosen for each step, the tools they called and
                the verification that gated the result are all persisted and visible to you.
              </p>
            </div>
            <div className="akx-pipe" id="pipeline-rail">
              {PIPELINE_STAGES.map(([n, label, note]) => (
                <div className="akx-stage" key={n}>
                  <span className="n">{n}</span>
                  <b>{label}</b>
                  <p>{note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Capabilities ---------- */}
        <section className="akx-band">
          <div className="aw-container">
            <div className="akx-band-head">
              <div>
                <p className="eyebrow" data-kicker="Capabilities"></p>
                <h2>Thousands of specialists, one interface.</h2>
              </div>
              <p>Work is routed by discipline — you keep one conversation and one workspace.</p>
            </div>
            <div className="akx-cards">
              {CAPABILITIES.map(([icon, title, note]) => (
                <article className="akx-card" key={title}>
                  <span className="akx-ico" aria-hidden="true">{icon}</span>
                  <h3>{title}</h3>
                  <p>{note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Agent world ---------- */}
        <section className="akx-band" id="agents">
          <div className="aw-container">
            <div className="akx-band-head">
              <div>
                <p className="eyebrow" data-kicker="Agent world"></p>
                <h2>A registry of 4,001 distinct agent contracts.</h2>
              </div>
              <p>
                Each contract declares its discipline, its model requirements and the tools it may use —
                which is how a step is matched to real capability instead of a guess.
              </p>
            </div>
            <div className="akx-cloud" aria-label="Disciplines in the agent registry">
              {DISCIPLINES.map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="akx-actions">
              <button className="btn btn-outline" id="explore-agents">Open the agent world</button>
            </div>
          </div>
        </section>

        {/* ---------- Security & honesty ---------- */}
        <section className="akx-band" id="security">
          <div className="aw-container">
            <div className="akx-band-head">
              <div>
                <p className="eyebrow" data-kicker="Security & honesty"></p>
                <h2>Built so the product can be trusted by default.</h2>
              </div>
              <p>Every guarantee below is implemented and covered by the platform test suite.</p>
            </div>
            <div className="akx-trust">
              {TRUST_POINTS.map(([title, note]) => (
                <div className="akx-trust-item" key={title}>
                  <i aria-hidden="true">⬡</i>
                  <div><b>{title}</b><small>{note}</small></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Pricing: rendered from the live billing API ---------- */}
        <section className="akx-band" id="pricing">
          <div className="aw-container">
            <div className="akx-band-head">
              <div>
                <p className="eyebrow" data-kicker="Pricing"></p>
                <h2>Honest task accounting.</h2>
              </div>
              <p>
                Plans in USD, from a free trial to company-grade capacity, plus manual credit purchase.
                A task is consumed only when work succeeds; failures are refunded automatically.
              </p>
            </div>
            <div className="akx-plans" id="landing-plans"></div>
          </div>
        </section>

        {/* ---------- Final CTA ---------- */}
        <section className="akx-band">
          <div className="aw-container">
            <div className="akx-cta">
              <p className="akx-kicker">Start now</p>
              <h2 className="akx-title" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
                Give MASTER your first goal.
              </h2>
              <p className="akx-lede" style={{ margin: '14px auto 0', maxWidth: '52ch' }}>
                Five free tasks on the trial, real execution, verified results — no card required.
              </p>
              <div className="akx-actions" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary btn-lg" data-route="register">Start building</button>
                <button className="btn btn-outline btn-lg" data-route="login">Sign in</button>
              </div>
            </div>
          </div>
        </section>
      </section>

      {/* ================= AUTH ================= */}
      <section className="screen auth-screen" id="screen-auth" hidden>
        {/* Deliberately one surface and nothing else. app.js sets `body.is-auth`,
            which retires the public marketing chrome while this screen is up, so
            the only things on screen are the AKBARAL! identity and the way in. */}
        <div className="auth-atmo" aria-hidden="true"></div>
        <div className="aw-container auth-wrap">
          <div className="auth-card">
            <header className="auth-brand">
              <span className="auth-mark" aria-hidden="true">A!</span>
              <span className="auth-wordmark">AKBARAL!</span>
              <p className="auth-tagline">One intelligence. Every solution.</p>
            </header>

            <h1 className="auth-title" id="auth-title">Sign in</h1>
            <p className="auth-sub" id="auth-sub">Access your agent operations center.</p>

            <form id="auth-form" autoComplete="on">
              <label className="auth-field">
                <span>Email</span>
                <input type="email" id="auth-email" autoComplete="email" placeholder="you@company.com" required />
              </label>
              <label className="auth-field" has-reveal>
                <span>Password</span>
                <input type="password" id="auth-password" minLength={8} autoComplete="current-password" placeholder="Your password" required /><button type="button" className="auth-reveal" id="auth-reveal" data-password-reveal="auth-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg className="eye-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12S6 5.6 12 5.6 21.8 12 21.8 12 18 18.4 12 18.4 2.2 12 2.2 12Z" /><circle cx="12" cy="12" r="3.1" /></svg><svg className="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 3.5 17 17" /><path d="M10.6 6.2A9.9 9.9 0 0 1 12 6.1c6 0 9.8 6 9.8 6a17.4 17.4 0 0 1-3.3 3.9" /><path d="M6.4 7.9A16.7 16.7 0 0 0 2.2 12s3.8 6.4 9.8 6.4c1.5 0 2.9-.2 4.1-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg></button>
              </label>
              <label className="auth-field" id="auth-name-wrap" hidden>
                <span>Name</span>
                <input type="text" id="auth-name" autoComplete="name" placeholder="Your name" />
              </label>
              <button className="btn btn-primary btn-block btn-lg" id="auth-submit" type="submit">Sign in</button>
            <p className="auth-feedback" id="auth-feedback" data-state="idle" role="status" aria-live="polite" hidden /></form>

            <div className="auth-oauth" id="auth-oauth" hidden>
              <div className="auth-oauth-divider"><span>or continue with</span></div>
              <div className="auth-oauth-buttons" id="auth-oauth-buttons"></div>
              <p className="auth-oauth-note" id="auth-oauth-note" hidden></p>
            </div>

            <p className="auth-switch" id="auth-switch">No account? <a href="#/register">Create one</a></p>
          </div>
        </div>
      </section>

      {/* ================= Dashboard ================= */}
      <section className="screen screen-default" id="screen-dashboard" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Overview"></p><h1>

          Dashboard</h1><p className="sub">Your AKBARAL operating picture at a glance.</p></div><button className="btn btn-ghost" id="refresh-dashboard">

          Refresh</button></div><div className="stat-grid" id="dashboard-stats"></div><div className="cols-2"><div className="panel"><h3>

          Recent tasks</h3><div id="dashboard-tasks" className="list"></div></div><div className="panel"><h3>
          My agents</h3><div id="dashboard-agents" className="list"></div></div></div></div></section>

      {/* ============ MASTER — the AKBARAL! application shell (Build #6) ============
          ONE compact application screen. Three zones, each with a real job:

            LEFT   · sidebar — brand, New chat, Search, Library, Images &
                     media, Projects, Files, recent history, account block.
            CENTER · the MASTER conversation — header, live log + activity
                     stream, composer with attachment controls.
            RIGHT  · artifact rail — Preview (the download/export control sits
                     ABOVE the canvas) plus the Files / Library / Images
                     panels, chosen from the rail's tabs at the top.

          Narrow viewports collapse the sidebar into a drawer and SWITCH the
          center/rail with the pane tabs instead of shrinking the desktop
          grid. The Android app mirrors the same design system and data
          contracts (mobile/src/screens/MasterScreen.tsx). Every control is
          bound to a real API — nothing decorative, nothing simulated. */}
      <section className="screen master-screen" id="screen-master" hidden>
        <div className="ak-app" id="master-shell" data-sidebar="open" data-rail="open">

          {/* ---------------- LEFT · sidebar ---------------- */}
          <aside className="ak-sidebar" id="master-sidebar" aria-label="AKBARAL! navigation">
            <div className="ak-side-head">
              <a className="ak-brand" href="#/" aria-label="AKBARAL! home">
                <span className="brand-mark ak-brand-mark" aria-hidden="true">A!</span>
                <span className="ak-brand-text">
                  <b>AKBARAL!</b>
                  <small>One Intelligence. Every Solution.</small>
                </span>
              </a>
              <button type="button" className="ak-icon-btn ak-side-toggle" id="master-sidebar-toggle" aria-expanded="true" aria-controls="master-sidebar" title="Collapse sidebar">
                <span aria-hidden="true">⟨</span>
                <span className="sr-only">Collapse sidebar</span>
              </button>
            </div>

            <button type="button" className="ak-newchat" id="master-new-chat">
              <span aria-hidden="true">＋</span>
              <span className="ak-nav-label">New chat</span>
            </button>

            <nav className="ak-nav" aria-label="Workspace">
              <button type="button" className="ak-nav-item" id="ak-nav-search" data-ak-action="search" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">⌕</span>
                <span className="ak-nav-label">Search</span>
                <kbd>⌘K</kbd>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-library" data-ak-action="library" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">▤</span>
                <span className="ak-nav-label">Library</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-media" data-ak-action="media" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">◫</span>
                <span className="ak-nav-label">Images &amp; media</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-projects" data-ak-action="projects" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">◈</span>
                <span className="ak-nav-label">Projects</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-files" data-ak-action="files" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">❐</span>
                <span className="ak-nav-label">Files</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-agents" data-ak-action="agents" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">⬡</span>
                <span className="ak-nav-label">Agents</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-automations" data-ak-action="automations" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">⟳</span>
                <span className="ak-nav-label">Automations</span>
              </button>
              <button type="button" className="ak-nav-item" id="ak-nav-billing" data-ak-action="billing" aria-current="false">
                <span className="ak-nav-ico" aria-hidden="true">◆</span>
                <span className="ak-nav-label">Billing &amp; credits</span>
              </button>
            </nav>

            {/* Recent chat / task history — real tasks, click to reopen the result. */}
            <div className="ak-recent">
              <div className="ak-section-head">
                <span>Recent</span>
                <button type="button" className="ak-icon-btn" id="master-history-refresh" title="Refresh history" aria-label="Refresh history">↻</button>
              </div>
              <div id="master-task-history" className="list master-history">
                <div className="list-item"><small>No tasks yet.</small></div>
              </div>
            </div>

            {/* Account — profile, settings, owner console (role-gated), sign-out. */}
            <div className="ak-account" id="master-account">
              <span className="ak-avatar" id="ak-avatar" aria-hidden="true">A</span>
              <span className="ak-account-text">
                <b id="ak-user-name">Guest</b>
                <small id="ak-user-email">not signed in</small>
              </span>
              <button type="button" className="ak-icon-btn" id="ak-account-menu-btn" aria-expanded="false" aria-controls="ak-account-menu" title="Account">⋯</button>
              <div className="ak-menu" id="ak-account-menu" hidden>
                <a href="#/settings">Account settings</a>
                <a href="#/dashboard">Dashboard</a>
                <a href="#/billing">Billing &amp; credits</a>
                <a href="#/projects">Projects &amp; knowledge</a>
                <a href="#/factory">Agent Factory</a>
                <a href="/owner" id="ak-owner-link" hidden>Owner console →</a>
                <a href="#/economy" id="ak-mission-link" hidden>Private console →</a>
                <hr />
                <button type="button" id="ak-logout">Log out</button>
              </div>
            </div>
          </aside>
          <div className="ak-scrim" id="master-sidebar-scrim" hidden></div>

          {/* ---------------- MAIN ---------------- */}
          <div className="ak-main">

            {/* Compact top bar: identity, pane switch, project, core state,
                credits, preview toggle. No oversized hero, no card stack. */}
            <header className="ak-topbar" id="master-topbar">
              <button type="button" className="ak-icon-btn ak-burger" id="master-menu-btn" aria-label="Open navigation" aria-expanded="false" aria-controls="master-sidebar">☰</button>
              <div className="ak-top-id">
                <span className="ak-top-mark ak-mobile-only" aria-hidden="true">A!</span>
                <div className="ak-top-title">
                  <b>MASTER</b>
                  <small id="ak-top-sub">orchestration workspace</small>
                </div>
              </div>
              <div className="master-pane-switch" role="tablist" aria-label="Workspace panes">
                <button type="button" role="tab" id="master-pane-workspace" data-pane-tab="workspace" aria-selected="true">Preview</button>
                <button type="button" role="tab" id="master-pane-chat" data-pane-tab="chat" aria-selected="false">MASTER chat</button>
              </div>
              <div className="ak-top-actions">
                <button type="button" className="ak-icon-btn" id="master-search-btn" data-ak-action="search" title="Search (⌘K)" aria-label="Search">⌕</button>
                <label className="mt-project">
                  <span>Project</span>
                  <select id="master-project"><option value="">— none —</option></select>
                </label>
                <div className="master-core" id="master-core" data-state="idle" role="status" aria-label="MASTER core status">
                  <div className="core-ring r1"></div><div className="core-ring r2"></div><div className="core-spark"></div>
                  <span className="master-core-label" id="master-core-label">idle</span>
                </div>
                <span className="credit-pill ak-credit" id="ak-credit-pill" title="Free task credits">Credits · …</span>
                <button type="button" className="ak-icon-btn" id="master-rail-toggle" aria-expanded="true" aria-controls="master-workspace" title="Toggle preview panel">▤</button>
              </div>
            </header>

            <div className="master-layout" id="master-layout" data-pane="workspace">

              {/* ---- CENTER · the MASTER conversation ---- */}
              <section className="master-chat" id="master-chat" aria-label="MASTER chat">
                <header className="chat-head">
                  <span className="brand-mark chat-brand" aria-hidden="true">A!</span>
                  <div className="chat-head-text">
                    <b>AKBARAL!</b>
                    <small>MASTER · orchestration</small>
                  </div>
                  <span id="master-console-state" className="console-state">idle</span>
                  <button type="button" className="chat-drawer-btn" data-chat-drawer="history" aria-expanded="false" aria-controls="master-drawer-history">History</button>
                  <button type="button" className="chat-drawer-btn" data-chat-drawer="env" aria-expanded="false" aria-controls="master-drawer-env">Env</button>
                </header>

                <div className="chat-log" id="master-chat-log">
                  <div className="chat-drawer" id="master-drawer-history" hidden>
                    <div className="panel">
                      <h3>Task history</h3>
                      <div id="master-task-history-drawer" className="list master-history">
                        <div className="list-item"><small>No tasks yet — the sidebar keeps your recent runs one click away.</small></div>
                      </div>
                    </div>
                  </div>
                  <div className="chat-drawer" id="master-drawer-env" hidden>
                    <div className="panel master-info" id="master-info">
                      <h3>Environment</h3>
                      <div id="master-info-body" className="master-info-body">
                        <div className="info-line"><span>Model providers</span><b>Loading…</b></div>
                      </div>
                    </div>
                  </div>
                  <div id="master-output" className="output master-console chat-activity" aria-live="polite">
                    <div className="console-hint">Describe a goal. MASTER plans, picks specialists and streams the run here — the result renders in the preview rail.</div>
                  </div>
                </div>

                <form id="master-form" className="chat-composer">
                  <div className="composer-head">
                    <label htmlFor="master-goal">Goal</label>
                    <button type="button" className="btn btn-ghost btn-sm" id="master-voice" hidden title="Dictate your goal">Voice input</button>
                    <span className="sub" id="master-voice-note" hidden></span>
                    <div className="composer-tools">
                      <label className="btn btn-ghost btn-sm" htmlFor="master-attachment-input" title="Attach files to this goal">Attach files</label>
                      <button type="button" className="btn btn-ghost btn-sm" id="master-open-files" data-ak-action="files">Files &amp; artifacts</button>
                      <span className="attach-chip" id="master-attach-count" hidden>0 attached</span>
                    </div>
                  </div>
                  <textarea id="master-goal" rows={ 3 } placeholder="Ask MASTER — e.g. build me a calculator · create an image of a mountain lake · research this market" required defaultValue="" />
                  <div className="composer-row">
                    <span className="sub composer-note">Credits are consumed only on success — failures refund automatically. Enter sends, Shift+Enter adds a line.</span>
                    <button className="btn btn-primary" id="master-plan-btn" type="submit">Plan &amp; run</button>
                  </div>
                </form>
              </section>

              {/* ---- RIGHT · artifact rail: Preview + Files/Library/Images ---- */}
              <section className="master-workspace" id="master-workspace" aria-label="Preview and artifacts">
                <div className="ak-rail-head">
                  <div className="ak-rail-tabs" role="tablist" aria-label="Preview and artifact panels">
                    <button type="button" role="tab" id="ak-tab-preview" data-rail-tab="preview" aria-selected="true">Preview</button>
                    <button type="button" role="tab" id="ak-tab-files" data-rail-tab="files" aria-selected="false">Files</button>
                    <button type="button" role="tab" id="ak-tab-library" data-rail-tab="library" aria-selected="false">Library</button>
                    <button type="button" role="tab" id="ak-tab-media" data-rail-tab="media" aria-selected="false">Images</button>
                  </div>
                  <button type="button" className="ak-icon-btn ak-rail-close" id="ak-rail-close" aria-label="Collapse the preview panel" title="Collapse panel">✕</button>
                </div>

                <div className="ak-rail-body" id="master-rail-body">

                  {/* Preview — export control ABOVE the live canvas. */}
                  <div className="ak-rail-pane" id="ak-pane-preview" data-rail-pane="preview">
                    <div className="ws-exportbar">
                      <div className="ws-export-id">
                        <span className="ws-export-label">Live preview</span>
                        <span className="console-state" id="master-canvas-state">idle</span>
                      </div>
                      <div className="ws-export-actions" id="master-export-actions">
                        <span className="sub">Select a project to export its website.</span>
                      </div>
                    </div>
                    <div className="ws-preview" id="master-preview">
                      <div className="ws-preview-empty" id="master-preview-empty">
                        <span className="wpe-mark" aria-hidden="true">A!</span>
                        <b>Live canvas</b>
                        <small>Websites, images, documents, datasets, calculators and forms render here as they are produced. Export controls stay above the preview.</small>
                      </div>
                      <div id="master-result" className="ws-result" hidden></div>
                    </div>
                    <div className="artifact-bar-host" id="master-artifact-bar" hidden></div>
                  </div>

                  {/* Files — uploads and generated files for the selected project. */}
                  <div className="ak-rail-pane" id="ak-pane-files" data-rail-pane="files" hidden>
                    <aside className="panel ws-files-panel" aria-label="Project files and uploads">
                      <div className="ws-panel-head">
                        <b>Files &amp; artifacts</b>
                        <div className="ws-panel-actions">
                          <label className="btn btn-outline btn-sm" htmlFor="master-attachment-input">Upload</label>
                          <input type="file" id="master-attachment-input" multiple hidden />
                          <button type="button" className="btn btn-ghost btn-sm" id="master-files-refresh">Refresh</button>
                        </div>
                      </div>
                      <span className="sub" id="master-attachment-hint">Select a project to attach files.</span>
                      <div id="master-attachments" className="attach-list"></div>
                      <div id="master-files" className="list master-files">
                        <div className="list-item"><small>Select a project to see its files.</small></div>
                      </div>
                      <div className="ws-project-box" id="master-project-box">
                        <div id="master-project-controls" className="project-controls"></div>
                      </div>
                    </aside>
                  </div>

                  {/* Library — the real task history, with real results. */}
                  <div className="ak-rail-pane" id="ak-pane-library" data-rail-pane="library" hidden>
                    <div className="panel">
                      <h3>Library</h3>
                      <p className="ak-pane-note">Every past MASTER run for this account. Opening one restores its real result on the canvas — nothing is regenerated or faked.</p>
                      <div id="master-library" className="list master-files">
                        <div className="list-item"><small>No tasks yet.</small></div>
                      </div>
                    </div>
                  </div>

                  {/* Images &amp; media — real image files and image artifacts. */}
                  <div className="ak-rail-pane" id="ak-pane-media" data-rail-pane="media" hidden>
                    <div className="panel">
                      <h3>Images &amp; media</h3>
                      <p className="ak-pane-note">Generated and uploaded images across your projects. Each card opens on the canvas and downloads the stored bytes.</p>
                      <div id="master-media" className="media-grid">
                        <div className="list-item"><small>Select a project to see its images.</small></div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Search overlay — real tasks, knowledge and projects. */}
            <div className="ak-command" id="master-search" hidden role="dialog" aria-modal="true" aria-label="Search">
              <div className="ak-command-box">
                <form className="ak-command-input" id="master-search-form">
                  <span aria-hidden="true">⌕</span>
                  <input id="master-search-input" placeholder="Search tasks, knowledge and projects…" aria-label="Search query" autoComplete="off" />
                  <button className="btn btn-primary btn-sm" type="submit">Search</button>
                  <button className="btn btn-ghost btn-sm" type="button" id="master-search-close">Esc</button>
                </form>
                <div className="ak-command-results" id="master-search-results">
                  <div className="ak-command-group">
                    <b>Type a query</b>
                    <div className="list-item"><small>Results come from your own tasks, indexed knowledge and projects.</small></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= Task Center (detail) ================= */}
      <section className="screen screen-default" id="screen-task" hidden><div className="aw-container"><div id="task-detail-root"></div></div></section>

      {/* ================= Agent World ================= */}
      <section className="screen screen-default" id="screen-agents" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Registry"></p><h1>

        Agent World</h1><p className="sub">Browse 4,000+ genuinely distinct specialists.</p></div></div><div className="toolbar"><input id="agent-search" placeholder="Search agents…" aria-label="Search agents" /><select id="agent-category" aria-label="Filter by category"><option value="">

          All categories</option></select><button className="btn btn-ghost" id="refresh-agents">

        Refresh</button></div><div id="agent-list" className="agent-grid"></div></div></section>

      {/* ================= Agent Factory ================= */}
      <section className="screen screen-default" id="screen-factory" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Build"></p><h1>

        Agent Factory</h1><p className="sub">Create, test, benchmark and version your own agents.</p></div></div><div className="cols-2"><form id="factory-form" className="panel form-panel"><h3>


            Create custom agent</h3><p className="form-kicker">01 · Define</p><label>
            Name<input name="name" required /></label><label>
            Specialization<input name="specialization" required /></label><label>
            Description<textarea name="description" required defaultValue="" /></label><p className="form-kicker">02 · Behavior</p><label>

            System instructions<textarea name="system_instructions" rows={ 6 } required defaultValue="" /></label><p className="form-kicker">03 · Configure</p><label>
            Capabilities (comma separated)<input name="capabilities" /></label><label>

            Tool permissions (comma separated)<input name="tool_permissions" placeholder="web_search, page_fetch, knowledge_search" /></label><label>
            Verification rules (comma separated)<input name="verification_rules" /></label><p className="form-kicker">04 · Publish</p><label>

            Price (USD cents, optional)<input type="number" name="price_cents" placeholder="e.g. 1000 = $10" /></label><button className="btn btn-primary" type="submit">

            Create agent</button></form><div><div className="panel"><h3>

            My agents</h3><div id="factory-agents" className="list"></div></div><div id="factory-detail" className="panel detail-panel"></div></div></div></div></section>

      {/* ================= Marketplace ================= */}
      <section className="screen screen-default" id="screen-marketplace" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Exchange"></p><h1>

        Marketplace</h1><p className="sub">Discover, install and publish agents.</p></div></div><div className="toolbar"><button className="btn btn-ghost" id="refresh-marketplace">

        Refresh</button></div><div id="marketplace-list" className="agent-grid"></div></div></section>

      {/* ================= Workspace ================= */}
      <section className="screen screen-default" id="screen-workspace" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Knowledge"></p><h1>

        Workspace</h1><p className="sub">Projects, files and knowledge.</p></div></div><div className="cols-2"><div className="panel"><h3>


            Projects</h3><form id="project-form"><input placeholder="Project name" required aria-label="Project name" /><button className="btn btn-primary" type="submit">

            Create</button></form><div id="project-list" className="list"></div></div><div className="panel"><h3>


            Knowledge search</h3><p className="panel-note">Tool · searches documents you have indexed. Task results appear on the MASTER screen and in Task Center — not here.</p><form id="knowledge-form"><input placeholder="Search your knowledge" required aria-label="Search knowledge" /><button className="btn btn-primary" type="submit">

            Search</button></form><div id="knowledge-results" className="list"></div></div></div><div className="panel" id="project-workspace"><div className="empty-state">Select a project to inspect its files, tasks, workflows and knowledge.</div></div></div></section>

      {/* ================= Automations (scheduled workflows) ================= */}
      <section className="screen screen-default" id="screen-automations" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Automation"></p><h1>

        Scheduled Automations</h1><p className="sub">One-time, recurring and timezone-aware schedules that run registered agents through the MASTER orchestrator — with retries, timeouts, refunds and notifications.</p></div></div><div className="cols-2"><div className="panel"><h3>


            Create automation</h3><form id="sched-form"><input name="name" placeholder="Name (e.g. Morning research)" required aria-label="Automation name" /><select name="kind" aria-label="Schedule kind"><option value="interval">Interval (every N minutes)</option><option value="cron">Cron (timezone-aware)</option><option value="once">One-time</option></select><input name="minutes" type="number" min="1" placeholder="Every N minutes (interval)" aria-label="Interval minutes" /><input name="cron_expr" placeholder="Cron: minute hour dom month dow" aria-label="Cron expression" /><input name="cron_tz" placeholder="Timezone (e.g. Asia/Karachi)" aria-label="Cron timezone" /><input name="run_at" placeholder="Run at (ISO 8601, one-time)" aria-label="One-time run at" /><textarea name="steps" rows={4} placeholder={'One step per line: agent-slug | goal\ne.g. research-researcher-002 | Summarize today\u2019s AI news'} aria-label="Steps"></textarea><button className="btn btn-primary" type="submit">

            Create</button></form><p className="sub" id="sched-hint"></p></div><div className="panel"><h3>


            Your automations</h3><div id="sched-list" className="list"></div></div></div><div className="panel" id="sched-runs-panel" hidden><h3>


            Runs</h3><div id="sched-runs" className="list"></div></div></div></section>

      {/* ================= CRM ================= */}
      <section className="screen screen-default" id="screen-crm" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Revenue"></p><h1>

        CRM &amp; Automation</h1><p className="sub">Contacts, pipelines, campaigns, automations and AI employees.</p></div></div><div className="cols-2"><div className="panel"><h3>


            Contacts</h3><form id="contact-form"><input name="first_name" placeholder="First name" /><input name="email" placeholder="Email" /><button className="btn btn-primary" type="submit">

            Add contact</button></form><div id="contact-list" className="list"></div></div><div className="panel"><h3>


            Campaigns</h3><form id="campaign-form"><input name="name" placeholder="Campaign name" required /><button className="btn btn-primary" type="submit">

            Create</button></form><div id="campaign-list" className="list"></div></div></div><div className="cols-2"><div className="panel"><h3>


            Automations</h3><form id="automation-form"><input name="name" placeholder="Automation name" required /><input name="trigger_key" placeholder="Trigger (e.g. deal.won)" required /><button className="btn btn-primary" type="submit">


            Create</button></form><div id="automation-list" className="list"></div></div><div className="panel"><h3>


            AI Employees</h3><form id="employee-form"><input name="name" placeholder="Employee name" required /><input name="role" placeholder="Role" required /><button className="btn btn-primary" type="submit">

            Hire</button></form><div id="employee-list" className="list"></div></div></div></div></section>

      {/* ================= Billing ================= */}
      <section className="screen screen-default" id="screen-billing" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Billing"></p><h1>

        Billing &amp; credits</h1><p className="sub">Transparent plans, honest ledger of every credit.</p></div></div><div className="stat-grid" id="billing-stats"></div><div className="cols-2"><div className="panel"><h3>


          Plans</h3><div id="billing-plans" className="list"></div></div><div className="panel"><h3>

          Custom credits</h3><form id="credit-form"><label>


              Credits<input type="number" name="credits" min="1" defaultValue="10" required /></label><label>
              Amount (USD cents)<input type="number" name="amount_cents" min="100" defaultValue="1000" required /><div className="quick-amounts" aria-label="Quick amounts"><button type="button" data-amount="1000" aria-pressed="false">$10</button><button type="button" data-amount="5000" aria-pressed="false">$50</button><button type="button" data-amount="9000" aria-pressed="false">$90</button><button type="button" data-amount="20000" aria-pressed="false">$200</button><button type="button" data-amount="40000" aria-pressed="false">$400</button></div></label><button className="btn btn-primary" type="submit">

              Request purchase</button></form><div id="credit-order"></div></div></div><div className="panel"><h3>


        Invoices</h3><div id="invoice-list" className="list"></div></div></div></section>

      {/* ================= Admin ================= */}
      <section className="screen screen-default" id="screen-economy" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Private"></p><h1>

        Private Owner Console</h1><p className="sub">Private operations — owner account only. Realized revenue, treasury, opportunities and autonomous operation controls.</p></div></div><div className="stat-grid" id="economy-stats" aria-live="polite"></div><div className="stat-grid" id="economy-windows" aria-live="polite"></div><div className="panel"><h3>

        Platform (registry · tasks · cost mix)</h3><div id="economy-platform" className="econ-list"></div></div><div className="panel"><h3>

        Private economy activity today</h3><div id="economy-today" className="econ-today"></div></div><div className="panel"><h3>Provider sign-in</h3><p className="sub">Owner diagnostics. The sign-in screen never shows any of this: visitors get polished provider buttons, and a provider this deployment cannot serve simply appears unavailable.</p><div id="owner-provider-setup" data-provider-setup="1" className="list"></div></div><div className="panel"><h3>
        Mission chat (owner ↔ agent)</h3><div className="econ-controls"><input id="mission-agent" placeholder="agent slug, e.g. web-research-001" aria-label="Agent slug" /><input id="mission-input" placeholder="Message the agent — ask about status, earnings, costs, capabilities" aria-label="Mission message" /><button className="btn btn-primary" id="mission-send" type="button">

        Send</button></div><div id="mission-history" className="econ-list"></div><p className="sub" id="mission-note"></p></div><div className="panel"><h3>

        Autonomous operation</h3><div className="econ-controls"><label className="check"><input type="checkbox" id="econ-autonomous" /> Enable autonomous operation (policy-gated, positive economics only)</label><label className="check"><input type="checkbox" id="econ-discovery" /> Enable opportunity discovery</label><button className="btn btn-danger" id="econ-kill" type="button">Engage kill switch</button><button className="btn" id="econ-tick" type="button">Run one scheduler tick now</button></div><p className="sub" id="econ-policy-note"></p></div><div className="panel"><h3>

        Opportunities</h3><div id="economy-opportunities" className="econ-list"></div></div><div className="panel"><h3>

        Treasury ledger</h3><div id="economy-ledger" className="econ-list"></div></div><div className="panel"><h3>
        Agent accounts &amp; transfers</h3><div id="economy-accounts" className="econ-list"></div><div className="econ-controls"><input id="transfer-agent" placeholder="source agent slug" aria-label="Source agent slug" /><input id="transfer-amount" type="number" min="1" placeholder="amount (cents)" aria-label="Transfer amount cents" /><input id="transfer-reason" placeholder="reason (required)" aria-label="Transfer reason" /><button className="btn" id="transfer-propose" type="button">

        Propose transfer</button></div><div id="economy-transfers" className="econ-list"></div></div><div className="panel"><h3>

        Activity &amp; security events</h3><div id="economy-events" className="econ-list"></div></div></div></section>

      <section className="screen screen-default" id="screen-admin" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Control"></p><h1>

        Admin Control Center</h1><p className="sub">System health, feature flags and emergency controls.</p></div></div><div className="stat-grid" id="admin-stats"></div><div className="panel"><h3>


          Feature flags</h3><form id="flag-form"><input name="key" placeholder="feature key" required aria-label="Feature key" /><input name="value" placeholder="value" aria-label="Feature value" /><button className="btn btn-primary" type="submit">


            Set / enable</button></form><div id="flag-list" className="list"></div></div><div className="panel"><h3>


          Feedback &amp; reports queue</h3><div id="admin-feedback" className="list"></div></div><div className="panel"><h3>Provider sign-in</h3><p className="sub">Owner-only diagnostics. The sign-in screen never shows this — visitors get polished provider buttons, and an unconfigured provider simply appears unavailable.</p><div id="admin-provider-setup" data-provider-setup="1" className="list"></div></div><div className="panel danger-panel"><h3>


          Emergency controls</h3><p className="sub">

          Immediately pause all new agent execution without cancelling existing work.</p><div className="actions"><button className="btn btn-danger" id="emergency-stop">


            Emergency stop</button><button className="btn btn-outline" id="system-resume">

            Resume system</button></div></div></div></section>

      {/* ================= Settings ================= */}
      <section className="screen screen-default" id="screen-settings" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Account"></p><h1>

        Settings</h1><p className="sub">Session, theme and account security.</p></div></div><div className="cols-2"><div className="panel"><h3>


            Account</h3><div className="list"><div className="list-item"><div><b id="settings-name">


              —</b><small id="settings-email">—</small></div></div><div className="list-item"><div><b id="settings-credits">

              —</b><small>Free task credits</small></div></div><div className="list-item"><div><b id="settings-plan">

              —</b><small>Plan</small></div></div><div className="list-item"><div><b id="settings-trial">

              —</b><small>Trial</small></div></div><div className="list-item"><div><b id="settings-role">

              —</b><small>Role</small></div></div></div></div><div className="panel"><h3>


            Appearance &amp; security</h3><div className="list"><div className="list-item"><div><b>


              Visual identity</b><small>AKBARAL! signature luxury glass theme — one designed identity</small></div></div><div className="list-item"><div><b>

              Session</b><small>Bearer session tokens are rotated on refresh.</small></div><span className="badge green">active</span></div></div></div><div className="panel"><h3>


            Connected accounts</h3><div className="list"><div className="list-item"><div><b>
            Password</b><small id="settings-password-status">—</small></div><span className="badge" data-badge="neutral">—</span></div><div className="list" id="settings-oauth-list"><div className="list-item"><small>Sign in to manage connected providers.</small></div></div></div><div id="settings-oauth-actions" className="list"></div></div></div><div className="cols-2"><div className="panel"><h3>


            Trust &amp; privacy</h3><p className="sub"><span aria-hidden="true">

            ⬡</span> Provider credentials are never exposed in the UI; the API reports only configured/unconfigured.</p><button className="btn btn-danger btn-block" id="settings-logout">

            Log out</button></div><div className="panel"><h3>


            Feedback &amp; reports</h3><p className="sub">

            Report a bug, request a feature, send feedback or report abuse. Reports go to a real admin review queue.</p><form id="feedback-form"><label>


              Type
                <select id="feedback-type"><option value="feedback">

                  Feedback</option><option value="bug">

                  Bug report</option><option value="feature">

                  Feature request</option><option value="abuse">

                  Report abuse</option></select></label><label>


              Subject<input id="feedback-subject" maxLength={ 200 } required /></label><label>

              Details<textarea id="feedback-body" rows={ 4 } maxLength={ 10000 } required defaultValue="" /></label><button className="btn btn-primary" type="submit">

              Send report</button></form><div id="feedback-list" className="list"></div></div></div></div></section>
</main>

      {/* Advertising slot + consent (honest architecture — inert until configured + accepted) */}
      <div className="ad-slot" id="ad-slot-footer" hidden data-ad-slot="" aria-label="Advertisement"></div>
      <div className="ads-consent" id="ads-consent" hidden role="region" aria-label="Advertising consent">
        <p>This deployment supports the free tier with third-party advertising (Google AdSense). Advertising cookies are set only if you accept.</p>
        <div className="ads-consent-actions"><button type="button" className="btn btn-primary btn-sm" id="ads-accept">Accept ads</button><button type="button" className="btn btn-outline btn-sm" id="ads-decline">Keep ad-free</button></div>
      </div>

      <footer className="site-footer"><div className="aw-container footer-inner"><div className="footer-brand"><p className="brand-lockup"><span className="brand-mark" aria-hidden="true">

      A!</span> AKBARAL!</p><p className="footer-tagline">One intelligence. Every solution. A Master AI operating platform — no fabrications, no hidden charges.</p></div><nav className="footer-nav" aria-label="Footer"><div className="footer-nav-bar"><a href="#/" data-route-landing>Platform</a><button type="button" className="footer-link" data-legal="about">About</button><button type="button" className="footer-link" data-legal="contact">Contact</button><button type="button" className="footer-link" data-legal="privacy">Privacy</button><button type="button" className="footer-link" data-legal="terms">Terms</button><button type="button" className="footer-link" data-legal="security">Security</button><a href="/api/health" target="_blank" rel="noopener" className="footer-status"><i aria-hidden="true"></i>System status</a></div></nav><p className="footer-copy">


      © <span id="footer-year"></span> AKBARAL!. Real execution · honest credits.</p></div></footer>

      {/* Legal modal */}
      <div className="modal-scrim" id="legal-modal" hidden role="dialog" aria-modal="true" aria-labelledby="legal-title"><div className="modal-card"><button className="modal-close icon-btn" id="legal-close" type="button" aria-label="Close">


      ×</button><p className="eyebrow" data-kicker="Legal"></p><h2 id="legal-title">


      Privacy</h2><div className="legal-body" id="legal-body"></div></div></div>
    </>
  );
}
