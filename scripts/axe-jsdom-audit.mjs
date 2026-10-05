#!/usr/bin/env node
/** Honest axe scope: server-rendered route HTML in jsdom. Hydrated client
 * interactions, focus traps, and browser geometry require the browser ladder. */
import { JSDOM, VirtualConsole } from 'jsdom';
import axe from 'axe-core';

const base = process.env.AUDIT_BASE || 'http://127.0.0.1:3000';
const routes = ['/', '/chat', '/work', '/settings', '/dashboard', '/pricing', '/signin', '/signup'];
let violations = 0;
for (const route of routes) {
  const html = await (await fetch(`${base}${route}`)).text();
  const dom = new JSDOM(html, { url: `${base}${route}`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  dom.window.eval(axe.source);
  const result = await dom.window.axe.run(dom.window.document, { runOnly: ['wcag2a', 'wcag2aa'] });
  violations += result.violations.length;
  console.log(`${route}: ${result.violations.length} violation groups, ${result.passes.length} pass groups`);
  dom.window.close();
}
console.log(`AXE JSDOM SSR SCOPE: ${violations === 0 ? 'PASS' : 'FAIL'} (${routes.length} server-rendered routes; hydrated interactions not exercised)`);
process.exitCode = violations ? 1 : 0;
