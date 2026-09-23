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
    masterAttachments: [],
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ----- Design-system helpers ----- */

  function setCoreState(next, label) {
    const core = $('#master-core');
    const labelEl = $('#master-core-label');
    if (core) core.dataset.state = next;
    if (labelEl) labelEl.textContent = label || next;
    const consoleState = $('#master-console-state');
    if (consoleState) {
      // The stylesheet keys success on [data-state="ok"] — map the lifecycle
      // name so a completed run is actually shown in the success colour.
      consoleState.dataset.state = next === 'thinking' || next === 'executing'
        ? 'running'
        : next === 'success' ? 'ok' : next;
      consoleState.textContent = label || next;
    }
  }

  /**
   * Honest, actionable failure copy for every real task failure mode.
   * Never claims success; never hides the underlying reason — the raw
   * message is always shown alongside the explanation.
   */
  function friendlyTaskError(code, message) {
    const msg = String(message || '');
    const m = {
      provider_not_configured: {
        title: 'No AI provider configured',
        detail: 'This deployment has no model provider key, so the task cannot run. The operator must configure a model provider (see the Environment panel on the MASTER screen for live availability). Your free task credit was refunded.',
      },
      provider_auth: {
        title: 'AI provider rejected the credentials',
        detail: 'The model provider answered that the API key is invalid or unauthorized. The operator must fix the provider key. Your free task credit was refunded.',
      },
      provider_rate_limited: {
        title: 'AI provider rate limit',
        detail: 'The model provider is rate-limiting this deployment right now. The task was retried with backoff and then stopped honestly. Your free task credit was refunded — try again shortly.',
      },
      provider_outage: {
        title: 'AI provider outage',
        detail: 'The model provider returned a server error. The task was retried and then stopped honestly. Your free task credit was refunded — try again shortly.',
      },
      verification_failed: {
        title: 'Result rejected by verification',
        detail: 'The model produced output, but it did not meet this agent\'s verification contract (substance, structure or goal coverage). Nothing unverified is ever returned as a success. Your free task credit was refunded.',
      },
      timed_out: {
        title: 'Execution timed out',
        detail: 'The execution exceeded its time budget and was stopped. Your free task credit was refunded.',
      },
      cancelled: {
        title: 'Task cancelled',
        detail: 'This task was cancelled. Your free task credit was refunded.',
      },
      requires_pro: {
        title: 'Free tasks exhausted',
        detail: 'All free task credits are used. AKBARAL Pro is required to run more tasks.',
      },
    };
    let key = code || '';
    if (!key || !m[key]) {
      if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) key = 'provider_auth';
      else if (msg.includes('HTTP 429')) key = 'provider_rate_limited';
      else if (msg.includes('HTTP 5') || msg.includes('server error')) key = 'provider_outage';
      else if (msg.includes('not configured')) key = 'provider_not_configured';
      else if (msg.includes('verification_failed')) key = 'verification_failed';
      else if (msg.includes('timed_out')) key = 'timed_out';
    }
    const entry = m[key];
    if (!entry) return { title: 'Task failed', detail: 'The task failed honestly. The raw error is shown below.', code: code || 'execution_failed' };
    return { title: entry.title, detail: entry.detail, code: key };
  }

  /* ============================================================
     TASK OUTCOME RENDERER — the single terminal task-result view.

     Four UI state machines, strictly separated — a state from one machine
     must NEVER be rendered by another:
       1. KNOWLEDGE state   -> #knowledge-results only (workspace tool panel)
       2. TOOL state        -> execution console log lines only
       3. EXECUTION state   -> console state chip + live logs (non-terminal)
       4. TERMINAL RESULT   -> THIS renderer only (#master-result, task detail)

     Payload shapes rendered with their REAL content — never a placeholder,
     never a knowledge/tool state, never fabricated output:
       - agent_result           (specialist agents; model content + verification)
       - web_research_report    (Agent #001; report.summary + facts + sources)
       - MASTER finalResult     (workflow document; executiveSummary + sections)
       - { content } / string   (generic real content)
     ============================================================ */
  /** A complete HTML document (the website-builder deliverable shape). */
  function isFullHtmlDocument(value) {
    return /^\s*(<!doctype html|<html[\s>])/i.test(String(value || '').trim());
  }

  /** Parse a JSON string that is an array of objects → table rows. */
  function tryParseJsonTable(value) {
    const text = String(value || '').trim();
    if (!text.startsWith('[')) return null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
        return parsed;
      }
      return null;
    } catch { return null; }
  }

  /**
   * Website preview (PART 2): renders the real HTML deliverable inside a
   * sandboxed iframe (srcdoc). The sandbox allows scripts but NOT
   * same-origin/allow-top-navigation — the artifact can never touch the app.
   * Viewport toggle gives the responsive preview; open/download use a real
   * Blob of the same content.
   */
  function renderWebsitePreview(root, html, meta) {
    const id = `wp-${Math.random().toString(36).slice(2, 9)}`;
    const versionLine = meta ? `<span class="wp-version">v${esc(String(meta.version))} · ${esc(String(meta.title || 'website'))}</span>` : '';
    root.innerHTML += `
      <div class="website-preview" id="${id}">
        <div class="wp-toolbar">
          <div class="wp-viewports">
            <button type="button" class="wp-vp active" data-w="${100}" title="Desktop">Desktop</button>
            <button type="button" class="wp-vp" data-w="820" title="Tablet">Tablet</button>
            <button type="button" class="wp-vp" data-w="390" title="Mobile">Mobile</button>
          </div>
          <div class="wp-actions">
            ${versionLine}
            <button type="button" class="wp-open">Open ↗</button>
            <button type="button" class="wp-download">Download</button>
          </div>
        </div>
        <div class="wp-frame-wrap"><iframe class="wp-frame" sandbox="allow-scripts" title="Website preview" style="width:100%"></iframe></div>
      </div>`;
    const container = document.getElementById(id);
    const frame = container.querySelector('.wp-frame');
    frame.srcdoc = html;
    container.querySelectorAll('.wp-vp').forEach((button) => {
      button.addEventListener('click', () => {
        container.querySelectorAll('.wp-vp').forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
        const width = Number(button.getAttribute('data-w'));
        frame.style.width = width >= 100 ? '100%' : `${width}px`;
      });
    });
    container.querySelector('.wp-open').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
    container.querySelector('.wp-download').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `akbaral-website${meta ? `-v${meta.version}` : ''}.html`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  /** Data preview (PART 2): a real table for JSON-array results, plus an
   *  honest CSS bar chart when a numeric column exists (real values only). */
  function renderDataTable(root, rows) {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
    // Chart: pick the first numeric column; label by the first string column.
    const numericCol = columns.find((c) => rows.some((row) => typeof row[c] === 'number'));
    const labelCol = columns.find((c) => typeof rows[0]?.[c] === 'string') ?? columns[0];
    const chartRows = numericCol ? rows.slice(0, 12) : [];
    const max = chartRows.length ? Math.max(...chartRows.map((row) => Math.abs(Number(row[numericCol])) || 0)) : 0;
    root.innerHTML += `
      <div class="result-block">
        <div class="result-meta"><span>${rows.length} rows · ${columns.length} columns</span></div>
        ${chartRows.length >= 2 && max > 0 ? `<div class="bar-chart" role="img" aria-label="Bar chart of ${esc(numericCol)} by ${esc(String(labelCol))}">${chartRows.map((row) => `
          <div class="bar-row" title="${esc(String(row[labelCol] ?? ''))}: ${esc(String(row[numericCol]))}">
            <span class="bar-label">${esc(String(row[labelCol] ?? '').slice(0, 14))}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((Math.abs(Number(row[numericCol])) / max) * 100))}%"></span></span>
            <span class="bar-value">${esc(String(row[numericCol]))}</span>
          </div>`).join('')}</div>` : ''}
        <div class="table-scroll"><table class="econ-table data-table"><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 50).map((row) => `<tr>${columns.map((c) => `<td>${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${rows.length > 50 ? `<p class="state-kv">Showing 50 of ${rows.length} rows.</p>` : ''}
      </div>`;
  }

  /**
   * Image preview (PART 2): renders a real image (auth-fetched file or data
   * URL) with save/export. Never fabricates an image — only renders what the
   * task/file actually produced.
   */
  function renderImagePreview(root, image) {
    const url = String((image && (image.url || image.src)) || '');
    const filename = String((image && (image.filename || image.alt)) || 'akbaral-image');
    const id = `img-${Math.random().toString(36).slice(2, 9)}`;
    root.innerHTML += `
      <div class="result-block image-result" id="${id}">
        <div class="result-meta"><span>image</span></div>
        <div class="image-frame"><img alt="${esc(filename)}" title="${esc(filename)}" /></div>
        <div class="result-actions"><button type="button" class="btn btn-sm wp-download">Download</button></div>
      </div>`;
    const container = document.getElementById(id);
    const img = container.querySelector('img');
    const isRelative = url.startsWith('/');
    if (isRelative) {
      // Auth-fetched (bearer) file: object URL of the REAL stored bytes.
      fetch(url, { headers: state.accessToken ? { authorization: `Bearer ${state.accessToken}` } : {} })
        .then((r) => { if (!r.ok) throw new Error(`file fetch failed (${r.status})`); return r.blob(); })
        .then((blob) => { img.src = URL.createObjectURL(blob); container.dataset.blobUrl = URL.createObjectURL(blob); })
        .catch(() => { container.querySelector('.image-frame').innerHTML = `<p class="state-kv">Image could not be loaded (${esc(url)}).</p>`; });
    } else {
      img.src = url;
    }
    container.querySelector('.wp-download').addEventListener('click', () => {
      const src = container.dataset.blobUrl || img.src;
      const anchor = document.createElement('a');
      anchor.href = src;
      anchor.download = filename;
      anchor.click();
    });
  }

  /**
   * Document preview (PART 2): renders the real document text with an honest
   * export (Blob download of the exact content — .md/.txt/.html by shape).
   */
  function renderDocumentPreview(root, doc) {
    const content = String((doc && (doc.content || doc.text)) || '');
    const title = String((doc && (doc.title || doc.filename)) || 'document');
    const ext = /^\s*(<!doctype html|<html[\s>])/i.test(content) ? 'html' : 'md';
    const id = `doc-${Math.random().toString(36).slice(2, 9)}`;
    root.innerHTML += `
      <div class="result-block document-result" id="${id}">
        <div class="result-meta"><span>document</span><span>${content.length.toLocaleString()} chars</span></div>
        <div class="result-body doc-body">${esc(content)}</div>
        <div class="result-actions"><button type="button" class="btn btn-sm wp-download">Download .${ext}</button></div>
      </div>`;
    document.getElementById(id).querySelector('.wp-download').addEventListener('click', () => {
      const blobUrl = URL.createObjectURL(new Blob([content], { type: ext === 'html' ? 'text/html' : 'text/markdown' }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'document'}.${ext}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    });
  }

  /**
   * Business form (PART 2): an interactive form the user can actually fill —
   * rendered from a form schema in the result. Submitting produces a filled
   * summary the user can download; nothing is sent anywhere else.
   */
  function renderBusinessForm(root, form) {
    const title = String((form && form.title) || 'Business form');
    const fields = Array.isArray(form && form.fields) ? form.fields.slice(0, 12) : [];
    const id = `bf-${Math.random().toString(36).slice(2, 9)}`;
    root.innerHTML += `
      <div class="result-block business-form" id="${id}">
        <div class="result-meta"><span>interactive form</span></div>
        <h4>${esc(title)}</h4>
        <form class="bf-form">
          ${fields.map((f, i) => {
            const label = esc(String((f && f.label) || `Field ${i + 1}`));
            const ftype = ['text', 'number', 'email', 'date'].includes(String(f && f.type)) ? String(f.type) : 'text';
            const options = Array.isArray(f && f.options) ? f.options.slice(0, 8) : null;
            return `<label class="bf-field"><span>${label}</span>${
              options
                ? `<select data-bf="${label}">${options.map((o) => `<option value="${esc(String(o))}">${esc(String(o))}</option>`).join('')}</select>`
                : `<input type="${ftype}" data-bf="${label}" placeholder="${label}" />`
            }</label>`;
          }).join('')}
          <div class="result-actions"><button type="submit" class="btn btn-sm btn-primary">Complete form</button></div>
        </form>
        <div class="bf-output" hidden></div>
      </div>`;
    const container = document.getElementById(id);
    container.querySelector('.bf-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const filled = Array.from(container.querySelectorAll('[data-bf]')).map((input) => ({ field: input.getAttribute('data-bf'), value: String(input.value || '').slice(0, 500) }));
      const output = container.querySelector('.bf-output');
      output.hidden = false;
      output.innerHTML = `
        <p class="section-label">Your completed form</p>
        <div class="table-scroll"><table class="econ-table data-table"><tbody>${filled.map((row) => `<tr><th>${esc(row.field)}</th><td>${esc(row.value)}</td></tr>`).join('')}</tbody></table></div>
        <div class="result-actions"><button type="button" class="btn btn-sm bf-download">Download filled form</button></div>`;
      output.querySelector('.bf-download').addEventListener('click', () => {
        const blobUrl = URL.createObjectURL(new Blob([JSON.stringify({ title, filled }, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = `${title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'form'}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      });
    });
  }

  /**
   * Comparison cards (PART 2: travel / shopping): structured results that
   * carry official source links render as secure cards + official links —
   * external pages are never fake-embedded.
   */
  function renderComparisonCards(root, rows, label) {
    const cards = rows.slice(0, 12).map((row) => {
      const entries = Object.entries(row).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
      const linkEntry = entries.find(([k]) => ['url', 'link', 'source_url', 'booking_url', 'official_url'].includes(k));
      const nameKey = ['name', 'title', 'option', 'airline', 'product', 'store', 'hotel'].find((k) => row[k] !== undefined && row[k] !== null) ?? entries[0]?.[0];
      const priceKey = ['price', 'price_cents', 'cost', 'fare', 'total', 'amount'].find((k) => row[k] !== undefined && row[k] !== null);
      const name = nameKey ? String(row[nameKey]) : 'Option';
      const price = priceKey !== undefined ? String(row[priceKey]) : null;
      const rest = entries.filter(([k]) => k !== nameKey && k !== priceKey && k !== linkEntry?.[0]).slice(0, 4);
      const link = linkEntry ? String(row[linkEntry[0]]) : null;
      return `<div class="cmp-card">
        <div class="cmp-head"><b>${esc(name)}</b>${price ? `<span class="cmp-price">${esc(price)}</span>` : ''}</div>
        ${rest.map(([k, v]) => `<div class="cmp-row"><span>${esc(String(k).replace(/_/g, ' '))}</span><b>${esc(String(v).slice(0, 80))}</b></div>`).join('')}
        ${link && /^https:?:\/\//i.test(link) ? `<a class="cmp-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : '<span class="cmp-link cmp-nolink">No official link provided</span>'}
      </div>`;
    }).join('');
    root.innerHTML += `
      <div class="result-block">
        <div class="result-meta"><span>${esc(String(label || 'comparison'))}</span><span>${rows.length} options · links open the official source (nothing is embedded)</span></div>
        <div class="cmp-grid">${cards}</div>
      </div>`;
  }

  /** Owner entitlement is SERVER-side; the client only reports it honestly. */
  function creditsLabel() {
    const role = String(state.user?.role ?? 'user');
    if (role === 'owner' || role === 'super_admin') return 'Unlimited (owner)';
    return `${state.user?.freeCredits ?? 0} free tasks`;
  }

  function renderTaskOutcome(root, input) {
    if (!root) return;
    const status = input.status;
    const payload = input.payload;

    if (status === 'failed' || status === 'cancelled') {
      const friendly = friendlyTaskError(input.code, input.message);
      root.innerHTML = `<div class="state-card state-error">
        <h4>${esc(friendly.title)}</h4>
        <p>${esc(friendly.detail)}</p>
        ${input.message ? `<p class="state-kv">${esc(String(input.message).slice(0, 400))}</p>` : ''}
      </div>`;
      return;
    }

    if (status !== 'completed') {
      // Non-terminal execution state: explicitly still running, never a
      // result claim.
      root.innerHTML = `<div class="state-card"><h4>Execution ${esc(String(status || 'running'))}</h4><p>The task is still running. The result appears here when it finishes.</p></div>`;
      return;
    }

    // --- completed: render the actual payload content by its real shape ---
    if (typeof payload === 'string' && payload.trim()) {
      if (isFullHtmlDocument(payload)) { renderWebsitePreview(root, payload, null); return; }
      const dataPayload = tryParseJsonTable(payload);
      if (dataPayload) {
        // Travel / shopping comparisons: rows carrying official links render
        // as secure cards + source links (never a fake embedded page).
        const hasLink = dataPayload.some((row) => ['url', 'link', 'source_url', 'booking_url', 'official_url'].some((k) => typeof row[k] === 'string' && /^https?:\/\//i.test(String(row[k]))));
        if (hasLink) { renderComparisonCards(root, dataPayload, 'comparison'); return; }
        renderDataTable(root, dataPayload);
        return;
      }
      root.innerHTML = `<div class="result-block"><div class="result-body">${esc(payload)}</div></div>`;
      return;
    }
    if (!payload || typeof payload !== 'object') {
      // Honest no-content completion: a completed task without a content
      // payload is stated exactly as that — never replaced by a knowledge
      // or tool state, never fabricated.
      root.innerHTML = `<div class="state-card state-ok"><h4>Completed</h4><p>The execution finished successfully, but no result content was attached to it.</p></div>`;
      return;
    }

    // Image result: a real produced/attached image (display + export).
    if (payload.type === 'image_result' && (payload.url || payload.src)) {
      renderImagePreview(root, payload);
      return;
    }

    // Document result: the real document text (preview + download).
    if ((payload.type === 'document_result' || payload.type === 'document') && typeof (payload.content || payload.text) === 'string') {
      renderDocumentPreview(root, payload);
      return;
    }

    // Business interactive form: a real fillable form from the result.
    if (payload.type === 'business_form' && Array.isArray(payload.fields)) {
      renderBusinessForm(root, payload);
      return;
    }

    // Specialist agent result: the model's verified answer.
    if (payload.type === 'agent_result') {
      const v = payload.verification || {};
      const meta = [
        payload.model ? String(payload.model) : null,
        payload.provider ? String(payload.provider) : null,
        payload.latencyMs != null ? `${payload.latencyMs} ms` : null,
        v.score != null ? `verification ${typeof v.score === 'number' ? Math.round(v.score * 100) + '%' : String(v.score)}` : null,
      ].filter(Boolean);
      root.innerHTML = `<div class="result-block">
        <div class="result-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        <div class="result-body">${esc(String(payload.content || ''))}</div>
      </div>`;
      return;
    }

    // Agent #001 web research report: summary + verified-source facts.
    if (payload.type === 'web_research_report' && payload.report) {
      const report = payload.report;
      const facts = Array.isArray(report.facts) ? report.facts : [];
      const sources = Array.isArray(report.sources) ? report.sources : [];
      const meta = [
        report.provider ? String(report.provider) : null,
        report.verifiedSources != null ? `${report.verifiedSources} verified source${Number(report.verifiedSources) === 1 ? '' : 's'}` : null,
        report.durationMs != null ? `${report.durationMs} ms` : null,
      ].filter(Boolean);
      root.innerHTML = `<div class="result-block">
        <div class="result-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
        <div class="result-body">${esc(String(report.summary || ''))}</div>
        ${facts.length ? `<div class="result-facts"><p class="section-label">Verified facts</p>${facts.map((f) => `<div class="list-item"><div><b>${esc(String((f && f.statement) || '')).slice(0, 240)}</b><small>${esc(String((f && f.source) || ''))}</small></div>${badge('verified')}</div>`).join('')}</div>` : ''}
        ${sources.length ? `<div class="result-facts"><p class="section-label">Sources</p>${sources.slice(0, 10).map((s) => `<a class="list-item list-item-link" href="${esc(String((s && s.url) || '#'))}" target="_blank" rel="noopener noreferrer"><div><b>${esc(String((s && s.title) || (s && s.url) || 'source'))}</b></div><span>open →</span></a>`).join('')}</div>` : ''}
      </div>`;
      return;
    }

    // MASTER workflow finalResult document: executive summary + the real
    // per-specialist section content.
    if (Array.isArray(payload.sections) || typeof payload.executiveSummary === 'string') {
      const sections = Array.isArray(payload.sections) ? payload.sections : [];
      const completedSections = sections.filter((s) => String(s && s.status) === 'completed');
      const meta = [
        payload.mode ? `synthesis: ${String(payload.mode)}` : null,
        completedSections.length ? `${completedSections.length} completed step${completedSections.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      const websiteSections = completedSections.filter((s) => isFullHtmlDocument(String(s.content || '')));
      const textSections = completedSections.filter((s) => !isFullHtmlDocument(String(s.content || '')));
      const sectionHtml = textSections.map((s) => `
        <div class="result-section">
          <p class="section-label">${esc(String(s.specialization || s.agentSlug || `step ${s.stepOrder}`))}${s.verified === false ? ' · unverified' : ''}</p>
          <div class="result-body">${esc(String(s.content || ''))}</div>
        </div>`).join('');
      const failedSections = sections.filter((s) => String(s && s.status) !== 'completed');
      root.innerHTML = `<div class="result-block">
        ${meta.length ? `<div class="result-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="result-body">${esc(String(payload.executiveSummary || ''))}</div>
        ${sectionHtml}
        ${failedSections.length ? `<p class="state-kv">${failedSections.length} step${failedSections.length === 1 ? '' : 's'} did not complete.</p>` : ''}
      </div>`;
      if (websiteSections.length > 0) {
        renderWebsitePreview(root, String(websiteSections[0].content || ''), null);
      }
      return;
    }

    // Generic real content payload.
    const genericContent = payload.content ?? payload.report?.summary ?? payload.summary ?? null;
    if (typeof genericContent === 'string' && genericContent.trim()) {
      root.innerHTML = `<div class="result-block"><div class="result-body">${esc(genericContent)}</div></div>`;
      return;
    }
    root.innerHTML = `<div class="state-card state-ok"><h4>Completed</h4><p>The execution finished successfully, but no result content was attached to it.</p></div>`;
  }

  /**
   * Render the terminal result into the workspace CANVAS (left pane, directly
   * under the export controls) and post the matching MASTER chat turn into the
   * right rail. One run, one real payload, two views of it — the canvas shows
   * the deliverable, the chat shows the answer.
   */
  function renderMasterResult(ok, payload) {
    const root = $('#master-result');
    if (!root) return;
    root.hidden = false;
    renderTaskOutcome(root, {
      status: ok ? 'completed' : 'failed',
      payload: ok ? payload : undefined,
      code: ok ? undefined : payload?.code,
      message: ok ? undefined : payload?.message,
    });
    const empty = $('#master-preview-empty');
    if (empty) empty.hidden = true;
    canvasSetState(ok ? 'ok' : 'error', ok ? canvasKindLabel(payload) : 'failed');
    chatAppend(outcomeChatTurn(ok, payload));
    // On narrow viewports the panes switch rather than shrink: a finished run
    // reveals its deliverable; a failure keeps the conversation in view.
    if (masterPaneIsNarrow()) masterPaneSet(ok ? 'workspace' : 'chat');
  }

  function clearMasterResult() {
    const root = $('#master-result');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    const empty = $('#master-preview-empty');
    if (empty) empty.hidden = false;
    canvasSetState('idle', 'idle');
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

  /**
   * Restore a session after a full page load.
   *
   * A browser refresh (F5, a bookmark, a shared link, a reopened tab) throws
   * away every in-memory value: `state.accessToken` is null while the tab still
   * holds a perfectly valid refresh token in storage. The router used to treat
   * "no access token in memory" as "not signed in" and bounced the visitor to
   * the sign-in screen — a refresh looked like being logged out even though the
   * session was live. Restoring here costs one request per page load at most
   * (single-flighted, and only when a refresh token exists), and a token the
   * server rejects is cleared by refreshSession() itself.
   */
  async function ensureSession() {
    if (state.accessToken) return true;
    if (!storageGet('ak_refresh')) return false; // anonymous: nothing to restore
    return refreshSession();
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
        body: '<h3>What we store</h3><p>AKBARAL stores only what is required to run your account: encrypted password hashes, hashed session tokens, your projects, files, knowledge, tasks and execution history. Provider API keys are never stored in the database and never sent to the browser.</p><h3>Cookies &amp; advertising</h3><p>The platform itself sets no tracking cookies. Sign-in tokens are kept in your browser\'s local storage and are essential/functional only. If advertising is enabled on a deployment, third-party advertising vendors (Google AdSense) may set cookies only after you explicitly accept the advertising-consent banner; declining keeps your experience ad-free and sets no advertising cookies. You can change your choice any time from the footer.</p><h3>What we do not do</h3><p>We do not fabricate reviews, ratings, statistics or AI results. We do not sell your data. Missing provider credentials are reported honestly.</p>',
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
    // Opening and closing a dialog must not strand keyboard users: focus moves
    // into the sheet, is kept inside it while it is open, and returns to the
    // control that opened it on every close path (button, backdrop, Escape).
    let returnFocusTo = null;
    const open = (key, opener) => {
      const item = content[key];
      if (!item) return;
      $('#legal-title').textContent = item.title;
      $('#legal-body').innerHTML = item.body;
      returnFocusTo = opener || document.activeElement;
      modal.hidden = false;
      close.focus();
    };
    const closeModal = () => {
      if (modal.hidden) return;
      modal.hidden = true;
      if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
      returnFocusTo = null;
    };
    $$('[data-legal]').forEach((btn) => btn.addEventListener('click', () => open(btn.dataset.legal, btn)));
    close.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeModal(); return; }
      if (event.key !== 'Tab' || modal.hidden) return;
      const focusable = [...modal.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null || el === close);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
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
    // Typography is requested with media="print" (never on the critical path).
    // Flipping it on here keeps every DOM write after hydration — the same rule
    // the rest of this file follows.
    const fontSheet = document.getElementById('ak-fonts');
    if (fontSheet) fontSheet.setAttribute('media', 'all');
    bindMenu();
    bindAuth();
    bindGeneral();
    bindMasterWorkspaceShell();
    bindAppShell();
    bindMotion();
    bindLandingNav();
    bindLegalModal();
    bindFooter();
    bindEconomy();
    initAds();
    initCinematic();
    window.addEventListener('hashchange', navigate);
    // Restore the tab's session BEFORE the first route decision, so a refresh
    // of any page (including a deep link) keeps the signed-in visitor signed in.
    await ensureSession();
    await navigate();
  }

  function bindMenu() {
    const nav = $('#main-nav');
    const toggle = $('#menu-toggle');
    const setOpen = (open) => {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    nav.querySelectorAll('a, button').forEach((item) => item.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  }

  /**
   * Inline auth feedback. The toast stays for app-wide messages, but a sign-in
   * failure must be readable where the user is looking — next to the fields —
   * with the offending input marked and screen readers told politely.
   */
  function authFeedback(state, message) {
    const box = $('#auth-feedback');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.dataset.state = 'idle';
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.dataset.state = state;
    box.textContent = message;
  }

  function authMarkInvalid(field, invalid) {
    const input = field === 'email' ? $('#auth-email') : field === 'password' ? $('#auth-password') : null;
    if (!input) return;
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', 'auth-feedback');
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function authSetBusy(busy) {
    const button = $('#auth-submit');
    if (!button) return;
    button.setAttribute('aria-busy', String(busy));
    button.disabled = busy;
  }

  function bindAuth() {
    $('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const name = $('#auth-name').value.trim();
      const mode = state.view === 'register' ? 'register' : 'login';
      const emailLooksValid = /.+@.+\..+/.test(email);
      authMarkInvalid('email', false);
      authMarkInvalid('password', false);
      authFeedback(null, null);
      if (!emailLooksValid) {
        authMarkInvalid('email', true);
        authFeedback('error', 'Enter a valid email address, for example you@company.com.');
        $('#auth-email').focus();
        return;
      }
      if (password.length < 8) {
        authMarkInvalid('password', true);
        authFeedback('error', 'Passwords need at least 8 characters.');
        $('#auth-password').focus();
        return;
      }
      authSetBusy(true);
      authFeedback('pending', mode === 'register' ? 'Creating your account…' : 'Signing you in…');
      try {
        if (mode === 'register') {
          await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: name || undefined }) });
          authFeedback('success', 'Account created. Sign in with the same email and password.');
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
        authFeedback('success', `Signed in as ${result.user.name || result.user.email}.`);
        toast(`Welcome, ${result.user.name || result.user.email}`, 'ok');
        afterSignIn();
      } catch (error) {
        const message = error && error.message ? error.message : 'Sign-in failed. Please try again.';
        authMarkInvalid('password', /password/i.test(message));
        authMarkInvalid('email', /email|account|user/i.test(message) && !/password/i.test(message));
        authFeedback('error', message);
      } finally {
        authSetBusy(false);
      }
    });

    // Password visibility — a real control, reflected in the input type.
    $$('[data-password-reveal]').forEach((button) => {
      const input = $(`#${button.dataset.passwordReveal}`);
      if (!input) return;
      button.addEventListener('click', () => {
        const shown = button.getAttribute('aria-pressed') === 'true';
        const next = !shown;
        button.setAttribute('aria-pressed', String(next));
        button.setAttribute('aria-label', next ? 'Hide password' : 'Show password');
        button.setAttribute('title', next ? 'Hide password' : 'Show password');
        input.type = next ? 'text' : 'password';
      });
    });

    // A fresh attempt should not keep stale error styling.
    ['#auth-email', '#auth-password'].forEach((selector) => {
      $(selector)?.addEventListener('input', () => {
        authMarkInvalid(selector === '#auth-email' ? 'email' : 'password', false);
        const box = $('#auth-feedback');
        if (box && box.dataset.state === 'error') authFeedback(null, null);
      });
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
    $('#explore-agents')?.addEventListener('click', () => {
      if (!state.accessToken) { location.hash = '#/login'; return; }
      location.hash = '#/agents';
    });

    $('#master-form').addEventListener('submit', runMaster);
    $('#master-attachment-input')?.addEventListener('change', (event) => void handleMasterAttachments(event.target));
    $('#master-project')?.addEventListener('change', () => void loadMasterWorkspace());
    bindVoiceInput();
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
    $$('#credit-form [data-amount]').forEach((other) => other.setAttribute('aria-pressed', String(other === chip)));
  }));
  $('#credit-form').addEventListener('submit', purchaseCredits);
    $('#flag-form').addEventListener('submit', setFlag);
    $('#emergency-stop').addEventListener('click', emergencyStop);
    $('#system-resume').addEventListener('click', systemResume);
    $('#feedback-form').addEventListener('submit', submitFeedback);
  }

  /**
   * Dense tables come from several renderers; any table that is not already
   * inside a horizontal scroller gets one, so a wide ledger can never push a
   * phone layout sideways.
   */
  function ensureTableScroll(root = document) {
    root.querySelectorAll('table').forEach((table) => {
      const parent = table.parentElement;
      if (!parent || parent.classList.contains('table-scroll') || parent.closest('.table-scroll')) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  async function navigate() {
    // The workspace is a REAL route (`/workspace`) as well as the `#/master`
    // hash screen: one component, one spatial model. A clean path wins when a
    // visitor lands on it without a hash, so `/workspace` opens the app shell
    // directly instead of the marketing landing.
    const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
    const hash = String(location.hash || '');
    const hashView = hash.replace('#/', '');
    // The marketing page is reachable ONLY when it is explicitly asked for:
    // `#/` (the header brand link and the post-sign-out target) and
    // `#/landing`. Every other entry is the application.
    const wantsMarketing = hash === '#/' || hash === '#/landing';
    // An explicit hash always wins (so `#/login` renders the sign-in screen);
    // the clean path decides when the visitor landed without a hash.
    // `#/workspace` IS the compact application shell (ChatGPT/Arena model) —
    // the legacy Projects & knowledge screen moved to `#/projects`, so every
    // "Workspace" entry point in the product reaches the new UI.
    // Clean, refreshable deep links. The application is hash-routed (`#/login`,
    // `#/projects`, …), which means a hard refresh of a hash URL always lands
    // on `/` and works. A CLEAN path has no such guarantee: the server must
    // have a real route for it or the browser gets a 404 on refresh. `/signin`,
    // `/signup`, `/projects`, `/billing`, `/admin` and `/master` therefore have
    // real Next routes rendering this same shell (mirroring `/workspace`), and
    // this map decides which screen each one opens. Unknown paths stay unknown
    // — they must still 404 rather than quietly serving the app.
    const PATH_VIEWS = {
      '/workspace': 'master',
      '/master': 'master',
      '/signin': 'login',
      '/signup': 'register',
      '/projects': 'projects',
      '/billing': 'billing',
      '/admin': 'admin',
    };
    const rawView = hash.length > 0 ? hashView : (PATH_VIEWS[path] ?? '');
    const view = rawView === 'workspace' ? 'master' : rawView;
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

    // The application is the product's primary surface. A clean entry — `/` or
    // `/workspace`, with no hash — opens the compact shell: the MASTER screen
    // for a live session, the shell's own sign-in card otherwise. The marketing
    // page is never the root fallback (it used to be, which meant a browser
    // holding a session the API no longer accepted — an expired, revoked or
    // rebuilt-database token — was quietly dropped onto the long marketing page
    // instead of the sign-in screen). `#/` still reaches it explicitly.
    if (wantsMarketing) {
      showScreen('landing');
      await loadLanding();
      return;
    }

    if (view === '') {
      if (state.accessToken) {
        try {
          await loadMe();
        } catch (error) {
          // A live session refreshes transparently inside api(), so reaching
          // here means it is genuinely unusable. Say so and open the sign-in
          // card — never the marketing page, and never a silent stall.
          if (!state.accessToken || error?.status === 401 || error?.status === 403) {
            // A dead refresh token may already have been dropped by the
            // refresh attempt; clear whatever is left and say it plainly.
            if (state.accessToken) clearSessionTokens();
            toast('Your session expired — sign in again to continue.', 'err');
          } else {
            toast('Could not reach the server — check your connection and sign in again.', 'err');
          }
          location.hash = '#/login';
          return;
        }
        if (state.user) {
          location.hash = '#/workspace';
          return;
        }
      }
      // No session at all: the sign-in card inside the compact shell.
      location.hash = '#/login';
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
    if (view === 'master') { showScreen('master'); await loadProjects(); void loadMasterInfo(); void loadMasterWorkspace(); return; }
    if (view === 'agents') { showScreen('agents'); await loadAgentWorld(); return; }
    if (view === 'factory') { showScreen('factory'); await loadFactory(); return; }
    if (view === 'marketplace') { showScreen('marketplace'); await loadMarketplace(); return; }
    if (view === 'projects') { showScreen('workspace'); await loadWorkspace(); return; }
    if (view === 'automations') { showScreen('automations'); await loadAutomations(); return; }
    const schedMatch = view.match(/^automations\/([A-Za-z0-9_-]+)$/);
    if (schedMatch) { showScreen('automations'); await loadAutomations(schedMatch[1]); return; }
    if (view === 'crm') { showScreen('crm'); await loadCrm(); return; }
    if (view === 'billing') { showScreen('billing'); await loadBilling(); return; }
    if (view === 'settings') { showScreen('settings'); await loadSettings(); void loadConnectedAccounts(); return; }
    if (view === 'economy') {
      // Private owner console — owner/super_admin only, invisible
      // to ordinary users (no nav entry; reached via #/economy).
      if (!['owner', 'super_admin'].includes(state.user?.role || '')) { toast('Owner access required', 'err'); showScreen('dashboard'); return; }
      showScreen('economy');
      await loadEconomy();
      return;
    }
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
    afterSignIn();
  }

  /**
   * Where a successful sign-in lands.
   *
   * An explicit same-origin `next` path (e.g. `#/login?next=/owner` used by
   * the owner console) is honoured — it must be a site-relative path, never
   * an absolute URL, so a crafted link cannot become an open redirect. With
   * no `next`, the sign-in lands on the MASTER workspace: the product home.
   */
  function afterSignIn() {
    const query = (location.hash || '').split('?')[1] || '';
    const next = new URLSearchParams(query).get('next') || '';
    if (/^\/[\w\-./?=&]*$/.test(next) && !next.startsWith('/api') && !next.startsWith('//')) {
      window.location.href = next;
      return;
    }
    location.hash = '#/master';
  }

  /* Official provider marks, inlined: the sign-in surface never waits on a
     third-party asset host, and a button can never render without its logo.
     GitHub and Apple use currentColor — their marks are monochrome and read
     correctly on the dark glass (brand #181717 would not). */
  const OAUTH_LOGOS = {
    google: '<svg viewBox="0 0 48 48" focusable="false" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    github: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
    microsoft: '<svg viewBox="0 0 23 23" focusable="false" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="12" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="12" width="10" height="10" fill="#00A4EF"/><rect x="12" y="12" width="10" height="10" fill="#FFB900"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073"/></svg>',
    apple: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  };

  /**
   * Provider sign-in buttons (2026-09-16).
   *
   * The sign-in surface is a production front door, so it shows polished
   * controls with official marks and never leaks configuration state: no
   * "setup needed" badges, no environment variable names, no debug notices.
   *
   *   · a provider the server reports as configured is a REAL control — the
   *     press navigates to /api/auth/oauth/<key>/authorize, which 302s to the
   *     provider's own consent screen;
   *   · a provider that is not configured renders in a subtle unavailable state
   *     (aria-disabled + disabled, muted glass, its real logo, and a plain
   *     "not available" tooltip). Nothing is faked and nothing is explained in
   *     internal terms to a visitor;
   *   · the exact credentials an operator must set live in the owner-only
   *     console (renderProviderSetupDiagnostics), which is where an operator
   *     looks — never on the public screen.
   */
  async function renderOAuthButtons() {
    const wrap = $('#auth-oauth');
    const target = $('#auth-oauth-buttons');
    const note = $('#auth-oauth-note');
    if (!wrap || !target) return;
    if (note) { note.textContent = ''; note.hidden = true; note.removeAttribute('data-kind'); }
    try {
      const body = await api('/api/auth/oauth/providers');
      const providers = body.providers || [];
      if (!providers.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      target.innerHTML = providers.map((p) => {
        const available = Boolean(p.configured);
        const mark = OAUTH_LOGOS[p.key] || '';
        const button = `<button type="button" class="oauth-btn${available ? '' : ' is-unavailable'}" data-oauth-provider="${esc(p.key)}" data-oauth-configured="${available ? '1' : '0'}"${available ? '' : ' disabled aria-disabled="true"'}>`
          + `<span class="oauth-mark" aria-hidden="true">${mark}</span>`
          + `<span class="oauth-label">Continue with ${esc(p.label)}</span></button>`;
        if (available) return button;
        // Browsers do not show a tooltip on a disabled control, so the wrapper
        // carries the plain-language reason.
        return `<span class="oauth-slot" title="${esc(p.label)} sign-in isn’t available on this deployment yet">${button}</span>`;
      }).join('');
      target.querySelectorAll('button[data-oauth-provider]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.oauthConfigured !== '1') return;
          window.location.href = `/api/auth/oauth/${encodeURIComponent(button.dataset.oauthProvider)}/authorize`;
        });
      });
    } catch {
      wrap.hidden = true;
    }
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
    // The pre-login surface is the product's front door, not a marketing page:
    // retire the public header and footer so nothing sits around the way in.
    document.body.classList.toggle('is-auth', name === 'auth');
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
      economy: 'screen-economy',
      settings: 'screen-settings',
    };
    const screen = document.getElementById(map[name]);
    if (screen) screen.hidden = false;
    // nav active
    $$('#main-nav a').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === location.hash));
    const isAdmin = ['admin', 'super_admin'].includes(state.user?.role || '');
    $('#login-btn').hidden = Boolean(state.accessToken);
    $('#logout-btn').hidden = !state.accessToken;
    $('#start-free-nav').hidden = Boolean(state.accessToken);
    $('.admin-only').hidden = !isAdmin;
    // One navigation system: landing links while signed out, app links
    // while signed in (see .nav-set rules in styles.css).
    document.body.classList.toggle('is-authed', Boolean(state.accessToken));
    // Build #6: the MASTER screen IS the application — the marketing chrome
    // steps aside and the shell owns the viewport. Every other screen keeps
    // the editorial layout it was designed for.
    const appScreen = name === 'master';
    document.body.classList.toggle('is-workspace', appScreen);
    if (appScreen) shellSyncChrome();
  }

  /** Drop a session the API no longer accepts (expired, revoked, rotated out
   *  by another tab, or issued against a database that no longer exists). */
  function clearSessionTokens() {
    state.accessToken = null;
    state.refreshToken = null;
    state.user = null;
    storageRemove('ak_access');
    storageRemove('ak_refresh');
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
    const pill = $('#credit-pill');
    if (pill) pill.textContent = label;
    // The app shell carries the same real number in its own top bar.
    const shellPill = $('#ak-credit-pill');
    if (shellPill) {
      shellPill.textContent = onTrial ? `Trial · ${credits} free` : `Credits · ${credits}`;
      shellPill.title = onTrial ? `${credits} free task credits on trial` : `${credits} task credits`;
    }
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
    $('#settings-credits').textContent = creditsLabel();
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
    let parsedOutput = null;
    if (task.output_data) {
      try { parsedOutput = JSON.parse(task.output_data); } catch { parsedOutput = null; }
    }
    const output = task.output_data ? safeJsonPretty(task.output_data) : null;
    const error = task.error_message || (executions || []).find((x) => x.error_message)?.error_message;
    const newest = (executions || [])[0];
    const isLive = newest && !['completed', 'failed', 'cancelled'].includes(String(newest.status));
    const logCount = (logs || []).length;

    const failure = task.status !== 'completed' && error ? friendlyTaskError(undefined, error) : null;
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
      ${failure ? `<div class="panel danger-panel"><h3>${esc(failure.title)}</h3><p class="sub">${esc(failure.detail)}</p></div>` : ''}
      <div class="stat-grid">
        <div class="stat"><span>Status</span><b>${esc(task.status || '—')}</b></div>
        <div class="stat"><span>Executions</span><b>${(executions || []).length}</b></div>
        <div class="stat"><span>Log entries</span><b id="task-log-count">${logCount}</b></div>
        <div class="stat"><span>Duration</span><b>${newest && newest.duration_ms ? Math.round(newest.duration_ms / 100) / 10 + 's' : '—'}</b></div>
      </div>
      ${error ? `<div class="panel danger-panel"><h3>Error</h3><pre>${esc(String(error))}</pre></div>` : ''}
      ${task.status === 'completed' || parsedOutput ? `<div class="panel"><h3>Result</h3><div id="task-outcome"></div>${output ? `<details class="raw-result"><summary>Raw result data</summary><pre>${esc(output)}</pre></details>` : ''}</div>` : ''}
      ${isLive ? `<div class="panel"><h3>Live execution</h3><p class="sub">This task is still running (${esc(String(newest.status))}). The result appears here when it finishes.</p></div>` : ''}
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

    // Terminal result: shared outcome renderer — the actual answer, never a
    // knowledge/tool state, never raw JSON as the primary view.
    const outcomeRoot = $('#task-outcome');
    if (outcomeRoot) {
      renderTaskOutcome(outcomeRoot, {
        status: String(task.status || 'unknown'),
        payload: parsedOutput,
        message: error,
      });
    }

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
      const friendly = friendlyTaskError(e.code, e.message);
      toast(`${friendly.title}: ${e.message}`, 'err');
      renderMasterResult(false, { code: e.code, message: e.message });
    }
  }

  /**
   * Website project state bar (PART 1): the real versioned artifact from the
   * server — current version, full history, undo (revert) and export
   * (download), wired to the versioned artifact API. Rendered above the
   * MASTER result whenever the active project has a website artifact.
   */
  async function renderProjectArtifactBar(projectId) {
    const host = $('#master-artifact-bar');
    if (!host || !projectId) return;
    const [latest, versions] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`),
      api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website/versions`),
    ]);
    if (!latest?.artifact) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const artifact = latest.artifact;
    const list = versions?.versions ?? [];
    host.hidden = false;
    host.innerHTML = `
      <div class="artifact-bar">
        <span class="badge">website</span>
        <strong>v${esc(String(artifact.version))}</strong>
        <span class="sub">${esc(String(artifact.title || ''))}</span>
        <select id="artifact-version-select" aria-label="Version">
          ${list.map((v) => `<option value="${esc(String(v.version))}" ${Number(v.version) === Number(artifact.version) ? 'selected' : ''}>v${esc(String(v.version))}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-sm" id="artifact-revert">Undo to selected</button>
        <button type="button" class="btn btn-sm" id="artifact-export">Export</button>
        <button type="button" class="btn btn-sm" id="artifact-open">Open v${esc(String(artifact.version))} ↗</button>
        <button type="button" class="btn btn-ghost btn-sm" id="artifact-rename" title="Rename the current version">Rename</button>
        <button type="button" class="btn btn-ghost btn-sm" id="artifact-delete" title="Delete the selected version (history stays append-only otherwise; deletion is audited)">Delete v</button>
      </div>`;
    // Real export/open: the API accepts no token in a query string, so both
    // actions are auth-fetched with the bearer token (a plain href would 401).
    $('#artifact-export')?.addEventListener('click', () => authedDownload(
      `/api/projects/${encodeURIComponent(projectId)}/artifacts/website/download`,
      `akbaral-website-v${artifact.version}.html`,
    ));
    $('#artifact-open')?.addEventListener('click', () => void openArtifactBlob(projectId, artifact.version));
    $('#artifact-rename')?.addEventListener('click', async () => {
      const title = window.prompt('New title for the current website version', String(artifact.title || ''));
      if (!title || !title.trim()) return;
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`, { method: 'PATCH', body: JSON.stringify({ title: title.trim() }) });
        toast(`Renamed the current website version`, 'ok');
        await renderProjectArtifactBar(projectId);
        await renderMasterExportBar(projectId);
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#artifact-delete')?.addEventListener('click', async () => {
      const target = Number($('#artifact-version-select').value);
      if (!window.confirm(`Delete version v${target}? This removes that version from history (audited). This cannot be undone.`)) return;
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website/v/${target}`, { method: 'DELETE' });
        toast(`Deleted v${target}`, 'ok');
        await renderProjectArtifactBar(projectId);
        await renderMasterExportBar(projectId);
        const refreshed = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`);
        if (refreshed?.artifact) renderMasterResult(true, { sections: [{ status: 'completed', content: refreshed.artifact.content, specialization: `Project website v${refreshed.artifact.version}` }], executiveSummary: `Current website after deleting v${target}.` });
        else clearMasterResult();
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#artifact-revert').addEventListener('click', async () => {
      const target = Number($('#artifact-version-select').value);
      if (!target || target === Number(artifact.version)) { toast('That is already the current version', 'err'); return; }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website/revert/${target}`, { method: 'POST' });
        toast(`Reverted project website to v${target} (saved as a new version)`, 'ok');
        await renderProjectArtifactBar(projectId);
        await renderMasterExportBar(projectId);
        const refreshed = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`);
        if (refreshed?.artifact) renderMasterResult(true, { sections: [{ status: 'completed', content: refreshed.artifact.content, specialization: `Project website v${refreshed.artifact.version}` }], executiveSummary: `Restored version v${target} — rendered as the current project website.` });
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  async function runMaster(event) {
    event.preventDefault();
    const goal = $('#master-goal').value.trim();
    if (!goal) return;
    const projectId = $('#master-project').value || null;
    const attachmentIds = state.masterAttachments.map((a) => a.id);
    if (attachmentIds.length > 0 && !projectId) { toast('Attachments need a selected project', 'err'); return; }
    // The goal opens the conversation as a real user turn.
    chatAppend({
      kind: 'user',
      who: 'You',
      meta: projectId ? [{ label: 'project', tone: 'blue' }] : [],
      html: `<p>${esc(goal)}</p>`,
    });
    if (masterPaneIsNarrow()) masterPaneSet('chat');
    $('#master-output').textContent = 'Planning…';
    clearMasterResult();
    setCoreState('thinking', 'planning');
    try {
      // Response shape: { workflow: { id, status }, plan: { intents, steps, notes } }.
      const plan = await api('/api/workflows/master', { method: 'POST', body: JSON.stringify({ goal, project_id: projectId, ...(attachmentIds.length ? { attachment_file_ids: attachmentIds } : {}) }) });
      renderPlan(plan);
      const workflowId = plan?.workflow?.id;
      if (!workflowId) throw new Error('Planning succeeded but no workflow id was returned');
      $('#master-output').innerHTML += `\n\nStarting workflow ${esc(workflowId)}…`;
      setCoreState('executing', 'executing');
      await api(`/api/workflows/${workflowId}/run`, { method: 'POST', body: JSON.stringify(attachmentIds.length ? { attachment_file_ids: attachmentIds } : {}) });
      // The files are claimed by the first specialist task — clear the tray.
      state.masterAttachments = [];
      renderMasterAttachments();
      await loadWorkflowProgress(workflowId, projectId);
    } catch (e) {
      $('#master-output').textContent += `\nError: ${e.message}`;
      setCoreState('error', 'error');
      renderMasterResult(false, { code: e.code, message: e.message });
      toast(e.message, 'err');
    }
  }

  /**
   * Live progress for a MASTER workflow run. Polls the real workflow state
   * (`GET /api/workflows/:id` returns the workflow row plus per-step
   * statuses) and renders each step transition until the workflow reaches a
   * terminal status, then shows the persisted final result.
   */
  async function loadWorkflowProgress(workflowId, projectId) {
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
          let parsedResult = null;
          if (workflow.result_json) {
            try { parsedResult = JSON.parse(workflow.result_json); out.textContent += JSON.stringify(parsedResult, null, 2).slice(0, 4000); }
            catch { out.textContent += String(workflow.result_json).slice(0, 4000); }
          } else if (workflow.error_message) {
            out.textContent += `${workflow.error_message}\n`;
          }
          const ok = workflow.status === 'completed';
          setCoreState(ok ? 'success' : 'error', ok ? 'success' : 'error');
          if (ok) {
            renderMasterResult(true, parsedResult?.finalResult ?? parsedResult);
            // Website-builder flow: if this run belonged to a project, refresh
            // the versioned artifact bar AND the export control above the
            // canvas — the server captured the new version on completion, so
            // the export bar must name it and the Files rail must list it
            // without the user re-selecting the project.
            if (projectId) {
              renderProjectArtifactBar(projectId).catch(() => {});
              renderMasterExportBar(projectId).catch(() => {});
              const filesRoot = $('#master-files');
              if (filesRoot && !filesRoot.closest('[hidden]')) loadMasterFiles(projectId).catch(() => {});
            }
          } else {
            renderMasterResult(false, { code: 'execution_failed', message: workflow.error_message || `workflow ${workflow.status}` });
          }
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
    clearMasterResult();
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
              // DOM nodes (not innerHTML) keep log text inert; classes color
              // warnings/errors honestly in the console.
              const line = document.createElement('div');
              if (log.level === 'warn') line.className = 'log-warn';
              else if (log.level === 'error') line.className = 'log-err';
              line.textContent = `[${log.created_at || ''}] ${log.message}`;
              out.appendChild(line);
              out.scrollTop = out.scrollHeight;
            }
          }
        }
        const exec = body.execution || {};
        if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'cancelled') {
          out.textContent += `\nFinal status: ${exec.status}\n`;
          let parsedOutput = null;
          if (exec.output_data) {
            try { parsedOutput = JSON.parse(exec.output_data); out.textContent += JSON.stringify(parsedOutput, null, 2); }
            catch { out.textContent += String(exec.output_data); }
          }
          const ok = exec.status === 'completed';
          setCoreState(ok ? 'success' : 'error', ok ? 'success' : 'error');
          if (ok) {
            renderMasterResult(true, parsedOutput);
          } else {
            renderMasterResult(false, { code: exec.status === 'cancelled' ? 'cancelled' : undefined, message: exec.error_message || `execution ${exec.status}` });
          }
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

  /**
   * Environment panel on the MASTER screen: honest model-provider
   * availability from /api/models (env key NAMES only — values never leave
   * the server). If no provider is configured the user sees why tasks
   * cannot run before spending anything.
   */
  async function loadMasterInfo() {
    const body = await api('/api/models').catch(() => null);
    const root = $('#master-info-body');
    if (!root) return;
    if (!body || !Array.isArray(body.providers)) {
      root.innerHTML = '<div class="info-line"><span>Model providers</span><b>unavailable</b></div>';
      return;
    }
    const configured = body.providers.filter((p) => p.configured && p.status === 'enabled');
    const line = configured.length
      ? configured.map((p) => `${p.name} (${p.key})`).join(' · ')
      : 'none configured';
    root.innerHTML = `
      <div class="info-line"><span>Model providers</span><b>${esc(line)}</b></div>
      <div class="info-line"><span>Free credits</span><b>${esc(creditsLabel())}</b></div>
      ${configured.length ? '' : '<p class="info-note">No model provider is configured on this deployment. Tasks will fail honestly and free credits are refunded automatically.</p>'}`;
  }

  /* ----- MASTER workspace panes (Build #4): history, files, controls,
     attachments and voice — all driven by the real APIs. ----- */

  /** Refresh every right/left pane that depends on the selected project. */
  async function loadMasterWorkspace() {
    await loadMasterTaskHistory();
    const projectId = $('#master-project')?.value || null;
    await renderMasterProjectControls(projectId);
    await loadMasterFiles(projectId);
    await renderProjectArtifactBar(projectId);
    await renderMasterExportBar(projectId);
    updateAttachmentHint();
  }

  /* ============================================================
     Build #5 — ARENA-STYLE WORKSPACE SHELL (web)

     LEFT pane  · the full project / book / file area, the live preview
                  canvas, and the download / export control ABOVE it.
     RIGHT pane · the AKBARAL! brand header at the top, then the main
                  MASTER chat (live activity, results, composer, drawers).

     Android mirrors this exact spatial model and design system
     (mobile/src/screens/MasterScreen.tsx). Every control here is bound to a
     real API — nothing decorative, nothing simulated.
     ============================================================ */

  /** Select the visible pane on narrow viewports (both panes stay visible
   *  on desktop, where the switch is hidden by CSS). */
  function masterPaneSet(name) {
    const layout = $('#master-layout');
    if (!layout) return;
    const pane = name === 'chat' ? 'chat' : 'workspace';
    layout.dataset.pane = pane;
    $$('[data-pane-tab]').forEach((tab) => {
      const active = tab.dataset.paneTab === pane;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('active', active);
    });
  }

  /** True when CSS has collapsed the two panes into one (pane switch active). */
  function masterPaneIsNarrow() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1080px)').matches;
  }

  /** Preview-canvas state chip (idle | running | ok | error + a real label). */
  function canvasSetState(kind, label) {
    const chip = $('#master-canvas-state');
    if (!chip) return;
    chip.dataset.state = kind || 'idle';
    chip.textContent = label || kind || 'idle';
  }

  function chatScrollToEnd() {
    const log = $('#master-chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /**
   * Append one MASTER chat turn. The live activity stream (#master-output)
   * always stays the last element of the rail, so turns read chronologically
   * above it. Actions are real handlers supplied by the caller.
   */
  function chatAppend(turn) {
    const log = $('#master-chat-log');
    if (!log) return null;
    const activity = $('#master-output');
    const el = document.createElement('div');
    el.className = `chat-msg ${turn.kind || 'master'}`;
    const meta = Array.isArray(turn.meta) ? turn.meta : [];
    const actions = Array.isArray(turn.actions) ? turn.actions : [];
    el.innerHTML = `
      <div class="cm-head">
        <span class="cm-who">${esc(turn.who || 'MASTER')}</span>
        ${meta.map((m) => `<span class="badge ${esc(m.tone || 'accent')}">${esc(m.label)}</span>`).join('')}
      </div>
      <div class="cm-body">${turn.html || ''}</div>
      ${actions.length ? `<div class="cm-actions">${actions.map((a, i) => `<button type="button" class="btn btn-sm ${esc(a.className || 'btn-ghost')}" data-chat-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
    if (activity && activity.parentNode === log) log.insertBefore(el, activity);
    else log.appendChild(el);
    actions.forEach((a, i) => {
      const button = el.querySelector(`[data-chat-action="${i}"]`);
      if (button && typeof a.onClick === 'function') button.addEventListener('click', a.onClick);
    });
    chatScrollToEnd();
    return el;
  }

  /** The real HTML deliverable inside a completed payload, if there is one. */
  function extractHtmlDeliverable(payload) {
    if (typeof payload === 'string') return isFullHtmlDocument(payload) ? payload : null;
    if (!payload || typeof payload !== 'object') return null;
    if (isFullHtmlDocument(String(payload.content || ''))) return String(payload.content);
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const website = sections.find((s) => isFullHtmlDocument(String((s && s.content) || '')));
    return website ? String(website.content) : null;
  }

  /** Short, honest canvas label for a completed payload shape. */
  function canvasKindLabel(payload) {
    if (typeof payload === 'string') return isFullHtmlDocument(payload) ? 'website' : 'result';
    if (!payload || typeof payload !== 'object') return 'result';
    if (payload.type === 'image_result') return 'image';
    if (payload.type === 'document_result' || payload.type === 'document') return 'document';
    if (payload.type === 'business_form') return 'form';
    if (Array.isArray(payload.sections)) return extractHtmlDeliverable(payload) ? 'website' : 'report';
    if (payload.type === 'web_research_report') return 'research';
    return 'result';
  }

  /** Download an exact HTML deliverable (used by the canvas + the chat turn). */
  function downloadHtmlDeliverable(html, filename) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || 'akbaral-deliverable.html';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** The chat turn for a finished run (summary + real export/open actions). */
  function outcomeChatTurn(ok, payload) {
    if (!ok) {
      const friendly = friendlyTaskError(payload?.code, payload?.message);
      return {
        kind: 'master err',
        who: 'MASTER · failed',
        meta: [{ label: 'failed', tone: 'red' }],
        html: `<p>${esc(friendly.title)}</p><p class="state-kv">${esc(friendly.detail)}</p>`,
      };
    }
    const html = extractHtmlDeliverable(payload);
    const actions = [];
    if (html) {
      actions.push({ label: 'Export .html', className: 'btn-outline', onClick: () => downloadHtmlDeliverable(html, 'akbaral-website.html') });
      actions.push({ label: 'Open in canvas', onClick: () => masterPaneSet('workspace') });
    }
    const text = typeof payload === 'string'
      ? payload
      : (payload && typeof payload === 'object'
        ? (payload.executiveSummary || payload.report?.summary || payload.content || payload.summary || '')
        : '');
    const body = typeof text === 'string' && text.trim()
      ? `<p>${esc(text.trim().slice(0, 700))}${text.trim().length > 700 ? '…' : ''}</p>`
      : '<p>Completed. The execution finished successfully, but no result content was attached to it — the canvas reflects exactly that.</p>';
    return {
      kind: 'master ok',
      who: 'MASTER · result',
      meta: [{ label: canvasKindLabel(payload), tone: 'green' }],
      html: body,
      actions,
    };
  }

  /** Open a real artifact version in a new tab (auth-fetched → blob). */
  async function openArtifactBlob(projectId, version) {
    try {
      const body = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website/v/${encodeURIComponent(String(version))}`);
      const content = String(body?.artifact?.content || '');
      if (!content) throw new Error('That version has no content to open');
      const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) { toast(e.message, 'err'); }
  }

  /** Render the project's current website artifact into the preview canvas. */
  async function previewWebsiteArtifact(projectId) {
    const root = $('#master-result');
    if (!root) return;
    try {
      const body = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`);
      const artifact = body?.artifact;
      if (!artifact) { toast('No website version in this project yet', 'err'); return; }
      root.hidden = false;
      root.innerHTML = '';
      renderWebsitePreview(root, String(artifact.content || ''), { version: artifact.version, title: artifact.title });
      const empty = $('#master-preview-empty');
      if (empty) empty.hidden = true;
      canvasSetState('ok', `website v${artifact.version}`);
      await renderMasterExportBar(projectId);
      masterPaneSet('workspace');
    } catch (e) { toast(e.message, 'err'); }
  }

  /**
   * The download / export control that sits ABOVE the live preview: real
   * export of the current website artifact, opening a version, and pushing it
   * back into the canvas. Downloads are auth-fetched with the bearer token
   * (the API deliberately accepts no token in a query string).
   */
  async function renderMasterExportBar(projectId) {
    const host = $('#master-export-actions');
    if (!host) return;
    if (!projectId) {
      host.innerHTML = '<span class="sub">Select a project to export its website.</span>';
      return;
    }
    const body = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/website`).catch(() => null);
    const artifact = body?.artifact;
    if (!artifact) {
      host.innerHTML = '<span class="sub">No website version yet — run a goal with this project selected.</span>';
      return;
    }
    host.innerHTML = `
      <span class="badge accent">website v${esc(String(artifact.version))}</span>
      <button type="button" class="btn btn-outline btn-sm" id="master-export-download">Export .html</button>
      <button type="button" class="btn btn-ghost btn-sm" id="master-export-open">Open ↗</button>
      <button type="button" class="btn btn-ghost btn-sm" id="master-export-canvas">Show in canvas</button>`;
    $('#master-export-download')?.addEventListener('click', () => authedDownload(
      `/api/projects/${encodeURIComponent(projectId)}/artifacts/website/download`,
      `akbaral-website-v${artifact.version}.html`,
    ));
    $('#master-export-open')?.addEventListener('click', () => void openArtifactBlob(projectId, artifact.version));
    $('#master-export-canvas')?.addEventListener('click', () => void previewWebsiteArtifact(projectId));
  }

  /**
   * File-context export bar: while a project file is on the canvas, the
   * controls above it export THAT file (or return to the website version) —
   * the bar never describes a different deliverable than the one shown.
   */
  function renderFileExportBar(fileId, name, projectId) {
    const host = $('#master-export-actions');
    if (!host) return;
    host.innerHTML = `
      <span class="badge blue">file</span>
      <span class="sub">${esc(name)}</span>
      <button type="button" class="btn btn-outline btn-sm" id="master-export-file">Export file</button>
      <button type="button" class="btn btn-ghost btn-sm" id="master-export-back">Website version</button>`;
    $('#master-export-file')?.addEventListener('click', () => authedDownload(`/api/files/${encodeURIComponent(fileId)}`, name || 'akbaral-file'));
    $('#master-export-back')?.addEventListener('click', () => {
      if (!projectId) { renderMasterExportBar(null); return; }
      void previewWebsiteArtifact(projectId);
    });
  }

  /**
   * Preview a real project file inside the workspace canvas (auth-fetched):
   * HTML renders in the sandboxed website frame, images render directly, text
   * renders as a document. Binary/unknown types are downloaded instead of
   * being pretended into a preview.
   */
  async function previewProjectFile(fileId, mime, name) {
    const root = $('#master-result');
    if (!root) return;
    const type = String(mime || '');
    try {
      if (type.startsWith('image/')) {
        root.hidden = false;
        root.innerHTML = '';
        renderImagePreview(root, { url: `/api/files/${encodeURIComponent(fileId)}`, filename: name });
        canvasSetState('ok', 'image');
      } else if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml') {
        const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
          headers: state.accessToken ? { authorization: `Bearer ${state.accessToken}` } : {},
        });
        if (!response.ok) throw new Error(`preview failed (${response.status})`);
        const text = await response.text();
        root.hidden = false;
        root.innerHTML = '';
        if (isFullHtmlDocument(text)) {
          renderWebsitePreview(root, text, { version: 1, title: name });
          canvasSetState('ok', 'html file');
        } else {
          renderDocumentPreview(root, { title: name, content: text });
          canvasSetState('ok', 'document');
        }
      } else {
        toast(`No in-canvas preview for ${type || 'this file type'} — use Download`, 'info');
        await authedDownload(`/api/files/${encodeURIComponent(fileId)}`, name || 'akbaral-file');
        return;
      }
      const empty = $('#master-preview-empty');
      if (empty) empty.hidden = true;
      renderFileExportBar(fileId, name || 'file', $('#master-project')?.value || null);
      masterPaneSet('workspace');
    } catch (e) { toast(e.message, 'err'); }
  }

  /** Wire the workspace shell: pane switch, chat drawers, file refresh. */
  function bindMasterWorkspaceShell() {
    if (!$('#master-layout')) return;
    $$('[data-pane-tab]').forEach((tab) => tab.addEventListener('click', () => masterPaneSet(tab.dataset.paneTab)));
    $$('[data-chat-drawer]').forEach((button) => button.addEventListener('click', () => {
      const drawer = $(`#master-drawer-${button.dataset.chatDrawer}`);
      if (!drawer) return;
      const open = drawer.hidden;
      drawer.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      chatScrollToEnd();
    }));
    $('#master-files-refresh')?.addEventListener('click', () => void loadMasterWorkspace());
    window.addEventListener('resize', () => { if (!masterPaneIsNarrow()) masterPaneSet('workspace'); });
  }

  /** Sidebar + chat drawer — the user's real recent tasks (click → real result). */
  async function loadMasterTaskHistory() {
    const hosts = [$('#master-task-history'), $('#master-task-history-drawer')].filter(Boolean);
    if (!hosts.length) return;
    const body = await api('/api/tasks').catch(() => ({ tasks: [] }));
    const tasks = (body.tasks || []).slice(0, 12);
    for (const root of hosts) {
      if (!tasks.length) {
        root.innerHTML = '<div class="list-item"><small>No tasks yet — run your first goal.</small></div>';
        continue;
      }
      root.innerHTML = tasks.map((t) => `
      <button type="button" class="list-item list-item-btn" data-task="${esc(t.id)}">
        <div><b>${esc(String(t.title || t.goal || t.id).slice(0, 60))}</b><small>${esc(String(t.status || ''))}</small></div>
        ${badge(t.status)}
      </button>`).join('');
      $$('[data-task]', root).forEach((btn) => btn.addEventListener('click', () => {
        // Opening a past run restores its REAL stored result (and reveals it).
        void loadMasterTaskResult(btn.dataset.task);
        shellRailOpen('preview');
      }));
    }
  }

  /** Re-open a past task's real result on the MASTER canvas. */
  async function loadMasterTaskResult(taskId) {
    try {
      const body = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
      const task = body.task || {};
      let parsed = null;
      if (task.output_data) { try { parsed = JSON.parse(task.output_data); } catch { parsed = null; } }
      $('#master-output').textContent = `Task ${taskId} — ${task.status || ''}`;
      if (task.status === 'completed') {
        const payload = parsed && typeof parsed === 'object' ? parsed : (parsed ?? String(task.output_data || ''));
        renderMasterResult(true, payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { content: String(task.output_data || '') });
      } else {
        renderMasterResult(false, { message: task.error_message || `Task ${task.status}` });
      }
      const projectId = task.project_id || $('#master-project')?.value || null;
      if (projectId) await renderProjectArtifactBar(projectId);
    } catch (e) { toast(e.message, 'err'); }
  }

  /** RIGHT pane — project controls (real project state + actions). */
  async function renderMasterProjectControls(projectId) {
    const root = $('#master-project-controls');
    if (!root) return;
    if (!projectId) {
      root.innerHTML = '<p class="sub">No project selected — results still run, but websites, files and versions need a project.</p>';
      return;
    }
    const body = await api(`/api/projects/${encodeURIComponent(projectId)}`).catch(() => null);
    const project = body?.project;
    if (!project) {
      root.innerHTML = '<p class="sub">Project unavailable.</p>';
      return;
    }
    root.innerHTML = `
      <div class="pc-row"><span>Project</span><b>${esc(project.name)}</b></div>
      <div class="pc-row"><span>Status</span><b>${esc(String(project.status || 'active'))}</b></div>
      <a class="btn btn-outline btn-sm" href="#/projects">Open projects ↗</a>`;
  }

  /**
   * LEFT pane (file area) — the real project files with their real actions:
   * render in the canvas, download the stored bytes, and (for images /
   * documents / HTML) preview without leaving the workspace.
   */
  /**
   * Files panel — everything a project really holds: the files the user
   * uploaded AND the deliverables AKBARAL! generated (versioned artifacts).
   * Every row carries its own real actions; binary/unknown types download
   * instead of being pretended into a preview.
   */
  async function loadMasterFiles(projectId) {
    const root = $('#master-files');
    if (!root) return;
    if (!projectId) {
      root.innerHTML = '<div class="list-item"><small>Select a project to see its files and generated artifacts.</small></div>';
      return;
    }
    const kinds = ['website', 'image', 'document', 'data'];
    const [body, ...artifacts] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}`).catch(() => null),
      ...kinds.map((kind) => api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${kind}`).catch(() => null)),
    ]);
    const files = (body?.files || []).slice(0, 20);
    const generated = artifacts
      .map((payload, index) => (payload?.artifact ? { kind: kinds[index], artifact: payload.artifact } : null))
      .filter(Boolean);
    const fileRows = files.length
      ? files.map((f) => `
      <div class="list-item file-item" data-file="${esc(f.id)}" data-mime="${esc(String(f.mime_type || ''))}" data-name="${esc(String(f.original_name || f.id))}">
        <div><b>${esc(String(f.original_name || f.id))}</b><small>uploaded · ${esc(String(f.mime_type || 'file'))}</small></div>
        <div class="file-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-preview="${esc(f.id)}" title="Render this file in the canvas">Canvas</button>
          <button type="button" class="btn btn-ghost btn-sm" data-download="${esc(f.id)}" data-name="${esc(String(f.original_name || 'file'))}">Download</button>
        </div>
      </div>`).join('')
      : '<div class="list-item"><small>No uploaded files yet — attach files to a MASTER goal or upload above.</small></div>';
    const artifactRows = generated.length
      ? generated.map((entry) => `
      <div class="list-item file-item" data-artifact-kind="${esc(entry.kind)}" data-artifact-version="${esc(String(entry.artifact.version))}">
        <div><b>${esc(String(entry.artifact.title || entry.kind))}</b><small>generated · ${esc(entry.kind)} v${esc(String(entry.artifact.version))}</small></div>
        <div class="file-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-artifact-open="${esc(entry.kind)}" data-version="${esc(String(entry.artifact.version))}" title="Render this version in the canvas">Canvas</button>
          <button type="button" class="btn btn-ghost btn-sm" data-artifact-download="${esc(entry.kind)}" data-name="${esc(String(entry.artifact.title || entry.kind))}">Download</button>
        </div>
      </div>`).join('')
      : '<div class="list-item"><small>No generated artifacts yet — run a goal with this project selected.</small></div>';
    root.innerHTML = `
      <div class="ak-section-head"><span>Uploaded</span><span>${files.length}</span></div>
      ${fileRows}
      <div class="ak-section-head" style="margin-top:6px"><span>Generated</span><span>${generated.length}</span></div>
      ${artifactRows}`;
    $$('[data-download]', root).forEach((btn) => btn.addEventListener('click', () => authedDownload(`/api/files/${btn.dataset.download}`, btn.dataset.name)));
    $$('[data-preview]', root).forEach((btn) => btn.addEventListener('click', () => {
      const item = btn.closest('.file-item');
      void previewProjectFile(btn.dataset.preview, item?.dataset.mime || '', item?.dataset.name || 'file');
    }));
    $$('[data-artifact-open]', root).forEach((btn) => btn.addEventListener('click', () => {
      void previewProjectArtifact(projectId, btn.dataset.artifactOpen, btn.dataset.version);
    }));
    $$('[data-artifact-download]', root).forEach((btn) => btn.addEventListener('click', () => {
      const kind = btn.dataset.artifactDownload;
      void authedDownload(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(kind)}/download`, btn.dataset.name || `akbaral-${kind}`);
    }));
  }

  /** Download an auth-protected file with the real bearer token. */
  async function authedDownload(path, filename) {
    try {
      const response = await fetch(path, { headers: state.accessToken ? { authorization: `Bearer ${state.accessToken}` } : {} });
      if (!response.ok) throw new Error(`download failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || 'akbaral-file';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast(e.message, 'err'); }
  }

  /** Attachments tray: real uploads into the selected project. */
  function updateAttachmentHint() {
    const hint = $('#master-attachment-hint');
    if (!hint) return;
    const projectId = $('#master-project')?.value || null;
    hint.textContent = projectId
      ? `Files upload into the selected project and travel with your next goal (${state.masterAttachments.length} attached).`
      : 'Select a project to attach files.';
  }

  function renderMasterAttachments() {
    const root = $('#master-attachments');
    if (!root) return;
    root.innerHTML = state.masterAttachments.map((a) => `
      <div class="list-item attach-item">
        <div><b>${esc(a.name)}</b><small>attached</small></div>
        <button type="button" class="btn btn-ghost btn-sm" data-detach="${esc(a.id)}">Remove</button>
      </div>`).join('');
    $$('[data-detach]', root).forEach((btn) => btn.addEventListener('click', () => {
      state.masterAttachments = state.masterAttachments.filter((a) => a.id !== btn.dataset.detach);
      renderMasterAttachments();
      updateAttachmentHint();
    }));
    // The composer shows the real attachment count (never a decorative chip).
    const count = $('#master-attach-count');
    if (count) {
      const total = state.masterAttachments.length;
      count.hidden = total === 0;
      count.textContent = `${total} attached`;
    }
    updateAttachmentHint();
  }

  async function handleMasterAttachments(input) {
    const files = Array.from(input.files || []);
    const projectId = $('#master-project')?.value || null;
    if (!files.length) return;
    if (!projectId) { toast('Select a project first — attachments upload into the project', 'err'); input.value = ''; return; }
    for (const file of files.slice(0, 5)) {
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
          method: 'POST',
          headers: state.accessToken ? { authorization: `Bearer ${state.accessToken}` } : {},
          body: form,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error?.message || `upload failed (${response.status})`);
        const fileId = body?.file?.fileId || body?.file?.id;
        if (!fileId) throw new Error('upload succeeded but no file id returned');
        state.masterAttachments.push({ id: fileId, name: file.name });
      } catch (e) { toast(`${file.name}: ${e.message}`, 'err'); }
    }
    input.value = '';
    renderMasterAttachments();
  }

  /** Voice input (Build #4 §1): the browser's real SpeechRecognition when
   *  available; hidden entirely when the browser does not support it. */
  function bindVoiceInput() {
    const button = $('#master-voice');
    const note = $('#master-voice-note');
    if (!button) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return; // stays hidden — no fake control
    button.hidden = false;
    let listening = false;
    button.addEventListener('click', () => {
      if (listening) return;
      const recognition = new Ctor();
      recognition.lang = document.documentElement?.lang || 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      listening = true;
      button.classList.add('active');
      if (note) { note.hidden = false; note.textContent = 'Listening… speak now'; }
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results || []).map((r) => String(r[0]?.transcript || '')).join(' ').trim();
        if (transcript) {
          const area = $('#master-goal');
          area.value = `${area.value ? `${area.value.trim()} ` : ''}${transcript}`;
        }
      };
      recognition.onerror = () => { if (note) note.textContent = 'Voice input unavailable right now'; };
      recognition.onend = () => {
        listening = false;
        button.classList.remove('active');
        if (note) { note.hidden = true; }
      };
      try { recognition.start(); } catch { listening = false; button.classList.remove('active'); }
    });
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
    const root = $('#project-workspace');
    root.innerHTML = '<div class="list-item"><small>Loading project…</small></div>';
    const body = await api(`/api/projects/${projectId}`).catch((e) => ({ __error: e.message }));
    if (body.__error) {
      root.innerHTML = `<div class="state-card state-error"><h4>Could not load project</h4><p>${esc(body.__error)}</p></div>`;
      return;
    }
    const files = body.files || [];
    const tasks = body.tasks || [];
    const workflows = body.workflows || [];
    const recentTasks = tasks.slice(0, 6).map((t) => `
      <a class="list-item list-item-link" href="#/tasks/${esc(t.id)}">
        <div><b>${esc(t.title || t.goal || t.id)}</b><small>${esc(t.status || '')}</small></div>
        <span>${badge(t.status)}</span>
      </a>`).join('');
    root.innerHTML = `<h3>${esc(name || 'Project')}</h3>
      <div class="stat-grid">
        <div class="stat"><span>Files</span><b>${files.length}</b></div>
        <div class="stat"><span>Tasks</span><b>${tasks.length}</b></div>
        <div class="stat"><span>Workflows</span><b>${workflows.length}</b></div>
      </div>
      ${recentTasks ? `<p class="section-label">Recent tasks</p><div class="list">${recentTasks}</div>` : '<div class="empty-state">No tasks in this project yet. Run a MASTER goal with this project selected.</div>'}`;
  }

  async function searchKnowledge(event) {
    event.preventDefault();
    const query = event.target.querySelector('input').value.trim();
    if (!query) return;
    const root = $('#knowledge-results');
    root.innerHTML = '<div class="list-item"><small>Searching…</small></div>';
    let body;
    try {
      body = await api('/api/files/knowledge/search', { method: 'POST', body: JSON.stringify({ query }) });
    } catch (e) {
      // Search itself failed (never pretend it succeeded with zero results).
      root.innerHTML = `<div class="state-card state-error"><h4>Knowledge search failed</h4><p>${esc(e.message)}</p></div>`;
      toast(e.message, 'err');
      return;
    }
    const results = body.results || [];
    const indexed = Number(body.knowledgeItems ?? 0);
    if (results.length) {
      root.innerHTML = results.map((r) => `<div class="list-item"><div><b>${esc(r.title || r.source_type || 'result')}</b><small>${esc(String(r.content || '').slice(0, 120))}…</small></div>${badge(r.source_type)}</div>`).join('');
      return;
    }
    // Honest distinction: an empty knowledge base is not a failed search.
    // Informational SECONDARY state, scoped to this tool panel only — this
    // is never a task result and never replaces task output anywhere.
    root.innerHTML = indexed === 0
      ? '<div class="empty-state">No documents indexed yet. This panel only searches your own indexed knowledge — upload a file in a project to make it searchable. Task results are shown on the MASTER screen and in Task Center.</div>'
      : `<div class="empty-state">No matches for “${esc(query)}” across ${indexed} indexed item${indexed === 1 ? '' : 's'}. Try broader terms.</div>`;
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

  // ── Private economy (owner console) ──────────────────────────────
  async function loadEconomy() {
    const [dashboard, today] = await Promise.all([
      api('/api/economy/dashboard'),
      api('/api/economy/report/today'),
    ]);
    void renderProviderSetupDiagnostics();
    const t = dashboard.treasury || {};
    const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
    $('#economy-stats').innerHTML = [
      ['Realized revenue', money(t.realizedRevenueCents), 'only RECEIVED counts'],
      ['Net profit', money(t.netProfitCents), ''],
      ['Expenses', money(t.totalExpensesCents), `reserved ${money(t.reservedCents)}`],
      ['Agents', String(dashboard.agents.economyAgentCount), `${dashboard.agents.activeAgents} active`],
      ['Opportunities', String(dashboard.opportunities.current), `${dashboard.opportunities.completed} completed / ${dashboard.opportunities.failed} failed`],
      ['Blocked (policy)', String(dashboard.opportunities.blocked), ''],
    ].map(([label, value, note]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><small>${esc(note)}</small></div>`).join('');
    const w = dashboard.revenueWindows || { todayCents: 0, last7DaysCents: 0, last30DaysCents: 0, lifetimeCents: 0 };
    $('#economy-windows').innerHTML = [
      ['Revenue today', money(w.todayCents), 'realized only (received/settled)'],
      ['Revenue 7 days', money(w.last7DaysCents), ''],
      ['Revenue 30 days', money(w.last30DaysCents), ''],
      ['Revenue lifetime', money(w.lifetimeCents), ''],
      ['Pending (not income)', money((dashboard.revenueStates || {}).pendingCents), 'awaiting evidence'],
      ['Expected (estimate)', money((dashboard.revenueStates || {}).expectedCents), 'never counted as income'],
    ].map(([label, value, note]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><small>${esc(note)}</small></div>`).join('');
    const p = dashboard.platform || {};
    const costMix = Object.entries(p.costsByCategoryCents || {});
    $('#economy-platform').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">Registry agents</span><strong class="stat-value">${Number(p.registryTotal ?? 0).toLocaleString()}</strong><small>${Number(p.registryActive ?? 0).toLocaleString()} active · ${Number(p.registryInactive ?? 0).toLocaleString()} inactive</small></div>
        <div class="stat"><span class="stat-label">Tasks (lifetime)</span><strong class="stat-value">${Number(p.tasksTotal ?? 0).toLocaleString()}</strong><small>${Number(p.tasksCompleted ?? 0).toLocaleString()} completed · ${Number(p.tasksFailed ?? 0).toLocaleString()} failed · ${Number(p.tasksActive ?? 0).toLocaleString()} active</small></div>
        <div class="stat"><span class="stat-label">Settlements</span><strong class="stat-value">${money(p.settlementsTotalCents)}</strong><small>ledger total</small></div>
      </div>
      ${costMix.length ? `<table class="econ-table"><thead><tr><th>Cost category</th><th>Total</th></tr></thead><tbody>${costMix.map(([category, cents]) => `<tr><td>${esc(String(category).replace(/_/g, ' '))}</td><td>${money(cents)}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">No costs recorded yet — $0 honestly.</p>'}`;
    loadMissionChat().catch(() => {});
    loadWorkforceOverview().catch(() => {});
    loadEconomyCommands().catch(() => {});
    $('#economy-today').innerHTML = today.chronology.length
      ? `<ol class="econ-chronology">${today.chronology.map((e) => `<li><small>${esc(new Date(e.ts).toLocaleTimeString())} · ${esc(e.kind)} · ${esc(e.actor)}</small><div>${esc(e.summary)}</div></li>`).join('')}</ol>`
      : '<p class="sub">No autonomous activity recorded today.</p>';
    const opps = dashboard.opportunities.recent || [];
    $('#economy-opportunities').innerHTML = opps.length
      ? `<table class="econ-table"><thead><tr><th>Opportunity</th><th>Status</th><th>Expected net</th><th>ROI</th></tr></thead><tbody>${opps.map((o) => `<tr><td>${esc(o.title.slice(0, 90))}</td><td>${badge(o.status)}</td><td>${money(o.expectedNetCents)}</td><td>${o.roi === null ? '—' : Number(o.roi).toFixed(2)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="sub">No opportunities yet. Discovery runs when enabled and a search provider is configured.</p>';
    const accounts = await api('/api/economy/accounts').catch(() => ({ accounts: [] }));
    $('#economy-accounts').innerHTML = (accounts.accounts || []).length
      ? `<table class="econ-table"><thead><tr><th>Agent</th><th>Revenue</th><th>Costs</th><th>Transferred</th><th>Available</th></tr></thead><tbody>${(accounts.accounts).map((a) => `<tr><td>${esc(a.agentSlug)}</td><td>${money(a.realizedRevenueCents)}</td><td>${money(a.costCents)}</td><td>${money(a.transferredOutCents)}</td><td>${money(a.availableCents)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="sub">No agent accounts with activity yet — balances are derived from the real ledger only.</p>';
    const transfers = await api('/api/economy/transfers').catch(() => ({ transfers: [] }));
    $('#economy-transfers').innerHTML = (transfers.transfers || []).length
      ? `<table class="econ-table"><thead><tr><th>When</th><th>Agent</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${(transfers.transfers).map((t) => `<tr><td><small>${esc(new Date(t.created_at).toLocaleString())}</small></td><td>${esc(t.source_agent_slug)}</td><td>${money(t.amount_cents)}</td><td>${badge(t.status)}</td><td>${t.status === 'proposed' ? `<button class="btn btn-sm" data-approve-transfer="${esc(t.id)}">Approve</button> <button class="btn btn-sm" data-reject-transfer="${esc(t.id)}">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="sub">No treasury transfers proposed yet.</p>';
    const ledger = await api('/api/economy/ledger?limit=15');
    $('#economy-ledger').innerHTML = (ledger.ledger || []).length
      ? `<table class="econ-table"><thead><tr><th>When</th><th>Category</th><th>Amount</th><th>Purpose</th></tr></thead><tbody>${ledger.ledger.map((row) => `<tr><td><small>${esc(new Date(row.ts).toLocaleString())}</small></td><td>${esc(row.category)} ${row.direction === 'credit' ? '↑' : '↓'}</td><td>${money(row.amount_cents)}</td><td>${esc(String(row.purpose || '').slice(0, 80))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="sub">No treasury movements yet.</p>';
    const events = await api('/api/economy/events?limit=25');
    $('#economy-events').innerHTML = (events.events || []).length
      ? `<ul class="econ-events">${events.events.map((e) => `<li><small>${esc(new Date(e.ts).toLocaleString())} · ${esc(e.kind)}</small><div>${esc(e.summary)}</div></li>`).join('')}</ul>`
      : '<p class="sub">No events yet.</p>';
    $('#econ-autonomous').checked = Boolean(dashboard.policy.autonomousEnabled);
    $('#econ-discovery').checked = Boolean(dashboard.policy.discoveryEnabled);
    const kill = document.querySelector('#econ-kill');
    kill.textContent = dashboard.policy.killSwitch ? 'Release kill switch' : 'Engage kill switch';
    kill.classList.toggle('btn-danger', !dashboard.policy.killSwitch);
    $('#econ-policy-note').textContent = `Daily spend cap $${(dashboard.policy.maxDailySpendCents / 100).toFixed(2)} · min expected net ${dashboard.policy.minExpectedNetCents}c · min ROI ${dashboard.policy.minRoi} · concurrency ${dashboard.policy.maxConcurrentExecutions} · agent cap ${dashboard.policy.maxEconomyAgents}. ${dashboard.honesty.note}`;
    ensureTableScroll();
  }

  // ── Workforce overview + agent inspector + command console (2026-09-19) ──
  // Every figure rendered here comes from a live API response over the real
  // database; nothing on this console is seeded, estimated or illustrative.
  async function loadWorkforceOverview() {
    const root = $('#economy-workforce');
    if (!root) return;
    const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
    try {
      const { overview } = await api('/api/economy/workforce-overview');
      const f = overview.finance || {};
      const w = overview.work || {};
      root.innerHTML = [
        ['Agents (active/total)', `${overview.activeAgents} / ${overview.economyAgentCount}`, `${overview.primaryCoveragePct}% primary coverage`],
        ['Primary assignments', String(overview.primaryAssignments ?? 0), `${overview.coveredAgents ?? 0} agents covered`],
        ['Fleet revenue', money(f.fleetRevenueCents), 'realized only'],
        ['Fleet available', money(f.fleetAvailableCents), 'spendable by policy'],
        ['Open commands', String(w.openCommands ?? 0), 'issued+acknowledged+executing'],
        ['Unverified completions', String(w.unverifiedCompletions ?? 0), 'never paid without verification'],
      ].map(([label, value, note]) => `<div class="stat"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><small>${esc(note)}</small></div>`).join('');
      const prim = await api('/api/workforce/primaries?limit=10').catch(() => ({ primaries: [] }));
      const list = $('#economy-primaries');
      if (list) {
        list.innerHTML = (prim.primaries || []).length
          ? `<table class="econ-table"><thead><tr><th>Agent</th><th>Primary platform</th><th>Status</th></tr></thead><tbody>${prim.primaries.map((p) => `<tr><td>${esc(p.agent_slug)}</td><td>${esc(p.platform_name || p.platform_id)}</td><td>${p.account_bound_at ? 'bound' : 'assigned'}</td></tr>`).join('')}</tbody></table>`
          : '<p class="sub">No primary assignments yet — agents share the verified pool until 1:1 coverage grows.</p>';
      }
    } catch (e) { root.innerHTML = `<p class="sub">Workforce overview unavailable: ${esc(e.message)}</p>`; }
  }

  async function loadAgentInspector() {
    const root = $('#economy-agent');
    if (!root) return;
    const slug = ($('#agent-inspector-slug')?.value || '').trim();
    const money = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
    if (!slug) { root.innerHTML = '<p class="sub">Enter an agent slug to inspect its finance, work, verification and blockers.</p>'; return; }
    try {
      const { report } = await api(`/api/economy/agents/${encodeURIComponent(slug)}/report`);
      const fin = report.finance || {};
      const cmds = (report.recentCommands || []).map((c) => `<li><small>${esc(c.id)} · ${esc(c.status)} · verification ${esc(c.verification)}</small><div>${esc(String(c.instruction).slice(0, 120))}</div></li>`).join('');
      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><span class="stat-label">Revenue (realized)</span><strong class="stat-value">${money(fin.realizedRevenueCents)}</strong><small>spent ${money(fin.costCents)} · available ${money(fin.availableCents)}</small></div>
          <div class="stat"><span class="stat-label">Primary</span><strong class="stat-value">${report.primary ? esc(report.primary.platform_name || report.primary.platform_id) : 'none'}</strong><small>${report.primary?.account_bound_at ? 'account bound' : '1:1 coverage pending'}</small></div>
          <div class="stat"><span class="stat-label">Quota</span><strong class="stat-value">${money(report.quota?.remainingCents ?? 0)} left</strong><small>of ${money(report.quota?.dailyCapCents ?? 0)} daily</small></div>
          <div class="stat"><span class="stat-label">Blockers</span><strong class="stat-value">${(report.blockers || []).length}</strong><small>${(report.blockers || []).map((b) => esc(b.reason)).join(' · ') || 'none'}</small></div>
        </div>
        ${cmds ? `<ul class="econ-events">${cmds}</ul>` : '<p class="sub">No commands issued to this agent yet.</p>'}`;
    } catch (e) { root.innerHTML = `<p class="sub">Agent report unavailable: ${esc(e.message)}</p>`; }
  }

  async function loadEconomyCommands() {
    const root = $('#economy-commands');
    if (!root) return;
    try {
      const { commands } = await api('/api/economy/commands?limit=10');
      root.innerHTML = (commands || []).length
        ? `<table class="econ-table"><thead><tr><th>Command</th><th>Agent</th><th>Status</th><th>Verification</th><th>Chat</th></tr></thead><tbody>${commands.map((c) => `<tr><td><small>${esc(c.id)}</small></td><td>${esc(c.agent_slug)}</td><td>${badge(c.status)}</td><td>${esc(c.verification)}</td><td>${c.chat_thread_id ? `<small>${esc(c.chat_thread_id.slice(0, 18))}…</small>` : '—'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="sub">No commands issued yet.</p>';
    } catch (e) { root.innerHTML = `<p class="sub">Commands unavailable: ${esc(e.message)}</p>`; }
  }

  async function sendEconomyCommand() {
    const slug = ($('#command-slug')?.value || '').trim();
    const instruction = ($('#command-text')?.value || '').trim();
    if (!slug || !instruction) { toast('Agent slug and instruction are required', 'err'); return; }
    try {
      const result = await api('/api/economy/commands', { method: 'POST', body: JSON.stringify({ agent_slug: slug, instruction, idempotency_key: `ui-${Date.now()}-${slug}` }) });
      toast(result.idempotentReplay ? 'Existing command returned (idempotent replay)' : `Command ${result.command.id} issued — chat thread linked`, 'ok');
      const root = $('#economy-command');
      if (root) root.innerHTML = `<p class="sub">Latest: ${esc(result.command.id)} → ${esc(slug)} · ${esc(result.command.status)} · verification ${esc(result.command.verification)}</p>`;
      await loadEconomyCommands();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function loadMissionChat() {
    const root = $('#mission-history');
    if (!root) return;
    const agent = ($('#mission-agent')?.value || '').trim();
    if (!agent) {
      const threads = await api('/api/economy/chat/threads');
      root.innerHTML = (threads.threads || []).length
        ? `<p class="sub">Existing threads: ${(threads.threads).map((t) => `<button class="btn btn-sm" data-thread="${esc(t.agentSlug)}" type="button">${esc(t.agentSlug)} · ${t.messageCount} msg</button>`).join(' ')}</p>`
        : '<p class="sub">Enter an agent slug (e.g. web-research-001) to start a private mission chat. Every message is audited.</p>';
      return;
    }
    const history = await api(`/api/economy/agents/${encodeURIComponent(agent)}/chat`);
    root.innerHTML = (history.messages || []).length
      ? `<div class="econ-chronology">${(history.messages).map((m) => `<div class="list-item"><div><b>${m.direction === 'owner' ? 'You' : esc(history.agent.name)}</b>${m.status === 'failed' ? ' <span class="badge badge-failed">failed</span>' : ''}<small>${esc(new Date(m.created_at).toLocaleString())}${m.model_key ? ' · ' + esc(m.model_key) : ''}</small><div>${esc(m.content)}</div></div></div>`).join('')}</div>`
      : '<p class="sub">No messages yet with this agent.</p>';
  }

  function bindEconomy() {
    $('#econ-autonomous').addEventListener('change', async (event) => {
      try { await api('/api/economy/policy', { method: 'PATCH', body: JSON.stringify({ autonomous_enabled: event.target.checked }) }); toast(`Autonomous operation ${event.target.checked ? 'enabled' : 'disabled'}`, 'ok'); }
      catch (e) { toast(e.message, 'err'); event.target.checked = !event.target.checked; }
    });
    $('#econ-discovery').addEventListener('change', async (event) => {
      try { await api('/api/economy/policy', { method: 'PATCH', body: JSON.stringify({ discovery_enabled: event.target.checked }) }); toast(`Discovery ${event.target.checked ? 'enabled' : 'disabled'}`, 'ok'); }
      catch (e) { toast(e.message, 'err'); event.target.checked = !event.target.checked; }
    });
    $('#econ-kill').addEventListener('click', async () => {
      const engage = !$('#econ-kill').textContent.startsWith('Release');
      try { await api('/api/economy/kill-switch', { method: 'POST', body: JSON.stringify({ engage }) }); toast(engage ? 'Kill switch ENGAGED — autonomous work halts' : 'Kill switch released', 'ok'); await loadEconomy(); }
      catch (e) { toast(e.message, 'err'); }
    });
    $('#econ-tick').addEventListener('click', async () => {
      try { const r = await api('/api/economy/tick', { method: 'POST', body: JSON.stringify({}) }); toast(`Tick: ${(r.notes || []).join(' · ') || 'nothing to do'}`, 'ok'); await loadEconomy(); }
      catch (e) { toast(e.message, 'err'); }
    });
    $('#transfer-propose')?.addEventListener('click', async () => {
      const agent = ($('#transfer-agent')?.value || '').trim();
      const amount = Number($('#transfer-amount')?.value || 0);
      const reason = ($('#transfer-reason')?.value || '').trim();
      if (!agent || !Number.isFinite(amount) || amount <= 0 || !reason) { toast('Source agent, positive amount and reason are required', 'err'); return; }
      try {
        const result = await api('/api/economy/transfers', { method: 'POST', body: JSON.stringify({ source_agent_slug: agent, amount_cents: amount, reason, idempotency_key: `ui-${Date.now()}-${agent}` }) });
        toast(result.idempotentReplay ? 'Existing proposal returned (idempotent replay)' : 'Transfer proposed — owner approval required', 'ok');
        await loadEconomy();
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#economy-transfers')?.addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-approve-transfer]');
      const reject = event.target.closest('[data-reject-transfer]');
      const id = (approve ?? reject)?.getAttribute('data-approve-transfer') ?? (approve ?? reject)?.getAttribute('data-reject-transfer');
      if (!id) return;
      try {
        await api(`/api/economy/transfers/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({}) });
        toast(`Transfer ${approve ? 'approved (executed against real ledger balance)' : 'rejected'}`, 'ok');
        await loadEconomy();
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#agent-inspector-load')?.addEventListener('click', () => { loadAgentInspector().catch((e) => toast(e.message, 'err')); });
    $('#command-send')?.addEventListener('click', () => { sendEconomyCommand().catch((e) => toast(e.message, 'err')); });
    $('#mission-send')?.addEventListener('click', async () => {
      const agent = ($('#mission-agent')?.value || '').trim();
      const content = ($('#mission-input')?.value || '').trim();
      if (!agent || !content) { toast('Enter an agent slug and a message', 'err'); return; }
      const button = $('#mission-send');
      button.disabled = true;
      try {
        const result = await api(`/api/economy/agents/${encodeURIComponent(agent)}/chat`, { method: 'POST', body: JSON.stringify({ content }) });
        $('#mission-input').value = '';
        if (result.agentMessage && result.agentMessage.status === 'failed') toast('Agent reply failed honestly (no provider configured) — see the thread', 'err');
        await loadMissionChat();
      } catch (e) { toast(e.message, 'err'); }
      finally { button.disabled = false; }
    });
    $('#mission-agent')?.addEventListener('change', () => { loadMissionChat().catch(() => {}); });
    $('#mission-history')?.addEventListener('click', (event) => {
      const thread = event.target.closest('[data-thread]');
      if (!thread) return;
      $('#mission-agent').value = thread.getAttribute('data-thread');
      const p = dashboard.platform || {};
    const costMix = Object.entries(p.costsByCategoryCents || {});
    $('#economy-platform').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><span class="stat-label">Registry agents</span><strong class="stat-value">${Number(p.registryTotal ?? 0).toLocaleString()}</strong><small>${Number(p.registryActive ?? 0).toLocaleString()} active · ${Number(p.registryInactive ?? 0).toLocaleString()} inactive</small></div>
        <div class="stat"><span class="stat-label">Tasks (lifetime)</span><strong class="stat-value">${Number(p.tasksTotal ?? 0).toLocaleString()}</strong><small>${Number(p.tasksCompleted ?? 0).toLocaleString()} completed · ${Number(p.tasksFailed ?? 0).toLocaleString()} failed · ${Number(p.tasksActive ?? 0).toLocaleString()} active</small></div>
        <div class="stat"><span class="stat-label">Settlements</span><strong class="stat-value">${money(p.settlementsTotalCents)}</strong><small>ledger total</small></div>
      </div>
      ${costMix.length ? `<table class="econ-table"><thead><tr><th>Cost category</th><th>Total</th></tr></thead><tbody>${costMix.map(([category, cents]) => `<tr><td>${esc(String(category).replace(/_/g, ' '))}</td><td>${money(cents)}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">No costs recorded yet — $0 honestly.</p>'}`;
    loadMissionChat().catch(() => {});
    });
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

    await renderProviderSetupDiagnostics();
  }

  /**
   * Owner-only provider diagnostics. This is the surface that answers "why is
   * that button unavailable, and what exactly do I set?" — the public sign-in
   * screen deliberately never says any of it.
   */
  async function renderProviderSetupDiagnostics() {
    const roots = $$('[data-provider-setup]');
    if (!roots.length) return;
    let providers = [];
    try { providers = (await api('/api/auth/oauth/providers')).providers || []; } catch { providers = []; }
    const html = providers.length ? providers.map((p) => {
      const required = (p.required || []).join(' + ') || 'provider credentials';
      const redirectUri = `${location.origin}/api/auth/oauth/${encodeURIComponent(p.key)}/callback`;
      return p.configured
        ? `<div class="list-item"><div><b>${esc(p.label)}</b><small>Enabled — the sign-in button starts the real consent flow.</small><small>Redirect URI to register: ${esc(redirectUri)}</small></div>${badge('enabled')}</div>`
        : `<div class="list-item"><div><b>${esc(p.label)}</b><small>Not configured — set ${esc(required)} server-side.</small><small>Then register ${esc(redirectUri)} as the OAuth redirect URI in the ${esc(p.label)} app.</small></div>${badge('not configured')}</div>`;
    }).join('') : '<div class="list-item"><small>No providers are registered on this deployment.</small></div>';
    roots.forEach((root) => { root.innerHTML = html; });
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

  /* ============================================================
     Build #6 — THE APPLICATION SHELL (Task 4)

     The MASTER screen is the product surface: LEFT sidebar (search,
     library, images & media, projects, files, recent history, account),
     CENTER the MASTER conversation, RIGHT the artifact rail (Preview +
     Files / Library / Images).

     Every control here is wired to a real screen or a real API call —
     no placeholder navigation, no invented data. Layout preferences
     (sidebar collapsed, rail collapsed) are stored locally; nothing
     else is persisted client-side.
     ============================================================ */

  const SHELL_SIDEBAR_KEY = 'ak_shell_sidebar'; // 'open' | 'collapsed'
  const SHELL_RAIL_KEY = 'ak_shell_rail'; // 'open' | 'closed'
  const SHELL_RAIL_TABS = ['preview', 'files', 'library', 'media'];
  let shellRailCurrentTab = 'preview';

  function shellIsNarrow() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1080px)').matches;
  }

  function shellEl() {
    return $('#master-shell');
  }

  /** Apply the stored layout preferences + the live account state. */
  function shellSyncChrome() {
    const shell = shellEl();
    if (!shell) return;
    // Narrow viewports always start with the drawer closed and the
    // conversation in view — the sidebar never covers the content on load.
    shell.dataset.sidebar = shellIsNarrow()
      ? 'open'
      : (storageGet(SHELL_SIDEBAR_KEY) === 'collapsed' ? 'collapsed' : 'open');
    const railClosed = storageGet(SHELL_RAIL_KEY) === 'closed';
    shell.dataset.rail = railClosed ? 'closed' : 'open';
    const sideToggle = $('#master-sidebar-toggle');
    if (sideToggle) {
      sideToggle.setAttribute('aria-expanded', String(shell.dataset.sidebar !== 'collapsed'));
      sideToggle.title = shell.dataset.sidebar === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar';
    }
    const railToggle = $('#master-rail-toggle');
    if (railToggle) {
      railToggle.setAttribute('aria-expanded', String(!railClosed));
      railToggle.setAttribute('aria-current', railClosed ? 'false' : 'true');
    }
    const menuBtn = $('#master-menu-btn');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    const scrim = $('#master-sidebar-scrim');
    if (scrim) scrim.hidden = true;
    shellSyncAccount();
    shellMarkNav(null);
  }

  /** Sidebar preferences: open | collapsed on desktop, drawer on phones. */
  function shellSidebarSet(mode) {
    const shell = shellEl();
    if (!shell) return;
    const scrim = $('#master-sidebar-scrim');
    const menuBtn = $('#master-menu-btn');
    if (mode === 'drawer') {
      shell.dataset.sidebar = 'drawer';
      if (scrim) scrim.hidden = false;
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
      return;
    }
    if (shellIsNarrow()) {
      // On a phone the sidebar is either open (as a drawer) or closed.
      shell.dataset.sidebar = mode === 'drawer' ? 'drawer' : 'open';
      if (scrim) scrim.hidden = true;
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    const next = mode === 'collapsed' ? 'collapsed' : 'open';
    shell.dataset.sidebar = next;
    storageSet(SHELL_SIDEBAR_KEY, next);
    if (scrim) scrim.hidden = true;
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    const sideToggle = $('#master-sidebar-toggle');
    if (sideToggle) {
      sideToggle.setAttribute('aria-expanded', String(next !== 'collapsed'));
      sideToggle.title = next === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar';
    }
  }

  function shellSidebarToggle() {
    const shell = shellEl();
    if (!shell) return;
    if (shellIsNarrow()) { shellSidebarSet('open'); return; }
    shellSidebarSet(shell.dataset.sidebar === 'collapsed' ? 'open' : 'collapsed');
  }

  /** The artifact rail: preview + the files/library/images panels. */
  function shellRailSet(open) {
    const shell = shellEl();
    if (!shell) return;
    shell.dataset.rail = open ? 'open' : 'closed';
    storageSet(SHELL_RAIL_KEY, open ? 'open' : 'closed');
    const toggle = $('#master-rail-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-current', open ? 'true' : 'false');
    }
    if (!open && shellIsNarrow()) masterPaneSet('chat');
  }

  function shellRailTabSet(name) {
    const tab = SHELL_RAIL_TABS.includes(name) ? name : 'preview';
    shellRailCurrentTab = tab;
    $$('[data-rail-tab]').forEach((button) => {
      const active = button.dataset.railTab === tab;
      button.setAttribute('aria-selected', String(active));
      button.classList.toggle('active', active);
    });
    $$('[data-rail-pane]').forEach((pane) => { pane.hidden = pane.dataset.railPane !== tab; });
    if (tab === 'library') void shellLoadLibrary();
    else if (tab === 'media') void shellLoadMedia();
    else if (tab === 'files') void loadMasterFiles($('#master-project')?.value || null);
    shellMarkNav(tab === 'preview' ? null : tab);
  }

  /** Open the rail (optionally on a specific panel) and reveal it. */
  function shellRailOpen(tab) {
    shellRailSet(true);
    shellRailTabSet(tab || shellRailCurrentTab);
    if (shellIsNarrow()) masterPaneSet('workspace');
    chatScrollToEnd();
  }

  /** Mark the sidebar entry that matches the visible surface. */
  function shellMarkNav(tab) {
    const map = { library: 'library', media: 'media', files: 'files' };
    const current = map[tab] || null;
    $$('[data-ak-action]').forEach((item) => {
      const action = item.dataset.akAction;
      if (['search', 'library', 'media', 'projects', 'files', 'agents', 'automations', 'billing'].includes(action)) {
        item.setAttribute('aria-current', String(Boolean(current) && action === current));
      }
    });
  }

  /**
   * Sidebar navigation — each entry opens a real surface:
   * search (this screen's real search), library (task results), media
   * (real image files/artifacts), files (the project file panel),
   * projects/agents/automations/billing (the existing app screens).
   */
  function shellAction(action) {
    switch (action) {
      case 'search': shellSearchOpen(); break;
      case 'library': shellRailOpen('library'); break;
      case 'media': shellRailOpen('media'); break;
      case 'files': shellRailOpen('files'); break;
      case 'projects': location.hash = '#/projects'; break;
      case 'agents': location.hash = '#/agents'; break;
      case 'automations': location.hash = '#/automations'; break;
      case 'billing': location.hash = '#/billing'; break;
      default: break;
    }
  }

  /** Account block: real identity, role-gated owner entry, sign-out. */
  function shellSyncAccount() {
    const user = state.user;
    const label = user?.name || user?.email || 'Guest';
    const nameEl = $('#ak-user-name');
    if (nameEl) nameEl.textContent = label;
    const emailEl = $('#ak-user-email');
    if (emailEl) emailEl.textContent = user?.email || (state.accessToken ? 'signed in' : 'not signed in');
    const avatar = $('#ak-avatar');
    if (avatar) avatar.textContent = (String(label).trim()[0] || 'A').toUpperCase();
    const role = String(user?.role || '');
    const isOwner = role === 'owner' || role === 'super_admin';
    const ownerLink = $('#ak-owner-link');
    if (ownerLink) ownerLink.hidden = !isOwner;
    const privateLink = $('#ak-mission-link');
    if (privateLink) privateLink.hidden = !isOwner;
    const sub = $('#ak-top-sub');
    if (sub) sub.textContent = isOwner ? 'owner workspace · unlimited execution' : 'orchestration workspace';
  }

  /** Library panel — the account's real tasks; opening one restores its result. */
  async function shellLoadLibrary() {
    const root = $('#master-library');
    if (!root) return;
    root.innerHTML = '<div class="list-item"><small>Loading your runs…</small></div>';
    const body = await api('/api/tasks').catch((e) => ({ __error: e.message }));
    if (body.__error) {
      root.innerHTML = `<div class="state-card state-error"><h4>Library unavailable</h4><p>${esc(body.__error)}</p></div>`;
      return;
    }
    const tasks = body.tasks || [];
    if (!tasks.length) {
      root.innerHTML = '<div class="empty-state">No runs yet. Every MASTER goal you execute is kept here with its real result.</div>';
      return;
    }
    root.innerHTML = tasks.slice(0, 40).map((t) => `
      <div class="library-row">
        <div class="library-meta">
          <b>${esc(String(t.title || t.goal || t.id).slice(0, 96))}</b>
          <small>${esc(String(t.status || ''))}${t.created_at ? ` · ${esc(String(t.created_at).slice(0, 16).replace('T', ' '))}` : ''}</small>
        </div>
        <div class="file-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-library-open="${esc(t.id)}">Open</button>
          <a class="btn btn-ghost btn-sm" href="#/tasks/${esc(t.id)}">Details</a>
        </div>
      </div>`).join('');
    $$('[data-library-open]', root).forEach((btn) => btn.addEventListener('click', async () => {
      await loadMasterTaskResult(btn.dataset.libraryOpen);
      shellRailTabSet('preview');
      shellRailOpen('preview');
    }));
  }

  /**
   * Images & media panel — real image files and real image artifacts from
   * the selected project (or the most recent projects when none is chosen).
   * Nothing is invented: a project with no images states exactly that.
   */
  async function shellLoadMedia() {
    const root = $('#master-media');
    if (!root) return;
    const selected = $('#master-project')?.value || null;
    const ids = selected ? [selected] : (state.projects || []).slice(0, 6).map((p) => p.id);
    if (!ids.length) {
      root.innerHTML = '<div class="list-item"><small>No projects yet — create one and generated images are kept there.</small></div>';
      return;
    }
    root.innerHTML = '<div class="list-item"><small>Scanning your projects…</small></div>';
    const cards = [];
    await Promise.all(ids.map(async (projectId) => {
      const [detail, imageArtifact] = await Promise.all([
        api(`/api/projects/${encodeURIComponent(projectId)}`).catch(() => null),
        api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/image`).catch(() => null),
      ]);
      const projectName = detail?.project?.name || projectId;
      const files = (detail?.files || []).filter((f) => String(f.mime_type || '').startsWith('image/'));
      for (const f of files.slice(0, 12)) {
        cards.push({
          projectId,
          kind: 'file',
          id: f.id,
          name: f.original_name || f.id,
          meta: `${projectName} · ${String(f.mime_type || 'image')}`,
          url: `/api/files/${encodeURIComponent(f.id)}`,
        });
      }
      const artifact = imageArtifact?.artifact;
      if (artifact) {
        cards.push({
          projectId,
          kind: 'artifact',
          version: artifact.version,
          name: artifact.title || `image v${artifact.version}`,
          meta: `${projectName} · generated image v${artifact.version}`,
          content: String(artifact.content || ''),
        });
      }
    }));
    if (!cards.length) {
      root.innerHTML = '<div class="empty-state">No images yet in these projects. Ask MASTER for an image and it lands here with its real bytes.</div>';
      return;
    }
    root.innerHTML = cards.map((card, index) => `
      <div class="media-card">
        <div class="media-thumb" data-media-thumb="${index}">${card.kind === 'artifact' ? 'IMAGE' : 'FILE'}</div>
        <b title="${esc(card.name)}">${esc(card.name)}</b>
        <small>${esc(card.meta)}</small>
        <div class="file-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-media-open="${index}">Canvas</button>
          <button type="button" class="btn btn-ghost btn-sm" data-media-download="${index}">Download</button>
        </div>
      </div>`).join('');
    // Thumbnails use the real bytes (auth-fetched for files, inline data /
    // absolute URLs for generated artifacts) — never a placeholder image.
    cards.forEach((card, index) => {
      const thumb = root.querySelector(`[data-media-thumb="${index}"]`);
      if (!thumb) return;
      const source = card.kind === 'file' ? card.url : card.content;
      if (!/^(data:|https?:\/\/|\/)/i.test(source || '')) return;
      if (String(source).startsWith('/')) {
        fetch(source, { headers: state.accessToken ? { authorization: `Bearer ${state.accessToken}` } : {} })
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
          .then((blob) => { thumb.innerHTML = `<img alt="${esc(card.name)}" src="${URL.createObjectURL(blob)}" />`; })
          .catch(() => { /* the card keeps its honest type label */ });
      } else {
        thumb.innerHTML = `<img alt="${esc(card.name)}" src="${esc(source)}" />`;
      }
    });
    $$('[data-media-open]', root).forEach((btn) => btn.addEventListener('click', () => {
      const card = cards[Number(btn.dataset.mediaOpen)];
      if (!card) return;
      if (card.kind === 'file') void previewProjectFile(card.id, 'image/*', card.name);
      else void previewProjectArtifact(card.projectId, 'image', card.version);
    }));
    $$('[data-media-download]', root).forEach((btn) => btn.addEventListener('click', () => {
      const card = cards[Number(btn.dataset.mediaDownload)];
      if (!card) return;
      if (card.kind === 'file') void authedDownload(`/api/files/${encodeURIComponent(card.id)}`, card.name);
      else void authedDownload(`/api/projects/${encodeURIComponent(card.projectId)}/artifacts/image/download`, card.name);
    }));
  }

  /** Render any stored artifact version on the canvas (real content only). */
  async function previewProjectArtifact(projectId, kind, version) {
    const root = $('#master-result');
    if (!root) return;
    try {
      const body = await api(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(kind)}/v/${encodeURIComponent(String(version))}`);
      const artifact = body?.artifact;
      const content = String(artifact?.content || '');
      if (!content) throw new Error('That version has no content to render');
      root.hidden = false;
      root.innerHTML = '';
      const empty = $('#master-preview-empty');
      if (empty) empty.hidden = true;
      if (kind === 'website' || isFullHtmlDocument(content)) {
        renderWebsitePreview(root, content, { version, title: artifact.title });
        canvasSetState('ok', 'website');
      } else if (kind === 'image') {
        if (/^(data:|https?:\/\/|\/)/i.test(content)) {
          renderImagePreview(root, { url: content, filename: String(artifact.title || `image-v${version}`) });
          canvasSetState('ok', 'image');
        } else {
          renderDocumentPreview(root, { title: artifact.title, content });
          canvasSetState('ok', 'image reference');
        }
      } else {
        renderDocumentPreview(root, { title: artifact.title, content });
        canvasSetState('ok', kind === 'data' ? 'dataset' : 'document');
      }
      shellRailOpen('preview');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ----- Search: real tasks, real knowledge, real projects ----- */

  function shellSearchOpen() {
    const overlay = $('#master-search');
    if (!overlay) return;
    overlay.hidden = false;
    const input = $('#master-search-input');
    if (input) input.focus();
  }

  function shellSearchClose() {
    const overlay = $('#master-search');
    if (overlay) overlay.hidden = true;
  }

  async function shellSearchRun(query) {
    const root = $('#master-search-results');
    if (!root) return;
    const q = String(query || '').trim();
    if (!q) {
      root.innerHTML = '<div class="ak-command-group"><b>Type a query</b><div class="list-item"><small>Results come from your own tasks, indexed knowledge and projects.</small></div></div>';
      return;
    }
    root.innerHTML = '<div class="ak-command-group"><b>Searching</b><div class="list-item"><small>Querying your tasks, knowledge and projects…</small></div></div>';
    const [tasksBody, projectsBody, knowledgeBody] = await Promise.all([
      api('/api/tasks').catch(() => null),
      api('/api/projects').catch(() => null),
      api('/api/files/knowledge/search', { method: 'POST', body: JSON.stringify({ query: q }) }).catch((e) => ({ __error: e.message })),
    ]);
    const needle = q.toLowerCase();
    const tasks = ((tasksBody?.tasks) || []).filter((t) => `${t.title || ''} ${t.goal || ''} ${t.status || ''}`.toLowerCase().includes(needle)).slice(0, 8);
    const projects = ((projectsBody?.projects) || []).filter((p) => String(p.name || '').toLowerCase().includes(needle)).slice(0, 8);
    const knowledge = knowledgeBody?.results || [];
    const knowledgeIndexed = Number(knowledgeBody?.knowledgeItems ?? 0);
    const groups = [];
    if (tasks.length) {
      groups.push(`<div class="ak-command-group"><b>Tasks</b>${tasks.map((t) => `
        <button type="button" class="ak-command-item" data-search-task="${esc(t.id)}">
          <span>${esc(String(t.title || t.goal || t.id).slice(0, 80))}</span>
          <small>${esc(String(t.status || ''))}</small>
        </button>`).join('')}</div>`);
    }
    if (projects.length) {
      groups.push(`<div class="ak-command-group"><b>Projects</b>${projects.map((p) => `
        <button type="button" class="ak-command-item" data-search-project="${esc(p.id)}">
          <span>${esc(p.name || p.id)}</span>
          <small>${esc(String(p.status || 'active'))}</small>
        </button>`).join('')}</div>`);
    }
    if (knowledge.length) {
      groups.push(`<div class="ak-command-group"><b>Knowledge</b>${knowledge.slice(0, 8).map((r) => `
        <div class="ak-command-item"><span>${esc(String(r.title || r.source_type || 'result'))}</span><small>${esc(String(r.content || '').slice(0, 60))}</small></div>`).join('')}</div>`);
    }
    if (!groups.length) {
      const note = knowledgeBody?.__error
        ? `<div class="state-card state-error"><h4>Knowledge search failed</h4><p>${esc(knowledgeBody.__error)}</p></div>`
        : (knowledgeIndexed === 0
          ? '<div class="list-item"><small>No tasks or projects match, and no documents are indexed yet. Index a file in a project to make it searchable.</small></div>'
          : `<div class="list-item"><small>No matches for “${esc(q)}” across your tasks, projects or ${knowledgeIndexed} indexed item${knowledgeIndexed === 1 ? '' : 's'}.</small></div>`);
      root.innerHTML = `<div class="ak-command-group"><b>No results</b>${note}</div>`;
      return;
    }
    root.innerHTML = groups.join('');
    $$('[data-search-task]', root).forEach((btn) => btn.addEventListener('click', async () => {
      shellSearchClose();
      await loadMasterTaskResult(btn.dataset.searchTask);
      shellRailOpen('preview');
    }));
    $$('[data-search-project]', root).forEach((btn) => btn.addEventListener('click', () => {
      const select = $('#master-project');
      if (select) {
        select.value = btn.dataset.searchProject;
        void loadMasterWorkspace();
      }
      shellSearchClose();
      toast('Project selected — MASTER will run into it', 'ok');
    }));
  }

  /** Start a clean conversation (no state is invented — the log is cleared). */
  function masterNewChat() {
    const log = $('#master-chat-log');
    if (!log) return;
    $$('.chat-msg', log).forEach((node) => node.remove());
    const out = $('#master-output');
    if (out) out.innerHTML = '<div class="console-hint">New conversation. Describe a goal — MASTER plans, picks specialists and streams the run here.</div>';
    const goal = $('#master-goal');
    if (goal) { goal.value = ''; goal.focus(); }
    state.masterAttachments = [];
    renderMasterAttachments();
    clearMasterResult();
    setCoreState('idle', 'idle');
    if (shellIsNarrow()) masterPaneSet('chat');
    toast('New chat', 'ok');
  }

  /** Wire the whole shell: sidebar, rail, search, account, shortcuts. */
  function bindAppShell() {
    if (!$('#master-shell')) return;
    $('#master-sidebar-toggle')?.addEventListener('click', shellSidebarToggle);
    $('#master-menu-btn')?.addEventListener('click', () => {
      const shell = shellEl();
      shellSidebarSet(shell?.dataset.sidebar === 'drawer' ? 'open' : 'drawer');
    });
    $('#master-sidebar-scrim')?.addEventListener('click', () => shellSidebarSet('open'));
    $('#master-new-chat')?.addEventListener('click', masterNewChat);
    $('#master-history-refresh')?.addEventListener('click', () => void loadMasterTaskHistory());
    $('#master-rail-toggle')?.addEventListener('click', () => {
      const shell = shellEl();
      shellRailSet(shell?.dataset.rail === 'closed');
    });
    $('#ak-rail-close')?.addEventListener('click', () => shellRailSet(false));
    $$('[data-rail-tab]').forEach((tab) => tab.addEventListener('click', () => shellRailTabSet(tab.dataset.railTab)));
    $$('[data-ak-action]').forEach((item) => item.addEventListener('click', () => shellAction(item.dataset.akAction)));

    // Account menu: real entries, role-gated owner console, real sign-out.
    const menu = $('#ak-account-menu');
    const menuBtn = $('#ak-account-menu-btn');
    menuBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!menu) return;
      const open = menu.hidden;
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!menu || menu.hidden) return;
      if (event.target === menuBtn || menu?.contains(event.target)) return;
      menu.hidden = true;
      menuBtn?.setAttribute('aria-expanded', 'false');
    });
    $('#ak-logout')?.addEventListener('click', async () => {
      try {
        if (state.refreshToken) await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: state.refreshToken }) });
      } catch {}
      storageRemove('ak_access');
      storageRemove('ak_refresh');
      state.accessToken = null;
      state.refreshToken = null;
      state.user = null;
      if (menu) menu.hidden = true;
      shellSyncAccount();
      location.hash = '#/';
    });

    // Search overlay.
    const searchForm = $('#master-search-form');
    searchForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void shellSearchRun($('#master-search-input')?.value || '');
    });
    $('#master-search-close')?.addEventListener('click', shellSearchClose);
    $('#master-search')?.addEventListener('click', (event) => {
      if (event.target?.id === 'master-search') shellSearchClose();
    });

    // Composer ergonomics: Enter sends, Shift+Enter adds a line.
    $('#master-goal')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('#master-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    // Keyboard shortcuts: ⌘/Ctrl+K search, ⌘/Ctrl+B sidebar, Escape closes.
    document.addEventListener('keydown', (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); shellSearchOpen(); return; }
      if (meta && event.key.toLowerCase() === 'b') { event.preventDefault(); shellSidebarToggle(); return; }
      if (event.key === 'Escape') {
        if (!$('#master-search')?.hidden) { shellSearchClose(); return; }
        if (shellEl()?.dataset.sidebar === 'drawer') shellSidebarSet('open');
      }
    });

    // Rotating the device or resizing the window keeps the shell coherent.
    window.addEventListener('resize', () => {
      const shell = shellEl();
      if (!shell) return;
      if (!shellIsNarrow() && shell.dataset.sidebar === 'drawer') shell.dataset.sidebar = storageGet(SHELL_SIDEBAR_KEY) === 'collapsed' ? 'collapsed' : 'open';
      if (shellIsNarrow() && shell.dataset.sidebar === 'collapsed') shell.dataset.sidebar = 'open';
      const scrim = $('#master-sidebar-scrim');
      if (scrim && shell.dataset.sidebar !== 'drawer') scrim.hidden = true;
    });
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
   * Mutating the DOM at that point (footer year, credit
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
