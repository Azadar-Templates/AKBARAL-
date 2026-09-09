/* ============================================================
 * AKBARAL! — MASTER AI premium homepage (Next.js App Router).
 *
 * Active page for `/`. Rendered as a real React component with native JSX
 * elements. The SPA behaviour is provided by public/app.js.
 * ============================================================ */

export default function Home() {
  return (
    <>
<div id="toast-root" aria-live="polite" aria-atomic="false"></div><a className="skip-link" href="#app-root">  
  Skip to content</a><header className="site-header" id="site-header"><a className="brand" href="#/" aria-label="AKBARAL home"><span className="brand-mark" aria-hidden="true"><span className="brand-mark-glow"></span>

      A!</span><span className="brand-text">
      AKBARAL!</span></a><nav className="main-nav" id="main-nav" aria-label="Primary navigation"><a href="#/dashboard"><span className="nav-dot"></span>

      Dashboard</a><a href="#/master"><span className="nav-dot"></span>
      MASTER AI</a><a href="#/agents"><span className="nav-dot"></span>
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
      Log out</button><button className="btn btn-primary btn-sm" id="login-btn" data-route="login">
      Log in</button><button className="btn btn-primary btn-sm" id="start-free-nav" data-route="register">Start free</button></div></header><main id="app-root">{/* Landing */}<section className="screen landing-screen" id="screen-landing"><div className="aw-container new-hero" id="hero"><div className="hero-copy" data-reveal><span className="brand-chip" aria-hidden="true"><span className="brand-chip-mark">

          A!</span> AKBARAL! · MASTER AI</span><h1 className="hero-title">
          One AI system. Thousands of specialists. <span className="gradient-text">One place to get work done.</span></h1><p className="lead">
          AKBARAL! turns a plain-language goal into a coordinated AI operation: MASTER plans it, specialist agents execute through real tools, results are verified, and every credit is handled honestly.</p><div className="hero-actions"><button className="btn btn-primary btn-lg magnetic" data-route="register" data-magnet><span className="btn-label">
          
            Start with AKBARAL!</span><span className="btn-ico" aria-hidden="true">→</span></button><button className="btn btn-outline btn-lg" id="explore-agents" data-magnet>
            Explore Agents</button></div><div className="trust-row" aria-label="Platform value indicators"><span className="trust-chip"><span className="trust-ico" aria-hidden="true">

            ✓</span>5 free tasks</span><span className="trust-chip"><span className="trust-ico" aria-hidden="true">
            ◎</span>Real tool execution</span><span className="trust-chip"><span className="trust-ico" aria-hidden="true">
            ◈</span>Tenant isolation</span></div></div><div className="orchestration-console" data-reveal data-reveal-delay="90" aria-label="AKBARAL AI orchestration preview"><div className="console-toolbar"><i></i><i></i><i></i><strong>

          AKBARAL OPERATIONS</strong><span className="console-status">live</span></div><div className="console-body"><div className="core-wrap"><div className="core-glow"></div><div className="ai-core"><span className="core-mark">

              A!</span><span className="core-label">MASTER</span></div><div className="orbit ring-a"></div><div className="orbit ring-b"></div><div className="orbit-node o1">

              Coding</div><div className="orbit-node o2">
              Research</div><div className="orbit-node o3">
              Revenue</div><div className="orbit-node o4">
              Design</div><div className="orbit-node o5">
              Automation</div><div className="orbit-node o6">
              Support</div><svg className="task-links" viewBox="0 0 480 360" aria-hidden="true"><path d="M205 180 L150 88 L66 70" className="link-line"></path><path d="M205 180 L290 78 L380 64" className="link-line"></path><path d="M205 180 L120 260 L52 300" className="link-line"></path><path d="M205 180 L330 268 L428 300" className="link-line"></path><path d="M205 180 L250 284 L300 322" className="link-line"></path><path d="M205 180 L150 60 L74 34" className="link-line dim"></path><path d="M205 180 L340 94 L442 52" className="link-line dim"></path></svg></div><div className="console-stack"><div className="task-card active"><span className="task-ico">

              ◈</span><div><b>Goal received</b><small>Launch research → GTM plan</small></div><span className="task-state">planning</span></div><div className="task-card"><span className="task-ico">
              ▣</span><div><b>Web research</b><small>Specialist agent · live tools</small></div><span className="task-state ok">running</span></div><div className="task-card"><span className="task-ico">
              ◎</span><div><b>Verify sources</b><small>Evidence + checks</small></div><span className="task-state">queued</span></div><div className="task-card"><span className="task-ico">
              ✓</span><div><b>Return result</b><small>Workspace + credits</small></div><span className="task-state ok">ready</span></div></div></div></div></div><nav className="platform-nav aw-container" aria-label="Landing sections"><button type="button" data-scroll-to="master-ai">

        MASTER AI</button><button type="button" data-scroll-to="agent-world">
        Agent World</button><button type="button" data-scroll-to="factory">
        Agent Factory</button><button type="button" data-scroll-to="workspace">
        Workspace</button><button type="button" data-scroll-to="automation">
        Automation</button><button type="button" data-scroll-to="creative">
        Creative AI</button><button type="button" data-scroll-to="integrations">
        Integrations</button><button type="button" data-scroll-to="trust">
        Trust</button><button type="button" data-scroll-to="pricing">
        Pricing</button></nav><div className="brand-strip aw-container" data-reveal><div className="brand-strip-inner"><span>

          Real tool execution</span><i aria-hidden="true"></i><span>
          4,000+ specialist agents</span><i aria-hidden="true"></i><span>
          Agent Factory</span><i aria-hidden="true"></i><span>
          Workspace</span><i aria-hidden="true"></i><span>
          Automation</span><i aria-hidden="true"></i><span>
          Honest credits</span></div></div><div className="aw-container section-block"><div className="section-head"><p className="eyebrow" data-kicker="Platform"></p><h2>

        One integrated operating system for real work</h2><p className="sub">No single-purpose AI toy. AKBARAL! coordinates research, engineering, revenue, design, operations and support through real routes, tools and verification.</p></div><div className="feature-grid capability-grid" data-reveal><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
        
          ✦</span><h3>MASTER AI Orchestrator</h3><p>Turns a goal into a plan, selects the right specialists, runs tools, verifies output and streams every step to your workspace.</p><span className="card-foot">Plan · execute · verify</span></article><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
          ▣</span><h3>4,000+ specialist agents</h3><p>Genuinely distinct contracts across coding, research, business, design, finance, automation, security, support and more.</p><span className="card-foot"><a href="#/agents">Open Agent World →</a></span></article><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
          ✓</span><h3>Honest credits</h3><p>5 free tasks on a 30-day trial. A task is consumed only on success; failures are refunded automatically.</p><span className="card-foot"><a href="#/billing">View billing →</a></span></article><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
          ▤</span><h3>Workspace &amp; knowledge</h3><p>Projects, files, knowledge and execution history live inside an isolated tenant with real security boundaries.</p><span className="card-foot"><a href="#/workspace">Open workspace →</a></span></article><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
          ◈</span><h3>Automation &amp; CRM</h3><p>Contacts, pipelines, campaigns, automations and AI employees connected to real project context and revenue flow.</p><span className="card-foot"><a href="#/crm">Open CRM →</a></span></article><article className="feature-card premium-card"><span className="feature-ico" aria-hidden="true">
          ◎</span><h3>Agent Factory</h3><p>Create, test, security-review, benchmark, version, deploy and rollback your own agents with an audit trail.</p><span className="card-foot"><a href="#/factory">Open Factory →</a></span></article></div></div><div className="aw-container landing-section" id="master-ai" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="How it works"></p><h2>

        From one goal to a coordinated AI operation</h2><p className="sub">MASTER AI is the conductor. It decomposes intent, assigns specialists, runs real tools, verifies evidence and returns a trusted result.</p></div><div className="workflow-rail"><div className="workflow-step"><span className="step-index">
        
          01</span><b>User goal</b><small>Plain language or business task</small></div><i className="rail-arrow">→</i><div className="workflow-step"><span className="step-index">
          02</span><b>MASTER AI orchestrator</b><small>Intent + plan + selection</small></div><i className="rail-arrow">→</i><div className="workflow-step"><span className="step-index">
          03</span><b>Specialist agents</b><small>Research · coding · revenue · design</small></div><i className="rail-arrow">→</i><div className="workflow-step"><span className="step-index">
          04</span><b>Tools + models</b><small>Real APIs with honest credential checks</small></div><i className="rail-arrow">→</i><div className="workflow-step"><span className="step-index">
          05</span><b>Verification</b><small>Sources, evidence, execution checks</small></div><i className="rail-arrow">→</i><div className="workflow-step"><span className="step-index">
          06</span><b>Final result</b><small>Workspace · history · credits</small></div></div></div><div className="aw-container landing-section" id="agent-world" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Agent World"></p><h2>

        A specialist network, not a single chatbot</h2><p className="sub">4,000+ genuinely specialized agent contracts. Each carries its own instructions, tool permissions, workflow, verification rules and evaluation config.</p></div><div className="agent-layout"><div className="agent-network" aria-hidden="true"><div className="net-core">

            A!</div><span className="net-node n1">
            Coding</span><span className="net-node n2">Research</span><span className="net-node n3">Business</span><span className="net-node n4">Marketing</span><span className="net-node n5">SEO</span><span className="net-node n6">Design</span><span className="net-node n7">Video</span><span className="net-node n8">Audio</span><span className="net-node n9">Data</span><span className="net-node n10">
            Finance</span><span className="net-node n11">Education</span><span className="net-node n12">Career</span><span className="net-node n13">Automation</span><span className="net-node n14">Travel</span><span className="net-node n15">Security</span><span className="net-node n16">Support</span><span className="net-node n17">E-com</span><span className="net-node n18">Social</span></div><div className="agent-categories" data-reveal><div className="category-chip">

            Coding</div><div className="category-chip">Research</div><div className="category-chip">Business</div><div className="category-chip">Marketing</div><div className="category-chip">SEO</div><div className="category-chip">Design</div><div className="category-chip">Video</div><div className="category-chip">Audio</div><div className="category-chip">Data</div><div className="category-chip">Finance</div><div className="category-chip">Education</div><div className="category-chip">Career</div><div className="category-chip">Automation</div><div className="category-chip">Travel</div><div className="category-chip">Security</div><div className="category-chip">Customer support</div><div className="category-chip">E-commerce</div><div className="category-chip">Social media</div><a className="btn btn-ghost" href="#/agents">
            Browse live registry →</a></div></div></div><div className="aw-container landing-section" id="factory" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Agent Factory"></p><h2>

        Build agents like a product team</h2><p className="sub">Define instructions, tool permissions and workflow, then run security review, benchmark, version, deploy, disable and rollback.</p></div><div className="factory-studio"><div className="studio-side"><div className="studio-chip active">
        
          Create</div><div className="studio-chip">Configure</div><div className="studio-chip">Test</div><div className="studio-chip">Evaluate</div><div className="studio-chip">Secure</div><div className="studio-chip">Deploy</div><div className="studio-chip">Version</div><div className="studio-chip">Rollback</div></div><div className="studio-preview"><div className="preview-top"><span className="preview-dot"></span><span className="preview-dot"></span><span className="preview-dot"></span><b>
          
            agent-builder</b><span className="preview-status">factory ready</span></div><div className="preview-grid"><label>
            
              Name<input defaultValue="Revenue Analyst" aria-label="Agent name" /></label><label>
              Specialization<input defaultValue="Pipeline research, revenue briefs, CRM automation" aria-label="Specialization" /></label><label>
              Tool permissions<textarea rows={ 4 } aria-label="Tool permissions" defaultValue="web_search, page_fetch, knowledge_search" /></label><label>
              Verification<textarea rows={ 4 } aria-label="Verification rules" defaultValue="source evidence, no fabricated numbers" /></label></div><div className="preview-actions"><button type="button" className="btn btn-outline btn-sm">
            
            Security review</button><button type="button" className="btn btn-ghost btn-sm">Benchmark</button><button type="button" className="btn btn-primary btn-sm">Deploy v1</button></div></div></div></div><div className="aw-container landing-section" id="workspace" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Workspace"></p><h2>

        Work like a real operating center</h2><p className="sub">The live workspace concept: goal input, execution plan, active agents, task progress, tool usage, verification and final result.</p></div><div className="workspace-demo"><div className="ws-col main"><div className="ws-card"><small>

            User goal</small><p>Research the Pakistan AI market and build a go-to-market plan.</p><span className="ws-tag">MASTER · planning</span></div><div className="ws-card"><small>
            Execution plan</small><div className="ws-line"><i></i><span>Market research → agents</span><b>active</b></div><div className="ws-line"><i></i><span>Competitor brief → drafting</span><b>active</b></div><div className="ws-line"><i></i><span>Verify sources → evidence</span><b>queued</b></div></div></div><div className="ws-col side"><div className="ws-card"><small>

            Active agents</small><div className="ws-avatar-row"><span>R</span><span>E</span><span>D</span><b>+9 more</b></div></div><div className="ws-card"><small>
            Live progress</small><div className="progress-track"><span style={{ "width": "64%" }}></span></div><span className="ws-tag exact">64% · 3/5 steps</span></div><div className="ws-card"><small>
            Tool usage</small><div className="ws-tool">web_search · 12 calls</div><div className="ws-tool">page_fetch · 8 calls</div></div><div className="ws-card success"><small>
            Verification</small><p>Evidence returned, no fabricated results.</p><span className="ws-tag">verified</span></div></div></div></div><div className="aw-container landing-section" id="automation" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="AI Employees"></p><h2>

        Automate business work, not just chat</h2><p className="sub">Sales, marketing, customer support, CRM, operations, research, content and business automation with real triggers and honest delivery checks.</p></div><div className="employee-grid"><div className="employee-card"><span className="emp-ico">
        
          ◈</span><b>Sales</b><small>Pipeline briefs, follow-up research, CRM context</small></div><div className="employee-card"><span className="emp-ico">
          ▤</span><b>Marketing</b><small>Campaign structure, copy, channel angle</small></div><div className="employee-card"><span className="emp-ico">
          ◎</span><b>Customer support</b><small>Answer drafts grounded in workspace knowledge</small></div><div className="employee-card"><span className="emp-ico">
          ▣</span><b>CRM</b><small>Contacts, pipelines, campaigns and automations</small></div><div className="employee-card"><span className="emp-ico">
          ✓</span><b>Operations</b><small>Task breakdowns, status tracking, handoffs</small></div><div className="employee-card"><span className="emp-ico">
          ✦</span><b>Research</b><small>Multi-source research with evidence</small></div><div className="employee-card"><span className="emp-ico">
          ▧</span><b>Content</b><small>Briefs, outlines, drafts with review layers</small></div><div className="employee-card"><span className="emp-ico">
          ◈</span><b>Business automation</b><small>Automations triggered by real business events</small></div></div></div><div className="aw-container landing-section" id="creative" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Creative AI"></p><h2>

        Creative AI with a production mindset</h2><p className="sub">Image direction, design systems, video structure, shorts, audio, voice direction, branding and campaign concepts.</p></div><div className="creative-grid"><div className="creative-card"><b>
        
          Image</b><small>Visual direction and image-generation briefs</small></div><div className="creative-card"><b>
          Design</b><small>Layout, brand system, product presentation</small></div><div className="creative-card"><b>
          Video</b><small>Storyboard, hooks, edit plan, captions</small></div><div className="creative-card"><b>
          Shorts</b><small>Vertical content structure and scripts</small></div><div className="creative-card"><b>
          Audio</b><small>Podcast structure, voice notes, sound direction</small></div><div className="creative-card"><b>
          Voice</b><small>Voice direction and speaking frameworks</small></div><div className="creative-card"><b>
          Branding</b><small>Positioning, naming angles, tone of voice</small></div><div className="creative-card"><b>
          Campaigns</b><small>Concept, target, channel, message hierarchy</small></div></div></div><div className="aw-container landing-section" id="integrations" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Integrations"></p><h2>

        Real tool surfaces, honestly reported</h2><p className="sub">Integration tiles below represent the actual product surface. Connected provider credentials are reported as configured/unconfigured, never exposed or faked.</p></div><div className="integration-studio"><div className="integration-hub"><div className="hub-glow"></div><div className="hub-core">
        
          A!</div><span className="hub-ring"></span></div><div className="integration-tiles"><div className="integration-tile"><b>
          
            Web Search</b><small>Product capability</small></div><div className="integration-tile"><b>
            Page Fetch</b><small>Product capability</small></div><div className="integration-tile"><b>
            Files</b><small>Product capability</small></div><div className="integration-tile"><b>
            Knowledge</b><small>Product capability</small></div><div className="integration-tile"><b>
            Repositories</b><small>Product capability</small></div><div className="integration-tile"><b>
            Excel / Data</b><small>Product capability</small></div><div className="integration-tile"><b>
            Image Rendering</b><small>Product capability</small></div><div className="integration-tile"><b>
            Email / SMTP</b><small>Configured via provider env</small></div><div className="integration-tile"><b>
            Webhooks</b><small>Product capability</small></div><div className="integration-tile"><b>
            APIs</b><small>Credential-backed, guarded</small></div><div className="integration-tile muted"><b>
            Social platforms</b><small>Not claimed until connected</small></div><div className="integration-tile muted"><b>
            E-commerce</b><small>Not claimed until connected</small></div></div></div></div><div className="aw-container landing-section" id="trust" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Security & trust"></p><h2>

        Enterprise-grade controls, no fake claims</h2><p className="sub">No fabricated results, no invented security certifications, no fake reviews or statistics.</p></div><div className="trust-grid"><div className="trust-card"><b>
        
          Workspace isolation</b><small>Tenant scoping on reads, writes, files and execution streams.</small></div><div className="trust-card"><b>
          Permissions</b><small>Role checks and admin-only control routes.</small></div><div className="trust-card"><b>
          Audit logs</b><small>Admin and system actions recorded.</small></div><div className="trust-card"><b>
          Secure API keys</b><small>Provider credentials never sent to the browser.</small></div><div className="trust-card"><b>
          Rate limits</b><small>API and auth buckets with bypass protection.</small></div><div className="trust-card"><b>
          Prompt-injection defense</b><small>Untrusted content is not blindly trusted.</small></div><div className="trust-card"><b>
          SSRF protection</b><small>Redirect and host checks on fetched URLs.</small></div><div className="trust-card"><b>
          Safe file handling</b><small>Size, extension and storage-key validation.</small></div><div className="trust-card"><b>
          Execution verification</b><small>Sources and evidence checked before success.</small></div></div></div><section className="pricing aw-container landing-section" id="pricing" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Pricing"></p><h2>

        Transparent pricing, honest task accounting</h2><p className="sub">Start with 5 free tasks during the 30-day trial. A free task is consumed only when work succeeds. Failure or unavailable paid resources keep the task.</p></div><div className="price-grid" id="landing-plans"></div><div className="pricing-note">
        
        Custom credit purchase available in your account. Payment processing is handled by the existing billing routes — no fake checkout here.</div></section><div className="aw-container landing-section faq-section" id="faq" data-reveal><div className="section-head"><p className="eyebrow" data-kicker="Questions"></p><h2>

        Frequently asked</h2></div><details className="faq-item"><summary>
        How do the 5 free tasks work?</summary><p>Your 30-day trial begins with 5 free tasks. A task reserves one credit atomically; it is consumed only when the task succeeds. If it fails or needs unavailable paid resources, the credit stays available.</p></details><details className="faq-item"><summary>
        What does MASTER AI actually do?</summary><p>MASTER takes a plain-language goal, builds a plan, selects specialist agents, runs real tools and models, verifies the output, then returns the result and history to your workspace.</p></details><details className="faq-item"><summary>
        Are the 4,000+ agents real specialists?</summary><p>Each registry entry carries a real specialization, system instructions, tool permissions, workflow, verification rules and evaluation config. No duplicate filler.</p></details><details className="faq-item"><summary>
        Can I build my own agent?</summary><p>Yes. Agent Factory lets you create, configure, test, evaluate, secure, deploy, version and rollback agents with an audit trail.</p></details><details className="faq-item"><summary>
        Is my workspace isolated?</summary><p>Yes. Projects, files, knowledge, tasks and execution streams are scoped to your authenticated account and checked at every read/mutation.</p></details></div><div className="aw-container landing-section final-cta" id="cta" data-reveal><div className="cta-card"><div><p className="eyebrow" data-kicker="Begin"></p><h2>

          Give AKBARAL! a goal.</h2><p className="sub">One goal becomes a coordinated AI execution — planned, run through real tools, verified and returned to your workspace.</p></div><div className="hero-actions"><button className="btn btn-primary btn-lg magnetic" data-route="register" data-magnet>
          Start with AKBARAL!</button><button className="btn btn-ghost btn-lg" id="explore-agents-final" data-route="agents">Explore Agent World</button></div></div></div></section>{/* Auth */}<section className="screen auth-screen" id="screen-auth" hidden><div className="aw-container"><div className="auth-card"><div className="auth-core" aria-hidden="true"><span className="auth-core-ring"></span><span className="auth-core-dot">

          A!</span></div><h2 id="auth-title">
          Sign in</h2><p className="auth-sub" id="auth-sub">
          Access your agent operations center.</p><form id="auth-form" autoComplete="on"><label>
          
            Email<input type="email" id="auth-email" autoComplete="email" required /></label><label>
            Password<input type="password" id="auth-password" minLength={ 8 } autoComplete="current-password" required /></label><label id="auth-name-wrap" hidden>
            Name<input type="text" id="auth-name" autoComplete="name" /></label><button className="btn btn-primary btn-block" id="auth-submit" type="submit">
            Continue</button></form><p className="auth-switch" id="auth-switch">
          
          No account? <a href="#/register">Create one</a></p><p className="auth-trust" role="note"><span aria-hidden="true">
          🔒</span> Secured with session tokens and honest provider checks.</p></div></div></section>{/* Dashboard */}<section className="screen screen-default" id="screen-dashboard" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Overview"></p><h1>

          Dashboard</h1><p className="sub">Your AKBARAL operating picture at a glance.</p></div><button className="btn btn-ghost" id="refresh-dashboard">
          Refresh</button></div><div className="stat-grid" id="dashboard-stats"></div><div className="cols-2"><div className="panel"><h3>

          Recent tasks</h3><div id="dashboard-tasks" className="list"></div></div><div className="panel"><h3>
          My agents</h3><div id="dashboard-agents" className="list"></div></div></div></div></section>{/* MASTER AI */}<section className="screen screen-default" id="screen-master" hidden><div className="aw-container"><div className="page-head master-head"><div><p className="eyebrow" data-kicker="MASTER AI"></p><h1>

          MASTER AI</h1><p className="sub">Describe a goal. MASTER plans, picks specialists and runs the workflow.</p></div><div className="master-core" id="master-core" data-state="idle" role="status" aria-label="MASTER core status"><div className="core-ring r1"></div><div className="core-ring r2"></div><div className="core-spark"></div><span className="master-core-label" id="master-core-label">

            idle</span></div></div><div className="panel master-panel"><form id="master-form"><label>

            Goal<textarea id="master-goal" rows={ 4 } placeholder="e.g. Research the Pakistani AI market and build a go-to-market plan." required defaultValue="" /></label><div className="form-row"><label>
            
              Project <select id="master-project"><option value="">— none —</option></select></label><button className="btn btn-primary" id="master-plan-btn" type="submit">
              Plan &amp; run</button></div></form></div><div id="master-output" className="output" aria-live="polite"></div></div></section>{/* Agent World */}<section className="screen screen-default" id="screen-agents" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Registry"></p><h1>

        Agent World</h1><p className="sub">Browse 4,000+ genuinely distinct specialists.</p></div></div><div className="toolbar"><input id="agent-search" placeholder="Search agents…" aria-label="Search agents" /><select id="agent-category" aria-label="Filter by category"><option value="">

          All categories</option></select><button className="btn btn-ghost" id="refresh-agents">
          Refresh</button></div><div id="agent-list" className="agent-grid"></div></div></section>{/* Agent Factory */}<section className="screen screen-default" id="screen-factory" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Build"></p><h1>

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

            My agents</h3><div id="factory-agents" className="list"></div></div><div id="factory-detail" className="panel detail-panel"></div></div></div></div></section>{/* Marketplace */}<section className="screen screen-default" id="screen-marketplace" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Exchange"></p><h1>

        Marketplace</h1><p className="sub">Discover, install and publish agents.</p></div></div><div className="toolbar"><button className="btn btn-ghost" id="refresh-marketplace">
        Refresh</button></div><div id="marketplace-list" className="agent-grid"></div></div></section>{/* Workspace */}<section className="screen screen-default" id="screen-workspace" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Knowledge"></p><h1>

        Workspace</h1><p className="sub">Projects, files and knowledge.</p></div></div><div className="cols-2"><div className="panel"><h3>

            Projects</h3><form id="project-form"><input placeholder="Project name" required aria-label="Project name" /><button className="btn btn-primary" type="submit">
            Create</button></form><div id="project-list" className="list"></div></div><div className="panel"><h3>

            Knowledge search</h3><form id="knowledge-form"><input placeholder="Search your knowledge" required aria-label="Search knowledge" /><button className="btn btn-primary" type="submit">
            Search</button></form><div id="knowledge-results" className="list"></div></div></div><div className="panel" id="project-workspace"></div></div></section>{/* CRM */}<section className="screen screen-default" id="screen-crm" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Revenue"></p><h1>

        CRM &amp; Automation</h1><p className="sub">Contacts, pipelines, campaigns, automations and AI employees.</p></div></div><div className="cols-2"><div className="panel"><h3>

            Contacts</h3><form id="contact-form"><input name="first_name" placeholder="First name" /><input name="email" placeholder="Email" /><button className="btn btn-primary" type="submit">
            Add contact</button></form><div id="contact-list" className="list"></div></div><div className="panel"><h3>

            Campaigns</h3><form id="campaign-form"><input name="name" placeholder="Campaign name" required /><button className="btn btn-primary" type="submit">
            Create</button></form><div id="campaign-list" className="list"></div></div></div><div className="cols-2"><div className="panel"><h3>

            Automations</h3><form id="automation-form"><input name="name" placeholder="Automation name" required /><input name="trigger_key" placeholder="Trigger (e.g. deal.won)" required /><button className="btn btn-primary" type="submit">
            Create</button></form><div id="automation-list" className="list"></div></div><div className="panel"><h3>

            AI Employees</h3><form id="employee-form"><input name="name" placeholder="Employee name" required /><input name="role" placeholder="Role" required /><button className="btn btn-primary" type="submit">
            Hire</button></form><div id="employee-list" className="list"></div></div></div></div></section>{/* Billing */}<section className="screen screen-default" id="screen-billing" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Billing"></p><h1>

        Billing &amp; credits</h1><p className="sub">Transparent plans, honest ledger of every credit.</p></div></div><div className="stat-grid" id="billing-stats"></div><div className="cols-2"><div className="panel"><h3>

          Plans</h3><div id="billing-plans" className="list"></div></div><div className="panel"><h3>
          Custom credits</h3><form id="credit-form"><label>
            
              Credits<input type="number" name="credits" min="1" defaultValue="10" required /></label><label>
              Amount (PKR)<input type="number" name="amount_cents" min="1" defaultValue="2500" required /></label><button className="btn btn-primary" type="submit">
              Request purchase</button></form><div id="credit-order"></div></div></div><div className="panel"><h3>

        Invoices</h3><div id="invoice-list" className="list"></div></div></div></section>{/* Admin */}<section className="screen screen-default" id="screen-admin" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Control"></p><h1>

        Admin Control Center</h1><p className="sub">System health, feature flags and emergency controls.</p></div></div><div className="stat-grid" id="admin-stats"></div><div className="panel"><h3>

          Feature flags</h3><form id="flag-form"><input name="key" placeholder="feature key" required aria-label="Feature key" /><input name="value" placeholder="value" aria-label="Feature value" /><button className="btn btn-primary" type="submit">

            Set / enable</button></form><div id="flag-list" className="list"></div></div><div className="panel"><h3>

          Feedback &amp; reports queue</h3><div id="admin-feedback" className="list"></div></div><div className="panel danger-panel"><h3>

          Emergency controls</h3><p className="sub">
          Immediately pause all new agent execution without cancelling existing work.</p><div className="actions"><button className="btn btn-danger" id="emergency-stop">
          
            Emergency stop</button><button className="btn btn-outline" id="system-resume">
            Resume system</button></div></div></div></section>{/* Settings */}<section className="screen screen-default" id="screen-settings" hidden><div className="aw-container"><div className="page-head"><div><p className="eyebrow" data-kicker="Account"></p><h1>

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
            
            🔒</span> Provider credentials are never exposed in the UI; the API reports only configured/unconfigured.</p><button className="btn btn-danger btn-block" id="settings-logout">
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
              Send report</button></form><div id="feedback-list" className="list"></div></div></div></div></section></main><div className="ad-slot" id="ad-slot-footer" hidden data-ad-slot="" aria-label="Advertisement"></div>
<div className="ads-consent" id="ads-consent" hidden role="region" aria-label="Advertising consent">
  <p>This deployment supports the free tier with third-party advertising (Google AdSense). Advertising cookies are set only if you accept.</p>
  <div className="ads-consent-actions"><button type="button" className="btn btn-primary btn-sm" id="ads-accept">Accept ads</button><button type="button" className="btn btn-outline btn-sm" id="ads-decline">Keep ad-free</button></div>
</div>
<footer className="site-footer"><div className="aw-container footer-inner"><div className="footer-brand"><p className="brand-lockup"><span className="brand-mark" aria-hidden="true">

      A!</span> AKBARAL!</p><p className="footer-tagline">Master AI operating platform. No fabrications, no hidden charges.</p></div><nav className="footer-nav" aria-label="Footer"><a href="#/" data-route-landing>
      
        Platform</a><button type="button" className="footer-link" data-legal="about">
        About</button><button type="button" className="footer-link" data-legal="contact">
        Contact</button><button type="button" className="footer-link" data-legal="privacy">
        Privacy</button><button type="button" className="footer-link" data-legal="terms">
        Terms</button><button type="button" className="footer-link" data-legal="security">
        Security</button><a href="/api/health" target="_blank" rel="noopener">
        Status</a></nav><p className="footer-copy">
      
      © <span id="footer-year"></span> AKBARAL!. Real execution · honest credits.</p></div></footer><div className="modal-scrim" id="legal-modal" hidden role="dialog" aria-modal="true" aria-labelledby="legal-title"><div className="modal-card"><button className="modal-close icon-btn" id="legal-close" type="button" aria-label="Close">

      ×</button><p className="eyebrow" data-kicker="Legal"></p><h2 id="legal-title">
      
      Privacy</h2><div className="legal-body" id="legal-body"></div></div></div>
    </>
  );
}
