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
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.locator('#boot-veil').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (let scene = 1; scene <= 6; scene += 1) {
      test(`scene ${scene} matches its baseline`, async ({ page }) => {
        await openLanding(page);
        const section = page.locator(`#scene-${scene}`);
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        await expect(section).toHaveScreenshot(`${viewport.name}-scene-${scene}.png`, {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  });
}

test.describe('accessibility and motion', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('landing has no automatic WCAG 2.1 A/AA violations', async ({ page }) => {
    await openLanding(page);
    const results = await new AxeBuilder({ page })
      .include('#screen-landing')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('landing controls have 44px targets and useful accessible names', async ({ page }) => {
    await openLanding(page);
    const failures = await page.locator('#screen-landing a, #screen-landing button').evaluateAll((controls) =>
      controls.flatMap((control) => {
        const rect = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        if (style.display === 'none' || style.visibility === 'hidden') return [];
        const name = control.getAttribute('aria-label') || control.textContent?.trim() || '';
        const issues: string[] = [];
        if (rect.height < 44 || rect.width < 44) issues.push(`${control.tagName} target ${rect.width}x${rect.height}`);
        if (!name) issues.push(`${control.tagName} has no accessible name`);
        return issues;
      }),
    );
    expect(failures).toEqual([]);
  });

  test('keyboard focus reaches the primary landing actions', async ({ page }) => {
    await openLanding(page);
    const start = page.getByRole('button', { name: /start free trial/i }).first();
    const plans = page.getByRole('button', { name: /see plans/i });
    await start.focus();
    await expect(start).toBeFocused();
    await expect(start).toHaveCSS('outline-style', 'solid');
    await plans.focus();
    await expect(plans).toBeFocused();
    await expect(plans).toHaveCSS('outline-style', 'solid');
  });

  test('reduced motion bypasses animated presentation and preserves all content', async ({ page }) => {
    await openLanding(page, 'reduce');
    await expect(page.locator('[class*="progress"]').first()).toHaveCSS('display', 'none');
    await expect(page.locator('.pin-spacer')).toHaveCount(0);
    for (let scene = 1; scene <= 6; scene += 1) {
      const section = page.locator(`#scene-${scene}`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await expect(section.locator('h1, h2').first()).toBeVisible();
    }
    await page.locator('#scene-1').scrollIntoViewIfNeeded();
    await expect(page.locator('#scene-1')).toHaveScreenshot('motion-reduced-scene-1.png', {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.01,
    });
  });

  test('motion-enabled presentation remains visually stable after settling', async ({ page }) => {
    await openLanding(page, 'no-preference');
    await page.waitForTimeout(1_600);
    await expect(page.locator('#scene-1')).toHaveScreenshot('motion-enabled-scene-1.png', {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.01,
    });
  });
});
