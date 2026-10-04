import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
] as const;

async function openLanding(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.emulateMedia({ reducedMotion });
  await page.goto('/#/', { waitUntil: 'networkidle' });
  await expect(page.locator('#screen-landing')).toBeVisible();
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await page.locator('#boot-veil').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

async function layoutFindings(page: Page) {
  return page.locator('#screen-landing').evaluate((root) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const controls = [...root.querySelectorAll('a,button,input,select,textarea')].filter(visible);
    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i += 1) for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
      const intersection = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (intersection > 4) overlaps.push(`${controls[i].tagName}:${controls[j].tagName}`);
    }
    const clipped = [...root.querySelectorAll('*')].filter(visible).flatMap((element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(element);
      const cuts = (style.overflowX === 'hidden' || style.overflowX === 'clip') && html.scrollWidth > html.clientWidth + 1;
      return cuts ? [element.tagName + (element.id ? `#${element.id}` : '')] : [];
    });
    return {
      horizontal: document.documentElement.scrollWidth - window.innerWidth,
      overlaps,
      clipped,
      shortTargets: controls.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).map((element) => element.tagName),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`landing reflows without collision at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openLanding(page);
    const findings = await layoutFindings(page);
    expect(findings.horizontal).toBeLessThanOrEqual(0);
    expect(findings.overlaps).toEqual([]);
    expect(findings.clipped).toEqual([]);
    expect(findings.shortTargets).toEqual([]);
    for (const marker of ['walk', 'power', 'work', 'handoff']) {
      await expect(page.locator(`[data-narrative="${marker}"]`)).toBeVisible();
    }
  });
}

test('landing passes WCAG 2.1 A/AA automated checks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openLanding(page);
  const results = await new AxeBuilder({ page }).include('#screen-landing')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('reduced motion is static while all narrative content remains available', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openLanding(page, 'reduce');
  await expect(page.locator('[class*="progress"]').first()).toHaveCSS('display', 'none');
  await expect(page.locator('.pin-spacer')).toHaveCount(0);
  for (const marker of ['walk', 'power', 'work', 'handoff']) {
    await expect(page.locator(`[data-narrative="${marker}"]`)).toBeVisible();
  }
});
