/* AKBARAL! / MASTER AI — web client */
(() => {
  'use strict';

  /* NOTE: no module-level DOM mutations allowed. This script executes before
   * React hydration; every DOM write (including classList tweaks) must live
   * inside boot(), which waits for the window load event — see the bootstrap
   * gate at the bottom of this file. */

  /* Safe browser storage.
   *
   * A sandboxed/embedded preview may not allow `localStorage` access. Accessing
   * it at the top of the bundle then throws a SecurityError and the whole SPA
   * renders as a blank screen. This wrapper falls back to process-memory storage
   * so authentication, theme and navigation keep working in every embedding
   * context without exposing anything to disk.
   */
  const memoryStore = new Map();
  const storage = (() => {
    try {
      window.localStorage.setItem('__akbaral_probe__', '1');
      window.localStorage.removeItem('__akbaral_probe__');
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  function storageGet(key) {
    if (!storage) return memoryStore.get(key) ?? null;
    try {
      return storage.getItem(key);
    } catch {
      return memoryStore.get(key) ?? null;
    }
  }

  function storageSet(key, value) {
    if (!storage) {
      memoryStore.set(key, String(value));
      return;
    }
    try {
      storage.setItem(key, value);
    } catch {
      memoryStore.set(key, String(value));
    }
  }

  function storageRemove(key) {
    if (!storage) {
      memoryStore.delete(key);
      return;
    }
    try {
      storage.removeItem(key);
    } catch {
      memoryStore.delete(key);
    }
  }

  const state = {
    accessToken: storageGet('ak_access') || null,
    refreshToken: storageGet('ak_refresh') || null,
    user: null,
    trial: null,
    subscription: null,
    projects: [],
    agents: [],
    categories: [],
    plan: null,
    executionStream: null,
    view: 'landing',
    theme: storageGet('ak_theme') || 'dark',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ----- Design-system helpers ----- */

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const toggle = $('#theme-toggle');
    const settingsToggle = $('#settings-theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(state.theme === 'light'));
      toggle.setAttribute('aria-label', state.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
      toggle.querySelector('.theme-toggle-icon').textContent = state.theme === 'light' ? '☾' : '◐';
    }
    if (settingsToggle) settingsToggle.textContent = state.theme === 'light' ? 'Switch to dark' : 'Switch to light';
  }

  function setTheme(next) {
    state.theme = next === 'light' ? 'light' : 'dark';
    storageSet('ak_theme', state.theme);
    applyTheme();
  }

  function setCoreState(next, label) {
    const core = $('#master-core');
    const labelEl = $('#master-core-label');
    if (core) core.dataset.state = next;
    if (labelEl) labelEl.textContent = label || next;
  }

  function skeleton(rootSelector, count = 3) {
    const root = $(rootSelector);
    if (!root) return;
    root.innerHTML = Array.from({ length: count }).map(() => '<div class="skeleton"></div>').join('');
  }

  function toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* AKBARAL! agent identity — the shared sigil.
     Same formula on web, Android and iOS (design-system/tokens.json):
     hue = 222 + (fnv1a(name + '|' + category) % 78) -> indigo..violet. */
  function fnv1a(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function agentSigil(name, category = '') {
    const hue = 222 + (fnv1a(`${name}|${category}`) % 78);
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    const mono = words.length === 0 ? 'A'
      : words.length === 1 ? words[0].slice(0, 2).toUpperCase()
      : (words[0][0] + words[1][0]).toUpperCase();
    return `<span class="agent-sigil" style="--sigil-hue: ${hue}" aria-hidden="true">${esc(mono)}</span>`;
  }

  function usd(cents) {
    const n = Number(cents || 0) / 100;
    return n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function badge(status) {
    const color = status === 'active' || status === 'completed' || status === 'published' || status === 'enabled'
      ? 'green'
      : status === 'failed' || status === 'disabled' || status === 'blocked' ? 'red'
      : status === 'pending' || status === 'running' || status === 'planned' ? 'accent'
      : 'blue';
    return `<span class="badge ${color}">${esc(status)}</span>`;
  }

  async function api(path, options = {}, retry = true) {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (state.accessToken) headers.authorization = `Bearer ${state.accessToken}`;
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401 && retry && state.refreshToken) {
      // Pass the exact token that failed: if another tab has refreshed since,
      // refreshSession adopts its tokens instead of rotating again.
      const refreshed = await refreshSession(headers.authorization || '');
      if (refreshed) return api(path, options, false);
    }
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const message = body?.error?.message || body?.message || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  // Single-flight refresh lock. The server strictly rotates refresh tokens
  // (a reused token is rejected), so two concurrent 401-retries refreshing
  // at the same moment kill each other — observed live as a 401 loop. All
  // concurrent callers must share ONE refresh request.
  let refreshInFlight = null;

  async function refreshSession(staleAuthorization = '') {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      // Another tab may already have rotated the token — always start from
      // the latest persisted copy instead of a stale in-memory value.
      const storedRefresh = storageGet('ak_refresh');
      if (storedRefresh) state.refreshToken = storedRefresh;
      const storedAccess = storageGet('ak_access');
      if (storedAccess) state.accessToken = storedAccess;
      // CROSS-TAB ROTATION GUARD: the server revokes the previous session on
      // every refresh, which instantly invalidates the OTHER tab's access
      // token. If a different tab already refreshed since this request was
      // sent with `staleAuthorization`, ADOPT its tokens — rotating again
      // would revoke the fresh session and ping-pong both tabs forever
      // (observed live: /api/me 401 -> /refresh 200 -> /api/me 401 loop).
      if (
        staleAuthorization &&
        storedAccess &&
        storedAccess !== staleAuthorization.replace(/^Bearer /, '')
      ) {
        return true; // a newer access token exists — retry with it
      }
      if (!state.refreshToken) return false;
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: state.refreshToken }),
        });
        if (!res.ok) {
          // The refresh token is dead or was rotated out from under us.
          // Clear the session so the router sends the user to sign-in
          // instead of hammering the API with 401s.
          if (res.status === 401) {
            storageRemove('ak_access');
            storageRemove('ak_refresh');
            state.accessToken = null;
            state.refreshToken = null;
          }
          return false;
        }
        const body = await res.json();
        state.accessToken = body.accessToken;
        state.refreshToken = body.refreshToken;
        storageSet('ak_access', state.accessToken);
        storageSet('ak_refresh', state.refreshToken);
        return true;
      } catch {
        return false;
      }
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  // Keep multiple tabs of the same session coherent: when one tab rotates
  // or clears tokens, the others pick the change up immediately instead of
  // refreshing with stale values.
  window.addEventListener('storage', (event) => {
    if (event.key === 'ak_access') state.accessToken = event.newValue || null;
    if (event.key === 'ak_refresh') state.refreshToken = event.newValue || null;
  });

  /* ----- Landing motion system ----- */
  const motionPrefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function bindMotion() {
    const revealEls = $$('[data-reveal]');
    if (!('IntersectionObserver' in window) || motionPrefersReduced()) {
      revealEls.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        animateCounts(entry.target);
        io.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el) => io.observe(el));

    // Subtle pointer parallax on the hero copy.
    const hero = $('#hero');
    const copy = $('.hero-copy');
    if (hero && copy && !motionPrefersReduced()) {
      hero.addEventListener('pointermove', (event) => {
        const rect = hero.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
        const y = ((event.clientY - rect.top) / rect.height - 0.5) * 8;
        copy.style.setProperty('--px', `${x}px`);
        copy.style.setProperty('--py', `${y}px`);
      });
      hero.addEventListener('pointerleave', () => {
        copy.style.setProperty('--px', '0px');
        copy.style.setProperty('--py', '0px');
      });
    }

    // Magnetic primary CTAs.
    $$('[data-magnet]').forEach((el) => {
      if (motionPrefersReduced()) return;
      el.addEventListener('pointermove', (event) => {
        const rect = el.getBoundingClientRect();
        const mx = (event.clientX - rect.left - rect.width / 2) / 8;
        const my = (event.clientY - rect.top - rect.height / 2) / 10;
        el.style.setProperty('--mx', `${mx}px`);
        el.style.setProperty('--my', `${my}px`);
        el.classList.add('is-magnetic');
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
        el.classList.remove('is-magnetic');
      });
    });

  }

  function animateCounts(root) {
    $$('.stat-count[data-count]', root).forEach((el) => {
      const target = Number(el.dataset.count || 0);
      if (!target || motionPrefersReduced()) { el.textContent = target.toLocaleString(); return; }
      const start = performance.now();
      const duration = 1400;
      const tick = (now) => {
        const eased = 1 - Math.pow(1 - Math.min(1, (now - start) / duration), 3);
        el.textContent = Math.round(target * eased).toLocaleString();
        if (eased < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------------------------ *
   * Cinematic landing system — hero media, live status, scroll direction.
   *
   * HONEST ARCHITECTURE:
   * - The hero background is a full-bleed <video> SLOT. If the deployment
   *   provides /media/hero-loop.mp4 it plays (muted/loop/playsInline) above
   *   an original still poster. Until then an ORIGINAL canvas animation —
   *   a slow intelligence network of drifting nodes and hairline links —
   *   stands in. No third-party or copyrighted assets are used.
   * - The system status chip reflects the REAL /api/health response.
   * - Everything respects prefers-reduced-motion (poster only) and pauses
   *   when off-screen or when the tab is hidden.
   * ------------------------------------------------------------------ */
  /* ============================================================
   DEMO CONSOLE — safe visual execution simulation (landing page).
   *
   * SECURITY MODEL — this panel is 100% INERT presentation:
   *   - Every displayed line is a plain STRING from the hardcoded
   *     libraries below (or composed from them). Lines are attached
   *     with textContent only — never innerHTML, never scripts.
   *   - No eval(), no new Function(), no dynamic import, no shell,
   *     no SQL, no network requests, no secrets, no cookies, no
   *     tokens. Nothing here touches auth, database, payments or
   *     the real orchestration engine.
   *   - The engine writes ONLY inside #demo-console. It reads
   *     nothing from the page and mutates nothing outside its
   *     container.
   *   - It is clearly labelled "SIMULATION · PRESENTATION ONLY" and
   *     fabricates no business results — it visualizes the SHAPE of
   *     a MASTER run (understand → plan → route → research →
   *     synthesize → verify), not a fake outcome.
   * Performance: one setTimeout chain, paused when off-screen or the
   * tab is hidden, capped DOM line count, cleaned up on restart.
   * Reduced motion: static pre-rendered snapshot, no animation loop.
   * ============================================================ */
  function initDemoConsole() {
    const root = $('#demo-console');
    const stream = $('#demo-stream');
    const phaseEl = $('#demo-phase');
    if (!root || !stream || !phaseEl) return;

    /* ---- inert local snippet library (presentation-only) ---- */
    const USER_REQUEST = 'Build me a complete launch strategy for my business.';
    const AGENTS = [
      ['research-analyst-002', 'market & competitor research'],
      ['strategy-lead-041', 'go-to-market architecture'],
      ['marketing-planner-018', 'positioning & channels'],
      ['seo-specialist-023', 'search & demand analysis'],
      ['data-scientist-056', 'pricing & forecast models'],
      ['copywriter-012', 'messaging framework'],
      ['brand-designer-031', 'identity & launch assets'],
      ['financial-analyst-047', 'budget & unit economics'],
      ['growth-strategist-019', 'launch sequencing'],
      ['operations-planner-028', 'rollout & logistics'],
    ];
    const TOOLS = ['web_search', 'page_fetch', 'knowledge_search', 'file_write', 'data_analyze'];
    const DOMAINS = ['SaaS', 'fintech', 'e-commerce', 'healthcare', 'education', 'marketplace', 'B2B services'];
    const MARKETS = ['North America', 'the EU', 'SEA', 'MENA', 'a global audience'];
    const PHASES = [
      'Understanding objective', 'Building execution plan', 'Selecting specialist agents',
      'Research', 'Strategy synthesis', 'Verification', 'Complete',
    ];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const pickN = (arr, n) => {
      const copy = arr.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, n);
    };
    const int = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

    /* Randomized, inert script for one loop of the simulation. */
    function buildScript() {
      const domain = pick(DOMAINS);
      const market = pick(MARKETS);
      const agents = pickN(AGENTS, int(3, 4));
      const tools = pickN(TOOLS, int(2, 3));
      const stepCount = int(5, 7);
      const sourceCount = int(3, 6);
      return [
        { name: PHASES[0], lines: [
          { t: `> "${USER_REQUEST}"`, c: 'dl-cmd', m: 'type' },
          { t: `const objective = parseGoal("launch strategy · ${domain}");`, c: 'dl-cmd', m: 'type' },
          { t: `intent.detected = "go_to_market"`, c: 'dl-dim', m: 'log' },
          { t: `scope = [product, ${market}, ${stepCount} workstreams]`, c: 'dl-dim', m: 'log' },
        ]},
        { name: PHASES[1], lines: [
          { t: 'const plan = await simulatePlanning(objective);', c: 'dl-cmd', m: 'type' },
          { t: `plan.steps = ${stepCount} · dependencies resolved`, c: 'dl-ok', m: 'log' },
          { t: 'credits.reserved = 1 · refunded on failure', c: 'dl-dim', m: 'log' },
        ]},
        { name: PHASES[2], lines: [
          { t: 'agentRouter.select(["research", "strategy", "marketing"]);', c: 'dl-cmd', m: 'type' },
          ...agents.map(([slug, role]) => ({ t: `↳ ${slug} · ${role}`, c: 'dl-agent', m: 'log' })),
        ]},
        { name: PHASES[3], lines: [
          { t: `${agents[0][0]} → ${tools[0]}("${domain} launch benchmarks")`, c: 'dl-tool', m: 'type' },
          { t: `${tools[1]}(${int(2, 4)} sources) · knowledge_search(workspace)`, c: 'dl-tool', m: 'log' },
          { t: `${sourceCount} sources captured · citations tracked`, c: 'dl-dim', m: 'log' },
        ]},
        { name: PHASES[4], lines: [
          { t: 'strategy.merge([positioning, pricing, channels, timeline]);', c: 'dl-cmd', m: 'type' },
          { t: `draft.sections = ${int(4, 6)} · review pass ${int(1, 2)}`, c: 'dl-dim', m: 'log' },
        ]},
        { name: PHASES[5], lines: [
          { t: 'verification.run(["sources_present", "steps_complete"]);', c: 'dl-cmd', m: 'type' },
          { t: 'verification.status = "passed"', c: 'dl-ok', m: 'log' },
          { t: `evidence.links = ${sourceCount} · trace archived`, c: 'dl-ok', m: 'log' },
        ]},
        { name: PHASES[6], lines: [
          { t: '// simulation complete — the real pipeline runs in your workspace', c: 'dl-dim', m: 'log' },
          { t: '▸ restarting simulation…', c: 'dl-dim', m: 'log' },
        ]},
      ];
    }

    const MAX_LINES = 48;
    let generation = 0;   // invalidates stale timer chains
    let timer = 0;
    let active = false;   // panel on screen (IntersectionObserver)

    function makeLine(text, cls) {
      const el = document.createElement('div');
      el.className = 'demo-line ' + (cls || '');
      el.textContent = text; // strings only — never HTML
      return el;
    }

    function appendLine(el) {
      stream.appendChild(el);
      while (stream.childElementCount > MAX_LINES) stream.firstElementChild.remove();
      stream.scrollTop = stream.scrollHeight;
    }

    function isLive() { return active && !document.hidden; }

    /* Schedule fn after ms — if paused, idle-poll until live again. */
    function pace(ms, fn) {
      const myGen = generation;
      const check = () => {
        if (myGen !== generation) return;
        if (isLive()) fn();
        else timer = setTimeout(check, 600);
      };
      timer = setTimeout(check, ms);
    }

    function play() {
      const myGen = ++generation;
      const script = buildScript();
      stream.textContent = '';
      let pi = 0;

      const playPhase = () => {
        if (myGen !== generation) return;
        if (pi >= script.length) {
          phaseEl.textContent = 'Simulation complete';
          pace(2600, () => { if (myGen === generation) play(); });
          return;
        }
        const phase = script[pi++];
        phaseEl.textContent = phase.name;
        appendLine(makeLine(`— ${phase.name.toLowerCase()}`, 'dl-head'));
        let li = 0;

        const playLine = () => {
          if (myGen !== generation) return;
          if (li >= phase.lines.length) { pace(420, playPhase); return; }
          const line = phase.lines[li++];
          const el = makeLine('', line.c);
          if (line.m === 'type') {
            el.classList.add('typing');
            appendLine(el);
            let i = 0;
            const typeChar = () => {
              if (myGen !== generation) return;
              el.textContent = line.t.slice(0, ++i);
              stream.scrollTop = stream.scrollHeight;
              if (i < line.t.length) pace(9 + Math.floor(Math.random() * 22), typeChar);
              else { el.classList.remove('typing'); pace(70 + Math.random() * 170, playLine); }
            };
            typeChar();
          } else {
            appendLine(el);
            el.textContent = line.t; // whole log line (CSS fade-in)
            pace(150 + Math.random() * 230, playLine);
          }
        };
        playLine();
      };
      playPhase();
    }

    if (motionPrefersReduced()) {
      // Static, minimally-animated snapshot: no loop, no typing.
      phaseEl.textContent = 'Simulation · static preview';
      const script = buildScript();
      for (const phase of script) {
        appendLine(makeLine(`— ${phase.name.toLowerCase()}`, 'dl-head'));
        for (const line of phase.lines.slice(0, 2)) appendLine(makeLine(line.t, line.c));
      }
      return;
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        active = entries[0].isIntersecting;
      }, { threshold: 0.15 }).observe(root);
    } else {
      active = true;
    }
    play();
  }

  function initCinematic() {
    dismissBootVeil();
    initHeroMedia();
    initSystemStatus();
    initSectionRail();
    initPipelineSpine();
    initDemoConsole();
    initHeroReticle();
    initHeroScrollParallax();
  }

  /* Premium boot experience: the server-rendered #boot-veil dissolves
     once the app has booted (never blocks input — pointer-events: none).
     A pure-CSS safety animation hides it even if JS never runs. */
  function dismissBootVeil() {
    const veil = $('#boot-veil');
    if (!veil) return;
    if (motionPrefersReduced()) { veil.remove(); return; }
    let done = false;
    const dismiss = () => {
      if (done) return;
      done = true;
      veil.classList.add('is-done');
      setTimeout(() => veil.remove(), 650);
    };
    const timer = setTimeout(dismiss, 1500);
    if (document.readyState === 'complete') {
      setTimeout(dismiss, 650);
    } else {
      window.addEventListener('load', () => { setTimeout(dismiss, 500); clearTimeout(timer); }, { once: true });
    }
  }

  function initHeroMedia() {
    const video = $('#hero-video');
    const canvas = $('#hero-canvas');
    if (!video && !canvas) return;
    // Reduced motion: keep the still poster only. No video, no canvas.
    if (motionPrefersReduced()) return;

    const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    // Mobile/save-data: canvas with a lighter node budget (no video fetch).
    const budget = isCoarse || saveData ? 'light' : 'full';

    // The server renders <meta name="akbaral-hero-video" content="1"> ONLY
    // when public/media/hero-loop.mp4 actually exists — so the no-video path
    // performs no network probe at all (a HEAD 404 would log a console error
    // on every visit) and no inline script is needed. If the video errors at
    // runtime, the original canvas network takes over.
    const hasVideo = document.querySelector('meta[name="akbaral-hero-video"]')?.content === '1';
    if (video && hasVideo && !saveData) {
      // The poster is the loading state; the real film cross-dissolves in
      // over it once frames are actually decodable (canplay).
      video.setAttribute('preload', 'auto');
      const launch = () => {
        video.classList.add('is-live');
        const play = video.play();
        if (play && play.catch) play.catch(() => { video.classList.remove('is-live'); startHeroNetwork(canvas, budget); });
      };
      if (video.readyState >= 2) {
        launch();
      } else {
        video.addEventListener('canplay', launch, { once: true });
        video.addEventListener('error', () => startHeroNetwork(canvas, budget), { once: true });
      }
    } else {
      startHeroNetwork(canvas, budget);
    }
  }

  /* Original intelligence-network animation: drifting nodes joined by
     hairline links within a radius — moss/olive threads, rare gold nodes.
     Deliberately slow and sparse; never draws attention from the copy. */
  function startHeroNetwork(canvas, budget) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = 0, height = 0, dpr = 1;
    let nodes = [];
    let running = false, rafId = 0, inView = true;
    const pointer = { x: -1e4, y: -1e4 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = budget === 'light'
        ? Math.min(34, Math.round((width * height) / 34000))
        : Math.min(84, Math.round((width * height) / 15000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() < 0.16 ? 1.9 : 1.1,
        accent: Math.random() < 0.18,
      }));
    };

    const step = () => {
      if (!running) return;
      ctx.clearRect(0, 0, width, height);
      const linkDist = width < 720 ? 108 : 138;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = width + 20; else if (n.x > width + 20) n.x = -20;
        if (n.y < -20) n.y = height + 20; else if (n.y > height + 20) n.y = -20;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > linkDist * linkDist) continue;
          const alpha = 0.16 * (1 - Math.sqrt(d2) / linkDist);
          ctx.strokeStyle = `rgba(122, 136, 246, ${alpha.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      for (const n of nodes) {
        // A whisper of pointer awareness — nodes lean toward the cursor.
        const pdx = pointer.x - n.x, pdy = pointer.y - n.y;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pd < 170 && pd > 0.001) { n.x += (pdx / pd) * 0.14; n.y += (pdy / pd) * 0.14; }
        ctx.fillStyle = n.accent ? 'rgba(157, 140, 255, 0.85)' : 'rgba(151, 161, 235, 0.5)';
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      rafId = requestAnimationFrame(step);
    };

    const start = () => { if (!running && inView && !document.hidden) { running = true; rafId = requestAnimationFrame(step); } };
    const stop = () => { running = false; cancelAnimationFrame(rafId); };

    resize();
    window.addEventListener('resize', resize, { passive: true });
    const host = $('#hero');
    if (host) {
      host.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = e.clientX - rect.left; pointer.y = e.clientY - rect.top;
      }, { passive: true });
      host.addEventListener('pointerleave', () => { pointer.x = -1e4; pointer.y = -1e4; });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          inView = entries[0].isIntersecting;
          if (inView) start(); else stop();
        }, { threshold: 0.02 }).observe(host);
      }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    start();
  }

  /* The status chip reports the REAL service health. */
  function initSystemStatus() {
    const el = $('#sys-status');
    if (!el) return;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const ok = body && body.status === 'ok';
        el.textContent = ok ? 'READY' : 'DEGRADED';
        el.classList.toggle('sys-ok', ok);
        el.classList.toggle('sys-bad', !ok);
      })
      .catch(() => {
        el.textContent = 'STANDBY';
        el.classList.remove('sys-ok');
        el.classList.add('sys-bad');
      });
  }

  /* Chapter rail: highlight the section currently in view. */
  function initSectionRail() {
    const buttons = $$('.section-rail button[data-scroll-to]');
    if (!buttons.length || !('IntersectionObserver' in window)) return;
    const byId = new Map(buttons.map((b) => [b.dataset.scrollTo, b]));
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        buttons.forEach((b) => b.classList.remove('active'));
        const btn = byId.get(entry.target.id);
        if (btn) btn.classList.add('active');
      }
    }, { rootMargin: '-38% 0px -52% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* Pipeline spine draws as its stages reveal. */
  function initPipelineSpine() {
    const rail = $('#pipeline-rail');
    if (!rail) return;
    const stages = $$('.pipe-stage', rail);
    if (!stages.length) return;
    if (!('IntersectionObserver' in window) || motionPrefersReduced()) {
      rail.style.setProperty('--pipe-progress', '100%');
      return;
    }
    let revealed = 0;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealed = Math.max(revealed, stages.indexOf(entry.target) + 1);
        rail.style.setProperty('--pipe-progress', `${Math.round((revealed / stages.length) * 100)}%`);
        io.unobserve(entry.target);
      }
    }, { threshold: 0.4 });
    stages.forEach((s) => io.observe(s));
  }

  /* Fine targeting reticle following the cursor inside the hero only. */
  function initHeroReticle() {
    if (motionPrefersReduced()) return;
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    const hero = $('#hero');
    if (!hero) return;
    const reticle = document.createElement('div');
    reticle.className = 'hero-reticle';
    reticle.setAttribute('aria-hidden', 'true');
    reticle.innerHTML = '<i></i>';
    document.body.appendChild(reticle);
    let x = 0, y = 0, tx = 0, ty = 0, visible = false, raf = 0;
    const loop = () => {
      x += (tx - x) * 0.16; y += (ty - y) * 0.16;
      reticle.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (visible || Math.abs(tx - x) > 0.4 || Math.abs(ty - y) > 0.4) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    hero.addEventListener('pointermove', (e) => {
      tx = e.clientX; ty = e.clientY;
      if (!visible) { visible = true; reticle.style.opacity = '0.85'; }
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { visible = false; reticle.style.opacity = '0'; });
  }

  /* Subtle scroll parallax on the hero content. */
  function initHeroScrollParallax() {
    if (motionPrefersReduced()) return;
    const hero = $('#hero');
    if (!hero) return;
    let ticking = false;
    const apply = () => {
      ticking = false;
      const rect = hero.getBoundingClientRect();
      if (rect.bottom < 0) return;
      hero.style.setProperty('--scroll-par', String(Math.max(0, Math.min(-rect.top, rect.height))));
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
  }

  /* ------------------------------------------------------------------ *
   * Advertising consent (launch readiness / AdSense).
   *
   * HONEST BEHAVIOUR: when no publisher id is configured by the deployment
   * (<meta name="akbaral-adsense-client"> absent — the launch default), this
   * module does NOTHING: no banner, no ad script, no slots, no cookies.
   * With a real publisher id configured, the AdSense script loads only
   * after the visitor accepts the consent banner; slots are clearly
   * labelled "Advertisement" and sit outside primary content. Declining is
   * a permanent, equally-valid choice. No ad ever pretends to be content
   * and nothing asks or rewards clicking ads.
   * ------------------------------------------------------------------ */
  function initAds() {
    const client = document.querySelector('meta[name="akbaral-adsense-client"]')?.content?.trim() || '';
    if (!client) return; // advertising not configured -> no ads, no banner
    const banner = $('#ads-consent');
    if (!banner) return;
    const choice = storageGet('ak_ads_consent');
    if (choice === 'accepted') { enableAds(client); return; }
    if (choice === 'declined') return;
    banner.hidden = false;
    $('#ads-accept')?.addEventListener('click', () => {
      storageSet('ak_ads_consent', 'accepted');
      banner.hidden = true;
      enableAds(client);
    });
    $('#ads-decline')?.addEventListener('click', () => {
      storageSet('ak_ads_consent', 'declined');
      banner.hidden = true;
    });
    // A persistent footer control to revisit the choice — injected ONLY on
    // deployments where advertising is configured, so unconfigured launches
    // never show a dead button.
    if (!$('#ads-footer-reset')) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'footer-link';
      reset.id = 'ads-footer-reset';
      reset.textContent = 'Ad choices';
      reset.addEventListener('click', () => { banner.hidden = false; });
      ($('.footer-nav') || document.body).appendChild(reset);
    }
  }

  function enableAds(client) {
    const slot = $('#ad-slot-footer');
    if (!slot) return;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    document.head.appendChild(script);
    slot.hidden = false;
    // One clearly-labelled unit below the main content, above the footer.
    slot.innerHTML = '<ins class="adsbygoogle" style="display:block" data-ad-client="'
      + esc(client) + '" data-ad-slot="' + esc(slot.dataset.adSlot || '') + '" data-ad-format="auto" data-full-width-responsive="true"></ins>';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  }

  function bindLegalModal() {
    const modal = $('#legal-modal');
    const close = $('#legal-close');
    if (!modal || !close) return;
    const content = {
      privacy: {
        title: 'Privacy',
        body: '<h3>What we store</h3><p>AKBARAL stores only what is required to run your account: encrypted password hashes, hashed session tokens, your projects, files, knowledge, tasks and execution history. Provider API keys are never stored in the database and never sent to the browser.</p><h3>Cookies &amp; advertising</h3><p>The platform itself sets no tracking cookies. Sign-in tokens and your theme preference are kept in your browser\'s local storage and are essential/functional only. If advertising is enabled on a deployment, third-party advertising vendors (Google AdSense) may set cookies only after you explicitly accept the advertising-consent banner; declining keeps your experience ad-free and sets no advertising cookies. You can change your choice any time from the footer.</p><h3>What we do not do</h3><p>We do not fabricate reviews, ratings, statistics or AI results. We do not sell your data. Missing provider credentials are reported honestly.</p>',
      },
      terms: {
        title: 'Terms',
        body: '<h3>Use of the platform</h3><p>You keep ownership of the work you create. You are responsible for the requests you submit and for complying with applicable law in your own workspace.</p><h3>Credits</h3><p>Free trial credits are consumed only by successful tasks and refunded on failure. Purchase and entitlement records are transparent in your billing history.</p>',
      },
      security: {
        title: 'Security',
        body: '<h3>Controls</h3><p>Passwords use salted scrypt hashing. Refresh tokens are stored as SHA-256 hashes and rotated. Sessions are checked on every authenticated request, WebSocket upgrade and tool context.</p><h3>Isolation</h3><p>Tasks, files, projects, knowledge and execution streams are scoped to the authenticated owner. SSRF, path traversal, upload size and rate-limit guards are enforced server-side.</p>',
      },
      about: {
        title: 'About',
        body: '<h3>AKBARAL! / MASTER AI</h3><p>AKBARAL is an AI operating platform: you state a goal, MASTER plans the work, specialist agents execute it through real tools, results are verified, and credits are only consumed by success. The agent registry, marketplace, execution history and billing records you see are real platform data — not demo content.</p><h3>Honesty policy</h3><p>Unconfigured integrations are reported as unconfigured. Nothing on this platform fabricates results, metrics or reviews.</p>',
      },
      contact: {
        title: 'Contact',
        body: '<h3>Support &amp; feedback</h3><p>The fastest channel is the built-in report system: Settings → “Feedback &amp; reports” (Report a bug / Request a feature / Report abuse). Reports go to a real admin review queue and are answered from there.</p><h3>Platform status</h3><p>Live service status is always visible at <a href="/api/health" target="_blank" rel="noopener">/api/health</a> and <a href="/api/ready" target="_blank" rel="noopener">/api/ready</a>.</p>',
      },
    };
    const open = (key) => {
      const item = content[key];
      if (!item) return;
      $('#legal-title').textContent = item.title;
      $('#legal-body').innerHTML = item.body;
      modal.hidden = false;
      close.focus();
    };
    $$('[data-legal]').forEach((btn) => btn.addEventListener('click', () => open(btn.dataset.legal)));
    close.addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (event) => { if (event.target === modal) modal.hidden = true; });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') modal.hidden = true; });
  }

  function bindFooter() {
    const year = $('#footer-year');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function bindLandingNav() {
    // Landing section shortcuts stay inside the premium landing without
    // triggering the location-hash router (which owns the real app routes).
    $$('[data-scroll-to]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.scrollTo);
        if (!target) return;
        if (target.scrollIntoView) target.scrollIntoView({ behavior: motionPrefersReduced() ? 'auto' : 'smooth', block: 'start' });
        else target.scrollIntoView?.(true);
      });
    });
  }

  async function boot() {
    applyTheme();
    bindMenu();
    bindAuth();
    bindGeneral();
    bindTheme();
    bindMotion();
    bindLandingNav();
    bindLegalModal();
    bindFooter();
    initAds();
    initCinematic();
    window.addEventListener('hashchange', navigate);
    await navigate();
  }

  function bindTheme() {
    $('#theme-toggle')?.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
    $('#settings-theme-toggle')?.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  }

  function bindMenu() {
    $('#menu-toggle').addEventListener('click', () => $('#main-nav').classList.toggle('open'));
  }

  function bindAuth() {
    $('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const name = $('#auth-name').value.trim();
      const mode = state.view === 'register' ? 'register' : 'login';
      try {
        if (mode === 'register') {
          await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: name || undefined }) });
          toast('Account created', 'ok');
          location.hash = '#/login';
          return;
        }
        const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        state.accessToken = result.accessToken;
        state.refreshToken = result.refreshToken;
        storageSet('ak_access', result.accessToken);
        storageSet('ak_refresh', result.refreshToken);
        state.user = result.user;
        toast(`Welcome, ${result.user.name || result.user.email}`, 'ok');
        location.hash = '#/dashboard';
      } catch (error) {
        toast(error.message, 'err');
      }
    });
  }

  function bindGeneral() {
    $('#logout-btn').addEventListener('click', async () => {
      try {
        if (state.refreshToken) await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: state.refreshToken }) });
      } catch {}
      storageRemove('ak_access');
      storageRemove('ak_refresh');
      state.accessToken = null;
      state.refreshToken = null;
      state.user = null;
      location.hash = '#/';
      setCoreState('idle', 'idle');
    });

    $('#settings-logout')?.addEventListener('click', async () => {
      try {
        if (state.refreshToken) await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: state.refreshToken }) });
      } catch {}
      storageRemove('ak_access');
      storageRemove('ak_refresh');
      state.accessToken = null;
      state.refreshToken = null;
      state.user = null;
      location.hash = '#/';
      setCoreState('idle', 'idle');
    });

    $('#login-btn').addEventListener('click', () => { location.hash = '#/login'; });
    $$('[data-route]').forEach((btn) => btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.route}`; }));
    $('#explore-agents').addEventListener('click', () => {
      if (!state.accessToken) { location.hash = '#/login'; return; }
      location.hash = '#/agents';
    });

    $('#master-form').addEventListener('submit', runMaster);
    $('#project-form').addEventListener('submit', createProject);
    $('#knowledge-form').addEventListener('submit', searchKnowledge);
    $('#refresh-dashboard').addEventListener('click', () => navigate());
    $('#refresh-agents').addEventListener('click', () => navigate());
    $('#refresh-marketplace').addEventListener('click', () => navigate());
    $('#factory-form').addEventListener('submit', createCustomAgent);
    $('#contact-form').addEventListener('submit', createContact);
    $('#campaign-form').addEventListener('submit', createCampaign);
    $('#automation-form').addEventListener('submit', createAutomation);
    $('#sched-form').addEventListener('submit', createScheduledAutomation);
    $('#sched-form').addEventListener('change', updateSchedForm);
    $('#employee-form').addEventListener('submit', createEmployee);
      $$('#credit-form [data-amount]').forEach((chip) => chip.addEventListener('click', () => {
    const input = $('#credit-form').elements.namedItem('amount_cents');
    if (input) { input.value = chip.dataset.amount; input.focus(); }
  }));
  $('#credit-form').addEventListener('submit', purchaseCredits);
    $('#flag-form').addEventListener('submit', setFlag);
    $('#emergency-stop').addEventListener('click', emergencyStop);
    $('#system-resume').addEventListener('click', systemResume);
    $('#feedback-form').addEventListener('submit', submitFeedback);
  }

  async function navigate() {
    const view = (location.hash || '#/').replace('#/', '');
    state.view = view;
    if (['login', 'register'].includes(view)) {
      showScreen('auth');
      void renderOAuthButtons();
      $('#auth-title').textContent = view === 'register' ? 'Create account' : 'Sign in';
      $('#auth-name-wrap').hidden = view !== 'register';
      $('#auth-submit').textContent = view === 'register' ? 'Create account' : 'Sign in';
      $('#auth-switch').innerHTML = view === 'register'
        ? 'Already have an account? <a href="#/login">Sign in</a>'
        : 'No account? <a href="#/register">Create one</a>';
      return;
    }

    // The premium AKBARAL landing is the authoritative production root. It is
    // always the first thing a user sees at `#/` regardless of whether a prior
    // session exists. Authenticated users still get their real account context
    // in the header, then continue from the landing CTAs into the live app.
    if (view === '' || view === 'landing') {
      if (state.accessToken) {
        try {
          await loadMe();
        } catch {
          // A stale/revoked token should not hide the premium landing. It is
          // cleared by the normal login/logout flow when the user acts.
        }
      }
      showScreen('landing');
      await loadLanding();
      return;
    }

    if (!state.accessToken) {
      location.hash = '#/login';
      return;
    }

    // Leaving a view closes its live execution stream.
    closeLiveStream();

    try {
      await loadMe();
    } catch {
      location.hash = '#/login';
      return;
    }

    const taskMatch = view.match(/^tasks\/([A-Za-z0-9_-]+)$/);
    if (taskMatch) { showScreen('task'); await loadTaskDetail(taskMatch[1]); return; }
    if (view.split('?')[0] === 'oauth/callback') { await handleOAuthCallback(view); return; }
    if (view === 'dashboard') { showScreen('dashboard'); await loadDashboard(); return; }
    if (view === 'master') { showScreen('master'); await loadProjects(); return; }
    if (view === 'agents') { showScreen('agents'); await loadAgentWorld(); return; }
    if (view === 'factory') { showScreen('factory'); await loadFactory(); return; }
    if (view === 'marketplace') { showScreen('marketplace'); await loadMarketplace(); return; }
    if (view === 'workspace') { showScreen('workspace'); await loadWorkspace(); return; }
    if (view === 'automations') { showScreen('automations'); await loadAutomations(); return; }
    const schedMatch = view.match(/^automations\/([A-Za-z0-9_-]+)$/);
    if (schedMatch) { showScreen('automations'); await loadAutomations(schedMatch[1]); return; }
    if (view === 'crm') { showScreen('crm'); await loadCrm(); return; }
    if (view === 'billing') { showScreen('billing'); await loadBilling(); return; }
    if (view === 'settings') { showScreen('settings'); await loadSettings(); void loadConnectedAccounts(); return; }
    if (view === 'admin') {
      if (!['admin', 'super_admin'].includes(state.user?.role || '')) { toast('Admin access required', 'err'); showScreen('dashboard'); return; }
      showScreen('admin');
      await loadAdmin();
      return;
    }
    showScreen('dashboard');
    await loadDashboard();
  }

  /* ----- OAuth (provider sign-in + account linking) ----- */

  async function handleOAuthCallback(view) {
    const params = new URLSearchParams(view.split('?')[1] || '');
    showScreen('auth');
    $('#auth-title').textContent = 'Signing in…';
    if (params.get('status') !== 'ok') {
      const code = params.get('error') || 'unknown_error';
      const messages = {
        invalid_state: 'The sign-in link expired or was already used. Please try again.',
        provider_error: 'The provider refused the sign-in request.',
        oauth_exchange_failed: 'The provider token exchange failed. Please try again.',
        oauth_profile_failed: 'The provider did not return a usable profile.',
        oauth_email_missing: 'The provider did not share an email address.',
        oauth_link_blocked: 'That email is registered, but the provider did not verify it. Sign in with your password, then link the provider from Settings.',
        link_conflict: 'That provider account is already linked to another user.',
      };
      toast(messages[code] || `Sign-in failed (${code})`, 'err');
      $('#auth-title').textContent = 'Sign in';
      location.hash = '#/login';
      return;
    }
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) { toast('Incomplete sign-in response', 'err'); location.hash = '#/login'; return; }
    state.accessToken = accessToken;
    state.refreshToken = refreshToken;
    storageSet('ak_access', accessToken);
    storageSet('ak_refresh', refreshToken);
    if (params.get('mode') === 'link') {
      toast('Provider account linked', 'ok');
      location.hash = '#/settings';
      await loadMe().catch(() => {});
      return;
    }
    await loadMe().catch(() => {});
    toast(`Welcome, ${state.user?.name || state.user?.email || ''}`, 'ok');
    location.hash = '#/dashboard';
  }

  async function renderOAuthButtons() {
    const wrap = $('#auth-oauth');
    const target = $('#auth-oauth-buttons');
    if (!wrap || !target) return;
    try {
      const body = await api('/api/auth/oauth/providers');
      const providers = (body.providers || []).filter((p) => p.configured);
      if (!providers.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      $('#auth-oauth-note').textContent = 'Provider sign-in is handled entirely server-side.';
      target.innerHTML = providers.map((p) => `<a class="btn btn-outline btn-sm" href="/api/auth/oauth/${esc(p.key)}/authorize">Continue with ${esc(p.label)}</a>`).join('');
    } catch { wrap.hidden = true; }
  }

  async function loadConnectedAccounts() {
    const list = $('#settings-oauth-list');
    const actions = $('#settings-oauth-actions');
    if (!list || !actions) return;
    try {
      const body = await api('/api/auth/oauth/identities');
      $('#settings-password-status').textContent = body.passwordSet ? 'Password sign-in enabled' : 'No password set (provider sign-in only)';
      const linked = new Map((body.identities || []).map((i) => [i.provider, i]));
      const rows = (body.providers || []).map((p) => {
        const identity = linked.get(p.key);
        return `<div class="list-item"><div><b>${esc(p.label)}</b><small>${identity ? `Linked ${identity.linkedAt ? new Date(identity.linkedAt).toLocaleDateString() : ''}` : (p.configured ? 'Not linked' : 'Not configured on this deployment')}</small></div>${
          identity
            ? `<button class="btn btn-ghost btn-sm" data-unlink="${esc(p.key)}" ${!body.passwordSet && (body.identities || []).length === 1 ? 'disabled title="Set a password before removing the last sign-in method"' : ''}>Unlink</button>`
            : (p.configured ? `<a class="btn btn-outline btn-sm" href="/api/auth/oauth/${esc(p.key)}/authorize?link=1" data-link="${esc(p.key)}">Link</a>` : '<span class="badge">off</span>')
        }</div>`;
      });
      list.innerHTML = rows.join('') || '<div class="list-item"><small>No providers configured on this deployment.</small></div>';
      actions.innerHTML = '';
      list.querySelectorAll('button[data-unlink]').forEach((button) => {
        button.addEventListener('click', async () => {
          const provider = button.dataset.unlink;
          if (!window.confirm(`Unlink ${provider} from your account?`)) return;
          try {
            await api(`/api/auth/oauth/identities/${encodeURIComponent(provider)}`, { method: 'DELETE' });
            toast('Provider unlinked', 'ok');
            await loadConnectedAccounts();
          } catch (e) { toast(e.message, 'err'); }
        });
      });
      // The link buttons need the session token in the Authorization header —
      // plain anchors cannot send it, so intercept and fetch-then-redirect.
      list.querySelectorAll('a[data-link]').forEach((link) => {
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          const provider = link.dataset.link;
          try {
            const body = await api(`/api/auth/oauth/${encodeURIComponent(provider)}/link`, { method: 'POST' });
            if (body.redirectUrl) window.location.href = body.redirectUrl;
            else toast('Could not start linking', 'err');
          } catch (e) { toast(e.message, 'err'); }
        });
      });
    } catch {
      list.innerHTML = '<div class="list-item"><small>Sign in to manage connected providers.</small></div>';
    }
  }

  /* ----- Live execution stream (M12 task center) -----
   * Primary channel: WebSocket /ws/executions/:id?token= (same origin,
   * proxied to the API). Fallback: SSE /api/executions/:id/events?token=
   * (EventSource cannot send headers). Both replay persisted logs then tail
   * live — identical payloads. */
  let liveStream = null;

  function closeLiveStream() {
    if (!liveStream) return;
    try {
      if (liveStream.kind === 'ws') { liveStream.handle.onclose = null; liveStream.handle.close(); }
      else liveStream.handle.close();
    } catch {}
    liveStream = null;
  }

  function openExecutionStream(executionId, onLog, onState) {
    closeLiveStream();
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    let ws;
    try {
      ws = new WebSocket(`${proto}${location.host}/ws/executions/${encodeURIComponent(executionId)}?token=${encodeURIComponent(state.accessToken || '')}`);
    } catch {
      ws = null;
    }
    if (ws) {
      let opened = false;
      const fallback = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} sse(); } }, 2500);
      ws.onopen = () => { opened = true; clearTimeout(fallback); liveStream = { kind: 'ws', handle: ws }; };
      ws.onmessage = (event) => {
        try { const msg = JSON.parse(event.data); if (msg.type === 'log') onLog(msg); }
        catch {}
      };
      ws.onclose = () => { clearTimeout(fallback); if (!opened) sse(); else if (onState) onState('closed'); };
      ws.onerror = () => {};
      return;
    }
    sse();

    function sse() {
      try {
        const es = new EventSource(`/api/executions/${encodeURIComponent(executionId)}/events?token=${encodeURIComponent(state.accessToken || '')}`);
        es.onmessage = (event) => {
          try { const msg = JSON.parse(event.data); if (msg.type === 'log') onLog(msg); } catch {}
        };
        es.onerror = () => { if (onState) onState('error'); };
        liveStream = { kind: 'sse', handle: es };
      } catch {}
    }
  }

  function showScreen(name) {
    $$('.screen').forEach((screen) => { screen.hidden = true; });
    const map = {
      landing: 'screen-landing',
      auth: 'screen-auth',
      task: 'screen-task',
      dashboard: 'screen-dashboard',
      master: 'screen-master',
      agents: 'screen-agents',
      factory: 'screen-factory',
      marketplace: 'screen-marketplace',
      workspace: 'screen-workspace',
      automations: 'screen-automations',
      crm: 'screen-crm',
      billing: 'screen-billing',
      admin: 'screen-admin',
      settings: 'screen-settings',
    };
    const screen = document.getElementById(map[name]);
    if (screen) screen.hidden = false;
    // nav active
    $$('#main-nav a').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === location.hash));
    const isAdmin = ['admin', 'super_admin'].includes(state.user?.role || '');
    $('#login-btn').hidden = Boolean(state.accessToken);
    $('#logout-btn').hidden = !state.accessToken;
    $('.admin-only').hidden = !isAdmin;
  }

  async function loadMe() {
    const body = await api('/api/me');
    state.user = body.user;
    state.trial = body.trial;
    state.subscription = body.subscription;
    updateCreditPill();
  }

  function updateCreditPill() {
    const credits = state.user?.freeCredits ?? 0;
    // /api/me returns trial.active (boolean) — `isActive` never existed, so
    // the trial label silently never showed.
    const onTrial = Boolean(state.trial?.active ?? state.trial?.isActive);
    const label = onTrial ? `Trial · ${credits} free tasks` : `Credits · ${credits}`;
    $('#credit-pill').textContent = label;
  }

  /**
   * Human label for the trial state. /api/me exposes trial.active plus the
   * ISO end timestamp (there is no daysRemaining field) — days remaining are
   * computed from trialEndsAt so the number is real, never "undefined".
   */
  function trialLabel(trial) {
    const active = Boolean(trial?.active ?? trial?.isActive);
    if (!active) return 'Inactive';
    const endsAt = trial?.trialEndsAt ? Date.parse(trial.trialEndsAt) : NaN;
    if (!Number.isFinite(endsAt)) return 'Active';
    const days = Math.max(0, Math.ceil((endsAt - Date.now()) / 86400000));
    return `${days}d remaining`;
  }

  async function loadSettings() {
    try {
      await loadMe();
    } catch {}
    const name = state.user?.name || state.user?.email || '—';
    $('#settings-name').textContent = name;
    $('#settings-email').textContent = state.user?.email || '—';
    $('#settings-credits').textContent = `${state.user?.freeCredits ?? 0} free tasks`;
    $('#settings-plan').textContent = state.subscription?.status || 'free/trial';
    $('#settings-trial').textContent = state.trial?.active ? `active · ${trialLabel(state.trial)}` : 'inactive';
    $('#settings-role').textContent = state.user?.role || 'user';
    loadMyFeedback();
  }

  async function loadMyFeedback() {
    const body = await api('/api/feedback/mine').catch(() => ({ feedback: [] }));
    renderFeedbackList(body.feedback || [], '#feedback-list');
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const type = $('#feedback-type').value;
    const subject = $('#feedback-subject').value.trim();
    const body = $('#feedback-body').value.trim();
    if (!subject || !body) return;
    try {
      await api('/api/feedback', { method: 'POST', body: JSON.stringify({ type, subject, body }) });
      toast('Feedback submitted for review', 'ok');
      event.target.reset();
      await loadMyFeedback();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function renderFeedbackList(items, selector) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = items.length
      ? items.map((item) => `<div class="list-item"><div><b>${esc(item.subject)}</b><small>${esc(item.type)} · ${esc(item.status)} · ${esc(item.created_at)}</small></div>${badge(item.status)}</div>`).join('')
      : '<div class="list-item"><small>No reports submitted yet.</small></div>';
  }

  async function loadLanding() {
    try {
      const body = await api('/api/billing/plans').catch(() => null);
      if (body?.plans) renderPlans(body.plans, '#landing-plans');
    } catch {}
  }

  async function loadDashboard() {
    updateCreditPill();
    const me = await api('/api/me');
    const stats = [
      ['Credits', state.user?.freeCredits ?? 0],
      ['Trial', trialLabel(state.trial)],
      ['Plan', state.subscription?.status || 'free/trial'],
      ['Role', state.user?.role || 'user'],
    ];
    renderStats(stats, '#dashboard-stats');
    skeleton('#dashboard-tasks', 3);
    skeleton('#dashboard-agents', 2);
    const tasks = await api('/api/tasks').catch(() => ({ tasks: [] }));
    renderTaskList(tasks.tasks || [], '#dashboard-tasks');

    const agents = state.user ? await api(`/api/agents?limit=6&status=active`).catch(() => ({ agents: [] })) : { agents: [] };
    renderAgentCards(agents.agents || [], '#dashboard-agents');
  }

  /* ----- Task Center: detail view with live logs (M12) ----- */

  async function loadTaskDetail(taskId) {
    const root = $('#task-detail-root');
    if (!root) return;
    root.innerHTML = '<div class="skeleton" style="height:180px"></div>';
    let body;
    try {
      body = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    } catch (e) {
      root.innerHTML = `<div class="empty">${esc(e.message)} — <a href="#/dashboard">back to dashboard</a></div>`;
      return;
    }
    const { task, executions, events, logs } = body;
    const output = task.output_data ? safeJsonPretty(task.output_data) : null;
    const error = task.error_message || (executions || []).find((x) => x.error_message)?.error_message;
    const newest = (executions || [])[0];
    const isLive = newest && !['completed', 'failed', 'cancelled'].includes(String(newest.status));
    const logCount = (logs || []).length;

    root.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow" data-kicker="Task Center"></p>
          <h1>${esc(task.title || task.goal || task.id)}</h1>
          <p class="sub">${esc(task.type || 'task')} · created ${esc(task.created_at || '')}</p>
        </div>
        <div class="actions">
          <span>${badge(task.status)}</span>
          <a class="btn btn-ghost btn-sm" href="#/dashboard">← Dashboard</a>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>Status</span><b>${esc(task.status || '—')}</b></div>
        <div class="stat"><span>Executions</span><b>${(executions || []).length}</b></div>
        <div class="stat"><span>Log entries</span><b id="task-log-count">${logCount}</b></div>
        <div class="stat"><span>Duration</span><b>${newest && newest.duration_ms ? Math.round(newest.duration_ms / 100) / 10 + 's' : '—'}</b></div>
      </div>
      ${error ? `<div class="panel danger-panel"><h3>Error</h3><pre>${esc(String(error))}</pre></div>` : ''}
      ${output ? `<div class="panel"><h3>Result</h3><pre>${esc(output)}</pre></div>` : ''}
      ${(executions || []).length ? `
      <div class="panel">
        <h3>Executions</h3>
        <div class="list">
          ${(executions || []).map((x) => `
            <div class="list-item">
              <div><b>${esc(x.id)}</b><small>${esc(x.status)}${x.completed_at ? ' · ' + esc(x.completed_at) : ''}</small></div>
              <span>${badge(x.status)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
      ${(events || []).length ? `
      <div class="panel">
        <h3>Events</h3>
        <div class="list">
          ${(events || []).map((ev) => `
            <div class="list-item">
              <div><b>${esc(ev.type || 'event')}</b><small>${esc(ev.message || '')}</small></div>
              <small>${esc(ev.created_at || '')}</small>
            </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="panel">
        <h3>Execution log ${isLive ? '<span class="live-indicator">● live</span>' : ''}</h3>
        <div class="log-console" id="task-log" role="log" aria-live="polite"></div>
      </div>`;

    const logRoot = $('#task-log');
    const seen = new Set();
    let count = logCount;
    const appendLog = (msg) => {
      if (!logRoot || seen.has(msg.id)) return;
      seen.add(msg.id);
      const line = document.createElement('div');
      line.className = 'log-line level-' + esc(msg.level || 'info');
      line.innerHTML = `<span class="log-time">${esc(String(msg.createdAt || '').slice(11, 19))}</span><span class="log-type">${esc(msg.logType || msg.type || 'log')}</span><span class="log-msg">${esc(msg.message || '')}</span>`;
      logRoot.appendChild(line);
      while (logRoot.childElementCount > 500) logRoot.firstElementChild.remove();
      logRoot.scrollTop = logRoot.scrollHeight;
      count += 1;
      const counter = $('#task-log-count');
      if (counter) counter.textContent = count;
    };
    (logs || []).forEach((row) => appendLog({ id: String(row.id), level: row.level, logType: row.type, message: row.message, createdAt: row.created_at }));

    if (isLive && newest) {
      openExecutionStream(
        String(newest.id),
        appendLog,
        () => { const live = root.querySelector('.live-indicator'); if (live) live.remove(); },
      );
    }
  }

  function safeJsonPretty(value) {
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
    }
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function renderStats(items, rootSelector) {
    const root = $(rootSelector);
    if (!root) return;
    root.innerHTML = items.map(([label, value]) => `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
  }

  function renderTaskList(tasks, rootSelector) {
    const root = $(rootSelector);
    if (!root) return;
    if (!tasks.length) { root.innerHTML = '<div class="list-item"><small>No tasks yet.</small></div>'; return; }
    root.innerHTML = tasks.slice(0, 10).map((task) => `
      <a class="list-item list-item-link" href="#/tasks/${esc(task.id)}">
        <div><b>${esc(task.title || task.goal || task.id)}</b><small>${esc(task.status || '')} · ${esc(task.created_at || '')}</small></div>
        <span>${badge(task.status)}</span>
      </a>
      ${task.status === 'completed' ? `<div class="list-item"><small>Rate this result:</small><div class="actions">${[1,2,3,4,5].map((r) => `<button class="btn btn-ghost btn-sm" data-rate="${r}" data-task="${esc(task.id)}">${r}</button>`).join('')}</div></div>` : ''}`).join('');
    $$('[data-rate]', root).forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/api/tasks/${btn.dataset.task}/rating`, { method: 'POST', body: JSON.stringify({ rating: Number(btn.dataset.rate) }) });
        toast(`Rated ${btn.dataset.rate}/5`, 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }));
  }

  function renderAgentCards(agents, rootSelector, allowDetail = true) {
    const root = $(rootSelector);
    if (!root) return;
    if (!agents.length) { root.innerHTML = '<div class="list-item"><small>No agents found.</small></div>'; return; }
    root.innerHTML = agents.slice(0, 24).map((agent) => `
      <article class="agent-card">
        <div class="agent-head">
          ${agentSigil(agent.name, agent.category)}
          <div class="agent-head-text">
            ${agent.category ? `<small class="agent-cat">${esc(agent.category)}</small>` : ''}
            <h3>${esc(agent.name)}</h3>
            <p>${esc(agent.specialization || agent.description || agent.slug)}</p>
          </div>
        </div>
        <div class="tags">${(agent.capabilities || []).slice(0, 5).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        <div class="actions">
          ${allowDetail ? `<button class="btn btn-ghost" data-detail="${esc(agent.slug)}">Details</button>` : ''}
          <button class="btn btn-ghost" data-run="${esc(agent.slug)}">Run</button>
          <button class="btn btn-ghost" data-save="${esc(agent.slug)}">Save</button>
        </div>
      </article>`).join('');
    $$('[data-detail]', root).forEach((btn) => btn.addEventListener('click', () => renderAgentDetail(btn.dataset.detail)));
    $$('[data-run]', root).forEach((btn) => btn.addEventListener('click', () => runSpecialist(btn.dataset.run, `${btn.dataset.run} task`)));
    $$('[data-save]', root).forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/api/agents/${btn.dataset.save}/save`, { method: 'POST', body: JSON.stringify({ saved: true, favorite: true }) }); toast('Agent saved', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    }));
  }

  async function loadAgentWorld() {
    const categories = await api('/api/agents/categories');
    state.categories = categories.categories || [];
    const select = $('#agent-category');
    select.innerHTML = '<option value="">All categories</option>' + state.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
    const q = new URLSearchParams();
    if (select.value) q.set('category', select.value);
    skeleton('#agent-list', 8);
    const body = await api(`/api/agents?limit=40&${q}`);
    renderAgentCards(body.agents || [], '#agent-list');
    select.addEventListener('change', () => navigate());
    $('#agent-search').addEventListener('input', debounce(async () => {
      const params = new URLSearchParams({ limit: '40', q: $('#agent-search').value });
      if (select.value) params.set('category', select.value);
      const b = await api(`/api/agents?${params}`);
      renderAgentCards(b.agents || [], '#agent-list');
    }, 250));
  }

  async function renderAgentDetail(slug) {
    const body = await api(`/api/agents/${slug}`);
    const a = body.agent || {};
    const detail = `
      <div class="panel">
        <h3>${esc(a.name)}</h3>
        <p>${esc(a.specialization)}</p>
        <p>${esc(a.description || '')}</p>
        <p><b>Category:</b> ${esc(a.category || '')} · <b>Version:</b> ${esc(a.version)} · <b>Status:</b> ${esc(a.status)}</p>
        <p><b>Capabilities:</b> ${esc((a.capabilities || []).join(', '))}</p>
        <p><b>Workflow:</b> ${esc((a.workflow || []).join(' → '))}</p>
        <p><b>Model requirements:</b> ${esc((a.modelRequirements || []).join(', '))}</p>
        <p><b>Security:</b> ${esc((a.securityPermissions || []).join(', '))}</p>
        <div class="actions">
          <button class="btn btn-primary" id="run-${esc(slug)}">Dispatch</button>
        </div>
      </div>`;
    // Insert into the agent list area for simplicity
    const node = document.createElement('div');
    node.innerHTML = detail;
    const container = $('#agent-list').parentElement;
    const existing = $('#agent-detail-panel');
    if (existing) existing.remove();
    node.firstElementChild.id = 'agent-detail-panel';
    container.appendChild(node.firstElementChild);
    const btn = $('#run-' + esc(slug));
    if (btn) btn.addEventListener('click', () => runSpecialist(slug, `${a.specialization} detail task`));
  }

  async function runSpecialist(slug, goal) {
    try {
      const projectId = $('#master-project')?.value || null;
      const body = await api('/api/workflows/agent', { method: 'POST', body: JSON.stringify({ agent_slug: slug, goal, project_id: projectId }) });
      // Response shape: { task: { id, executionId, agentSlug, ... }, job, freeCredits }.
      const executionId = body?.task?.executionId;
      if (!executionId) throw new Error('Dispatch accepted but no execution id was returned');
      toast(`Dispatched ${slug}. Execution ${executionId}`, 'ok');
      location.hash = '#/master';
      await loadMasterExecution(executionId);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function runMaster(event) {
    event.preventDefault();
    const goal = $('#master-goal').value.trim();
    if (!goal) return;
    const projectId = $('#master-project').value || null;
    $('#master-output').textContent = 'Planning…';
    setCoreState('thinking', 'planning');
    try {
      // Response shape: { workflow: { id, status }, plan: { intents, steps, notes } }.
      const plan = await api('/api/workflows/master', { method: 'POST', body: JSON.stringify({ goal, project_id: projectId }) });
      renderPlan(plan);
      const workflowId = plan?.workflow?.id;
      if (!workflowId) throw new Error('Planning succeeded but no workflow id was returned');
      $('#master-output').innerHTML += `\n\nStarting workflow ${esc(workflowId)}…`;
      setCoreState('executing', 'executing');
      await api(`/api/workflows/${workflowId}/run`, { method: 'POST', body: JSON.stringify({}) });
      await loadWorkflowProgress(workflowId);
    } catch (e) {
      $('#master-output').textContent = `Error: ${e.message}`;
      setCoreState('error', 'error');
      toast(e.message, 'err');
    }
  }

  /**
   * Live progress for a MASTER workflow run. Polls the real workflow state
   * (`GET /api/workflows/:id` returns the workflow row plus per-step
   * statuses) and renders each step transition until the workflow reaches a
   * terminal status, then shows the persisted final result.
   */
  async function loadWorkflowProgress(workflowId) {
    const out = $('#master-output');
    out.textContent += `\n`;
    let lastLines = '';
    const render = (workflow, steps) => {
      const lines = (steps || [])
        .slice()
        .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
        .map((step) => {
          const icon = { completed: '✓', failed: '✗', running: '▸', skipped: '–', pending: '·' }[step.status] || '·';
          return `${icon} Step ${step.step_order}: ${step.status}${step.error_message ? ` — ${step.error_message}` : ''}`;
        });
      const text = lines.join('\n');
      if (text !== lastLines) {
        lastLines = text;
        out.textContent = `${out.textContent.split('\n')[0]}\n${text}`;
      }
    };
    let misses = 0;
    const poll = async () => {
      try {
        const body = await api(`/api/workflows/${workflowId}`);
        misses = 0;
        const workflow = body?.workflow || {};
        render(workflow, body?.steps);
        if (['completed', 'failed', 'cancelled'].includes(workflow.status)) {
          out.textContent += `\nFinal status: ${workflow.status}\n`;
          if (workflow.result_json) {
            try { out.textContent += JSON.stringify(JSON.parse(workflow.result_json), null, 2).slice(0, 4000); }
            catch { out.textContent += String(workflow.result_json).slice(0, 4000); }
          } else if (workflow.error_message) {
            out.textContent += `${workflow.error_message}\n`;
          }
          const ok = workflow.status === 'completed';
          setCoreState(ok ? 'success' : 'error', ok ? 'success' : 'error');
          try { await loadMe(); } catch {}
          return;
        }
        setTimeout(poll, 1500);
      } catch (e) {
        misses += 1;
        if (misses >= 10) {
          out.textContent += `\nStopped polling: ${e.message}\n`;
          setCoreState('error', 'error');
          return;
        }
        setTimeout(poll, 1500);
      }
    };
    poll();
  }

  function renderPlan(plan) {
    const intents = (plan.plan?.intents || []).map((intent) => intent.label || intent.key || '').filter(Boolean).join(', ');
    const steps = (plan.plan?.steps || []).map((step) => `→ ${step.goal || step.description || step.agentSlug || step.name || step.stepOrder}${step.agentSlug ? ` (${step.agentSlug})` : ''}`).join('\n');
    $('#master-output').textContent = `Detected intents: ${intents}\nPlan:\n${steps}`;
  }

  async function loadMasterExecution(executionId) {
    const out = $('#master-output');
    out.textContent = `Streaming execution ${executionId}…\n`;
    const seen = new Set();
    let misses = 0;
    const poll = async () => {
      try {
        const body = await api(`/api/tasks/execution/${executionId}`).catch(() => null);
        if (!body) {
          // The execution id is unknown (or not yet visible). Stop after a
          // bounded number of misses instead of polling forever.
          misses += 1;
          if (misses >= 10) {
            out.textContent += `Execution ${executionId} is not available.\n`;
            setCoreState('error', 'error');
            return;
          }
          setTimeout(poll, 1200);
          return;
        }
        misses = 0;
        if (body.logs) {
          for (const log of body.logs) {
            if (log.id && !seen.has(log.id)) {
              seen.add(log.id);
              out.textContent += `[${log.created_at || ''}] ${log.message}\n`;
            }
          }
        }
        const exec = body.execution || {};
        if (exec.status === 'completed' || exec.status === 'failed') {
          out.textContent += `\nFinal status: ${exec.status}\n`;
          if (exec.output_data) {
            try { out.textContent += JSON.stringify(JSON.parse(exec.output_data), null, 2); }
            catch { out.textContent += String(exec.output_data); }
          }
          const ok = exec.status === 'completed';
          setCoreState(ok ? 'success' : 'error', ok ? 'success' : 'error');
          try { await loadMe(); } catch {}
          return;
        }
        setTimeout(poll, 1200);
      } catch (e) {
        out.textContent += `Error polling: ${e.message}\n`;
      }
    };
    poll();
  }

  async function showWorkflow(run) {
    $('#master-output').textContent = typeof run === 'string' ? run : JSON.stringify(run, null, 2);
  }

  async function loadProjects() {
    const body = await api('/api/projects').catch(() => ({ projects: [] }));
    state.projects = body.projects || [];
    const select = $('#master-project');
    select.innerHTML = '<option value="">— none —</option>' + state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    renderProjectList(state.projects, '#project-list');
  }

  async function createProject(event) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      input.value = '';
      toast('Project created', 'ok');
      await loadProjects();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderProjectList(projects, selector) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = projects.length ? projects.map((p) => `<div class="list-item"><div><b>${esc(p.name)}</b><small>${esc(p.slug || '')}</small></div><button class="btn btn-ghost" data-project="${esc(p.id)}" data-name="${esc(p.name)}">Open</button></div>`).join('') : '<div class="list-item"><small>No projects yet.</small></div>';
    $$('[data-project]', root).forEach((btn) => btn.addEventListener('click', () => openProject(btn.dataset.project, btn.dataset.name)));
  }

  async function openProject(projectId, name) {
    const body = await api(`/api/projects/${projectId}`).catch(() => null);
    const root = $('#project-workspace');
    if (!body) { root.textContent = 'Could not load project.'; return; }
    root.innerHTML = `<h3>${esc(name || 'Project')}</h3>
      <div class="list-item"><b>Files</b><span>${(body.files || []).length}</span></div>
      <div class="list-item"><b>Tasks</b><span>${(body.tasks || []).length}</span></div>
      <div class="list-item"><b>Workflows</b><span>${(body.workflows || []).length}</span></div>`;
  }

  async function searchKnowledge(event) {
    event.preventDefault();
    const query = event.target.querySelector('input').value.trim();
    if (!query) return;
    const body = await api('/api/files/knowledge/search', { method: 'POST', body: JSON.stringify({ query }) }).catch((e) => { toast(e.message, 'err'); return null; });
    const root = $('#knowledge-results');
    if (!body) return;
    root.innerHTML = (body.results || []).length
      ? body.results.map((r) => `<div class="list-item"><div><b>${esc(r.title || r.source_type || 'result')}</b><small>${esc(String(r.content || '').slice(0, 120))}…</small></div>${badge(r.source_type)}</div>`).join('')
      : '<div class="list-item"><small>No knowledge results.</small></div>';
  }

  async function loadFactory() {
    const body = await api('/api/agents?limit=200&status=active');
    const mine = (body.agents || []).filter((a) => a.ownerId === state.user.id);
    renderFactoryAgents(mine);
  }

  function renderFactoryAgents(agents) {
    const root = $('#factory-agents');
    root.innerHTML = agents.length ? agents.map((a) => `
      <div class="list-item">
        <div><b>${esc(a.name)}</b><small>${esc(a.slug)} · ${esc(a.version)}</small></div>
        <div class="actions">
          <button class="btn btn-ghost" data-security="${esc(a.slug)}">Security</button>
          <button class="btn btn-ghost" data-benchmark="${esc(a.slug)}">Benchmark</button>
          <button class="btn btn-ghost" data-version="${esc(a.slug)}">Version</button>
        </div>
      </div>`).join('') : '<div class="list-item"><small>Create your first agent.</small></div>';
    $$('[data-security]', root).forEach((btn) => btn.addEventListener('click', () => factoryAction('security', btn.dataset.security)));
    $$('[data-benchmark]', root).forEach((btn) => btn.addEventListener('click', () => factoryAction('benchmark', btn.dataset.benchmark)));
    $$('[data-version]', root).forEach((btn) => btn.addEventListener('click', () => factoryAction('version', btn.dataset.version)));
  }

  async function createCustomAgent(event) {
    event.preventDefault();
    const form = event.target;
    const name = form.elements.namedItem('name').value.trim();
    const specialization = form.elements.namedItem('specialization').value.trim();
    const description = form.elements.namedItem('description').value.trim();
    const systemInstructions = form.elements.namedItem('system_instructions').value.trim();
    const data = {
      name,
      specialization,
      description,
      system_instructions: systemInstructions,
      capabilities: form.elements.namedItem('capabilities').value.split(',').map((s) => s.trim()).filter(Boolean),
      tool_permissions: form.elements.namedItem('tool_permissions').value.split(',').map((s) => s.trim()).filter(Boolean),
      verification_rules: form.elements.namedItem('verification_rules').value.split(',').map((s) => s.trim()).filter(Boolean),
      price_cents: Number(form.elements.namedItem('price_cents').value || 0),
    };
    try {
      const body = await api('/api/factory/agents', { method: 'POST', body: JSON.stringify(data) });
      form.reset();
      toast('Custom agent created', 'ok');
      renderFactoryAgents([{ name: data.name, slug: body.agent.slug, version: body.agent.version }]);
    } catch (e) { toast(e.message, 'err'); }
  }

  async function factoryAction(kind, slug) {
    const el = $('#factory-detail');
    try {
      let body;
      if (kind === 'security') body = await api(`/api/factory/agents/${slug}/security`);
      else if (kind === 'benchmark') body = await api(`/api/factory/agents/${slug}/benchmark`);
      else if (kind === 'version') body = await api(`/api/factory/agents/${slug}/version`, { method: 'POST', body: JSON.stringify({ changelog: 'manual bump' }) });
      if (kind === 'version') { toast('Version created', 'ok'); return; }
      el.innerHTML = `<h3>${kind}</h3><pre>${esc(JSON.stringify(body, null, 2))}</pre>`;
    } catch (e) {
      el.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }

  async function loadMarketplace() {
    skeleton('#marketplace-list', 6);
    const body = await api('/api/marketplace');
    renderMarketplace(body.agents || []);
  }

  function renderMarketplace(agents) {
    const root = $('#marketplace-list');
    const tagsOf = (value) => {
      if (Array.isArray(value)) return value;
      try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
    };
    root.innerHTML = agents.length ? agents.map((a) => `
      <article class="agent-card">
        <div class="agent-head">
          ${agentSigil(a.name)}
          <div class="agent-head-text">
            <h3>${esc(a.name)}</h3>
            <p>${esc(a.description || a.specialization || a.slug)}</p>
          </div>
        </div>
        <div class="tags"><span>${usd(a.price_cents)}</span><span>${esc(a.install_count || 0)} installs</span>${tagsOf(a.tags).slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <div class="actions">
          <button class="btn btn-primary" data-install="${esc(a.slug)}">Install</button>
          <button class="btn btn-ghost" data-publish="${esc(a.slug)}">Publish</button>
        </div>
      </article>`).join('') : '<div class="list-item"><small>No published agents yet.</small></div>';
    $$('[data-install]', root).forEach((btn) => btn.addEventListener('click', () => installAgent(btn.dataset.install)));
    $$('[data-publish]', root).forEach((btn) => btn.addEventListener('click', () => publishAgent(btn.dataset.publish)));
  }

  async function installAgent(slug) {
    try { await api(`/api/marketplace/${slug}/install`, { method: 'POST' }); toast('Agent installed', 'ok'); await loadMarketplace(); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function publishAgent(slug) {
    try { await api(`/api/marketplace/${slug}/publish`, { method: 'POST', body: JSON.stringify({ price_cents: 0 }) }); toast('Agent published', 'ok'); await loadMarketplace(); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function loadWorkspace() {
    await loadProjects();
  }

  /* ----- Scheduled automations (Automation milestone) ----- */
  let schedSelected = null;

  function describeSchedule(s) {
    if (!s) return '';
    if (s.kind === 'once') return `Once · ${new Date(s.runAt).toLocaleString()}`;
    if (s.kind === 'cron') return `Cron ${s.expr} · ${s.tz || 'UTC'}`;
    const sec = s.seconds || 0;
    if (sec % 86400 === 0) return `Every ${sec / 86400}d`;
    if (sec % 3600 === 0) return `Every ${sec / 3600}h`;
    return `Every ${sec}m`;
  }

  function updateSchedForm() {
    const form = $('#sched-form');
    const kind = form.elements.namedItem('kind').value;
    form.elements.namedItem('minutes').hidden = kind !== 'interval';
    form.elements.namedItem('cron_expr').hidden = kind !== 'cron';
    form.elements.namedItem('cron_tz').hidden = kind !== 'cron';
    form.elements.namedItem('run_at').hidden = kind !== 'once';
  }

  async function loadAutomations(selectedId) {
    schedSelected = selectedId || schedSelected;
    skeleton('#sched-list', 3);
    const body = await api('/api/automations').catch(() => ({ automations: [] }));
    const items = body.automations || [];
    $('#sched-list').innerHTML = items.map((a) => `
      <div class="list-item" data-id="${esc(a.id)}"><div><b><span class="sched-kind">${esc(String((a.schedule && a.schedule.kind) || 'interval').toUpperCase())}</span>${esc(a.name)}</b><small>${esc(describeSchedule(a.schedule))} · ${a.steps.length} step${a.steps.length === 1 ? '' : 's'} · ${a.runCount} run${a.runCount === 1 ? '' : 's'}${a.failCount ? ` · ${a.failCount} failed` : ''}</small><small>${a.status === 'active' ? `Next: ${a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : '—'}` : 'Paused'}</small></div><div class="list-actions">${badge(a.status === 'active' ? 'active' : 'disabled')}<button class="btn btn-ghost btn-sm" data-act="toggle" data-id="${esc(a.id)}" data-status="${esc(a.status)}">${a.status === 'active' ? 'Pause' : 'Resume'}</button><button class="btn btn-ghost btn-sm" data-act="run" data-id="${esc(a.id)}">Run now</button><button class="btn btn-ghost btn-sm" data-act="runs" data-id="${esc(a.id)}">Runs</button><button class="btn btn-ghost btn-sm" data-act="delete" data-id="${esc(a.id)}">Delete</button></div></div>`).join('') || '<div class="list-item"><small>No automations yet — create one on the left.</small></div>';
    $('#sched-list').querySelectorAll('button[data-act]').forEach((button) => { button.addEventListener('click', schedAction); });
    updateSchedForm();
    if (schedSelected) await loadAutomationRuns(schedSelected);
  }

  async function loadAutomationRuns(id) {
    const panel = $('#sched-runs-panel');
    panel.hidden = false;
    skeleton('#sched-runs', 3);
    const body = await api(`/api/automations/${encodeURIComponent(id)}/runs`).catch(() => ({ runs: [] }));
    $('#sched-runs').innerHTML = (body.runs || []).map((r) => `<div class="list-item"><div><b>${r.triggerReason === 'manual' ? 'Manual run' : 'Scheduled run'}</b><small>${r.startedAt ? new Date(r.startedAt).toLocaleString() : (r.scheduledFor ? new Date(r.scheduledFor).toLocaleString() : '')}</small>${r.errorMessage ? `<small>${esc(r.errorMessage)}</small>` : ''}</div>${badge(r.status)}</div>`).join('') || '<div class="list-item"><small>No runs yet.</small></div>';
  }

  async function schedAction(event) {
    const button = event.currentTarget;
    const { act, id } = button.dataset;
    try {
      if (act === 'toggle') {
        const status = button.dataset.status;
        await api(`/api/automations/${encodeURIComponent(id)}/${status === 'active' ? 'pause' : 'resume'}`, { method: 'POST' });
        toast(status === 'active' ? 'Automation paused' : 'Automation resumed', 'ok');
      } else if (act === 'run') {
        await api(`/api/automations/${encodeURIComponent(id)}/run`, { method: 'POST' });
        toast('Run started', 'ok');
        schedSelected = id;
      } else if (act === 'runs') {
        schedSelected = id;
        await loadAutomationRuns(id);
        return;
      } else if (act === 'delete') {
        if (!window.confirm('Delete this automation? Open runs are cancelled.')) return;
        await api(`/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('Automation deleted', 'ok');
        if (schedSelected === id) { schedSelected = null; $('#sched-runs-panel').hidden = true; }
      }
    } catch (e) { toast(e.message, 'err'); }
    await loadAutomations();
  }

  async function createScheduledAutomation(event) {
    event.preventDefault();
    const form = event.target;
    const kind = form.elements.namedItem('kind').value;
    let schedule;
    if (kind === 'interval') {
      const minutes = Math.max(1, Number(form.elements.namedItem('minutes').value || '60'));
      schedule = { kind: 'interval', seconds: minutes * 60 };
    } else if (kind === 'cron') {
      schedule = { kind: 'cron', expr: form.elements.namedItem('cron_expr').value.trim(), tz: form.elements.namedItem('cron_tz').value.trim() || 'UTC' };
    } else {
      schedule = { kind: 'once', run_at: form.elements.namedItem('run_at').value.trim() };
    }
    const steps = form.elements.namedItem('steps').value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [agentSlug, ...rest] = line.split('|');
      return { agent_slug: agentSlug.trim(), goal: rest.join('|').trim() };
    }).filter((step) => step.agent_slug && step.goal);
    try {
      await api('/api/automations', { method: 'POST', body: JSON.stringify({ name: form.elements.namedItem('name').value.trim(), schedule, steps }) });
      toast('Automation created', 'ok');
      form.reset();
      updateSchedForm();
      await loadAutomations();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function loadCrm() {
    ['#contact-list', '#campaign-list', '#automation-list', '#employee-list'].forEach((sel) => skeleton(sel, 3));
    const [contacts, campaigns, automations, employees] = await Promise.all([
      api('/api/crm/contacts').catch(() => ({ contacts: [] })),
      api('/api/crm/campaigns').catch(() => ({ campaigns: [] })),
      api('/api/crm/automations').catch(() => ({ automations: [] })),
      api('/api/crm/employees').catch(() => ({ employees: [] })),
    ]);
    $('#contact-list').innerHTML = (contacts.contacts || []).map((c) => `<div class="list-item"><div><b>${esc(c.first_name || '')} ${esc(c.last_name || '')}</b><small>${esc(c.email || '')}</small></div>${badge('active')}</div>`).join('') || '<div class="list-item"><small>No contacts.</small></div>';
    $('#campaign-list').innerHTML = (campaigns.campaigns || []).map((c) => `<div class="list-item"><div><b>${esc(c.name)}</b><small>${esc(c.type || '')}</small></div>${badge(c.status)}</div>`).join('') || '<div class="list-item"><small>No campaigns.</small></div>';
    $('#automation-list').innerHTML = (automations.automations || []).map((a) => `<div class="list-item"><div><b>${esc(a.name)}</b><small>${esc(a.trigger_key)}</small></div>${badge(a.status)}</div>`).join('') || '<div class="list-item"><small>No automations.</small></div>';
    $('#employee-list').innerHTML = (employees.employees || []).map((e) => `<div class="list-item"><div><b>${esc(e.name)}</b><small>${esc(e.role)}</small></div>${badge(e.status)}</div>`).join('') || '<div class="list-item"><small>No AI employees.</small></div>';
  }

  async function createContact(event) {
    event.preventDefault();
    const form = event.target;
    try {
      const body = await api('/api/crm/contacts', { method: 'POST', body: JSON.stringify({ first_name: form.elements.namedItem('first_name').value, email: form.elements.namedItem('email').value }) });
      toast('Contact added', 'ok');
      form.reset();
      await loadCrm();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function createCampaign(event) {
    event.preventDefault();
    try {
      const name = event.target.elements.namedItem('name').value;
      await api('/api/crm/campaigns', { method: 'POST', body: JSON.stringify({ name, type: 'email' }) });
      toast('Campaign created', 'ok');
      await loadCrm();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function createAutomation(event) {
    event.preventDefault();
    try {
      const name = event.target.elements.namedItem('name').value;
      const triggerKey = event.target.elements.namedItem('trigger_key').value;
      await api('/api/crm/automations', { method: 'POST', body: JSON.stringify({ name, trigger_key: triggerKey, steps: [] }) });
      toast('Automation created', 'ok');
      await loadCrm();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function createEmployee(event) {
    event.preventDefault();
    try {
      const name = event.target.elements.namedItem('name').value;
      const role = event.target.elements.namedItem('role').value;
      await api('/api/crm/employees', { method: 'POST', body: JSON.stringify({ name, role }) });
      toast('AI employee hired', 'ok');
      await loadCrm();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function loadBilling() {
    skeleton('#billing-plans', 3);
    skeleton('#invoice-list', 3);
    const account = await api('/api/billing/account');
    renderStats([
      ['Plan', state.subscription?.status || account.subscription?.status || 'free/trial'],
      ['Credits', state.user?.freeCredits ?? 0],
      ['Trial', trialLabel(state.trial)],
      ['Invoices', (account.invoices || []).length],
    ], '#billing-stats');
    const plans = await api('/api/billing/plans');
    renderPlans(plans.plans || [], '#billing-plans');
    const invoices = $('#invoice-list');
    invoices.innerHTML = (account.invoices || []).length
      ? account.invoices.map((inv) => `<div class="list-item"><div><b>${esc(inv.number)}</b><small>${esc(inv.status)} · ${usd(inv.total_cents)}</small></div>${badge(inv.status)}</div>`).join('')
      : '<div class="list-item"><small>No invoices.</small></div>';
  }

  function renderPlans(plans, selector) {
    const root = $(selector);
    if (!root) return;
    const sorted = [...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    root.innerHTML = sorted.map((plan) => {
      const featured = plan.key === 'pro';
      const specs = [
        [`${plan.monthly_credits ?? 0}`, 'credits / month'],
        [`${plan.max_agents ?? 0}`, 'agents'],
        [`${plan.max_workspaces ?? 0}`, 'workspaces'],
        [`${plan.max_seats ?? 0}`, 'seats'],
      ];
      return `
      <article class="${featured ? 'featured' : ''}">
        <div class="plan-tier">${esc(plan.name)}${featured ? '<span class="plan-flag">Most chosen</span>' : ''}</div>
        <div class="plan-price"><b>${usd(plan.price_cents)}</b><span>/ ${esc(plan.billing_interval || 'month')}</span></div>
        <p class="plan-desc">${esc(plan.description || '')}</p>
        <ul class="plan-specs">${specs.map(([v, l]) => `<li><b>${esc(v)}</b><small>${esc(l)}</small></li>`).join('')}</ul>
        <button class="btn ${featured ? 'btn-primary' : 'btn-outline'} btn-block" data-plan="${esc(plan.key)}">${plan.key === 'free' ? 'Start free' : `Choose ${esc(plan.name)}`}</button>
      </article>`;
    }).join('');
    $$('[data-plan]', root).forEach((btn) => btn.addEventListener('click', () => switchPlan(btn.dataset.plan)));
  }

  async function switchPlan(key) {
    try { await api('/api/billing/switch', { method: 'POST', body: JSON.stringify({ plan_key: key }) }); toast(`Switched to ${key}`, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function purchaseCredits(event) {
    event.preventDefault();
    const credits = Number(event.target.elements.namedItem('credits').value);
    const amountCents = Number(event.target.elements.namedItem('amount_cents').value);
    try {
      const body = await api('/api/billing/credits', { method: 'POST', body: JSON.stringify({ credits, amount_cents: amountCents, provider: 'manual' }) });
      $('#credit-order').innerHTML = `<pre>${esc(JSON.stringify(body.order || {}, null, 2))}</pre>`;
      toast('Credit purchase requested', 'ok');
    } catch (e) {
      $('#credit-order').textContent = e.message;
      toast(e.message, 'err');
    }
  }

  async function loadAdmin() {
    skeleton('#flag-list', 3);
    // /api/admin/stats returns { stats: {...} } — unwrap before reading.
    const statsBody = await api('/api/admin/stats');
    const stats = statsBody.stats || {};
    const analytics = await api('/api/admin/analytics').catch(() => null);
    renderStats([
      ['Users', stats.users],
      ['Tasks', stats.tasks],
      ['Agents', stats.agents],
      ['Models', stats.models],
      ['Revenue (USD)', usd(stats.revenuePaidCents)],
      ['Failed tasks', stats.failedTasks],
      ['Credits granted', stats.creditsGranted],
      ['Credits consumed', stats.creditsConsumed],
      ['Gross margin', analytics ? `${analytics.grossMarginPct}%` : '—'],
      ['Cost / task (USD)', analytics ? usd(analytics.costPerTask) : '—'],
    ], '#admin-stats');
    const flags = await api('/api/admin/feature-flags');
    $('#flag-list').innerHTML = (flags.flags || []).map((f) => `<div class="list-item"><div><b>${esc(f.key)}</b><small>${esc(f.description || '')}</small></div>${badge(f.enabled ? 'enabled' : 'disabled')}</div>`).join('');

    const feedback = await api('/api/admin/feedback').catch(() => ({ feedback: [] }));
    renderAdminFeedback(feedback.feedback || []);
  }

  function renderAdminFeedback(items) {
    const root = $('#admin-feedback');
    if (!root) return;
    root.innerHTML = items.length
      ? items.map((item) => `
        <div class="list-item">
          <div><b>${esc(item.subject)}</b><small>${esc(item.user_email || '')} · ${esc(item.type)} · ${esc(item.status)}</small><small>${esc(item.body).slice(0, 140)}</small></div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" data-fb-status="under_review" data-fb-id="${esc(item.id)}">Review</button>
            <button class="btn btn-ghost btn-sm" data-fb-status="resolved" data-fb-id="${esc(item.id)}">Resolve</button>
            <button class="btn btn-ghost btn-sm" data-fb-status="dismissed" data-fb-id="${esc(item.id)}">Dismiss</button>
          </div>
        </div>`).join('')
      : '<div class="list-item"><small>No feedback in the queue.</small></div>';
    $$('[data-fb-status]', root).forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/feedback/${btn.dataset.fbId}/status`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.fbStatus }) });
        toast(`Feedback marked ${btn.dataset.fbStatus}`, 'ok');
        await loadAdmin();
      } catch (e) {
        toast(e.message, 'err');
      }
    }));
  }

  async function setFlag(event) {
    event.preventDefault();
    const key = event.target.elements.namedItem('key').value;
    const value = event.target.elements.namedItem('value').value;
    try { await api('/api/admin/feature-flags', { method: 'POST', body: JSON.stringify({ key, value, enabled: true }) }); toast('Flag set', 'ok'); await loadAdmin(); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function emergencyStop() {
    try { await api('/api/admin/emergency-stop', { method: 'POST', body: JSON.stringify({}) }); toast('Emergency stop engaged', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function systemResume() {
    try { await api('/api/admin/system/resume', { method: 'POST', body: JSON.stringify({}) }); toast('System resumed', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* Bootstrap AFTER React hydration.
   *
   * This script is a classic <script> at the end of <body>: it executes as
   * soon as it is parsed, which is BEFORE Next.js/React finish hydrating.
   * Mutating the DOM at that point (theme attribute, footer year, credit
   * pill, reveal classes, reticle node) caused React hydration-mismatch
   * errors and a full client re-render. Waiting for the window `load`
   * event (all sync/module scripts, including React's, have executed by
   * then) plus a double animation frame guarantees hydration is complete
   * before this SPA layer touches the DOM.
   */
  let hydrationGateDone = false;
  function startAfterHydration() {
    if (hydrationGateDone) return;
    hydrationGateDone = true;
    requestAnimationFrame(() => requestAnimationFrame(boot));
  }
  if (document.readyState === 'complete') startAfterHydration();
  else {
    window.addEventListener('load', startAfterHydration, { once: true });
    // Safety valve: if some subresource hangs and `load` never fires, boot
    // anyway — React hydration (pure script execution) will long since have
    // finished on any realistic device.
    setTimeout(startAfterHydration, 4000);
  }
})();
