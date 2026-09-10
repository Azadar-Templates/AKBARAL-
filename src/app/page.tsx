/* ============================================================
 * AKBARAL! — Cinematic Intelligence homepage (Next.js App Router).
 *
 * Active page for `/`. Rendered as a real React component with native JSX
 * elements. The SPA behaviour is provided by public/app.js.
 *
 * Visual system: "luxury cinematic AI operating system" — near-black
 * cinematic tones, muted olive / moss / antique gold accents, warm
 * off-white editorial typography, hairline borders, fine technical
 * grids, glass surfaces. Fully original design (no third-party assets).
 *
 * Hero background architecture: full-bleed <video> slot
 * (/media/hero-loop.mp4 — drop the production loop there) with an
 * original canvas intelligence-network animation as the live fallback
 * and an original still poster for reduced-motion / no-JS / mobile
 * fallbacks. See docs/DESIGN.md.
 * ============================================================ */

const WORLD_CATEGORIES_ROW_A = [
  ['Research', 51], ['Software engineering', 50], ['Marketing', 50], ['SEO', 50],
  ['UI / UX', 50], ['Data science', 50], ['Finance', 50], ['Automation', 50],
  ['Writing', 50], ['Business strategy', 50], ['Sales', 50], ['Education', 50],
  ['Web development', 50], ['Graphic design', 50], ['Project management', 50], ['Startup', 50],
];

const WORLD_CATEGORIES_ROW_B = [
  ['Documents', 50], ['Excel / spreadsheets', 50], ['E-commerce', 50], ['Translation', 50],
  ['Legal information', 50], ['Travel', 50], ['Recruitment / HR', 50], ['Customer support', 50],
  ['Video', 50], ['Audio', 50], ['Music', 50], ['Voice', 50],
  ['Security', 50], ['DevOps', 50], ['Cloud', 50], ['Social media', 50],
];

const PIPELINE_STAGES = [
  { n: '01', key: 'goal', label: 'User goal', note: 'State any goal in plain language — research, engineering, revenue, operations.' },
  { n: '02', key: 'understanding', label: 'Goal understanding', note: 'Intent detection decomposes the goal into structured, ordered work.' },
  { n: '03', key: 'planner', label: 'Planner', note: 'A persisted workflow and step graph is created with dependencies.' },
  { n: '04', key: 'core', label: 'Master orchestrator', note: 'MASTER sequences steps, selects specialists and streams every state change.' },
  { n: '05', key: 'agents', label: 'Specialist agents', note: 'The right agents are dispatched from a registry of 4,000+ distinct contracts.' },
  { n: '06', key: 'tools', label: 'Tools / APIs', note: 'Real tool execution — search, fetch, files, knowledge, data — with honest credential checks.' },
  { n: '07', key: 'execution', label: 'Execution', note: 'Queued, retried and cancellable runs with live progress in your workspace.' },
  { n: '08', key: 'verification', label: 'Verification', note: 'Sources, evidence and execution checks run before anything is marked successful.' },
  { n: '09', key: 'result', label: 'Final result', note: 'Verified result, full execution history — and credits consumed only on success.' },
];

const TRACE_STEPS = [
  ['Understanding', 'MASTER reads the goal, detects intent and decomposes it into ordered work.', 'completed'],
  ['Planning', 'A workflow is created — steps, dependencies and the specialists each step needs.', 'completed'],
  ['Research', 'Research agents gather real material through live tools with source tracking.', 'active'],
  ['Agent selection', 'Specialists are matched per step from the 4,000+ agent registry.', 'queued'],
  ['Execution', 'Steps run in dependency order — queued, retried, cancellable, streamed live.', 'queued'],
  ['Verification', 'Evidence and execution checks gate every completion. Failures are refunded.', 'queued'],
  ['Result', 'Verified deliverables land in your workspace with the full execution history.', 'queued'],
];

export default function Home() {
  return (
    <>
<div id="toast-root" aria-live="polite" aria-atomic="false"></div><a className="skip-link" href="#app-root">
  Skip to content</a><header className="site-header" id="site-header"><a className="brand" href="#/" aria-label="AKBARAL home"><span className="brand-mark" aria-hidden="true"><span className="brand-mark-glow"></span>

      A!</span><span className="brand-text">
      AKBARAL!</span></a><nav className="main-nav" id="main-nav" aria-label="Primary navigation"><a href="#/dashboard"><span className="nav-dot"></span>

      Dashboard</a><a href="#/master"><span className="nav-dot"></span>
      MASTER AI</a><a href="#/automations"><span className="nav-dot"></span>

      Automations</a><a href="#/agents"><span className="nav-dot"></span>
      Agent World</a><a href="#/factory"><span className="nav-dot"></span>
      Agent Factory</a><a href="#/marketplace"><span className="nav-dot"></span>
      Marketplace</a><a href="#/workspace"><span className="nav-dot"></span>
      Workspace</a><a href="#/crm"><span className="nav-dot"></span>
      CRM</a><a href="#/billing"><span className="nav-dot"></span>
      Billing</a><a href="#/settings"><span className="nav-dot"></span>
      Settings</a><a href="#/admin" className="admin-only" hidden><span className="nav-dot"></span>
      Admin</a></nav><div className="header-actions"><button className="icon-btn theme-toggle" id="theme-toggle" type="button" aria-pressed="false" aria-label="Toggle color theme"><span className="theme-toggle-icon" aria-hidden="true">

        ◐</span></button><span className="credit-pill" id="credit-pill" title="Free task credits">


      …</span><span className="menu-toggle" id="menu-toggle" role="button" tabIndex={ 0 } aria-label="Toggle navigation menu" aria-expanded="false">
      ☰</span><button className="btn btn-outline btn-sm" id="logout-btn" hidden>
      Log out</button><button className="btn btn-outline btn-sm" id="login-btn" data-route="login">
      Log in</button><button className="btn btn-primary btn-sm" id="start-free-nav" data-route="register">Start Building</button></div></header><main id="app-root">

      {/* ================= LANDING — cinematic hero ================= */}
      <section className="screen landing-screen" id="screen-landing">
        <div className="hero" id="hero">
          <div className="hero-media" aria-hidden="true">
            <video id="hero-video" muted loop playsInline preload="none" poster="/media/hero-poster.jpg" disablePictureInPicture tabIndex={-1}>
              <source src="/media/hero-loop.mp4" type="video/mp4" />
            </video>
            <canvas id="hero-canvas"></canvas>
            <div className="hero-poster" style={{ backgroundImage: 'url(/media/hero-poster.jpg)' }}></div>
            <div className="hero-veil"></div>
            <div className="hero-gridlines"></div>
            <div className="hero-vignette"></div>
          </div>
          <div className="hero-brackets" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

          <div className="aw-container hero-inner">
            <div className="hero-copy" data-reveal>
              <p className="hero-system">
                <span className="sys-dot" aria-hidden="true"></span>
                MASTER INTELLIGENCE SYSTEM
                <i className="sys-sep" aria-hidden="true">/</i>
                4,000+ SPECIALISTS
                <i className="sys-sep" aria-hidden="true">/</i>
                <span id="sys-status" className="sys-ok">READY</span>
              </p>
              <h1 className="hero-title">
                One intelligence.
                <span className="hero-title-2">Every solution.</span>
              </h1>
              <p className="hero-sub">
                Thousands of specialist agents. <b>One intelligent orchestration system.</b>
              </p>
              <div className="hero-actions">
                <button className="btn btn-primary btn-lg magnetic" data-route="register" data-magnet><span className="btn-label">

                  Start Building</span><span className="btn-ico" aria-hidden="true">→</span></button>
                <button className="btn btn-outline btn-lg" id="explore-agents" data-magnet>
                  Explore AI Agents</button>
              </div>
            </div>

            <div className="hero-meta" data-reveal data-reveal-delay="120" aria-label="Platform facts">
              <div><small>Orchestration</small><span>Goal → plan → specialists → <b>verified result</b></span></div>
              <div><small>Registry</small><span><b>4,001</b> agents across <b>80</b> disciplines</span></div>
              <div><small>Credits</small><span>5 free tasks · consumed <b>only on success</b></span></div>
              <div><small>Trial</small><span><b>30 days</b> · no card required</span></div>
            </div>
          </div>

          <div className="hero-scroll" aria-hidden="true">Scroll</div>
        </div>

        {/* Chapter index */}
        <nav className="section-rail aw-container" aria-label="Landing chapters">
          <button type="button" data-scroll-to="master-ai"><i>01</i> Master AI</button>
          <button type="button" data-scroll-to="agent-world"><i>02</i> Agent World</button>
          <button type="button" data-scroll-to="factory"><i>03</i> Agent Factory</button>
          <button type="button" data-scroll-to="workspace"><i>04</i> Execution</button>
          <button type="button" data-scroll-to="trust"><i>05</i> Security</button>
          <button type="button" data-scroll-to="pricing"><i>06</i> Pricing</button>
        </nav>

        {/* ================= 01 · MASTER AI pipeline ================= */}
        <div className="aw-container landing-section" id="master-ai">
          <div className="pipeline-wrap">
            <div className="pipeline-side" data-reveal>
              <p className="eyebrow" data-kicker="Master AI"></p>
              <h2>From one goal to a<br />verified result.</h2>
              <p className="sub">
                AKBARAL! is not a chat window. MASTER is a real orchestrator: it understands the
                goal, plans the work, dispatches specialist agents through real tools, verifies
                the evidence and returns a result you can trust — with every step streamed live.
              </p>
              <p className="trust-note">ARCHITECTURE REPRESENTATION — THE REAL PIPELINE RUNS IN YOUR WORKSPACE.</p>
            </div>
            <div className="pipeline" id="pipeline-rail" aria-label="MASTER AI execution architecture">
              {PIPELINE_STAGES.map((stage) => (
                <div className="pipe-stage" data-reveal data-stage={stage.key} key={stage.key}>
                  <small>{stage.n}</small>
                  <b>{stage.label}</b>
                  <p>{stage.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================= 02 · Agent World ================= */}
        <div className="aw-container landing-section" id="agent-world">
          <div className="section-head" data-reveal>
            <p className="eyebrow" data-kicker="Agent World"></p>
            <h2>Eighty disciplines.<br />Four thousand specialists.</h2>
            <p className="sub">
              Every agent in the registry is a genuinely distinct contract — its own instructions,
              capabilities, tool permissions, workflow, verification rules and evaluation config.
              These are the live categories of the real registry.
            </p>
          </div>
          <div className="agent-world-panel" data-reveal>
            <div className="world-stats" aria-label="Registry facts">
              <div><span className="stat-count" data-count="4001">0</span><small>Specialist agents</small></div>
              <div><span className="stat-count" data-count="80">0</span><small>Disciplines</small></div>
              <div><span className="stat-count" data-count="1">0</span><small>Orchestrator</small></div>
            </div>
            <div className="world-marquee" aria-label="Agent registry categories" aria-hidden="true">
              <div className="marquee-row">
                {[...WORLD_CATEGORIES_ROW_A, ...WORLD_CATEGORIES_ROW_A].map(([name, count], i) => (
                  <span className="category-cell" key={`a-${i}`}><b>{name}</b><small>{count}</small></span>
                ))}
              </div>
              <div className="marquee-row reverse">
                {[...WORLD_CATEGORIES_ROW_B, ...WORLD_CATEGORIES_ROW_B].map(([name, count], i) => (
                  <span className="category-cell" key={`b-${i}`}><b>{name}</b><small>{count}</small></span>
                ))}
              </div>
            </div>
            <div className="world-note">
              <p>Plus 48 more disciplines — from localization to film production to scientific research — all live in the registry today.</p>
              <div className="actions">
                <a className="btn btn-outline" href="#/agents">Browse the live registry →</a>
              </div>
            </div>
          </div>
        </div>

        {/* ================= 03 · Agent Factory ================= */}
        <div className="aw-container landing-section" id="factory">
          <div className="section-head" data-reveal>
            <p className="eyebrow" data-kicker="Agent Factory"></p>
            <h2>Manufacture intelligence.</h2>
            <p className="sub">
              The Agent Factory is a real laboratory for building your own specialists — specify
              the contract, map capabilities, assign tools, test, verify and publish with a full
              audit trail.
            </p>
          </div>
          <div className="factory-lab" data-reveal>
            <div className="factory-readout" aria-label="Factory specification readout">
              <h3>Blueprint · readout</h3>
              <div className="readout-line"><span>Registry</span><b>4,001 contracts</b></div>
              <div className="readout-line"><span>Contract fields</span><b>instructions · tools · workflow</b></div>
              <div className="readout-line"><span>Verification</span><b>rules per agent</b></div>
              <div className="readout-line"><span>Versioning</span><b>deploy · disable · rollback</b></div>
              <div className="readout-line"><span>Audit</span><b>every action logged</b></div>
              <div className="readout-line"><span>Ownership</span><b>your tenant, your agents</b></div>
            </div>
            <div className="factory-lineage" aria-label="Agent production lineage">
              <div className="lineage-stage" data-reveal><small>L-01</small><b>Specify</b><p>Define identity, specialization and the system instructions that govern behavior.</p></div>
              <div className="lineage-stage" data-reveal><small>L-02</small><b>Map capabilities</b><p>Declare exactly what the agent can do — capabilities, inputs, outputs.</p></div>
              <div className="lineage-stage" data-reveal><small>L-03</small><b>Assign tools</b><p>Grant a minimal set of real tool permissions. Nothing more.</p></div>
              <div className="lineage-stage" data-reveal><small>L-04</small><b>Test</b><p>Run the agent against real inputs and inspect its execution history.</p></div>
              <div className="lineage-stage" data-reveal><small>L-05</small><b>Verify</b><p>Attach verification rules so success requires evidence, not assertion.</p></div>
              <div className="lineage-stage" data-reveal><small>L-06</small><b>Publish</b><p>Version, deploy to your workspace — or list it on the marketplace.</p></div>
              <div className="factory-cta">
                <a className="btn btn-primary" href="#/factory">Open Agent Factory</a>
                <a className="btn btn-ghost" href="#/marketplace">Visit the marketplace</a>
              </div>
            </div>
          </div>
        </div>

        {/* ================= 04 · Workspace / execution ================= */}
        <div className="aw-container landing-section" id="workspace">
          <div className="section-head" data-reveal>
            <p className="eyebrow" data-kicker="Execution"></p>
            <h2>Watch the system work.</h2>
            <p className="sub">
              Every task runs the same disciplined line — understanding to verified result.
              This is the shape of a real MASTER run; your live workspace shows the actual
              steps, tools and evidence of every task you start.
            </p>
          </div>
          <div className="trace-panel" data-reveal>
            <div className="trace-head">
              <b>Execution trace — representative run</b>
              <span>MASTER · decomposition</span>
            </div>
            <div className="trace-goal">
              <small>User goal</small>
              <p>Build me a complete launch strategy for my business.</p>
            </div>
            <div className="trace-steps">
              {TRACE_STEPS.map(([label, note, state]) => (
                <div className="trace-step" key={label}>
                  <b>{label}</b>
                  <p>{note}</p>
                  <span className={`badge ${state === 'completed' ? 'green' : state === 'active' ? 'gold' : 'blue'}`}>{state}</span>
                </div>
              ))}
            </div>
            <div className="trace-foot">
              <small>Credits are consumed only when a task succeeds. Failures, verification failures and cancellations are refunded automatically.</small>
              <a className="btn btn-outline btn-sm" href="#/master">Run a real task →</a>
            </div>
          </div>
        </div>

        {/* ================= 05 · Trust + security ================= */}
        <div className="aw-container landing-section" id="trust">
          <div className="section-head" data-reveal>
            <p className="eyebrow" data-kicker="Security &amp; trust"></p>
            <h2>Security-first architecture.</h2>
            <p className="sub">
              These are the protections actually implemented and tested in this platform —
              not marketing claims. No system is perfect, and we will never tell you ours is
              unhackable; we will tell you exactly what we do defend.
            </p>
          </div>
          <div className="trust-stamps" data-reveal aria-label="Security posture">
            <span>Secure</span><span>Verified</span><span>Audited</span><span>Isolated</span><span>Protected</span>
          </div>
          <div className="trust-grid" data-reveal>
            <div className="trust-card"><b>Authentication</b><small>JWT access tokens with strictly rotated, hashed refresh tokens.</small></div>
            <div className="trust-card"><b>Authorization</b><small>Role checks and admin-only control routes throughout the API.</small></div>
            <div className="trust-card"><b>Login protection</b><small>Rate limits and lockout guards on authentication endpoints.</small></div>
            <div className="trust-card"><b>Rate limiting</b><small>API and auth buckets with bypass protection.</small></div>
            <div className="trust-card"><b>Tenant isolation</b><small>Tasks, files, knowledge and streams scoped to their owner.</small></div>
            <div className="trust-card"><b>SSRF protection</b><small>Redirect and host checks on every fetched URL.</small></div>
            <div className="trust-card"><b>Upload validation</b><small>Size, extension and storage-key checks on file handling.</small></div>
            <div className="trust-card"><b>Audit logging</b><small>Admin and system actions recorded for review.</small></div>
            <div className="trust-card"><b>Webhook verification</b><small>Signature-verified webhooks with idempotent handling.</small></div>
            <div className="trust-card"><b>Prompt-injection defense</b><small>Untrusted content is never blindly trusted by agents.</small></div>
            <div className="trust-card"><b>Credit atomicity</b><small>Reservation, consumption and refund are atomic and idempotent.</small></div>
            <div className="trust-card"><b>Crash recovery</b><small>Interrupted runs are recovered or refunded — never double-charged.</small></div>
          </div>
          <p className="trust-note" data-reveal>EVERY CONTROL ABOVE IS IMPLEMENTED AND COVERED BY THE PLATFORM TEST SUITE.</p>
        </div>

        {/* ================= 06 · Pricing ================= */}
        <section className="pricing aw-container landing-section" id="pricing">
          <div className="section-head" data-reveal>
            <p className="eyebrow" data-kicker="Pricing"></p>
            <h2>Honest task accounting.</h2>
            <p className="sub">
              Start with 5 free tasks across a 30-day trial. A task is consumed only when work
              succeeds. Paid resources that require Pro are disclosed before use — and if a
              provider is not configured, the platform says so instead of pretending.
            </p>
          </div>
          <div className="price-grid" id="landing-plans" data-reveal></div>
          <div className="pricing-rules" data-reveal aria-label="Billing rules">
            <div><small>01</small><span>30-day trial with 5 free tasks. No card required.</span></div>
            <div><small>02</small><span>A free task is consumed only when work succeeds.</span></div>
            <div><small>03</small><span>Failed, unverified or cancelled tasks are refunded automatically.</span></div>
            <div><small>04</small><span>Paid resources are clearly disclosed; Pro required where applicable.</span></div>
            <div><small>05</small><span>Every credit movement is visible in your billing ledger.</span></div>
          </div>
        </section>

        {/* ================= Final CTA ================= */}
        <div className="aw-container landing-section cta-final" id="cta">
          <div data-reveal>
            <h2>State the goal.<br /><span>The system does the rest.</span></h2>
            <p>One intelligence. Every solution. Start building with AKBARAL! today.</p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg magnetic" data-route="register" data-magnet><span className="btn-label">

                Start Building</span><span className="btn-ico" aria-hidden="true">→</span></button>
              <button className="btn btn-ghost btn-lg" id="explore-agents-final" data-route="agents">Explore Agent World</button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= AUTH ================= */}
      <section className="screen auth-screen" id="screen-auth" hidden><div className="aw-container"><div className="auth-card"><div className="auth-core" aria-hidden="true"><span className="auth-core-ring"></span><span className="auth-core-dot">

          A!</span></div><h2 id="auth-title">
          Sign in</h2><p className="auth-sub" id="auth-sub">
          Access your agent operations center.</p><form id="auth-form" autoComplete="on"><label>


            Email<input type="email" id="auth-email" autoComplete="email" required /></label><label>
            Password<input type="password" id="auth-password" minLength={ 8 } autoComplete="current-password" required /></label><label id="auth-name-wrap" hidden>
            Name<input type="text" id="auth-name" autoComplete="name" /></label><button className="btn btn-primary btn-block" id="auth-submit" type="submit">
            Continue</button></form><p className="auth-switch" id="auth-switch">


          No account? <a href="#/register">Create one</a></p><p className="auth-trust" role="note"><span aria-hidden="true">

          ⬡</span> Secured with rotated session tokens and honest provider checks.</p></div></div></section>

      {/* ================= Dashboard ================= */}
      <section className="screen screen-default" id="screen-dashboard" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Overview"></p><h1>

          Dashboard</h1><p className="sub">Your AKBARAL operating picture at a glance.</p></div><button className="btn btn-ghost" id="refresh-dashboard">

          Refresh</button></div><div className="stat-grid" id="dashboard-stats"></div><div className="cols-2"><div className="panel"><h3>

          Recent tasks</h3><div id="dashboard-tasks" className="list"></div></div><div className="panel"><h3>
          My agents</h3><div id="dashboard-agents" className="list"></div></div></div></div></section>

      {/* ================= MASTER AI ================= */}
      <section className="screen screen-default" id="screen-master" hidden><div className="aw-container"><div className="page-head master-head"><div><p className="eyebrow" data-kicker="MASTER AI"></p><h1>

          MASTER AI</h1><p className="sub">Describe a goal. MASTER plans, picks specialists and runs the workflow.</p></div><div className="master-core" id="master-core" data-state="idle" role="status" aria-label="MASTER core status"><div className="core-ring r1"></div><div className="core-ring r2"></div><div className="core-spark"></div><span className="master-core-label" id="master-core-label">


            idle</span></div></div><div className="panel master-panel"><form id="master-form"><label>


            Goal<textarea id="master-goal" rows={ 4 } placeholder="e.g. Research the Pakistani AI market and build a go-to-market plan." required defaultValue="" /></label><div className="form-row"><label>


              Project <select id="master-project"><option value="">— none —</option></select></label><button className="btn btn-primary" id="master-plan-btn" type="submit">
              Plan &amp; run</button></div></form></div><div id="master-output" className="output" aria-live="polite"></div></div></section>

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


            Create custom agent</h3><label>
            Name<input name="name" required /></label><label>
            Specialization<input name="specialization" required /></label><label>
            Description<textarea name="description" required defaultValue="" /></label><label>

            System instructions<textarea name="system_instructions" rows={ 6 } required defaultValue="" /></label><label>
            Capabilities (comma separated)<input name="capabilities" /></label><label>

            Tool permissions (comma separated)<input name="tool_permissions" placeholder="web_search, page_fetch, knowledge_search" /></label><label>
            Verification rules (comma separated)<input name="verification_rules" /></label><label>

            Price (PKR, optional)<input type="number" name="price_cents" placeholder="0" /></label><button className="btn btn-primary" type="submit">

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


            Knowledge search</h3><form id="knowledge-form"><input placeholder="Search your knowledge" required aria-label="Search knowledge" /><button className="btn btn-primary" type="submit">

            Search</button></form><div id="knowledge-results" className="list"></div></div></div><div className="panel" id="project-workspace"></div></div></section>

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
              Amount (PKR)<input type="number" name="amount_cents" min="1" defaultValue="2500" required /></label><button className="btn btn-primary" type="submit">

              Request purchase</button></form><div id="credit-order"></div></div></div><div className="panel"><h3>


        Invoices</h3><div id="invoice-list" className="list"></div></div></div></section>

      {/* ================= Admin ================= */}
      <section className="screen screen-default" id="screen-admin" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Control"></p><h1>

        Admin Control Center</h1><p className="sub">System health, feature flags and emergency controls.</p></div></div><div className="stat-grid" id="admin-stats"></div><div className="panel"><h3>


          Feature flags</h3><form id="flag-form"><input name="key" placeholder="feature key" required aria-label="Feature key" /><input name="value" placeholder="value" aria-label="Feature value" /><button className="btn btn-primary" type="submit">


            Set / enable</button></form><div id="flag-list" className="list"></div></div><div className="panel"><h3>


          Feedback &amp; reports queue</h3><div id="admin-feedback" className="list"></div></div><div className="panel danger-panel"><h3>


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


              Theme</b><small>AKBARAL dark / light identity</small></div><button className="btn btn-outline btn-sm" id="settings-theme-toggle">Toggle theme</button></div><div className="list-item"><div><b>

              Session</b><small>Bearer session tokens are rotated on refresh.</small></div><span className="badge green">active</span></div></div><p className="auth-trust" role="note"><span aria-hidden="true">


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

      A!</span> AKBARAL!</p><p className="footer-tagline">One intelligence. Every solution. A Master AI operating platform — no fabrications, no hidden charges.</p></div><nav className="footer-nav" aria-label="Footer"><a href="#/" data-route-landing>

        Platform</a><button type="button" className="footer-link" data-legal="about">

        About</button><button type="button" className="footer-link" data-legal="contact">

        Contact</button><button type="button" className="footer-link" data-legal="privacy">

        Privacy</button><button type="button" className="footer-link" data-legal="terms">

        Terms</button><button type="button" className="footer-link" data-legal="security">

        Security</button><a href="/api/health" target="_blank" rel="noopener">

        Status</a></nav><p className="footer-copy">


      © <span id="footer-year"></span> AKBARAL!. Real execution · honest credits.</p></div></footer>

      {/* Legal modal */}
      <div className="modal-scrim" id="legal-modal" hidden role="dialog" aria-modal="true" aria-labelledby="legal-title"><div className="modal-card"><button className="modal-close icon-btn" id="legal-close" type="button" aria-label="Close">


      ×</button><p className="eyebrow" data-kicker="Legal"></p><h2 id="legal-title">


      Privacy</h2><div className="legal-body" id="legal-body"></div></div></div>
    </>
  );
}
