/* AKBARAL! / MASTER AI — web client */
(() => {
  'use strict';

  const state = {
    accessToken: localStorage.getItem('ak_access') || null,
    refreshToken: localStorage.getItem('ak_refresh') || null,
    user: null,
    trial: null,
    subscription: null,
    projects: [],
    agents: [],
    categories: [],
    plan: null,
    executionStream: null,
    view: 'landing',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

  function badge(status) {
    const color = status === 'active' || status === 'completed' || status === 'published' || status === 'enabled'
      ? 'green'
      : status === 'failed' || status === 'disabled' || status === 'blocked' ? 'red'
      : status === 'pending' || status === 'running' || status === 'planned' ? 'gold'
      : 'blue';
    return `<span class="badge ${color}">${esc(status)}</span>`;
  }

  async function api(path, options = {}, retry = true) {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (state.accessToken) headers.authorization = `Bearer ${state.accessToken}`;
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401 && retry && state.refreshToken) {
      const refreshed = await refreshSession();
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

  async function refreshSession() {
    if (!state.refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      state.accessToken = body.accessToken;
      state.refreshToken = body.refreshToken;
      localStorage.setItem('ak_access', state.accessToken);
      localStorage.setItem('ak_refresh', state.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async function boot() {
    bindMenu();
    bindAuth();
    bindGeneral();
    window.addEventListener('hashchange', navigate);
    await navigate();
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
        localStorage.setItem('ak_access', result.accessToken);
        localStorage.setItem('ak_refresh', result.refreshToken);
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
      localStorage.removeItem('ak_access');
      localStorage.removeItem('ak_refresh');
      state.accessToken = null;
      state.refreshToken = null;
      state.user = null;
      location.hash = '#/';
    });

    $('#login-btn').addEventListener('click', () => { location.hash = '#/login'; });
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
    $('#employee-form').addEventListener('submit', createEmployee);
    $('#credit-form').addEventListener('submit', purchaseCredits);
    $('#flag-form').addEventListener('submit', setFlag);
    $('#emergency-stop').addEventListener('click', emergencyStop);
  }

  async function navigate() {
    const view = (location.hash || '#/').replace('#/', '');
    state.view = view;
    if (['login', 'register'].includes(view)) {
      showScreen('auth');
      $('#auth-title').textContent = view === 'register' ? 'Create account' : 'Sign in';
      $('#auth-name-wrap').hidden = view !== 'register';
      $('#auth-submit').textContent = view === 'register' ? 'Create account' : 'Sign in';
      $('#auth-switch').innerHTML = view === 'register'
        ? 'Already have an account? <a href="#/login">Sign in</a>'
        : 'No account? <a href="#/register">Create one</a>';
      return;
    }

    if (!state.accessToken) {
      if (view === '') { showScreen('landing'); await loadLanding(); return; }
      location.hash = '#/login';
      return;
    }

    try {
      await loadMe();
    } catch {
      location.hash = '#/login';
      return;
    }

    if (view === '' || view === 'landing') { showScreen('dashboard'); await loadDashboard(); return; }
    if (view === 'dashboard') { showScreen('dashboard'); await loadDashboard(); return; }
    if (view === 'master') { showScreen('master'); await loadProjects(); return; }
    if (view === 'agents') { showScreen('agents'); await loadAgentWorld(); return; }
    if (view === 'factory') { showScreen('factory'); await loadFactory(); return; }
    if (view === 'marketplace') { showScreen('marketplace'); await loadMarketplace(); return; }
    if (view === 'workspace') { showScreen('workspace'); await loadWorkspace(); return; }
    if (view === 'crm') { showScreen('crm'); await loadCrm(); return; }
    if (view === 'billing') { showScreen('billing'); await loadBilling(); return; }
    if (view === 'admin') {
      if (!['admin', 'super_admin'].includes(state.user?.role || '')) { toast('Admin access required', 'err'); showScreen('dashboard'); return; }
      showScreen('admin');
      await loadAdmin();
      return;
    }
    showScreen('dashboard');
    await loadDashboard();
  }

  function showScreen(name) {
    $$('.screen').forEach((screen) => { screen.hidden = true; });
    const map = {
      landing: 'screen-landing',
      auth: 'screen-auth',
      dashboard: 'screen-dashboard',
      master: 'screen-master',
      agents: 'screen-agents',
      factory: 'screen-factory',
      marketplace: 'screen-marketplace',
      workspace: 'screen-workspace',
      crm: 'screen-crm',
      billing: 'screen-billing',
      admin: 'screen-admin',
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
    const label = state.trial?.isActive ? `Trial · ${credits} free tasks` : `Credits · ${credits}`;
    $('#credit-pill').textContent = label;
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
      ['Trial', state.trial?.isActive ? `${state.trial.daysRemaining}d remaining` : 'Inactive'],
      ['Plan', state.subscription?.status || 'free/trial'],
      ['Role', state.user?.role || 'user'],
    ];
    renderStats(stats, '#dashboard-stats');
    const tasks = await api('/api/tasks').catch(() => ({ tasks: [] }));
    renderTaskList(tasks.tasks || [], '#dashboard-tasks');

    const agents = state.user ? await api(`/api/agents?limit=6&status=active`).catch(() => ({ agents: [] })) : { agents: [] };
    renderAgentCards(agents.agents || [], '#dashboard-agents');
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
      <div class="list-item">
        <div><b>${esc(task.title || task.goal || task.id)}</b><small>${esc(task.status || '')} · ${esc(task.created_at || '')}</small></div>
        <span>${badge(task.status)}</span>
      </div>`).join('');
  }

  function renderAgentCards(agents, rootSelector, allowDetail = true) {
    const root = $(rootSelector);
    if (!root) return;
    if (!agents.length) { root.innerHTML = '<div class="list-item"><small>No agents found.</small></div>'; return; }
    root.innerHTML = agents.slice(0, 24).map((agent) => `
      <article class="agent-card">
        <h3>${esc(agent.name)}</h3>
        <p>${esc(agent.specialization || agent.description || agent.slug)}</p>
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
      toast(`Dispatched ${slug}. Execution ${body.executionId}`, 'ok');
      location.hash = '#/master';
      await loadMasterExecution(body.executionId);
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
    try {
      const plan = await api('/api/workflows/master', { method: 'POST', body: JSON.stringify({ goal, project_id: projectId }) });
      renderPlan(plan);
      $('#master-output').innerHTML += `\n\nStarting workflow ${plan.workflowId}…`;
      const run = await api(`/api/workflows/${plan.workflowId}/run`, { method: 'POST', body: JSON.stringify({}) });
      if (run.executionId) {
        await loadMasterExecution(run.executionId);
      } else {
        showWorkflow(run);
      }
    } catch (e) {
      $('#master-output').textContent = `Error: ${e.message}`;
      toast(e.message, 'err');
    }
  }

  function renderPlan(plan) {
    const steps = (plan.plan?.steps || []).map((step) => `→ ${step.agentSlug || step.name || step.specialization || step.stepOrder}${step.description ? ` — ${step.description}` : ''}`).join('\n');
    $('#master-output').textContent = `Detected intents: ${(plan.plan?.intents || []).join(', ')}\nPlan:\n${steps}`;
  }

  async function loadMasterExecution(executionId) {
    const out = $('#master-output');
    out.textContent = `Streaming execution ${executionId}…\n`;
    const seen = new Set();
    const poll = async () => {
      try {
        const body = await api(`/api/tasks/execution/${executionId}`).catch(() => null);
        if (body && body.logs) {
          for (const log of body.logs) {
            if (log.id && !seen.has(log.id)) {
              seen.add(log.id);
              out.textContent += `[${log.created_at || ''}] ${log.message}\n`;
            }
          }
        }
        const exec = body?.execution || {};
        if (exec.status === 'completed' || exec.status === 'failed') {
          out.textContent += `\nFinal status: ${exec.status}\n`;
          if (exec.output_data) {
            try { out.textContent += JSON.stringify(JSON.parse(exec.output_data), null, 2); }
            catch { out.textContent += String(exec.output_data); }
          }
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
        <h3>${esc(a.name)}</h3>
        <p>${esc(a.description || a.specialization || a.slug)}</p>
        <div class="tags"><span>PKR ${Number(a.price_cents || 0) / 100}</span><span>${esc(a.install_count || 0)} installs</span>${tagsOf(a.tags).slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
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

  async function loadCrm() {
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
    const account = await api('/api/billing/account');
    renderStats([
      ['Plan', state.subscription?.status || account.subscription?.status || 'free/trial'],
      ['Credits', state.user?.freeCredits ?? 0],
      ['Trial', state.trial?.isActive ? `${state.trial.daysRemaining}d remaining` : 'Inactive'],
      ['Invoices', (account.invoices || []).length],
    ], '#billing-stats');
    const plans = await api('/api/billing/plans');
    renderPlans(plans.plans || [], '#billing-plans');
    const invoices = $('#invoice-list');
    invoices.innerHTML = (account.invoices || []).length
      ? account.invoices.map((inv) => `<div class="list-item"><div><b>${esc(inv.number)}</b><small>${esc(inv.status)} · PKR ${Number(inv.total_cents || 0) / 100}</small></div>${badge(inv.status)}</div>`).join('')
      : '<div class="list-item"><small>No invoices.</small></div>';
  }

  function renderPlans(plans, selector) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = plans.map((plan) => `
      <article class="${plan.key === 'pro' ? 'featured' : ''}">
        <h3>${esc(plan.name)}</h3>
        <p class="muted">${esc(plan.description || '')}</p>
        <p><b>PKR ${Number(plan.price_cents || 0) / 100}</b> / ${esc(plan.billing_interval || 'month')}</p>
        <p>${esc(plan.monthly_credits || 0)} credits · ${esc(plan.max_agents || 0)} agents · ${esc(plan.max_workspaces || 0)} workspaces</p>
        <button class="btn btn-primary" data-plan="${esc(plan.key)}">${plan.key === 'free' ? 'Activate free' : 'Switch plan'}</button>
      </article>`).join('');
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
    const stats = await api('/api/admin/stats');
    const analytics = await api('/api/admin/analytics').catch(() => null);
    renderStats([
      ['Users', stats.users],
      ['Tasks', stats.tasks],
      ['Agents', stats.agents],
      ['Models', stats.models],
      ['Revenue (PKR)', (Number(stats.revenuePaidCents || 0) / 100).toFixed(2)],
      ['Failed tasks', stats.failedTasks],
      ['Credits granted', stats.creditsGranted],
      ['Credits consumed', stats.creditsConsumed],
      ['Gross margin', analytics ? `${analytics.grossMarginPct}%` : '—'],
      ['Cost / task (PKR)', analytics ? (Number(analytics.costPerTask || 0) / 100).toFixed(2) : '—'],
    ], '#admin-stats');
    const flags = await api('/api/admin/feature-flags');
    $('#flag-list').innerHTML = (flags.flags || []).map((f) => `<div class="list-item"><div><b>${esc(f.key)}</b><small>${esc(f.description || '')}</small></div>${badge(f.enabled ? 'enabled' : 'disabled')}</div>`).join('');
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

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  boot();
})();
