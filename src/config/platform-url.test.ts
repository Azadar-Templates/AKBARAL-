import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectPlatformPublicUrl, resolvePublicSiteUrl } from './platform-url';

/**
 * A bought domain must never be a launch requirement: every free host already
 * serves a working HTTPS hostname. These tests lock the detection so the
 * launch gate cannot silently start demanding a purchase again.
 */
describe('free public URL detection', () => {
  it('uses the Hugging Face Space hostname', () => {
    const detected = detectPlatformPublicUrl({ SPACE_HOST: 'akbaral-akbaral.hf.space' });
    assert.equal(detected?.url, 'https://akbaral-akbaral.hf.space');
    assert.equal(detected?.source, 'Hugging Face Spaces');
    assert.equal(detected?.envKey, 'SPACE_HOST');
  });

  it('derives the Space hostname from SPACE_ID when SPACE_HOST is absent', () => {
    const detected = detectPlatformPublicUrl({ SPACE_ID: 'Owner/AKBARAL' });
    assert.equal(detected?.url, 'https://owner-akbaral.hf.space');
  });

  it('recognises the other free hosts', () => {
    assert.equal(detectPlatformPublicUrl({ RENDER_EXTERNAL_URL: 'https://akbaral.onrender.com' })?.source, 'Render');
    assert.equal(detectPlatformPublicUrl({ KOYEB_PUBLIC_DOMAIN: 'akbaral.koyeb.app' })?.url, 'https://akbaral.koyeb.app');
    assert.equal(detectPlatformPublicUrl({ FLY_APP_NAME: 'akbaral' })?.url, 'https://akbaral.fly.dev');
    assert.equal(detectPlatformPublicUrl({ RAILWAY_PUBLIC_DOMAIN: 'akbaral.up.railway.app' })?.source, 'Railway');
    assert.equal(detectPlatformPublicUrl({ VERCEL_URL: 'akbaral.vercel.app' })?.source, 'Vercel');
  });

  it('always forces https and strips trailing slashes', () => {
    assert.equal(detectPlatformPublicUrl({ RENDER_EXTERNAL_URL: 'http://akbaral.onrender.com/' })?.url, 'https://akbaral.onrender.com');
  });

  it('returns null off-platform instead of inventing a hostname', () => {
    assert.equal(detectPlatformPublicUrl({}), null);
    assert.equal(detectPlatformPublicUrl({ SPACE_ID: 'no-slash' }), null);
  });

  it('explicit configuration always wins over detection', () => {
    const resolved = resolvePublicSiteUrl({ AKBARAL_SITE_URL: 'https://akbaral.example/', SPACE_HOST: 'x.hf.space' });
    assert.equal(resolved?.url, 'https://akbaral.example');
    assert.equal(resolved?.source, 'explicit configuration');
  });
});
