/**
 * Mounts a REAL page component in jsdom at a given viewport width and returns
 * the delivered DOM.
 *
 * Why mount instead of reading `.next/server/app/<page>.html`: every
 * authenticated surface prerenders only the "Opening AKBARAL!" card, because
 * the account is resolved in an effect. Auditing that file proves nothing
 * about the signed-in layout. Here the component actually runs: effects fire,
 * `matchMedia` answers for the width under test, and the resulting DOM is the
 * one a signed-in person sees at that width.
 *
 * Network is stubbed with the shapes the real endpoints return. No fixture
 * HTML is written by hand — the markup always comes from the components.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

/** Endpoint stubs: the real response shapes, with empty-but-valid collections. */
function stubFetch(width) {
  return async (input) => {
    const raw = typeof input === 'string' ? input : (input?.url ?? '');
    const path = raw.split('?')[0];
    const body = (() => {
      if (path === '/api/me') return { user: { id: 'u_audit', email: 'owner@akbaral.test', name: 'Owner', role: 'owner' }, unlimited: false };
      if (path === '/api/chat') return { conversations: [] };
      if (path === '/api/models') return { models: [{ key: 'auto', name: 'Automatic', available: true, provider: 'auto' }] };
      if (path === '/api/chat/attachment-support') return { models: [] };
      if (path === '/api/projects') return { projects: [] };
      if (path === '/api/files') return { files: [] };
      if (path === '/api/images') return { images: [] };
      if (path === '/api/agents') return { agents: [] };
      if (path === '/api/automations') return { automations: [] };
      if (path === '/api/billing/summary' || path === '/api/billing') return { balance: 0, transactions: [] };
      if (path === '/api/dashboard') return { metrics: {} };
      if (path === '/api/plans' || path === '/api/pricing') return { plans: [] };
      return {};
    })();
    return {
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(),
      body: null,
    };
  };
}

/** A matchMedia that really answers min-width/max-width for the width under test. */
function makeMatchMedia(width) {
  return (query) => {
    const evaluate = () => String(query).split(',').every((clause) => {
      const minimum = clause.match(/min-width:\s*([\d.]+)px/);
      const maximum = clause.match(/max-width:\s*([\d.]+)px/);
      if (minimum && width < Number(minimum[1])) return false;
      if (maximum && width > Number(maximum[1])) return false;
      return true;
    });
    return {
      media: String(query),
      matches: evaluate(),
      onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    };
  };
}

export const PAGE_MODULES = {
  '/': '../../src/app/page.tsx',
  '/chat': '../../src/app/chat/page.tsx',
  '/work': '../../src/app/work/page.tsx',
  '/dashboard': '../../src/app/dashboard/page.tsx',
  '/settings': '../../src/app/settings/page.tsx',
  '/files': '../../src/app/files/page.tsx',
  '/projects': '../../src/app/projects/page.tsx',
  '/images': '../../src/app/images/page.tsx',
  '/agents': '../../src/app/agents/page.tsx',
  '/automations': '../../src/app/automations/page.tsx',
  '/billing': '../../src/app/billing/page.tsx',
  '/help': '../../src/app/help/page.tsx',
  '/pricing': '../../src/app/pricing/page.tsx',
  '/about': '../../src/app/(public)/about/page.tsx',
  '/team': '../../src/app/(public)/team/page.tsx',
  '/blog': '../../src/app/(public)/blog/page.tsx',
  '/contact': '../../src/app/(public)/contact/page.tsx',
};

/**
 * @param {{ page: string, width: number }} options
 * @returns {Promise<{ html: string, document: Document, window: Window }>}
 */
export async function renderPage({ page, width }) {
  const specifier = PAGE_MODULES[page];
  if (!specifier) throw new Error(`No page module registered for ${page}`);

  const dom = new JSDOM(// The real document title comes from Next metadata in src/app/layout.tsx,
  // which the harness does not execute; supplying it here keeps axe measuring
  // the page instead of the harness.
  '<!doctype html><html lang="en" data-theme="dark"><head><title>AKBARAL!</title></head><body><div id="root"></div></body></html>', {
    url: `https://audit.akbaral.test${page}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;

  window.matchMedia = makeMatchMedia(width);
  window.fetch = stubFetch(width);
  window.scrollTo = () => {};
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });

  const previous = {};
  const globals = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    Event: window.Event, CustomEvent: window.CustomEvent, KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent, FormData: window.FormData, Headers: window.Headers,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (cb) => window.setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => window.clearTimeout(id),
    matchMedia: window.matchMedia, fetch: window.fetch,
    IntersectionObserver: window.IntersectionObserver, ResizeObserver: window.ResizeObserver,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous[key] = globalThis[key];
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  globalThis.RESPONSIVE_PATHNAME = page;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    const React = (await import('react')).default ?? (await import('react'));
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const mod = await import(specifier);
    const Page = mod.default;

    const root = createRoot(window.document.getElementById('root'));
    await act(async () => { root.render(React.createElement(Page)); });
    // Let the account/catalog effects settle, then let their state land.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const html = window.document.body.innerHTML;
    return { html, document: window.document, window };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
}
