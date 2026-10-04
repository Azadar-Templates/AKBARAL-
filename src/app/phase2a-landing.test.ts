import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const landing = read('src/app/_components/landing/cinematic-landing.tsx');
const css = read('src/app/_components/landing/cinematic-landing.module.css');

describe('Atlas-structure landing contract', () => {
  it('has the identity, tagline and working primary actions', () => {
    assert.match(landing, /AKBARAL!/); assert.match(landing, /One Intelligence\./); assert.match(landing, /Every Solution\./);
    assert.match(landing, /href="\/signup"/); assert.match(landing, /href="\/signin"/); assert.match(landing, /See Plans/);
    assert.doesNotMatch(landing, /AKBARAL AI|ZA141251SA/);
  });
  it('contains the complete section flow without narrative scenes', () => {
    for (const marker of ['suggestions-title', 'features-title', 'integrations-title', 'demo-title', 'agents-title', 'security-title', 'started-title', 'faq-title', 'pricing-title', 'final-title']) assert.match(landing, new RegExp(marker));
    for (const marker of ['Understanding', 'Planning', 'Routing', 'Execution', 'Delivery', 'Approach', 'Connect', 'Build', 'Handoff']) assert.doesNotMatch(landing, new RegExp(`\\b${marker}\\b`));
    assert.doesNotMatch(landing, /ScrollTrigger|useGSAP|gsap|framer-motion/);
  });
  it('publishes the six exact USD plans and truthful registry wording', () => {
    for (const value of ["['Free', '$0', '5 tasks', '30-day trial']", "['Starter', '$10', '25 tasks', 'For focused work']", "['Pro', '$50', '100 tasks', 'For professionals']", "['Business', '$90', '250 tasks', 'For growing teams']", "['Scale', '$200', '750 tasks', 'For high-volume work']", "['Enterprise', '$400', '2,000 tasks', 'For organizations']"]) assert.ok(landing.includes(value));
    assert.match(landing, /4,001 registered agent contracts/); assert.match(landing, /not active or earning/);
  });
  it('supports accessible targets and narrow layouts', () => { assert.match(css, /min-width:44px;min-height:44px/); assert.match(css, /@media\(max-width:460px\)/); assert.match(css, /grid-template-columns:1fr/); });
  it('has no prohibited third-party names', () => { assert.doesNotMatch(landing, /Atlas|WorkOS|Slack|use\.ai|ChatGPT/); });
});
